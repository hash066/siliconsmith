"""run_live: ONE candidate instruction, proposed, implemented and verified, under hard caps.

It reuses the engine's Search for everything that matters (the architect/implementer/repair/triage prompts, the
develop loop with up to two repairs, scoring and pruning), so a live run is the same mechanism as the recorded 20-minute
search, cut down to one branch:

    Ultra proposes 2 instructions -> we develop the one it ranks best (k_root=1, depth=1)
    Super writes RTL + C reference + kernel rewrite, and (separately) the golden spec
    the Sandbox lints the spec, then runs the ladder: lint, 1M unit vectors, whole-program output, bench, formal proof, area
    NO polish rounds and NO Fmax (the place-and-route toolchain is not in the hosted function)

The baseline is not re-measured: it is read from baselines/<id>.json (measured once in a real Sandbox).
"""

from __future__ import annotations

import hashlib
import json
import itertools
import os
import secrets
import tempfile
import threading
import time
from pathlib import Path
from typing import Iterator

from .. import hwgen, ladder
from ..agent import prompts as P
from ..agent.schemas import SpecRtl
from ..bundle import render_report
from ..config import Settings, settings as load_settings
from ..llm import LLMError
from ..search import Node, Search, SearchConfig
from ..tools.workload import Workload
from . import baseline as baselines
from .bus import LiveBus
from .limits import (WORKLOADS, Deadline, LiveError, check_caps, check_workload, clean_note, DEFAULT_BUDGET_USD,
                     DEFAULT_SECONDS)

AREA_BUDGET_PCT = 5.0
GRACE_S = 10.0  # the stream may outlive the cap by this much while the last in-flight call returns

LADDER = [
    {"id": "L1", "label": "Builds cleanly (Verilator lint)", "tool": "verilator"},
    {"id": "L2", "label": "Matches the C reference on 1,000,000 vectors", "tool": "verilator"},
    {"id": "L3", "label": "Formally proven equal to an independent spec", "tool": "yosys"},
    {"id": "L4", "label": "Whole program output is bit-identical", "tool": "riscv-gcc + verilator"},
    {"id": "L5", "label": "Area within budget (Gowin synthesis)", "tool": "yosys"},
    {"id": "L6", "label": "Wall-clock speedup (Fmax place-and-route)", "tool": "nextpnr"},
]
SCOPE = ("Live run: one candidate instruction, up to 2 repairs, no polish rounds. Fmax place-and-route is not run in the "
         "hosted function, so the result is a cycle speedup and an area figure, not a wall-clock speedup.")


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class LiveSearch(Search):
    """Search cut to one branch, with Sandbox-only execution and an in-memory bus."""

    def __init__(self, wl: Workload, cfg: SearchConfig, bus: LiveBus, llm, backend, base: ladder.Measured,
                 base_image: str):
        self.wl, self.cfg, self.bus, self.llm, self.backend = wl, cfg, bus, llm, backend
        self.s = llm.s if hasattr(llm, "s") else None
        self.run_id = bus.run_id
        self.work = Path(tempfile.gettempdir()) / "ss-live" / bus.run_id  # scratch path only; nothing runs on the host
        self.nodes: list[Node] = []
        self._ids: dict = {}
        self._lock = threading.Lock()
        self._ops = itertools.count(1)
        self.tried: list[str] = []
        self.patch_name = wl.patchable[0]
        self.base_fmax = None
        self.base = base
        self.base_image = base_image
        self.last_fail: dict[str, tuple[str, str]] = {}  # node id -> (stage, detail) of the last failing stage
        self.deadline_s = 0.0
        self.last_impl: dict[str, dict] = {}  # node id -> artifacts of the last implementation (for the report)

    # every stage event also remembers the last failure and the last implementation, for the verdict and the report
    def _stage(self, node, stage, status, attempt, detail="", artifacts=None):
        if status == "fail":
            self.last_fail[node.id] = (stage, detail)
        if stage == "implement" and status == "pass" and artifacts:
            self.last_impl[node.id] = artifacts
        super()._stage(node, stage, status, attempt, detail, artifacts)

    def write_spec(self, node: Node, name: str, c_ref: str, attempts: int = 3) -> str:
        """The golden spec is written by Super independently from the C reference only, then VALIDATED in the Sandbox
        (lint + agreement with C) before the proof may trust it. Same rule as the full search; the tools run remotely."""
        from .llm import CapReached
        from .backend import SandboxCapReached

        msgs = [{"role": "system", "content": P.SPEC_SYSTEM},
                {"role": "user", "content": P.SPEC_USER.format(name=name, c_ref=hwgen.normalize_c_ref(c_ref))}]
        err = ""
        for _ in range(attempts):
            spec, rep = self.llm.json("super", "implement", msgs, SpecRtl, think=True, node_id=node.id, max_tokens=8000)
            try:
                ok, msg, log = self.backend.check_spec(name, c_ref, spec.spec_rtl)
            except SandboxCapReached as e:
                raise CapReached(f"wall-time cap: {e}") from e
            if ok:
                self.bus.log(f"{node.id}: golden spec written independently from C and validated in the Sandbox on {msg}",
                             node_id=node.id)
                return spec.spec_rtl
            err = msg + "\n" + log[-2500:]
            msgs = msgs + [{"role": "assistant", "content": rep.content[-6000:]},
                           {"role": "user", "content": "That spec module failed validation:\n" + err +
                            "\nFix it. Plain Verilog-2005: declare all variables at module level, use integer loop "
                            "variables, no declarations inside begin/end blocks. Reply with ONLY {\"spec_rtl\": \"...\"}"}]
        raise LLMError(f"could not produce a valid spec after {attempts} attempts: {err[:300]}")

    # ------------------------------------------------------------------ the run
    def choose(self, props) -> tuple:
        """Ultra ranks by expected speedup; take the best one whose own area estimate fits the budget."""
        fits = [p for p in props if p.est_area_pct <= self.cfg.area_budget_pct]
        pool = fits or props
        best = max(pool, key=lambda p: p.est_speedup)
        return best, [p for p in props if p is not best]

    def run(self, deadline: Deadline, caps: dict, tool_versions: dict, meta: dict) -> dict:
        """Emits every event; returns the result dict (verdict, headline, ...) that the bundle is built from."""
        c, bus, wl = self.cfg, self.bus, self.wl
        self.deadline_s = deadline.max_seconds
        t0 = time.monotonic()
        bus.emit("run.started", domain="silicon", ladder=LADDER, tool_versions=tool_versions, live=True, caps=caps,
                 workload={"id": wl.id, "title": wl.title, "lang": "c",
                           "source_repo": wl.manifest.get("source", {}).get("repo"),
                           "source_path": wl.manifest.get("source", {}).get("path")},
                 config={"area_budget_pct": c.area_budget_pct, "beam": c.beam, "k_root": c.k_root,
                         "k_child": c.k_child, "max_depth": c.max_depth, "max_concurrency": c.max_concurrency},
                 backend=self.backend.name)
        b = self.base
        root = Node(id="root", parent=None, depth=0, isa=[], patch={}, measured=b, status="scored", image=self.base_image)
        self.nodes.append(root)
        bus.emit("run.baseline", cycles=b.cycles, luts=b.area.luts + b.area.alus, ffs=b.area.ffs, cells=b.area.cells,
                 fmax_mhz=None, output_hash=b.hash, cached=True, measured_at=meta.get("measured_at"),
                 hotspots=[{**h, "symbol": h.get("symbol") or h.get("function")} for h in b.hotspots])
        bus.emit("node.created", node_id="root", parent_id=None, depth=0, proposal=None, instruction_set=[])
        bus.log("Baseline measured once in a real Sandbox and cached (" + str(meta.get("measured_at", "?")) + "). " + SCOPE)

        props = self._safe_propose(root, 2)
        if not props:
            return self._finish(t0, None, root, "failed", "The architect model returned no usable proposal "
                                "(see the log above for why).", stage="propose", reason="no proposal")
        prop, others = self.choose(props)
        for o in others:
            bus.log(f"Also proposed, not developed in this live run: {o.mnemonic} ({o.title})", node_id="root")
        node = Node(id=self._child_id(root), parent=root, depth=1, isa=[], patch={}, proposal=prop)
        root.children.append(node)
        self.nodes.append(node)
        self.tried.append(f"{prop.mnemonic} ({prop.title})")
        bus.emit("node.created", node_id=node.id, parent_id="root", depth=1, instruction_set=[prop.mnemonic],
                 proposal={"kind": "instruction", "mnemonic": prop.mnemonic, "title": prop.title,
                           "semantics_c": prop.semantics_c, "operands": {"rs1": "u32", "rs2": "u32", "rd": "u32"},
                           "rationale": prop.rationale, "est_speedup": prop.est_speedup,
                           "est_area_pct": prop.est_area_pct})
        bus.emit("node.expanded", node_id="root", children=[node.id])
        try:
            self.develop(node, prop, hwgen.CpuConfig().next_funct7())
        except Exception as e:  # noqa: BLE001 - infrastructure (Sandbox/network) failure, not a verdict on the design
            if node.status != "pruned":
                self._prune(node, f"infrastructure error: {type(e).__name__}: {e}"[:300])
            return self._finish(t0, node, root, "error", f"The run stopped on an infrastructure error "
                                f"({type(e).__name__}). This says nothing about the instruction.",
                                reason=f"{type(e).__name__}: {e}"[:300])
        return self._finish(t0, node, root)

    def _verdict(self, node: Node) -> tuple[str, str, str, str]:
        """(verdict, headline, failed stage, reason) from what the ladder really said."""
        mn = node.proposal.mnemonic if node.proposal else "the instruction"
        if node.status == "scored":
            m = node.measured
            return ("verified_faster",
                    f"Verified: {mn} makes the program {node.speedup:.2f}× faster in cycles ({self.base.cycles:,} → "
                    f"{m.cycles:,}) for {node.area_delta:+.1f}% area. Output is bit-identical to the original and the "
                    "hardware is formally proven equal to an independent spec. Wall-clock time was not measured.",
                    "", "")
        stage, detail = self.last_fail.get(node.id, ("", ""))
        reason = self.pruned_reason(node)
        if "wall-time cap" in reason or "run budget" in reason:
            what = (f"the {self.deadline_s:.0f} s time cap" if "wall-time cap" in reason
                    else f"the ${self.llm.s.run_budget_usd:.2f} spend cap")
            last = f" The last rung that failed was `{stage}`: {detail}" if stage else ""
            return ("stopped", f"Stopped by {what} before {mn} could be verified.{last} Nothing here is a verified "
                    "result; try again.", stage, reason)
        if reason.startswith("no speedup"):
            return ("no_speedup", f"Not faster: {mn} produced bit-identical output but did not cut cycles, so it was "
                    f"rejected at the benchmark ({reason}). The formal proof and area were not run for it.", "bench", reason)
        if reason.startswith("over area budget"):
            return ("over_budget", f"Rejected on area: {mn} is correct and faster but {reason}. It was proven equal to "
                    "its spec, but the budget is a hard rule.", "synth", reason)
        return ("failed", f"Failed verification at {stage or 'the ladder'}: {reason}", stage, reason)

    def pruned_reason(self, node: Node) -> str:
        for e in reversed(self.bus.events):
            if e["type"] == "node.pruned" and e["node_id"] == node.id:
                return e["reason"]
        return ""

    def _finish(self, t0: float, node: Node | None, root: Node, verdict: str | None = None, headline: str = "",
                stage: str = "", reason: str = "") -> dict:
        bus = self.bus
        if verdict is None:
            verdict, headline, stage, reason = self._verdict(node)
        stopped_by = "time" if "wall-time cap" in reason else "budget" if "run budget" in reason else None
        totals = {"cost_usd": round(self.llm.spent_usd, 4), "tokens": self.llm.tokens,
                  "wall_s": round(time.monotonic() - t0, 1)}
        best = node if node is not None and node.status == "scored" else root
        report = {"verdict": verdict, "headline": headline, "stopped_by": stopped_by,
                  "wall_clock": "not measured (no place-and-route in the hosted function)",
                  "cost_note": "cost_usd is model tokens only; Sandbox compute is not included"}
        sandboxes = getattr(self.backend, "sandbox_runs", None)
        if sandboxes is None:
            sandboxes = next(self._ops) - 1
        bus.emit("run.completed", best_node_id=best.id, pareto=[best.id] if best is not root else [],
                 totals={"nodes": len(self.nodes) - 1, "sandboxes": sandboxes, **totals}, report=report)
        result = {"verdict": verdict, "headline": headline, "failed_stage": stage, "reason": reason,
                  "stopped_by": stopped_by, "totals": totals, "node": node, "best": best}
        return result

    # ------------------------------------------------------------------ the downloadable bundle
    def bundle_files(self, result: dict, deadline: Deadline) -> list[dict]:
        best: Node = result["best"]
        node: Node | None = result["node"]
        files: dict[str, str] = {}
        if result["verdict"] == "verified_faster":
            ins = best.isa[-1]
            cfg = hwgen.CpuConfig(list(best.isa))
            files[f"rtl/ss_insn_{ins.name}.v"] = ins.rtl.strip() + "\n"
            files["rtl/ss_pcpi.v"] = hwgen.render_pcpi(cfg)
            files[f"proof/ss_spec_{ins.name}.v"] = best.spec.strip() + "\n"
            files["include/ss_intrinsics.h"] = hwgen.render_intrinsics(cfg)
            for name, text in best.patch.items():
                files[f"src/{name}"] = text if text.endswith("\n") else text + "\n"
                for cand in (self.wl.dir / name, self.wl.dir / "src" / name):  # the original, for a before/after view
                    if cand.is_file():
                        files[f"src/original/{name}"] = cand.read_text(encoding="utf-8")
                        break
            viz = getattr(self.backend, "viz", None)
            if viz is not None and deadline.remaining() >= 50:
                data = viz(ins.name, ins.rtl, ins.c_ref)
                if data:
                    vcd = data.pop("vcd", "")
                    if vcd:  # every signal of the instruction on the eight operand pairs, openable in GTKWave
                        files["views/waveform.vcd"] = vcd
                    files["views/instruction.json"] = json.dumps(data, separators=(",", ":")) + "\n"
            report = render_report(self.wl, self.base, best, self.bus.events)
        else:
            report = self._failure_report(result, node)
        files["REPORT.md"] = self._scope_section(result, deadline) + "\n" + report
        return [{"name": n, "content": c, "sha256": _sha(c)} for n, c in files.items()]

    def _scope_section(self, result: dict, deadline: Deadline) -> str:
        t = result["totals"]
        return "\n".join([
            f"> **{result['headline']}**", ">",
            f"> {SCOPE}", ">",
            f"> Spent ${t['cost_usd']:.3f} on model tokens ({t['tokens']:,} tokens) in {t['wall_s']:.0f} s "
            f"(caps ${self.llm.s.run_budget_usd:.2f} and {deadline.max_seconds:.0f} s). Sandbox compute is not included. "
            "The baseline was measured once in a real Sandbox and reused.", ""])

    def _failure_report(self, result: dict, node: Node | None) -> str:
        lines = [f"# SiliconSmith live run: {self.wl.title}", "", f"**Result: {result['verdict'].replace('_', ' ')}.** "
                 + result["headline"], "",
                 "No file in this bundle is a verified design. The candidate below is shown only so you can see what the "
                 "model tried; it did not pass the ladder and must not be used.", ""]
        if node is not None:
            p = node.proposal
            lines += [f"## Candidate: `{p.mnemonic}` ({p.title})", "", p.rationale, "", "```c", p.semantics_c.strip(), "```", ""]
            arts = self.last_impl.get(node.id)
            if arts:
                lines += ["### Last RTL the model wrote (unverified)", "", "```verilog", arts["rtl"].strip(), "```", ""]
            st = self.last_fail.get(node.id)
            if st:
                lines += [f"### Where it stopped: `{st[0]}`", "", st[1], ""]
        return "\n".join(lines)


def _tool_versions(meta: dict) -> dict:
    v = dict(meta.get("tool_versions") or {})
    v["baseline_measured_at"] = meta.get("measured_at", "unknown")
    return v


def run_live(workload: str, budget_usd: float = DEFAULT_BUDGET_USD, max_seconds: float = DEFAULT_SECONDS,
             backend="contree", note: str | None = None, *, llm=None, config: Settings | None = None) -> Iterator[dict]:
    """Validate, then return an iterator of v2 event dicts ending with a `bundle` event.

    `backend` is "contree" (Token Factory Sandboxes, the only value the HTTP endpoint uses) or a Backend object with
    `check_spec` (tests). `llm` is for tests (an object with .json/.s/.spent_usd/.tokens); production builds Nemotron.
    Raises LiveError for a bad request BEFORE returning the iterator.
    """
    wid = check_workload(workload)
    budget_usd, max_seconds = check_caps(budget_usd, max_seconds)
    note = clean_note(note)
    if isinstance(backend, str) and backend != "contree":
        raise LiveError("bad_backend", "the live pipeline runs only in Token Factory Sandboxes (backend='contree')")
    cfg_s = config or load_settings()
    if llm is None and not cfg_s.api_key:
        raise LiveError("not_configured", "NEBIUS_API_KEY is not set on this host", 503)
    try:
        base, meta = baselines.load(wid)
    except FileNotFoundError:
        raise LiveError("no_baseline", f"no cached baseline for {wid}: run `python -m siliconsmith.live baseline {wid}`",
                        503) from None
    return _stream(wid, budget_usd, max_seconds, backend, note, llm, cfg_s, base, meta)


def _stream(wid, budget_usd, max_seconds, backend, note, llm, cfg_s, base, meta) -> Iterator[dict]:
    run_id = "live-" + time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3)
    key = cfg_s.api_key or os.environ.get("NEBIUS_API_KEY", "")
    bus = LiveBus(run_id, secrets=(key,))
    deadline = Deadline(max_seconds)
    wl = Workload.load(WORKLOADS[wid])
    cfg = SearchConfig(k_root=1, k_child=0, beam=1, max_depth=1, area_budget_pct=AREA_BUDGET_PCT, max_concurrency=1,
                       max_repairs=2, vectors=1_000_000, polish=False)
    caps = {"budget_usd": budget_usd, "max_seconds": max_seconds}
    state: dict = {}

    def work() -> None:
        try:
            from .llm import LiveNemotron

            the_llm = llm or LiveNemotron(cfg_s, bus, deadline, budget_usd, note)
            if llm is not None:
                llm.bus = bus
            the_backend = backend
            if isinstance(backend, str):
                from .backend import LiveBackend

                the_backend = LiveBackend(deadline, bus)
            s = LiveSearch(wl, cfg, bus, the_llm, the_backend, base, getattr(the_backend, "base_image", "base"))
            state["search"] = s
            result = s.run(deadline, caps, _tool_versions(meta), meta)
            files = s.bundle_files(result, deadline)
            bus.emit("bundle", verdict=result["verdict"], headline=result["headline"], files=files,
                     totals=result["totals"], scope=SCOPE)
        except Exception as e:  # noqa: BLE001 - any crash is reported as a failed run, never as a bare disconnect
            bus.emit("run.failed", error=f"{type(e).__name__}: {e}"[:500])
        finally:
            bus.close()

    th = threading.Thread(target=work, name=f"live-{run_id}", daemon=True)
    th.start()
    import queue

    hard_stop = deadline.start + max_seconds + GRACE_S
    while True:
        try:
            ev = bus.queue.get(timeout=1.0)
        except queue.Empty:
            if time.monotonic() > hard_stop:
                bus.emit("run.failed", error=f"wall-time cap: the run did not finish within {max_seconds:.0f} s")
                bus.close()
            continue
        if ev is None:
            break
        yield ev
