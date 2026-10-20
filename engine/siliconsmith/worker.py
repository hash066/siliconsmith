"""Sandbox-side entry point: verifies one candidate CPU and reports over stdout.

    python -m siliconsmith.worker baseline <workload>        # measure the baseline CPU (root checkpoint)
    python -m siliconsmith.worker eval <job.json>            # run the ladder for one candidate

Protocol (one JSON object per line, everything else on stdout is ignored):
    SS_STAGE {"stage": ..., "status": ..., "detail": ..., "artifacts": {...} | null}
    SS_OUTCOME {"ok": true, "measured": {...}}
    SS_OUTCOME {"ok": false, "kind": "failure" | "prune" | "error", "stage": ..., "message": ..., ...}

The same command runs in-process (tests), in a local subprocess, or inside a Token Factory
Sandbox branch; only the transport differs (see backends.py).
"""

from __future__ import annotations

import json
import sys
from dataclasses import asdict
from pathlib import Path

from . import hwgen, ladder, paths
from .tools import verify
from .tools.build import ToolError
from .tools.workload import Workload

STAGE_TAG = "SS_STAGE "
OUTCOME_TAG = "SS_OUTCOME "


def measured_to_dict(m: ladder.Measured) -> dict:
    return asdict(m)


def measured_from_dict(d: dict) -> ladder.Measured:
    return ladder.Measured(cycles=d["cycles"], hash=d["hash"], area=verify.Area(**d["area"]),
                           hotspots=d["hotspots"], disasm=d["disasm"], extra=d.get("extra", {}))


def instruction_from_dict(d: dict) -> hwgen.Instruction:
    return hwgen.Instruction(**d)


def _say(tag: str, obj: dict) -> None:
    sys.stdout.write(tag + json.dumps(obj) + "\n")
    sys.stdout.flush()


def cmd_baseline(workload: str) -> int:
    wl = Workload.load(workload)
    try:
        m = ladder.measure(wl, hwgen.CpuConfig(), {}, paths.RUNS / "root")
    except ToolError as e:
        _say(OUTCOME_TAG, {"ok": False, "kind": "error", "stage": e.stage, "message": e.message, "log": e.log})
        return 1
    _say(OUTCOME_TAG, {"ok": True, "measured": measured_to_dict(m)})
    return 0


def cmd_eval(job_path: str) -> int:
    job = json.loads(Path(job_path).read_text(encoding="utf-8"))
    wl = Workload.load(job["workload"])

    def on_stage(stage: str, status: str, detail: str, artifacts: dict | None) -> None:
        _say(STAGE_TAG, {"stage": stage, "status": status, "detail": detail, "artifacts": artifacts})

    try:
        m = ladder.evaluate(
            wl,
            measured_from_dict(job["base"]),
            measured_from_dict(job["parent"]),
            [instruction_from_dict(i) for i in job["parent_isa"]],
            instruction_from_dict(job["ins"]),
            job["spec_rtl"],
            job["patch"],
            paths.RUNS / "nodes" / job["node_id"] / f"a{job.get('attempt', 0)}",
            on_stage=on_stage,
            area_budget_pct=job["area_budget_pct"],
            vectors=job["vectors"],
        )
    except ladder.Prune as p:
        _say(OUTCOME_TAG, {"ok": False, "kind": "prune", "stage": p.stage, "message": p.reason})
        return 0
    except ladder.StageFailure as f:
        _say(OUTCOME_TAG, {"ok": False, "kind": "failure", "stage": f.stage, "message": f.message,
                           "log": f.log, "artifacts": f.artifacts})
        return 0
    except Exception as e:  # noqa: BLE001 - report, never hang the orchestrator
        _say(OUTCOME_TAG, {"ok": False, "kind": "error", "stage": "e2e",
                           "message": f"{type(e).__name__}: {e}"[:500]})
        return 1
    _say(OUTCOME_TAG, {"ok": True, "measured": measured_to_dict(m)})
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) == 2 and argv[0] == "baseline":
        return cmd_baseline(argv[1])
    if len(argv) == 2 and argv[0] == "eval":
        return cmd_eval(argv[1])
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
