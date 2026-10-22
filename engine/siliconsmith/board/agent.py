"""Board agent loop: Nemotron proposes or repairs a design, deterministic code judges it.

The model is never trusted. Every proposal is run through the ladder (checks.run_ladder); a design counts as passing
only when every implemented rung returns `pass`. Failures go back to the model as rung, detail and evidence ids, up to
`max_rounds`. Design assumptions (battery size, target, duty cycle, bus mode) come from the user's Brief and replace
whatever the model wrote, so the model cannot pass B5 by changing the battery.

`llm` is anything with `json(tier, role, messages, schema, *, think, node_id=None) -> (obj, reply)`, which is the
interface of `siliconsmith.llm.Nemotron` (Nemotron on Nebius Token Factory). Tests use a scripted stand-in.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from .checks import IMPLEMENTED_RUNGS, CheckResult, run_ladder
from .netlist import Design
from .parts import Part, resolve_fact

Event = Callable[[str, dict[str, Any]], None]

SYSTEM = (
    "You are a board-level co-design assistant. You output ONE JSON object that is a complete design: instances "
    "(ref, part, params), nets (name, pins as REF.PIN), mcu_ref, mcu_assignments (function, pin, use, net) and "
    "firmware_pins (function, pin, use). Rules: use ONLY the parts and pin names in the library below; never invent "
    "pins or parts; every pin name is exact. Pin 'use' is input, output or bidir. The firmware pin table must equal "
    "the netlist's assignments. Avoid flash pins, strapping pins and input-only pins used as outputs. Resistor values go in "
    "params.ohms. Do not include an 'assumptions' field. Reply with the JSON object only."
)


@dataclass
class Brief:
    name: str
    text: str
    assumptions: dict[str, float | int | str] = field(default_factory=dict)


@dataclass
class Attempt:
    design: Design
    results: list[CheckResult]

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


def library_brief(library: dict[str, Part]) -> str:
    """Compact text of the parts the model may use. Facts are shown with their checked/unchecked state."""
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


def _loop(llm: Any, messages: list[dict], brief: Brief, library: dict[str, Part], *, role: str, max_rounds: int,
          first: Design | None, tier: str, on_event: Event | None) -> AgentResult:
    spent0 = getattr(llm, "spent_usd", 0.0)
    attempts: list[Attempt] = []
    design = first
    for rnd in range(1, max_rounds + 1):
        if design is None:
            try:
                proposed, _ = llm.json(tier, role, messages, Design, think=rnd == 1, node_id=f"{role}.{rnd}")
            except Exception as e:  # LLMError, BudgetExceeded, network: report, do not hide
                return AgentResult(False, attempts[-1].design if attempts else None, attempts,
                                   error=f"{type(e).__name__}: {e}", cost_usd=getattr(llm, "spent_usd", 0.0) - spent0)
            design = _apply_brief(proposed, brief)
        attempt = Attempt(design, run_ladder(design, library))
        attempts.append(attempt)
        if on_event:
            on_event("board.attempt", {"round": rnd, "passed": attempt.passed,
                                       "rungs": {r.rung: r.status for r in attempt.results}})
        if attempt.passed:
            return AgentResult(True, design, attempts, cost_usd=getattr(llm, "spent_usd", 0.0) - spent0)
        messages = messages + [
            {"role": "assistant", "content": design.model_dump_json()},
            {"role": "user", "content": "The deterministic checks rejected this design:\n"
             + _feedback(attempt.results, library) + "\nReply with the corrected complete design JSON only."},
        ]
        design = None
    return AgentResult(False, attempts[-1].design, attempts, error="round limit reached with the ladder still failing",
                       cost_usd=getattr(llm, "spent_usd", 0.0) - spent0)


def propose_design(llm: Any, brief: Brief, library: dict[str, Part], *, max_rounds: int = 3, tier: str = "super",
                   on_event: Event | None = None) -> AgentResult:
    """Template or free-text brief to a design that passes the implemented ladder, or an honest failure."""
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": _brief_message(brief, library)}]
    return _loop(llm, messages, brief, library, role="board.propose", max_rounds=max_rounds, first=None, tier=tier,
                 on_event=on_event)


def repair_design(llm: Any, design: Design, brief: Brief, library: dict[str, Part], *, max_rounds: int = 3,
                  tier: str = "super", on_event: Event | None = None) -> AgentResult:
    """Start from an existing (possibly faulty) design; the first attempt is judged before the model is called."""
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": _brief_message(brief, library)}]
    return _loop(llm, messages, brief, library, role="board.repair", max_rounds=max_rounds,
                 first=_apply_brief(design, brief), tier=tier, on_event=on_event)
