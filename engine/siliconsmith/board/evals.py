"""Board evals from docs/WORKSTATION_PLAN.md section 10, as code. Thresholds are fixed here and are never edited after
seeing a result; a failed eval is reported as failed.

| Eval | Grader | Target |
| fault detection: 8 injected faults | deterministic | 8/8 detected by the right rung, 0 false positives on the clean design |
| agent: template to a design passing every implemented rung | code | pass@3 >= 80% over 5 runs |
| repair: agent repairs each injected fault | code | pass@3 >= 75% over the 8 faults |
| cost per agent session | code | mean < $0.05 |

"pass@3" means the run passed within three judged designs: the first proposal plus up to two repairs.

    python -m siliconsmith.board.evals detect
    python -m siliconsmith.board.evals live --runs 5 [--env-file PATH] [--budget USD]
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import time
from pathlib import Path
from typing import Any, Callable

from . import faults
from .agent import propose_design, repair_design
from .checks import IMPLEMENTED_RUNGS, run_ladder
from .heldout import HELDOUT
from .parts import Part, load_library
from .run import load_env_file, template_brief

TARGETS = {"detect": "8/8 detected, 0 false positives", "agent_pass_at_3": 0.80, "repair_pass_at_3": 0.75,
           "cost_per_session_usd": 0.05}


def eval_fault_detection(library: dict[str, Part] | None = None) -> dict[str, Any]:
    """Each catalogue fault must make exactly its expected rung fail; the clean design must pass every rung."""
    lib = library or load_library()
    clean = {r.rung: r.status for r in run_ladder(faults.reference_design(), lib)}
    false_positives = [r for r, s in clean.items() if s != "pass"] or []
    rows, detected = [], 0
    for f in faults.FAULTS:
        got = {r.rung: r.status for r in run_ladder(faults.inject_fault(faults.reference_design(), f.id), lib)}
        ok = got.get(f.expected_rung) == "fail"
        detected += ok
        rows.append({"fault": f.id, "expected_rung": f.expected_rung, "status": got.get(f.expected_rung), "detected": ok,
                     "also_failed": sorted(r for r, s in got.items() if s == "fail" and r != f.expected_rung)})
    passed = detected == len(faults.FAULTS) and not false_positives and set(clean) == set(IMPLEMENTED_RUNGS)
    return {"eval": "board_fault_detection", "target": TARGETS["detect"], "detected": detected,
            "total": len(faults.FAULTS), "false_positives_on_clean": false_positives, "faults": rows, "passed": passed}


def eval_agent(llm_factory: Callable[[], Any], runs: int = 5, library: dict[str, Part] | None = None,
               max_repairs: int = 2) -> dict[str, Any]:
    """Template to design, `runs` independent sessions, a fresh LLM client (and so a fresh budget) for each."""
    lib = library or load_library()
    rows = []
    for i in range(runs):
        res = propose_design(llm_factory(), template_brief(), lib, max_repairs=max_repairs)
        rows.append({"run": i + 1, "passed": res.passed, "attempts": len(res.attempts), "cost_usd": round(res.cost_usd, 5),
                     "error": res.error,
                     "first_failures": [f"{r.rung}:{r.detail[:160]}" for r in (res.attempts[0].results if res.attempts else [])
                                        if r.status != "pass"][:3]})
    rate = sum(r["passed"] for r in rows) / len(rows) if rows else 0.0
    return {"eval": "board_agent_template_to_design", "target": TARGETS["agent_pass_at_3"], "rate": rate, "runs": rows,
            "passed": rate >= TARGETS["agent_pass_at_3"]}


def eval_repair(llm_factory: Callable[[], Any], library: dict[str, Part] | None = None,
                max_repairs: int = 2) -> dict[str, Any]:
    """Repair each of the 8 injected faults once, from the clean design with that fault, within three judged designs."""
    lib = library or load_library()
    rows = []
    for f in faults.FAULTS:
        res = repair_design(llm_factory(), faults.inject_fault(faults.reference_design(), f.id), template_brief(), lib,
                            max_repairs=max_repairs)
        rows.append({"fault": f.id, "repaired": res.passed, "attempts": len(res.attempts),
                     "cost_usd": round(res.cost_usd, 5), "error": res.error})
    rate = sum(r["repaired"] for r in rows) / len(rows)
    return {"eval": "board_agent_repair", "target": TARGETS["repair_pass_at_3"], "rate": rate, "faults": rows,
            "passed": rate >= TARGETS["repair_pass_at_3"]}


def eval_heldout(llm_factory: Callable[[], Any], trials: int = 3, library: dict[str, Part] | None = None,
                 max_repairs: int = 2) -> dict[str, Any]:
    """Repair the held-out scenarios (see heldout.py), `trials` independent sessions each. Reports the repaired
    fraction overall and per family; no pass/fail target is attached (it is a before/after comparison)."""
    lib = library or load_library()
    rows = []
    for sc in HELDOUT:
        broken = faults.inject_ops(faults.reference_design(), sc["ops"])
        got = {r.rung: r.status for r in run_ladder(broken, lib)}
        assert got[sc["expected_rung"]] == "fail", (sc["id"], got)  # the scenario really breaks its rung
        for t in range(trials):
            res = repair_design(llm_factory(), broken, template_brief(), lib, max_repairs=max_repairs)
            rows.append({"scenario": sc["id"], "family": sc["family"], "trial": t + 1, "repaired": res.passed,
                         "attempts": len(res.attempts), "cost_usd": round(res.cost_usd, 5)})
    fam = {}
    for f in sorted({r["family"] for r in rows}):
        sub = [r for r in rows if r["family"] == f]
        fam[f] = {"repaired": sum(r["repaired"] for r in sub), "sessions": len(sub)}
    return {"eval": "board_heldout_repair", "sessions": len(rows), "repaired": sum(r["repaired"] for r in rows),
            "rate": sum(r["repaired"] for r in rows) / len(rows), "by_family": fam, "trials": trials, "rows": rows,
            "total_usd": round(sum(r["cost_usd"] for r in rows), 5)}


def eval_catalogue_repeats(llm_factory: Callable[[], Any], trials: int = 3, library: dict[str, Part] | None = None,
                           max_repairs: int = 2) -> dict[str, Any]:
    """The 8 catalogue faults, `trials` sessions each (the old tuned set, sampled like the held-out set)."""
    lib = library or load_library()
    rows = []
    for f in faults.FAULTS:
        broken = faults.inject_fault(faults.reference_design(), f.id)
        for t in range(trials):
            res = repair_design(llm_factory(), broken, template_brief(), lib, max_repairs=max_repairs)
            rows.append({"scenario": f.id, "trial": t + 1, "repaired": res.passed, "attempts": len(res.attempts),
                         "cost_usd": round(res.cost_usd, 5)})
    weak = [r for r in rows if r["scenario"] in ("regulator_overload", "i2c_address_collision")]
    return {"eval": "board_catalogue_repeats", "sessions": len(rows), "repaired": sum(r["repaired"] for r in rows),
            "rate": sum(r["repaired"] for r in rows) / len(rows), "trials": trials,
            "weak_two": {"repaired": sum(r["repaired"] for r in weak), "sessions": len(weak)}, "rows": rows,
            "total_usd": round(sum(r["cost_usd"] for r in rows), 5)}


def eval_cost(*results: dict[str, Any]) -> dict[str, Any]:
    costs = [r["cost_usd"] for res in results for r in res.get("runs", res.get("faults", []))]
    mean = sum(costs) / len(costs) if costs else 0.0
    return {"eval": "board_cost_per_session", "target": TARGETS["cost_per_session_usd"], "sessions": len(costs),
            "mean_usd": round(mean, 5), "total_usd": round(sum(costs), 5), "passed": bool(costs) and mean < TARGETS["cost_per_session_usd"]}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="siliconsmith.board.evals")
    ap.add_argument("which", choices=["detect", "live", "heldout"])
    ap.add_argument("--runs", type=int, default=5)
    ap.add_argument("--trials", type=int, default=3, help="sessions per scenario for `heldout`")
    ap.add_argument("--budget", type=float, default=0.30, help="USD cap per session")
    ap.add_argument("--env-file", type=Path)
    args = ap.parse_args(argv)
    if args.which == "detect":
        out = [eval_fault_detection()]
    elif args.which == "heldout":
        if args.env_file:
            load_env_file(args.env_file)
        from ..config import settings
        from ..llm import Nemotron

        cfg = dataclasses.replace(settings(), run_budget_usd=args.budget)
        factory = lambda: Nemotron(cfg)  # noqa: E731
        out = [eval_heldout(factory, args.trials), eval_catalogue_repeats(factory, args.trials)]
    else:
        if args.env_file:
            load_env_file(args.env_file)
        from ..config import settings
        from ..llm import Nemotron

        cfg = dataclasses.replace(settings(), run_budget_usd=args.budget)
        factory = lambda: Nemotron(cfg)  # noqa: E731
        agent = eval_agent(factory, args.runs)
        repair = eval_repair(factory)
        out = [eval_fault_detection(), agent, repair, eval_cost(agent, repair)]
    from .. import paths

    dest = paths.ROOT / "runs" / "evals"
    dest.mkdir(parents=True, exist_ok=True)
    f = dest / f"board-{args.which}-{time.strftime('%Y%m%d-%H%M%S')}.json"
    f.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    for r in out:
        if isinstance(r.get("passed"), bool):
            print(f"{r['eval']}: {'PASS' if r['passed'] else 'FAIL'}  (target {r['target']})")
        else:
            print(f"{r['eval']}: " + str({k: r[k] for k in ("repaired", "sessions", "by_family", "weak_two", "total_usd") if k in r}))
    print(f"written {f}")
    return 0 if all(r.get("passed", True) for r in out) else 1


if __name__ == "__main__":
    raise SystemExit(main())
