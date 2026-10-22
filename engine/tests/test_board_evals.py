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


def test_heldout_scenarios_each_break_exactly_their_rung_and_stay_well_formed():
    from siliconsmith.board.checks import run_ladder
    from siliconsmith.board.faults import inject_ops
    from siliconsmith.board.heldout import HELDOUT
    from siliconsmith.board.parts import load_library

    lib = load_library()
    assert len(HELDOUT) == 6 and {s["family"] for s in HELDOUT} == {"regulator_overload", "i2c_address_collision"}
    for sc in HELDOUT:
        st = {r.rung: r.status for r in run_ladder(inject_ops(reference_design(), sc["ops"]), lib)}
        assert st["B1"] == "pass" and st[sc["expected_rung"]] == "fail", (sc["id"], st)
        assert sorted(r for r, s in st.items() if s == "fail") == [sc["expected_rung"]], (sc["id"], st)


def test_heldout_and_repeat_evals_run_with_a_scripted_model_and_report_counts():
    from siliconsmith.board.evals import eval_catalogue_repeats, eval_heldout

    r = eval_heldout(lambda: Scripted(reference_design()), trials=2)
    assert r["sessions"] == 12 and r["repaired"] == 12 and r["by_family"]["regulator_overload"] == {"repaired": 6, "sessions": 6}
    c = eval_catalogue_repeats(lambda: Scripted(reference_design()), trials=1)
    assert c["sessions"] == 8 and c["weak_two"] == {"repaired": 2, "sessions": 2}


def test_weak_fault_families_are_caught_on_permuted_designs_too():
    import sys
    from siliconsmith.board.checks import run_ladder
    from siliconsmith.board.faults import inject_ops
    from siliconsmith.board.heldout import HELDOUT
    from siliconsmith.board.parts import load_library
    from test_board_property import permuted

    lib = load_library()
    for seed in range(15):
        for sc in HELDOUT:
            st = {r.rung: r.status for r in run_ladder(inject_ops(permuted(seed), sc["ops"]), lib)}
            assert st[sc["expected_rung"]] == "fail" and st["B1"] == "pass", (seed, sc["id"], st)
