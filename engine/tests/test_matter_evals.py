"""The eval machinery re-derives a winner from saved files (checked on a scripted-model run), and, when real
runs are present under runs/matter (gitignored), enforces the plan's section 10 targets on them."""

import os
from pathlib import Path

import pytest

pytest.importorskip("scipy")

from siliconsmith import paths  # noqa: E402
from siliconsmith.events import EventBus  # noqa: E402
from siliconsmith.matter import evals  # noqa: E402
from siliconsmith.matter import reference_generators as ref  # noqa: E402
from siliconsmith.matter.agent import MatterRun  # noqa: E402
from siliconsmith.matter.problem import Spreader  # noqa: E402

from test_matter_agent import ScriptedLLM, idea  # noqa: E402


def test_eval_rederives_winner(tmp_path):
    llm = ScriptedLLM([[idea("rect_fins", ref.RECT_FINS["param_space"]), idea("radial_spokes", ref.RADIAL_SPOKES["param_space"])]])
    bus = EventBus("r_eval", tmp_path / "e.ndjson")
    MatterRun(Spreader(), llm, bus, tmp_path / "out", rounds=1, ideas_per_round=2, samples=5, seed=2).run()
    bus.close()
    r = evals.eval_run(tmp_path / "out")
    assert r["reproduced"] and r["stl_closed"]
    assert r["m4"] == "pass" and r["fem_err"] <= 0.03


REAL = sorted((paths.ROOT / "runs" / "matter").glob("m_eval_*")) if os.environ.get("SS_MATTER_EVAL") else []


@pytest.mark.skipif(not REAL, reason="set SS_MATTER_EVAL=1 with three runs/matter/m_eval_* dirs present")
def test_real_runs_meet_plan_targets():
    ev, md = evals.summarize([evals.eval_run(Path(p)) for p in REAL])
    print("\n" + md)
    assert ev["solver_validation"] and ev["second_solver_pass"]
    assert ev["agent_beats_equal_material_baseline_pass"]
