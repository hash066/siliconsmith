"""Matter agent loop: Nemotron proposes and writes geometry generators; WE run the physics and the ladder.

Ultra (architect) proposes generator ideas from the previous round's measured failures and successes.
Super (implement/repair) writes the generator code. The code runs in a limited subprocess
(generators.py), its masks go through ladder rungs M2..M5 and our validated solver. The model never
touches the physics and never decides pass/fail.

Events (additive to docs/contracts/events.md): run.started {domain:"matter", ladder:[{id,label,tool}]},
node.stage {stage: "implement"|"M1".."M5"}, node.scored {metrics, ladder:{M1..M5}, samples},
artifact.created {kind, path, sha256}. Existing node.created/node.pruned/node.expanded/llm.call keep their meaning.
"""

from __future__ import annotations

import dataclasses
import re
import time
import zlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable

import numpy as np
from pydantic import BaseModel, Field

from .. import paths
from ..events import EventBus
from . import export, generators, ladder
from . import reference_generators as ref
from .runners import make_runner
from .problem import Spreader, baseline, force_chip, solve_mask

MAX_PARAMS = 8


class Idea(BaseModel):
    name: str = Field(pattern=r"^[a-z][a-z0-9_]{2,40}$")
    title: str
    rationale: str
    param_space: dict[str, list[float]]
    based_on: str | None = None


class Ideas(BaseModel):
    ideas: list[Idea]


# ------------------------------------------------------------------ prompts


def problem_text(sp: Spreader) -> str:
    i0, i1, j0, j1 = sp.chip_cells
    return (
        f"Design a 2D heat-spreader plate. Grid: {sp.n}x{sp.n} cells of {sp.dx * 1e3:.0f} mm "
        f"(a {sp.n * sp.dx * 1e3:.0f} mm square), plate thickness {sp.t * 1e3:.0f} mm, aluminium k={sp.k:.0f} W/mK. "
        f"A {sp.chip}x{sp.chip}-cell chip (cells x {i0}..{i1 - 1}, y {j0}..{j1 - 1}, always material) dissipates {sp.Q} W. "
        f"Heat leaves ONLY by convection from both faces (h={sp.h:.0f} W/m2K, ambient {sp.T_inf:.0f} C). "
        f"Objective: minimise the PEAK temperature. Constraints: at most {sp.budget_cells} material cells "
        f"({sp.budget_fraction:.0%} of the plate); ALL material connected to the chip (4-connectivity); "
        f"every feature at least {sp.min_feature} cells wide; no enclosed voids. "
        "A grader we wrote (not you) solves the heat equation and checks these rules."
    )


CONTRACT = (
    "A generator is Python source defining `def generate(params, n, chip):` returning a numpy bool array of "
    "shape (n, n) (True = material). params is a dict of numbers named exactly as in your param_space; chip = "
    "(i0, i1, j0, j1). Allowed imports: numpy, math, itertools, functools, collections. No files, network, "
    "classes, getattr/eval/open. Make geometry valid BY CONSTRUCTION for every parameter value in the ranges "
    "(cast params with int(); keep the cell count under the budget, e.g. clip lengths); runs over budget or "
    "disconnected from the chip count as failures."
)


def architect_messages(sp: Spreader, n_ideas: int, history: str, base_peak: float, taken: list[str]) -> list[dict]:
    ex = ref.RECT_FINS
    sys = ("You are a thermal-mechanical design agent. You propose parametric geometry GENERATORS; "
           "you do not solve physics. Reply with ONLY a JSON object.")
    user = (
        f"{problem_text(sp)}\n\n{CONTRACT}\n\nExample generator (plain rectangular fins; param_space "
        f"{ex['param_space']}):\n```python{ex['source']}```\n"
        f"The best plain rectangular-fin plate within the same material budget reaches {base_peak:.1f} C peak. "
        f"The real target is to get BELOW {base_peak:.1f} C using the whole budget; a design that uses far less "
        f"material is only useful if it is also cooler per cell. Heat leaves only through the plate surface, so "
        f"convecting area matters, but conduction paths from the chip must stay thick enough to carry the heat. "
        f"Think about where the heat flux is highest (near the chip) and taper accordingly.\n\nPrevious results (measured by the grader):\n{history or '(none yet: first round)'}\n\n"
        f"Names already used (do not reuse): {taken or 'none'}.\n"
        f"Propose {n_ideas} NEW distinct generator ideas as JSON: "
        '{"ideas":[{"name":"snake_case","title":"...","rationale":"1-3 sentences, cite the measured results you learn from",'
        '"param_space":{"param":[lo,hi]},"based_on":null or an earlier name you are improving}]}. '
        f"Use at most {MAX_PARAMS} parameters; integer bounds mean integer parameters."
    )
    return [{"role": "system", "content": sys}, {"role": "user", "content": user}]


def coder_messages(sp: Spreader, idea: Idea, parent_code: str | None, error: str | None) -> list[dict]:
    sys = "You write small, correct numpy geometry generators. Reply with ONE ```python code block and nothing else."
    parts = [problem_text(sp), CONTRACT, f"Idea: {idea.title}\n{idea.rationale}",
             f"Parameters (name: [lo, hi]) you must accept: {idea.param_space}"]
    if parent_code:
        parts.append(f"Improve this earlier generator:\n```python\n{parent_code}\n```")
    if error:
        parts.append(f"Your previous attempt failed with:\n{error}\nFix it.")
    return [{"role": "system", "content": sys}, {"role": "user", "content": "\n\n".join(parts)}]


_FENCE = re.compile(r"```(?:python|py)?\s*\n(.*?)```", re.S)


def extract_code(text: str) -> str:
    m = _FENCE.search(text)
    return (m.group(1) if m else text).strip() + "\n"


# ------------------------------------------------------------------ evaluation


def sample_params(space: dict[str, list[float]], k: int, rng: np.random.Generator) -> list[dict]:
    """Midpoint first, then k-1 uniform random samples; integer bounds give integer values."""
    def draw(lo, hi, mid):
        if float(lo).is_integer() and float(hi).is_integer():
            return int(round((lo + hi) / 2)) if mid else int(rng.integers(int(lo), int(hi) + 1))
        return (lo + hi) / 2 if mid else float(rng.uniform(lo, hi))

    return [{n: draw(b[0], b[1], i == 0) for n, b in space.items()} for i in range(k)]


def validate_space(space: dict[str, list[float]]) -> str | None:
    if not space or len(space) > MAX_PARAMS:
        return f"param_space must have 1..{MAX_PARAMS} parameters"
    for n, b in space.items():
        if len(b) != 2 or not (b[0] <= b[1]) or not np.all(np.isfinite(b)):
            return f"param {n!r} needs [lo, hi] with lo <= hi"
    return None


def eval_sample(mask: np.ndarray, sp: Spreader) -> dict:
    m = force_chip(mask, sp)
    r2 = ladder.m2_valid(mask, sp)
    r3 = ladder.m3_printable(mask, sp) if r2.status == "pass" else None
    out = dict(cells=int(m.sum()), material_fraction=float(m.sum()) / sp.n**2, m2=r2.status, m2_detail=r2.detail,
               m3=r3.status if r3 else "skipped", m3_detail=r3.detail if r3 else "", peak=None)
    if r2.status == "pass":
        out["peak"] = float(solve_mask(m, sp).peak)
    return out


def pick_best(rows: list[dict]) -> int | None:
    """Index of the best sample: feasible (M2+M3) with lowest peak, else M2-valid, else the first generated."""
    def key(r):
        tier = 2 if r["m3"] == "pass" else 1 if r["m2"] == "pass" else 0
        return (-tier, r["peak"] if r["peak"] is not None else 1e9)

    idx = [i for i, r in enumerate(rows) if r is not None]
    return min(idx, key=lambda i: key(rows[i])) if idx else None


def pareto_front(points: list[tuple[float, float, str]]) -> set[str]:
    """Non-dominated (material_fraction, peak) points, minimising both; returns node ids."""
    front = set()
    for f, p, nid in points:
        if not any((f2 <= f and p2 <= p) and (f2 < f or p2 < p) for f2, p2, _ in points):
            front.add(nid)
    return front


# ------------------------------------------------------------------ the run


class MatterRun:
    def __init__(self, sp: Spreader, llm, bus: EventBus, outdir: Path, *, rounds: int = 3, ideas_per_round: int = 3,
                 samples: int = 12, seed: int = 0, max_concurrency: int = 3, max_repairs: int = 1,
                 gen_timeout_s: float = 60.0, refine_samples: int = 12, runner=None):
        self.runner = runner
        self.refine_samples = refine_samples
        self.sp, self.llm, self.bus, self.out = sp, llm, bus, outdir
        self.rounds, self.k, self.samples, self.seed = rounds, ideas_per_round, samples, seed
        self.conc, self.max_repairs, self.gen_timeout = max_concurrency, max_repairs, gen_timeout_s
        self.nodes: dict[str, dict] = {}
        self.names: dict[str, str] = {}  # generator name -> node id
        self._count = 0
        self.t0 = time.monotonic()

    # -- events
    def stage(self, nid: str, stage: str, status: str, attempt: int = 0, detail: str = "", **art):
        extra = {"artifacts": art} if art else {}
        self.bus.emit("node.stage", node_id=nid, stage=stage, status=status, attempt=attempt, detail=detail, **extra)

    def artifact(self, nid: str | None, kind: str, path: str, sha: str):
        self.bus.emit("artifact.created", node_id=nid, kind=kind, path=path, sha256=sha)

    # -- history text for the architect
    def history(self) -> str:
        lines = []
        for nid, n in self.nodes.items():
            b = n.get("best")
            if b is None:
                lines.append(f"- {n['idea'].name} ({nid}): {n['status']}: {n.get('reason', '')}")
                continue
            peak = f"{b['peak']:.1f} C peak, {b['material_fraction']:.1%} material" if b["peak"] is not None else "no valid sample"
            lines.append(f"- {n['idea'].name} ({nid}): best sample {peak} at params {b.get('params')}; "
                         f"rungs {n.get('ladder')}; {n.get('reason', '')}")
        return "\n".join(lines[-14:])

    # -- one node
    def run_node(self, nid: str, parent: str, depth: int, idea: Idea, rng_seed: int) -> None:
        sp = self.sp
        n = self.nodes[nid] = dict(idea=idea, status="running", parent=parent, ladder={})
        self.names[idea.name] = nid
        self.bus.emit("node.created", node_id=nid, parent_id=parent, depth=depth,
                      proposal={"kind": "generator", "mnemonic": idea.name, "title": idea.title,
                                "semantics_c": "", "operands": {"rs1": "", "rs2": "", "rd": ""},
                                "rationale": idea.rationale, "param_space": idea.param_space},
                      instruction_set=[idea.name])
        err = validate_space(idea.param_space)
        if err:
            return self.prune(nid, "implement", err)
        parent_code = self.nodes.get(parent, {}).get("code") if parent != "root" else None
        code, error = None, None
        outcomes: list = []
        samples = sample_params(idea.param_space, self.samples, np.random.default_rng(rng_seed))
        for attempt in range(self.max_repairs + 1):
            self.stage(nid, "implement", "running", attempt)
            try:
                rep = self.llm.chat("super", "implement" if attempt == 0 else "repair",
                                    coder_messages(sp, idea, parent_code, error), think=False,
                                    max_tokens=5000, temperature=0.3, node_id=nid)
            except Exception as e:  # budget or API failure: node cannot proceed
                return self.prune(nid, "implement", f"model call failed: {type(e).__name__}: {str(e)[:200]}")
            code = extract_code(rep.content)
            outcomes = generators.run_generator(code, samples, sp.n, sp.chip_cells, timeout_s=self.gen_timeout, runner=self.runner)
            n["code"] = code
            if any(o.ok for o in outcomes):
                break
            error = next((o.error for o in outcomes), "no output")
            self.stage(nid, "implement", "fail", attempt, error[:300], generator_code=code, error_log=error)
        else:
            return self.prune(nid, "implement", f"generator never produced a mask: {error[:200]}")
        ok_n = sum(o.ok for o in outcomes)
        self.stage(nid, "implement", "pass", attempt, f"{ok_n}/{len(outcomes)} parameter samples produced a mask", generator_code=code)

        rows: list = [eval_sample(o.mask, sp) if o.ok else None for o in outcomes]
        for r, o, s in zip(rows, outcomes, samples):
            if r is not None:
                r["params"] = s
        bi = pick_best(rows)
        # parameter refinement (no LLM): re-sample in a box around the best sample, keep any improvement
        if rows[bi]["m3"] == "pass" and self.refine_samples:
            lo_hi = {k: idea.param_space[k] for k in rows[bi]["params"]}
            rng = np.random.default_rng(rng_seed + 1)
            cand = []
            for _ in range(self.refine_samples):
                p = {}
                for k, v0 in rows[bi]["params"].items():
                    lo, hi = lo_hi[k]
                    w = 0.15 * (hi - lo)
                    x = min(max(v0 + rng.uniform(-w, w), lo), hi)
                    p[k] = int(round(x)) if float(lo).is_integer() and float(hi).is_integer() else float(x)
                cand.append(p)
            extra = generators.run_generator(code, cand, sp.n, sp.chip_cells, timeout_s=self.gen_timeout, runner=self.runner)
            for o, p in zip(extra, cand):
                if o.ok:
                    r = eval_sample(o.mask, sp)
                    r["params"] = p
                    rows.append(r)
                    outcomes.append(o)
                    samples.append(p)
            bi = pick_best(rows)
        n["rows"] = [r for r in rows if r]
        best, mask = rows[bi], outcomes[bi].mask
        n["best"], n["mask"], n["best_idx"] = best, mask, bi
        L = {"M1": "pass", "M2": best["m2"], "M3": best["m3"], "M4": "skipped", "M5": "skipped"}
        self.stage(nid, "M1", "pass", detail="solver suite validated once at run start (same code, same interpreter)")
        self.stage(nid, "M2", best["m2"], detail=best["m2_detail"])
        if best["m2"] == "pass":
            self.stage(nid, "M3", best["m3"], detail=best["m3_detail"])
        n["ladder"] = L
        n["reason"] = ""
        if best["m2"] != "pass":
            n["reason"] = f"M2: {best['m2_detail']}"
        elif best["m3"] != "pass":
            n["reason"] = f"M3: {best['m3_detail']}"
        else:
            r4 = ladder.m4_second_solver(mask, sp)
            L["M4"] = r4.status
            self.stage(nid, "M4", r4.status, detail=r4.detail)
            if r4.status == "pass":
                r5 = ladder.m5_baseline(mask, sp)
                L["M5"] = r5.status
                n["m5"] = r5.data
                self.stage(nid, "M5", r5.status, detail=r5.detail)
                n["reason"] = f"M5: {r5.detail}"
            else:
                n["reason"] = f"M4: {r4.detail}"
            n["m4"] = r4.data
        n["status"] = "scored"

    def prune(self, nid: str, stage: str, reason: str) -> None:
        n = self.nodes[nid]
        n.update(status="pruned", reason=f"{stage}: {reason}", ladder={"M1": "pass", "M2": "skipped", "M3": "skipped", "M4": "skipped", "M5": "skipped"})
        self.stage(nid, stage, "fail", detail=reason[:300])

    # -- after a round: emit scores, pareto, artifacts
    def finish_round(self) -> None:
        sp = self.sp
        feasible = [(n["best"]["material_fraction"], n["best"]["peak"], nid) for nid, n in self.nodes.items()
                    if n.get("best") and n["best"]["m3"] == "pass" and n["best"]["peak"] is not None]
        front = pareto_front(feasible)
        for nid, n in self.nodes.items():
            if n.get("emitted"):
                continue
            n["emitted"] = True
            if n["status"] == "pruned":
                self.bus.emit("node.pruned", node_id=nid, reason=n["reason"])
                continue
            b = n["best"]
            L = n["ladder"]
            base = n.get("m5", {})
            metrics = dict(peak_temp_c=b["peak"], peak_rise_k=None if b["peak"] is None else b["peak"] - sp.T_inf,
                           material_fraction=b["material_fraction"], material_cells=b["cells"],
                           baseline_peak_c=base.get("baseline_peak"), delta_vs_baseline_k=base.get("delta_k"))
            samples = [dict(peak_temp_c=r["peak"], material_fraction=r["material_fraction"],
                            feasible=r["m3"] == "pass") for r in n["rows"] if r["peak"] is not None]
            if b["m2"] == "pass":  # artifacts for every node with a valid mask
                d = self.out / "nodes" / nid
                p, s = export.write_artifact(d / "generator.py", n["code"])
                self.artifact(nid, "code", p, s)
                p, s = export.write_artifact(d / "plate.stl", export.mask_to_stl(n["mask"], sp))
                self.artifact(nid, "stl", p, s)
                p, s = export.write_results_json(d / "field.json", export.field_payload(
                    force_chip(n["mask"], sp), solve_mask(force_chip(n["mask"], sp), sp).T, sp))
                self.artifact(nid, "field", p, s)
                p, s = export.write_results_json(d / "result.json", dict(
                    node=nid, generator=n["idea"].name, params=b["params"], metrics=metrics, ladder=L,
                    m4=n.get("m4"), m5=n.get("m5"), spreader=sp.as_dict(), samples=n["rows"]))
                self.artifact(nid, "results", p, s)
            self.bus.emit("node.scored", node_id=nid, metrics=metrics, ladder=L, samples=samples,
                          feasible=L["M3"] == "pass", on_pareto=nid in front,
                          params=b.get("params"))
            if not all(v == "pass" for v in L.values()):
                self.bus.emit("node.pruned", node_id=nid, reason=n["reason"])
        for nid, n in self.nodes.items():
            kids = [c for c, m in self.nodes.items() if m["parent"] == nid]
            if kids and not n.get("expanded"):
                n["expanded"] = True
                self.bus.emit("node.expanded", node_id=nid, children=kids)

    # -- whole run
    def run(self) -> dict:
        sp = self.sp
        self.bus.emit("run.started", domain="matter",
                      workload={"id": "heat-spreader", "title": f"{sp.Q:g} W chip heat spreader, {sp.budget_fraction:.0%} material budget",
                                "lang": "python"},
                      config={"rounds": self.rounds, "ideas_per_round": self.k, "samples": self.samples,
                              "max_concurrency": self.conc, "spreader": sp.as_dict()},
                      backend="local", ladder=ladder.LADDER_EVENT)
        self.bus.emit("node.created", node_id="root", parent_id=None, depth=0, proposal=None, instruction_set=[])
        self.stage("root", "M1", "running")
        r1 = ladder.m1_solver_validated()
        self.stage("root", "M1", r1.status, detail=r1.detail)
        if r1.status != "pass":
            self.bus.emit("run.failed", error="M1 failed: solver is not validated, no agent code was run: " + r1.detail)
            return dict(ok=False, error=r1.detail)
        bpeak, bparams = baseline(sp, sp.budget_cells)
        self.bus.log(f"baseline: best plain rectangular fins within the full budget reach {bpeak:.2f} C ({bparams})")
        stopped = None
        for rnd in range(self.rounds):
            try:
                ideas, _ = self.llm.json("ultra", "architect",
                                         architect_messages(sp, self.k, self.history(), bpeak, list(self.names)),
                                         Ideas, think=True, max_tokens=12000)
            except Exception as e:
                stopped = f"architect call failed in round {rnd + 1}: {type(e).__name__}: {str(e)[:200]}"
                self.bus.log(stopped, "warn")
                break
            jobs = []
            for idea in ideas.ideas[: self.k]:
                if idea.name in self.names:
                    continue
                parent = self.names.get(idea.based_on or "", "root")
                self._count += 1
                if parent == "root":
                    nid = f"n{self._count}"
                else:
                    nid = f"{parent}.{sum(1 for m in self.nodes.values() if m['parent'] == parent) + 1}"
                self.names[idea.name] = nid
                self.nodes[nid] = dict(idea=idea, status="queued", parent=parent, ladder={})
                jobs.append((nid, parent, 1 if parent == "root" else nid.count(".") + 1, idea))
            with ThreadPoolExecutor(max_workers=self.conc) as ex:
                futs = [ex.submit(self.run_node, nid, parent, depth, idea, self.seed * 1000 + zlib.crc32(nid.encode()) % 1000)
                        for nid, parent, depth, idea in jobs]
                for f in futs:
                    f.result()
            self.finish_round()
        return self.complete(bpeak, bparams, stopped)

    def complete(self, bpeak: float, bparams: dict, stopped: str | None) -> dict:
        sp = self.sp
        scored = {nid: n for nid, n in self.nodes.items() if n["status"] == "scored" and n["best"]["peak"] is not None}
        full = {nid: n for nid, n in scored.items() if all(v == "pass" for v in n["ladder"].values())}
        pool = full or {nid: n for nid, n in scored.items() if n["best"]["m3"] == "pass"}
        best_id = min(pool, key=lambda i: pool[i]["best"]["peak"]) if pool else None
        feasible = [(n["best"]["material_fraction"], n["best"]["peak"], nid) for nid, n in scored.items() if n["best"]["m3"] == "pass"]
        front = sorted(pareto_front(feasible))
        wall = time.monotonic() - self.t0
        summary = dict(
            ok=True, best_node_id=best_id, all_rungs_passed=best_id in full if best_id else False,
            baseline_peak_c=bpeak, baseline=bparams, pareto=front,
            nodes={nid: dict(generator=n["idea"].name, status=n["status"], ladder=n["ladder"], reason=n.get("reason", ""),
                             peak_c=(n.get("best") or {}).get("peak"),
                             equal_material_baseline_c=(n.get("m5") or {}).get("baseline_peak"),
                             delta_vs_equal_material_k=(n.get("m5") or {}).get("delta_k"),
                             material_fraction=(n.get("best") or {}).get("material_fraction"))
                   for nid, n in self.nodes.items()},
            stopped=stopped, cost_usd=round(getattr(self.llm, "spent_usd", 0.0), 6),
            tokens=getattr(self.llm, "tokens", 0), wall_s=round(wall, 1), spreader=sp.as_dict())
        rep = render_report(summary, sp)
        p, s = export.write_artifact(self.out / "report.md", rep)
        self.artifact(None, "report", p, s)
        p, s = export.write_results_json(self.out / "results.json", summary)
        self.artifact(None, "results", p, s)
        self.bus.emit("run.completed", best_node_id=best_id or "root", pareto=front,
                      totals=dict(nodes=len(self.nodes), sandboxes=len(self.nodes), cost_usd=summary["cost_usd"],
                                  tokens=summary["tokens"], wall_s=wall),
                      report={"bundle_url": str(self.out)})
        return summary


def render_report(s: dict, sp: Spreader) -> str:
    L = ["# Matter run report", "",
         f"Problem: {sp.Q:g} W chip ({sp.chip}x{sp.chip} mm) on a {sp.n * sp.dx * 1e3:.0f} mm square aluminium plate, "
         f"{sp.t * 1e3:.0f} mm thick, convection h={sp.h:g} W/m2K both faces, ambient {sp.T_inf:g} C, "
         f"material budget {sp.budget_fraction:.0%}.", "",
         f"Baseline (best plain rectangular fins, full budget): {s['baseline_peak_c']:.2f} C peak.", ""]
    if s["best_node_id"]:
        n = s["nodes"][s["best_node_id"]]
        verdict = "all rungs M1-M5 passed" if s["all_rungs_passed"] else "NOT all rungs passed"
        eq = n.get("delta_vs_equal_material_k")
        L += [f"Best node: **{s['best_node_id']}** `{n['generator']}`: {n['peak_c']:.2f} C peak using {n['material_fraction']:.1%} material; {verdict}.",
              (f"M5 compares against the best plain rectangular-fin plate using no more material than the candidate: "
               f"{n['equal_material_baseline_c']:.2f} C, so the candidate is {eq:+.2f} K better at equal material." if eq is not None else ""),
              ("It does " + ("" if n["peak_c"] < s["baseline_peak_c"] else "NOT ") +
               f"beat the full-budget rectangular-fin baseline ({s['baseline_peak_c']:.2f} C)."), ""]
    else:
        L += ["No candidate produced a feasible (valid and printable) geometry.", ""]
    L += ["| node | generator | M1 | M2 | M3 | M4 | M5 | peak C | material | note |", "|---|---|---|---|---|---|---|---|---|---|"]
    for nid, n in s["nodes"].items():
        l = n["ladder"] or {}
        pk = f"{n['peak_c']:.2f}" if n["peak_c"] is not None else "-"
        mf = f"{n['material_fraction']:.1%}" if n["material_fraction"] is not None else "-"
        L.append(f"| {nid} | {n['generator']} | " + " | ".join(l.get(k, "-") for k in ("M1", "M2", "M3", "M4", "M5"))
                 + f" | {pk} | {mf} | {n['reason'][:90]} |")
    L += ["", f"Pareto (peak vs material): {', '.join(s['pareto']) or 'none'}.",
          f"Cost ${s['cost_usd']:.4f}, {s['tokens']} tokens, {s['wall_s']} s.", "",
          "## Honest limits", "",
          "2D model, steady state, stated h and k (assumptions, not measurements), no airflow CFD, not validated on a printed part. "
          "'Validated' means agreement with an analytic case within pre-set thresholds. "
          "'Second solver agrees' compares our FV solver with our own independent FEM solver, not with experiment.", ""]
    if s.get("stopped"):
        L += [f"Run stopped early: {s['stopped']}", ""]
    return "\n".join(L)


# ------------------------------------------------------------------ CLI


def main(argv: list[str] | None = None) -> int:
    import argparse
    import json

    from ..config import settings
    from ..llm import Nemotron

    ap = argparse.ArgumentParser(description="Run the Matter agent end to end (real Nemotron on Token Factory).")
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--ideas", type=int, default=3)
    ap.add_argument("--samples", type=int, default=12)
    ap.add_argument("--max-usd", type=float, default=1.5)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--runner", choices=["local", "sandbox"], default="local",
                    help="where generator code runs: local dev fallback or a Token Factory Sandbox (the boundary)")
    ap.add_argument("--run-id", default=None)
    a = ap.parse_args(argv)
    run_id = a.run_id or time.strftime("m_%Y%m%d_%H%M%S")
    st = dataclasses.replace(settings(), run_budget_usd=a.max_usd)
    bus = EventBus(run_id, paths.RUN_LOGS / f"{run_id}.ndjson")
    outdir = paths.ROOT / "runs" / "matter" / run_id
    llm = Nemotron(st, bus)
    try:
        summary = MatterRun(Spreader(), llm, bus, outdir, rounds=a.rounds, ideas_per_round=a.ideas,
                            samples=a.samples, seed=a.seed, runner=make_runner(a.runner)).run()
    except Exception as e:  # noqa: BLE001
        bus.emit("run.failed", error=f"{type(e).__name__}: {str(e)[:300]}")
        raise
    finally:
        bus.close()
    print(json.dumps({k: summary.get(k) for k in ("ok", "best_node_id", "all_rungs_passed", "baseline_peak_c", "cost_usd", "tokens", "wall_s")}))
    print("run_id:", run_id, "events:", paths.RUN_LOGS / f"{run_id}.ndjson")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
