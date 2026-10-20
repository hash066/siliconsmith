import os

import pytest

from siliconsmith import backends, examples, hwgen, ladder, paths
from siliconsmith.tools.workload import Workload
from siliconsmith.worker import OUTCOME_TAG, STAGE_TAG


def test_parse_worker_lines_forwards_stages_and_returns_outcome():
    seen = []
    lines = [
        "noise from a tool\n",
        STAGE_TAG + '{"stage": "lint", "status": "pass", "detail": "ok", "artifacts": null}\n',
        OUTCOME_TAG + '{"ok": false, "kind": "prune", "stage": "bench", "message": "no speedup"}\n',
    ]
    out = backends.parse_worker_lines(lines, lambda *a: seen.append(a))
    assert seen == [("lint", "pass", "ok", None)]
    with pytest.raises(ladder.Prune) as e:
        backends.raise_for_outcome(out)
    assert e.value.stage == "bench"


def test_missing_outcome_is_a_stage_failure():
    with pytest.raises(ladder.StageFailure) as e:
        backends.parse_worker_lines(["Traceback (most recent call last):\n", "boom\n"], None)
    assert "boom" in e.value.log


def test_failure_outcome_keeps_artifacts():
    out = {"ok": False, "kind": "failure", "stage": "prove", "message": "cex", "log": "l",
           "artifacts": {"culprit": "rtl"}}
    with pytest.raises(ladder.StageFailure) as e:
        backends.raise_for_outcome(out)
    assert e.value.stage == "prove" and e.value.artifacts == {"culprit": "rtl"}


@pytest.mark.skipif(not os.environ.get("SS_SLOW"), reason="needs the hardware toolchain; set SS_SLOW=1")
def test_subprocess_worker_matches_in_process_on_golden_example(tmp_path):
    wl = Workload.load("w1")
    ex = examples.load("dot4_s8")
    sub, loc = backends.SubprocessBackend(), backends.LocalBackend()
    base_s, img = sub.baseline(wl, tmp_path / "root_s")
    base_l, _ = loc.baseline(wl, tmp_path / "root_l")
    assert img == "subprocess:root" and base_s.cycles == base_l.cycles and base_s.hash == base_l.hash
    stages = []
    job = backends.EvalJob(node_id="t1", attempt=0, workload=wl.id, parent_image=img, base=base_s,
                           parent=base_s, parent_isa=[], ins=ex.instruction, spec_rtl=ex.spec_rtl,
                           patch=ex.patch, area_budget_pct=10.0, vectors=20_000)
    r = sub.evaluate(job, lambda st, status, d, a: stages.append((st, status)), tmp_path / "t1")
    assert ("prove", "pass") in stages and ("e2e", "pass") in stages
    assert r.measured.hash == base_s.hash and r.measured.cycles < base_s.cycles
