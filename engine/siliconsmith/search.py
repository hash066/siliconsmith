"""Beam search over candidate CPUs, driven by Nemotron and verified on the ladder.

Each node is a CPU = parent CPU + one new custom instruction + the software rewritten to use it.
Ultra proposes instructions, Super implements/repairs them and (separately) writes the golden spec,
Nano triages failures. Every step is emitted as an event (docs/contracts/events.md).
"""

from __future__ import annotations

import difflib
import itertools
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from . import backends, hwgen, ladder, paths
from .agent import prompts as P
from .agent.schemas import Implementation, Proposal, ProposalSet, SpecRtl, Triage
from .config import Settings
from .events import EventBus
from .llm import BudgetExceeded, LLMError, Nemotron
from .tools import verify
from .tools.build import ToolError
from .tools.workload import Workload


@dataclass
class SearchConfig:
    k_root: int = 6
    k_child: int = 4
    beam: int = 3
    max_depth: int = 2
    area_budget_pct: float = 5.0
    max_concurrency: int = 4
    max_repairs: int = 2
    vectors: int = 1_000_000


@dataclass(eq=False)
class Node:
    id: str
    parent: "Node | None"
    depth: int
    isa: list[hwgen.Instruction]
    patch: dict[str, str]
    proposal: Proposal | None = None
    measured: ladder.Measured | None = None
    status: str = "pending"  # pending | scored | pruned
    speedup: float = 1.0
    area_delta: float = 0.0
    image: str = ""  # checkpoint this node's CPU lives in (sandbox image id on contree)
    children: list["Node"] = field(default_factory=list)


class Search:
    def __init__(self, wl: Workload, settings: Settings, cfg: SearchConfig, run_id: str | None = None):
        self.wl, self.s, self.cfg = wl, settings, cfg
        self.run_id = run_id or time.strftime("r_%Y%m%d_%H%M%S")
        self.work = paths.RUNS / self.run_id
        self.bus = EventBus(self.run_id, paths.RUN_LOGS / f"{self.run_id}.ndjson")
        self.llm = Nemotron(settings, self.bus)
        self.backend = backends.make_backend(settings.backend)
        self.nodes: list[Node] = []
        self._ids: dict[str, itertools.count] = {}
        self._lock = threading.Lock()
        self._ops = itertools.count(1)
        self.tried: list[str] = []
        self.patch_name = wl.patchable[0]

    # ------------------------------------------------------------------ helpers
    def _child_id(self, parent: Node) -> str:
        with self._lock:
            c = self._ids.setdefault(parent.id, itertools.count(1))
            n = next(c)
        return f"n{n}" if parent.id == "root" else f"{parent.id}.{n}"

    def _src(self, node: Node) -> str:
        return node.patch.get(self.patch_name, self.wl.original(self.patch_name))

    def _stage(self, node: Node, stage: str, status: str, attempt: int, detail: str = "",
               artifacts: dict | None = None) -> None:
        ev = {"node_id": node.id, "stage": stage, "status": status, "attempt": attempt}
        if detail:
            ev["detail"] = detail
        if artifacts:
            ev["artifacts"] = artifacts
        self.bus.emit("node.stage", **ev)

    # ------------------------------------------------------------------ roles
    def propose(self, parent: Node, k: int) -> list[Proposal]:
        m = parent.measured
        assert m is not None
        hot = "\n".join(f"- {h['function']} ({h['file']}:{h['line_start']}-{h['line_end']}): {h['pct']}%"
                        for h in m.hotspots)
        isa = ("CUSTOM INSTRUCTIONS ALREADY IN THIS CPU (the code below already uses them; propose NEW ones "
               "that remove remaining cycles): " + ", ".join(f"{i.mnemonic} = {i.title}" for i in parent.isa) + "\n"
               if parent.isa else "")
        avoid = ("ALREADY TRIED ELSEWHERE IN THIS SEARCH (do not repeat): " + "; ".join(self.tried[-24:]) + "\n"
                 if self.tried else "")
        user = P.ARCHITECT_USER.format(
            workload_title=self.wl.title, workload_summary=self.wl.manifest.get("summary", ""),
            baseline_cycles=f"{m.cycles:,}", area_budget=self.cfg.area_budget_pct,
            baseline_luts=self.base.area.lut_equiv, current_isa=isa, hotspots=hot,
            disassembly=m.disasm[:9000], patchable_name=self.patch_name, patchable_src=self._src(parent),
            avoid=avoid, k=k)
        out, rep = self.llm.json("ultra", "architect", [
            {"role": "system", "content": P.ARCHITECT_SYSTEM}, {"role": "user", "content": user}],
            ProposalSet, think=True, node_id=parent.id, max_tokens=16000)
        if rep.reasoning:
            self.bus.log(f"Ultra on {parent.id}: {out.hotspot_analysis}", node_id=parent.id)
        seen, props = {i.name for i in parent.isa}, []
        for p in out.proposals:
            if p.name in seen:
                p.name = f"{p.name}_{len(seen)}"[:31]
            seen.add(p.name)
            props.append(p)
        return props[:k]

    def implement(self, node: Node, prop: Proposal) -> Implementation:
        existing = ", ".join(f"{i.mnemonic} via ss_{i.name}()" for i in node.parent.isa) or "none"
        user = P.IMPLEMENT_USER.format(
            few_shot=P.FEW_SHOT, name=prop.name, mnemonic=prop.mnemonic, title=prop.title,
            semantics_c=prop.semantics_c, rationale=prop.rationale,
            how_software_uses_it=prop.how_software_uses_it, existing=existing,
            rtl_rules=P.RTL_RULES.format(name=prop.name), patchable_name=self.patch_name,
            patchable_src=self._src(node.parent))
        impl, _ = self.llm.json("super", "implement", [
            {"role": "system", "content": P.IMPLEMENTER_SYSTEM}, {"role": "user", "content": user}],
            Implementation, think=True, node_id=node.id, max_tokens=16000)
        return impl

    def write_spec(self, node: Node, name: str, c_ref: str, attempts: int = 3) -> str:
        """Independently write the golden spec RTL from the C reference only, then VALIDATE it
        (lint + agreement with C on random/edge vectors) before it is trusted for the proof."""
        msgs = [{"role": "system", "content": P.SPEC_SYSTEM},
                {"role": "user", "content": P.SPEC_USER.format(name=name, c_ref=hwgen.normalize_c_ref(c_ref))}]
        err = ""
        for i in range(attempts):
            spec, rep = self.llm.json("super", "implement", msgs, SpecRtl, think=True, node_id=node.id,
                                      max_tokens=8000)
            probe = hwgen.Instruction(
                name=name, mnemonic=name, funct7=0, c_ref=c_ref,
                rtl=spec.spec_rtl.replace(f"module ss_spec_{name}", f"module ss_insn_{name}"))
            work = self.work / node.id / f"spec{i}"
            try:
                verify.lint_unit(probe, work / "lint")
                r = verify.unit_test(probe, work / "unit", n_random=200_000)
                self.bus.log(f"{node.id}: golden spec written independently from C and validated on "
                             f"{r.vectors:,} vectors", node_id=node.id)
                return spec.spec_rtl
            except (ToolError, ValueError) as e:
                err = getattr(e, "message", str(e)) + "\n" + getattr(e, "log", "")[-2500:]
                msgs = msgs + [{"role": "assistant", "content": rep.content[-6000:]},
                               {"role": "user", "content": "That spec module failed validation:\n" + err +
                                "\nFix it. Plain Verilog-2005: declare all variables at module level, "
                                "use integer loop variables, no declarations inside begin/end blocks. "
                                'Reply with ONLY {"spec_rtl": "..."}'}]
        raise LLMError(f"could not produce a valid spec after {attempts} attempts: {err[:300]}")

    def repair(self, node: Node, prop: Proposal, impl: Implementation, f: ladder.StageFailure,
               diagnosis: str) -> Implementation:
        user = P.REPAIR_USER.format(
            stage=f.stage, error=(f.message + "\n" + f.log)[-5000:], diagnosis=diagnosis,
            rtl=impl.rtl, c_ref=impl.c_ref, patchable_name=self.patch_name,
            patched=impl.patched_files.get(self.patch_name, self._src(node.parent)), name=prop.name,
            rtl_rules=P.RTL_RULES.format(name=prop.name))
        fixed, _ = self.llm.json("super", "repair", [
            {"role": "system", "content": P.IMPLEMENTER_SYSTEM}, {"role": "user", "content": user}],
            Implementation, think=True, node_id=node.id, max_tokens=16000)
        return fixed

    def triage(self, node: Node, mnemonic: str, f: ladder.StageFailure) -> Triage | None:
        try:
            t, _ = self.llm.json("nano", "triage", [
                {"role": "system", "content": P.TRIAGE_SYSTEM},
                {"role": "user", "content": P.TRIAGE_USER.format(
                    stage=f.stage, mnemonic=mnemonic, log=(f.message + "\n" + f.log)[-3000:])}],
                Triage, think=False, node_id=node.id, max_tokens=600)
            return t
        except (LLMError, BudgetExceeded):
            return None

    # ------------------------------------------------------------------ node lifecycle
    def develop(self, node: Node, prop: Proposal, funct7: int) -> None:
        op = f"op-{next(self._ops)}"
        from_img = node.parent.image
        self.bus.emit("sandbox.op", node_id=node.id, op_id=op, from_image=from_img, status="started")
        t0 = time.monotonic()
        try:
            self._develop(node, prop, funct7)
        finally:
            self.bus.emit("sandbox.op", node_id=node.id, op_id=op, from_image=from_img,
                          to_image=node.image if node.status == "scored" else None,
                          status="succeeded" if node.status == "scored" else "failed",
                          duration_s=round(time.monotonic() - t0, 1))

    def _develop(self, node: Node, prop: Proposal, funct7: int) -> None:
        attempt = 0
        spec_redos = 0
        try:
            self._stage(node, "implement", "running", attempt)
            impl = self.implement(node, prop)
            spec = self.write_spec(node, prop.name, impl.c_ref)
        except (LLMError, BudgetExceeded) as e:
            self._stage(node, "implement", "fail", attempt, str(e)[:300])
            return self._prune(node, f"implementation failed: {e}")
        while True:
            try:
                ins = hwgen.Instruction(name=prop.name, mnemonic=prop.mnemonic, funct7=funct7, rtl=impl.rtl,
                                        c_ref=impl.c_ref, title=prop.title, rationale=prop.rationale)
            except ValueError as e:
                f = ladder.StageFailure("lint", str(e))
                ins = None
            if ins is not None:
                patch = {**node.parent.patch, **{k: v for k, v in impl.patched_files.items()
                                                 if k in self.wl.patchable}}
                self._stage(node, "implement", "pass", attempt, impl.notes[:200] or "implemented",
                            self._impl_artifacts(node, ins, patch))
                work = self.work / node.id / f"a{attempt}"
                try:
                    job = backends.EvalJob(
                        node_id=node.id, attempt=attempt, workload=self.wl.id, parent_image=node.parent.image,
                        base=self.base, parent=node.parent.measured, parent_isa=node.parent.isa, ins=ins,
                        spec_rtl=spec, patch=patch, area_budget_pct=self.cfg.area_budget_pct,
                        vectors=self.cfg.vectors)
                    res = self.backend.evaluate(
                        job, lambda st, status, detail, arts: self._stage(node, st, status, attempt, detail, arts),
                        work)
                    node.isa, node.patch, node.measured, node.image = [*node.parent.isa, ins], patch, res.measured, res.image
                    return self._score(node)
                except ladder.Prune as p:
                    return self._prune(node, p.reason)
                except ladder.StageFailure as e:
                    f = e
                finally:
                    shutil.rmtree(work / "soc" / "src", ignore_errors=True)
            spec_fault = f.stage == "prove" and f.artifacts.get("culprit") == "spec"
            t = None if spec_fault else self.triage(node, prop.mnemonic, f)
            arts = dict(f.artifacts)
            arts["error_log"] = (f.message + "\n" + f.log)[-4000:]
            detail = ("golden spec disagreed; the RTL matches the C reference, so the spec is rewritten"
                      if spec_fault else (t.summary if t else f.message))
            self._stage(node, f.stage, "fail", attempt, detail[:300], arts)
            if spec_fault and spec_redos < 2:
                spec_redos += 1
                try:
                    spec = self.write_spec(node, prop.name, impl.c_ref)
                except (LLMError, BudgetExceeded) as e:
                    return self._prune(node, f"spec rewrite failed: {e}")
                continue
            if attempt >= self.cfg.max_repairs:
                return self._prune(node, f"{f.stage} failed after {attempt} repairs: {f.message[:160]}")
            attempt += 1
            self._stage(node, "implement", "running", attempt)
            try:
                if spec_fault:
                    spec = self.write_spec(node, prop.name, impl.c_ref)
                else:
                    diag = f"DIAGNOSIS: {t.likely_cause}. HINT: {t.fix_hint}\n" if t else ""
                    impl = self.repair(node, prop, impl, f, diag)
                    if f.stage == "prove":
                        spec = self.write_spec(node, prop.name, impl.c_ref)
            except (LLMError, BudgetExceeded) as e:
                self._stage(node, "implement", "fail", attempt, str(e)[:300])
                return self._prune(node, f"repair failed: {e}")

    def _impl_artifacts(self, node: Node, ins: hwgen.Instruction, patch: dict[str, str]) -> dict:
        before = self._src(node.parent).splitlines(keepends=True)
        after = patch.get(self.patch_name, "").splitlines(keepends=True)
        diff = "".join(difflib.unified_diff(before, after, f"a/{self.patch_name}", f"b/{self.patch_name}"))
        return {"rtl": ins.rtl, "c_ref": ins.c_ref,
                "intrinsic_h": hwgen.render_intrinsics(hwgen.CpuConfig([ins])), "patch_diff": diff}

    def _score(self, node: Node) -> None:
        m = node.measured
        node.status = "scored"
        node.speedup = round(self.base.cycles / m.cycles, 4)
        node.area_delta = round(m.extra["area_delta_pct"], 2)
        self.bus.emit("node.scored", node_id=node.id, cycles=m.cycles, speedup=node.speedup,
                      luts=m.area.luts + m.area.alus, ffs=m.area.ffs, area_delta_pct=node.area_delta,
                      fmax_mhz=None, wall_speedup=node.speedup, feasible=True, on_pareto=False,
                      ladder={"L1": "pass", "L2": "pass", "L3": "pass", "L4": "pass", "L5": "pass", "L6": "skipped"})

    def _prune(self, node: Node, reason: str) -> None:
        node.status = "pruned"
        self.bus.emit("node.pruned", node_id=node.id, reason=reason[:300])

    # ------------------------------------------------------------------ the search
    def run(self) -> Node:
        c = self.cfg
        self.bus.emit("run.started", workload={
            "id": self.wl.id, "title": self.wl.title, "lang": "c",
            "source_repo": self.wl.manifest.get("source", {}).get("repo"),
            "source_path": self.wl.manifest.get("source", {}).get("path")},
            config={"area_budget_pct": c.area_budget_pct, "beam": c.beam, "k_root": c.k_root,
                    "k_child": c.k_child, "max_depth": c.max_depth, "max_concurrency": c.max_concurrency},
            backend=self.backend.name)
        t0 = time.monotonic()
        try:
            self.base, root_image = self.backend.baseline(self.wl, self.work / "root")
            root = Node(id="root", parent=None, depth=0, isa=[], patch={}, measured=self.base, status="scored",
                        image=root_image)
            self.nodes.append(root)
            b = self.base
            self.bus.emit("run.baseline", cycles=b.cycles, luts=b.area.luts + b.area.alus, ffs=b.area.ffs,
                          cells=b.area.cells, fmax_mhz=None, output_hash=b.hash, hotspots=b.hotspots)
            self.bus.emit("node.created", node_id="root", parent_id=None, depth=0, proposal=None, instruction_set=[])
            frontier = [root]
            for depth in range(1, c.max_depth + 1):
                k = c.k_root if depth == 1 else c.k_child
                with ThreadPoolExecutor(max_workers=max(1, len(frontier))) as ex:
                    props = list(ex.map(lambda p: self._safe_propose(p, k), frontier))
                jobs = []
                for parent, plist in zip(frontier, props):
                    for prop in plist:
                        child = Node(id=self._child_id(parent), parent=parent, depth=depth,
                                     isa=list(parent.isa), patch=dict(parent.patch), proposal=prop)
                        parent.children.append(child)
                        self.nodes.append(child)
                        self.tried.append(f"{prop.mnemonic} ({prop.title})")
                        funct7 = hwgen.CpuConfig(list(parent.isa)).next_funct7()
                        self.bus.emit("node.created", node_id=child.id, parent_id=parent.id, depth=depth,
                                      proposal={"mnemonic": prop.mnemonic, "title": prop.title,
                                                "semantics_c": prop.semantics_c,
                                                "operands": {"rs1": "u32", "rs2": "u32", "rd": "u32"},
                                                "rationale": prop.rationale, "est_speedup": prop.est_speedup,
                                                "est_area_pct": prop.est_area_pct},
                                      instruction_set=[i.mnemonic for i in parent.isa] + [prop.mnemonic])
                        jobs.append((child, prop, funct7))
                    self.bus.emit("node.expanded", node_id=parent.id, children=[ch.id for ch in parent.children])
                with ThreadPoolExecutor(max_workers=c.max_concurrency) as ex:
                    list(ex.map(lambda j: self.develop(*j), jobs))
                scored = [n for n in self.nodes if n.depth == depth and n.status == "scored"]
                if not scored or self.llm.spent_usd >= self.s.run_budget_usd:
                    break
                frontier = sorted(scored, key=lambda n: (-n.speedup, n.area_delta))[: c.beam]
            done = [n for n in self.nodes if n.status == "scored" and n.depth > 0]
            best = max(done, key=lambda n: (n.speedup, -n.area_delta), default=root)
            pareto = [n.id for n in done if not any(
                o.speedup >= n.speedup and o.area_delta <= n.area_delta and
                (o.speedup > n.speedup or o.area_delta < n.area_delta) for o in done)]
            self.bus.emit("run.completed", best_node_id=best.id, pareto=pareto, totals={
                "nodes": len(self.nodes) - 1, "sandboxes": next(self._ops) - 1,
                "cost_usd": round(self.llm.spent_usd, 4), "tokens": self.llm.tokens,
                "wall_s": round(time.monotonic() - t0, 1)}, report={})
            return best
        except Exception as e:  # surface any crash in the run log
            self.bus.emit("run.failed", error=f"{type(e).__name__}: {e}"[:500])
            raise
        finally:
            self.bus.close()

    def _safe_propose(self, parent: Node, k: int) -> list[Proposal]:
        try:
            return self.propose(parent, k)
        except (LLMError, BudgetExceeded) as e:
            self.bus.log(f"proposal for {parent.id} failed: {e}", level="error", node_id=parent.id)
            return []
