"""Board evals (plan section 10) as code; the deterministic one runs here, the agent ones with a scripted model."""

from siliconsmith.board.evals import TARGETS, eval_agent, eval_cost, eval_fault_detection, eval_repair
from siliconsmith.board.faults import reference_design

from test_board_agent import Scripted


def test_fault_detection_eval_meets_its_fixed_target():
    r = eval_fault_detection()
    assert r["passed"], r
    assert r["detected"] == r["total"] == 8 and r["false_positives_on_clean"] == []
    assert all(f["detected"] for f in r["faults"])


def test_targets_are_the_plan_thresholds():
    assert TARGETS["agent_pass_at_3"] == 0.80 and TARGETS["repair_pass_at_3"] == 0.75 and TARGETS["cost_per_session_usd"] == 0.05


def test_agent_and_repair_evals_report_failures_honestly():
    good = eval_agent(lambda: Scripted(reference_design()), runs=5)
    assert good["passed"] and good["rate"] == 1.0
    bad = eval_agent(lambda: Scripted(*[reference_design().model_copy(update={"mcu_ref": None})] * 3), runs=5)
    assert not bad["passed"] and bad["rate"] == 0.0 and all(r["error"] for r in bad["runs"])
    rep = eval_repair(lambda: Scripted(reference_design()))
    assert rep["passed"] and rep["rate"] == 1.0 and len(rep["faults"]) == 8


def test_cost_eval_uses_the_per_session_mean():
    class Costly(Scripted):
        def json(self, *a, **k):
            self.spent_usd += 0.2
            return super().json(*a, **k)
    r = eval_cost(eval_agent(lambda: Costly(reference_design()), runs=2))
    assert not r["passed"] and r["mean_usd"] >= 0.2
    assert eval_cost(eval_agent(lambda: Scripted(reference_design()), runs=2))["passed"]
