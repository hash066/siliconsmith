"""Import-light, JSON-in / JSON-out entrypoints for hosting Matter as serverless functions.

    simulate(params)                          deterministic, NO LLM, safe to call freely
    run_agent(spec, budget_usd, max_seconds)  the Nemotron loop, generators in Token Factory Sandboxes, hard-capped

Both take and return plain JSON-able dicts. Importing this module pulls in numpy and scipy only (no FastAPI, no
LLM client, no sandbox SDK); the agent-only imports happen inside run_agent. Errors are InputError (HTTP 422).
"""

from __future__ import annotations

import base64
import functools
import hashlib
import json
import tempfile
import time
import uuid
from pathlib import Path

import numpy as np

from . import export, ladder
from . import limits as lim
from . import reference_generators as ref
from .problem import Spreader, baseline, force_chip, isothermal_bound, rect_fin_mask, solve_mask

GENERATORS = {g["name"]: g for g in (ref.RECT_FINS, ref.RADIAL_SPOKES)}

LIMITS_TEXT = [
    "2D plate model, steady state, constant stated h and k (assumptions, not measurements).",
    "No airflow CFD, no radiation model, not validated on a printed part.",
    "'Validated' means the solver agrees with analytic cases within pre-set thresholds, nothing more.",
    "'Second solver agrees' compares two solvers we wrote, not a measurement.",
    "Baselines are rectangular-fin plates from our own sweep, not a vendor heat sink.",
]


@functools.lru_cache(maxsize=1)
def _m1():
    return ladder.m1_solver_validated()


@functools.lru_cache(maxsize=8)
def _generate_fn(name: str):
    env: dict = {}
    exec(compile(GENERATORS[name]["source"], f"<reference:{name}>", "exec"), env)  # our own code, not model output
    return env["generate"]


def _gen_params(name: str, given: dict | None) -> dict:
    space = GENERATORS[name]["param_space"]
    given = given or {}
    if not isinstance(given, dict):
        raise lim.InputError("gen_params", "must be an object")
    unknown = sorted(set(given) - set(space))
    if unknown:
        raise lim.InputError("gen_params", f"unknown parameter(s) {unknown} for {name}; allowed: {sorted(space)}")
    out = {}
    for k, (lo, hi) in space.items():
        out[k] = lim.number(f"gen_params.{k}", given[k], lo, hi, integer=True) if k in given else int(round((lo + hi) / 2))
    return out


def _rung(status: str, detail: str, idx: int) -> dict:
    _id, label, tool = ladder.RUNGS[idx]
    return dict(id=_id, status=status, label=label if status == "pass" else None, check=tool, detail=detail)


def mask_rows(mask: np.ndarray) -> list[str]:
    return ["".join("1" if v else "0" for v in row) for row in mask]


def simulate(params: dict | None = None) -> dict:
    """Run one built-in reference generator through the validated solver and the ladder. No LLM, no network."""
    t0 = time.monotonic()
    p = params or {}
    if not isinstance(p, dict):
        raise lim.InputError("params", "must be an object")
    extra = sorted(set(p) - {"generator", "gen_params", "spreader", "include_stl"})
    if extra:
        raise lim.InputError("params", f"unknown field(s) {extra}; allowed: generator, gen_params, spreader, include_stl")
    name = p.get("generator", "rect_fins")
    if name not in GENERATORS:
        raise lim.InputError("generator", f"must be one of {sorted(GENERATORS)}, got {name!r}")
    sp = lim.spreader_from(p.get("spreader"))
    gp = _gen_params(name, p.get("gen_params"))
    mask = np.asarray(_generate_fn(name)(dict(gp), sp.n, sp.chip_cells), dtype=bool)

    ladder_out: list[dict] = []
    m1 = _m1()
    ladder_out.append(_rung(m1.status, m1.detail, 0))
    metrics: dict = {}
    first_fail = None
    r2 = ladder.m2_valid(mask, sp)
    ladder_out.append(_rung(r2.status, r2.detail, 1))
    field = None
    full_peak, full_params = baseline(sp, sp.budget_cells)
    baselines = {"equal_material": None, "full_budget": dict(peak_temp_c=full_peak, delta_k=None, params=full_params, cells=sp.budget_cells)}
    verdict = None
    if r2.status == "pass":
        m = force_chip(mask, sp)
        res = solve_mask(m, sp)
        cells = int(m.sum())
        metrics = dict(peak_temp_c=res.peak, peak_rise_k=res.peak - sp.T_inf, material_cells=cells,
                       material_fraction=cells / sp.n**2, heat_balance_rel=res.balance_rel)
        field = export.field_payload(m, res.T, sp)
        r3 = ladder.m3_printable(mask, sp)
        ladder_out.append(_rung(r3.status, r3.detail, 2))
        if r3.status == "pass":
            r4 = ladder.m4_second_solver(mask, sp)
            ladder_out.append(_rung(r4.status, r4.detail, 3))
            eq_peak, eq_params = baseline(sp, cells)
            r5 = ladder.m5_baseline(mask, sp)
            ladder_out.append(_rung(r5.status if r4.status == "pass" else "skipped",
                                    r5.detail if r4.status == "pass" else "skipped: M4 did not pass", 4))
            baselines = dict(equal_material=dict(peak_temp_c=eq_peak, delta_k=eq_peak - res.peak, params=eq_params, cells=cells),
                             full_budget=dict(peak_temp_c=full_peak, delta_k=full_peak - res.peak, params=full_params,
                                              cells=sp.budget_cells))
            verdict = ladder.verdict(res.peak, eq_peak, full_peak, isothermal_bound(sp, sp.budget_cells))
        else:
            ladder_out += [_rung("skipped", "skipped: M3 did not pass", 3), _rung("skipped", "skipped: M3 did not pass", 4)]
    else:
        ladder_out += [_rung("skipped", "skipped: M2 did not pass", i) for i in (2, 3, 4)]
    first_fail = next((r["id"] for r in ladder_out if r["status"] == "fail"), None)

    baseline_viewer = None
    eqb = baselines.get("equal_material")
    if eqb and field is not None:
        bp = eqb["params"]
        bmask = np.asarray(rect_fin_mask(sp, bp["spine"], bp["n_fins"], bp["fin_w"], bp["fin_len"], bp["spine_len"] or None), dtype=bool) if bp.get("spine") else force_chip(np.zeros((sp.n, sp.n), bool), sp)
        bres = solve_mask(bmask, sp)
        # the same artifact as `viewer`, for the plain-fin plate that uses the same amount of material
        baseline_viewer = dict(format="matter-candidate/1", n=sp.n, dx_mm=sp.dx * 1e3, thickness_mm=sp.t * 1e3, chip=list(sp.chip_cells),
                               mask=mask_rows(bmask), field=export.field_payload(bmask, bres.T, sp))
    out = dict(ok=True, generator=name, gen_params=gp, spreader=sp.as_dict(), ladder=ladder_out, first_failure=first_fail,
               baseline_viewer=baseline_viewer,
               metrics=metrics, baselines=baselines, verdict=verdict,
               viewer=dict(format="matter-candidate/1", n=sp.n, dx_mm=sp.dx * 1e3, thickness_mm=sp.t * 1e3,
                           chip=list(sp.chip_cells), mask=mask_rows(force_chip(mask, sp)), field=field),
               limits=LIMITS_TEXT, source="deterministic simulation, no LLM",
               timings_ms=int((time.monotonic() - t0) * 1000))
    if p.get("include_stl"):
        if not isinstance(p["include_stl"], bool):
            raise lim.InputError("include_stl", "must be true or false")
        stl = export.mask_to_stl(force_chip(mask, sp), sp)
        out["stl"] = dict(base64=base64.b64encode(stl).decode(), bytes=len(stl), sha256=hashlib.sha256(stl).hexdigest(), units="mm")
    return out


def run_agent(spec: dict | None, budget_usd: float, max_seconds: float, *, runner=None, llm=None,
              allow_local_runner: bool = False, workdir: Path | None = None) -> dict:
    """The Nemotron loop with hard caps. Generator code runs in Token Factory Sandboxes (the `sandbox` runner) unless
    a runner is injected (tests) or allow_local_runner is set (development only). Returns the event list,
    artifacts, candidate payloads and the honest result object."""
    from ..events import EventBus
    from .agent import MatterRun
    from .runners import make_runner

    spec = spec or {}
    if not isinstance(spec, dict):
        raise lim.InputError("spec", "must be an object")
    extra = sorted(set(spec) - {"spreader", "rounds", "ideas", "samples", "seed"})
    if extra:
        raise lim.InputError("spec", f"unknown field(s) {extra}; allowed: spreader, rounds, ideas, samples, seed (numbers only)")
    sp = lim.spreader_from(spec.get("spreader"))
    rounds = lim.number("spec.rounds", spec.get("rounds", 3), 1, lim.MAX_ROUNDS, True)
    ideas = lim.number("spec.ideas", spec.get("ideas", 3), 1, lim.MAX_IDEAS, True)
    samples = lim.number("spec.samples", spec.get("samples", 12), 4, lim.MAX_SAMPLES, True)
    seed = lim.number("spec.seed", spec.get("seed", 0), 0, 10**6, True)
    budget = lim.number("budget_usd", budget_usd, 0.01, lim.MAX_AGENT_BUDGET_USD)
    seconds = lim.number("max_seconds", max_seconds, 30, lim.MAX_AGENT_SECONDS)

    if runner is None:
        runner = make_runner("local" if allow_local_runner else "sandbox")
    run_id = "m_" + uuid.uuid4().hex[:12]
    root = Path(workdir) if workdir else Path(tempfile.mkdtemp(prefix="matter-"))
    bus = EventBus(run_id, root / "events.ndjson")
    if llm is None:
        import dataclasses

        from ..config import settings
        from ..llm import Nemotron

        llm = Nemotron(dataclasses.replace(settings(), run_budget_usd=budget), bus)
    try:
        summary = MatterRun(sp, llm, bus, root / "out", rounds=rounds, ideas_per_round=ideas, samples=samples, seed=seed,
                            runner=runner, deadline_s=seconds).run()
    except Exception as e:  # noqa: BLE001
        bus.emit("run.failed", error=f"{type(e).__name__}: {str(e)[:300]}")
        bus.close()
        return dict(ok=False, run_id=run_id, error=f"{type(e).__name__}: {str(e)[:300]}",
                    events=[json.loads(x) for x in (root / "events.ndjson").read_text(encoding="utf-8").splitlines()])
    bus.close()
    events = [json.loads(x) for x in (root / "events.ndjson").read_text(encoding="utf-8").splitlines()]
    artifacts = [dict(node_id=e.get("node_id"), kind=e["kind"], path=e["path"], sha256=e["sha256"])
                 for e in events if e["type"] == "artifact.created"]
    candidates = []
    for e in events:
        if e["type"] == "artifact.created" and e["kind"] == "candidate":
            candidates.append(json.loads(Path(e["path"]).read_text(encoding="utf-8")))
    winner = None
    if summary.get("best_node_id"):
        wc = next((c for c in candidates if c["node"] == summary["best_node_id"]), None)
        stl_path = root / "out" / "nodes" / summary["best_node_id"] / "plate.stl"
        if wc and stl_path.exists():
            stl = stl_path.read_bytes()
            winner = dict(wc, stl=dict(base64=base64.b64encode(stl).decode(), bytes=len(stl),
                                       sha256=hashlib.sha256(stl).hexdigest(), units="mm"))
    return dict(ok=bool(summary.get("ok")), run_id=run_id, events=events, artifacts=artifacts, candidates=candidates,
                winner=winner, result=dict(verdict=summary.get("verdict"), baselines=summary.get("baselines"),
                                           all_rungs_passed=summary.get("all_rungs_passed"), best_node_id=summary.get("best_node_id"),
                                           pareto=summary.get("pareto"), stopped=summary.get("stopped")),
                cost_usd=summary.get("cost_usd"), tokens=summary.get("tokens"), wall_s=summary.get("wall_s"),
                caps=dict(budget_usd=budget, max_seconds=seconds,
                          generator_runner="sandbox" if type(runner).__name__ == "SandboxRunner" else "local-or-injected"),
                limits=LIMITS_TEXT)
