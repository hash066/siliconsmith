"""Board agent loop: Nemotron proposes or repairs a design, deterministic code judges it.

The model is never trusted. Every proposal is run through the ladder (checks.run_ladder); a design counts as passing
only when every implemented rung returns `pass`. Failures go back to the model as rung, detail and evidence ids, up to
`max_repairs` times. Design assumptions (battery size, target, duty cycle, bus mode) come from the user's Brief and
replace whatever the model wrote, so the model cannot pass B5 by changing the battery. The firmware pin header judged
by B4 is the one our own generator writes from the design's firmware pin table, parsed back.

Ultra architects the first design; Super repairs from the structured check failures. `llm` is anything with
`json(tier, role, messages, schema, *, think, node_id=None) -> (obj, reply)` and an optional `spent_usd`, which is the
interface of `siliconsmith.llm.Nemotron` (Nemotron on Nebius Token Factory). `bus` is anything with
`emit(type, **fields)` (events.EventBus); events follow contract v2 in docs/contracts/events.md.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .checks import IMPLEMENTED_RUNGS, RUNG_LABELS, CheckResult, run_ladder
from .export import firmware_header
from .netlist import Design
from .parts import Part, resolve_fact

SYSTEM = (
    "You are a board-level co-design assistant. You output ONE JSON object that is a complete design: instances "
    "(ref, part, params), nets (name, pins as REF.PIN), mcu_ref, mcu_assignments (function, pin, use, net) and "
    "firmware_pins (function, pin, use). Rules: use ONLY the parts and pin names in the library below; never invent "
    "pins or parts; every pin name is exact. Pin 'use' is input, output or bidir. Function names are lower-case "
    "snake_case. The firmware pin table must equal the netlist's assignments. Avoid flash pins, strapping pins and "
    "input-only pins used as outputs. Every pin marked * (required) must be connected. Every power input must sit on a "
    "net driven by a power output. Resistor values go in params.ohms. Do not include an 'assumptions' field. "
    "Reply with the JSON object only."
)

RUNG_TOOL = {"B1": "board.checks.run_b1", "B2": "board.checks.run_b2", "B3": "board.checks.run_b3",
             "B4": "board.checks.run_b4", "B5": "board.checks.run_b5"}
LADDER_EVENT = [{"id": r, "label": RUNG_LABELS[r], "tool": RUNG_TOOL[r]} for r in IMPLEMENTED_RUNGS]


@dataclass
class Brief:
    name: str
    text: str
    assumptions: dict[str, float | int | str] = field(default_factory=dict)


@dataclass
class Attempt:
    node_id: str
    design: Design
    results: list[CheckResult]
    header: str

    @property
    def passed(self) -> bool:
        return [r.rung for r in self.results] == list(IMPLEMENTED_RUNGS) and all(r.status == "pass" for r in self.results)


@dataclass
class AgentResult:
    passed: bool
    design: Design | None
    attempts: list[Attempt]
    error: str | None = None
    cost_usd: float = 0.0

    @property
    def final(self) -> Attempt | None:
        return self.attempts[-1] if self.attempts else None


def library_brief(library: dict[str, Part]) -> str:
    """Compact text of the parts the model may use. Pin tables are exhaustive."""
    out = []
    for part in library.values():
        if part.kind == "standard":
            continue
        out.append(f"PART {part.id}: {part.name} [{part.origin}]")
        for p in part.pins:
            caps = ",".join(p.capabilities)
            lim = ""
            if p.v_rec_min is not None or p.v_rec_max is not None:
                lim = f" supply {p.v_rec_min}-{p.v_rec_max}V"
            if p.v_out_min is not None:
                lim += f" drives {p.v_out_min}-{p.v_out_max}V"
            out.append(f"  pin {p.name} #{p.number} {p.direction}{'*' if p.required else ''}"
                       f"{(' [' + caps + ']') if caps else ''}{lim}")
        for f in part.facts:
            out.append(f"  fact {f.key}: {f.text}")
    out.append("(* = required pin; each part's pin table is exhaustive)")
    return "\n".join(out)


def _feedback(results: list[CheckResult], library: dict[str, Part]) -> str:
    lines = []
    for r in results:
        if r.status == "pass":
            continue
        lines.append(f"{r.rung} {r.status.upper()}: {r.detail}")
        for e in r.evidence[:8]:
            prov = resolve_fact(library, e)
            lines.append(f"  evidence {e}" + (f" ({prov.section})" if prov else ""))
    return "\n".join(lines)


def _brief_message(brief: Brief, library: dict[str, Part]) -> str:
    return f"LIBRARY\n{library_brief(library)}\n\nBRIEF ({brief.name})\n{brief.text}"


def _apply_brief(design: Design, brief: Brief) -> Design:
    design = design.copy()
    design.assumptions = dict(brief.assumptions)
    if not design.name:
        design.name = brief.name
    return design


def _rung_status(r: CheckResult) -> str:
    """Contract stage status: pass | fail | skipped. Unknown (including 'not run') is shown as skipped, never pass."""
    return r.status if r.status in ("pass", "fail") else "skipped"


def _emit(bus: Any, type_: str, **fields: Any) -> None:
    if bus is not None:
        bus.emit(type_, **fields)


def _judge(bus: Any, node_id: str, attempt_no: int, design: Design, library: dict[str, Part]) -> Attempt:
    """Run the ladder on one node, emitting one stage event per rung (with the evidence ids) and node.scored."""
    try:
        header = firmware_header(design)
    except ValueError as e:
        header = f"/* header could not be generated: {e} */\n"  # B4 then fails on an unreadable header
    _emit(bus, "node.stage", node_id=node_id, stage="implement", status="pass", attempt=attempt_no,
          detail="design JSON received" if attempt_no == 0 else "design repaired from check failures")
    results = run_ladder(design, library, header)
    for r in results:
        _emit(bus, "node.stage", node_id=node_id, stage=r.rung, status="running", attempt=attempt_no)
        _emit(bus, "node.stage", node_id=node_id, stage=r.rung, status=_rung_status(r), attempt=attempt_no,
              detail=r.detail[:400], evidence=r.evidence, label=r.label)
    att = Attempt(node_id, design, results, header)
    _emit(bus, "node.scored", node_id=node_id,
          metrics={"instances": len(design.instances), "nets": len(design.nets),
                   "rungs_passed": sum(r.status == "pass" for r in results), "rungs_total": len(results)},
          ladder={r.rung: _rung_status(r) for r in results}, feasible=att.passed)
    return att


def _node_created(bus: Any, node_id: str, parent: str, depth: int, title: str, rationale: str) -> None:
    # The v1 Proposal shape is silicon's; non-silicon fields are filled with honest placeholders.
    _emit(bus, "node.created", node_id=node_id, parent_id=parent, depth=depth, instruction_set=[],
          proposal={"kind": "design", "mnemonic": f"design.{node_id}", "title": title, "semantics_c": "",
                    "operands": {"rs1": "-", "rs2": "-", "rd": "-"}, "rationale": rationale})


def _loop(llm: Any, messages: list[dict], brief: Brief, library: dict[str, Part], *, max_repairs: int,
          first: Design | None, first_note: str, bus: Any, think_first: bool) -> AgentResult:
    spent0 = getattr(llm, "spent_usd", 0.0)
    cost = lambda: getattr(llm, "spent_usd", 0.0) - spent0  # noqa: E731
    attempts: list[Attempt] = []
    design = first
    parent, node_id = "root", "n1"
    _emit(bus, "node.created", node_id="root", parent_id=None, depth=0, proposal=None, instruction_set=[])
    for rnd in range(max_repairs + 1):
        if design is None:
            tier, role = ("ultra", "architect") if rnd == 0 else ("super", "repair")
            try:
                proposed, _ = llm.json(tier, role, messages, Design, think=think_first and rnd == 0, node_id=node_id)
            except Exception as e:  # LLMError, BudgetExceeded, network: report, do not hide
                _emit(bus, "log", level="error", msg=f"{role} call failed: {type(e).__name__}: {e}"[:400], node_id=parent)
                return AgentResult(False, attempts[-1].design if attempts else None, attempts,
                                   error=f"{type(e).__name__}: {e}", cost_usd=cost())
            design = _apply_brief(proposed, brief)
            title = "Architect proposal" if rnd == 0 else f"Repair {rnd}"
            note = f"{tier} {role} output, judged by deterministic checks"
        else:
            title, note = "Starting design", first_note
        _node_created(bus, node_id, parent, rnd + 1, title, note)
        attempt = _judge(bus, node_id, rnd, design, library)
        attempts.append(attempt)
        if attempt.passed:
            return AgentResult(True, design, attempts, cost_usd=cost())
        failed = [f"{r.rung} {r.status}" for r in attempt.results if r.status != "pass"]
        _emit(bus, "node.pruned", node_id=node_id, reason=("; ".join(failed) + ": " + attempt.results[
            next(i for i, r in enumerate(attempt.results) if r.status != "pass")].detail)[:300])
        messages = messages + [
            {"role": "assistant", "content": design.model_dump_json()},
            {"role": "user", "content": "The deterministic checks rejected this design:\n"
             + _feedback(attempt.results, library) + "\nReply with the corrected complete design JSON only."},
        ]
        design = None
        if rnd < max_repairs:
            child = f"{node_id}.1"
            _emit(bus, "node.expanded", node_id=node_id, children=[child])
            parent, node_id = node_id, child
    return AgentResult(False, attempts[-1].design, attempts, cost_usd=cost(),
                       error="repair limit reached with the ladder still failing")


def propose_design(llm: Any, brief: Brief, library: dict[str, Part], *, max_repairs: int = 2, bus: Any = None,
                   think_first: bool = False) -> AgentResult:
    """Template or free-text brief to a design that passes the implemented ladder, or an honest failure."""
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": _brief_message(brief, library)}]
    return _loop(llm, messages, brief, library, max_repairs=max_repairs, first=None, first_note="", bus=bus,
                 think_first=think_first)


def repair_design(llm: Any, design: Design, brief: Brief, library: dict[str, Part], *, max_repairs: int = 2,
                  bus: Any = None, first_note: str = "supplied design (not model output)",
                  think_first: bool = False) -> AgentResult:
    """Start from an existing (possibly faulty) design: it is judged before the model is called, then repaired."""
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": _brief_message(brief, library)}]
    return _loop(llm, messages, brief, library, max_repairs=max_repairs, first=_apply_brief(design, brief),
                 first_note=first_note, bus=bus, think_first=think_first)
