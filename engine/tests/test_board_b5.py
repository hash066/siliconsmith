"""Board rung B5: battery life duty-cycle model (a model, not a measurement)."""

from siliconsmith.board.checks import IMPLEMENTED_RUNGS, RUNG_LABELS, run_b5, run_ladder
from siliconsmith.board.faults import FAULTS, inject_fault, reference_design
from siliconsmith.board.netlist import Instance
from siliconsmith.board.parts import load_library, resolve_fact

LIB = load_library()


def test_clean_design_passes_b5_with_arithmetic_and_model_label():
    r = run_b5(reference_design(), LIB)
    assert r.status == "pass", r.detail
    assert r.label == "Battery estimate meets target (model, not measured)" == RUNG_LABELS["B5"]
    assert r.evidence and all(resolve_fact(LIB, e) for e in r.evidence)
    # (240.764 mA x 5 s + 0.0601 mA x 595 s) / 600 s = 2.066 mA ; 2000 mAh x 0.8 / 2.066 = 774 h
    assert "active 240.764 mA for 5 s" in r.detail
    assert "average 2.066 mA" in r.detail and "= 774 h vs target 48 h" in r.detail
    assert {"part:esp32.wifi_tx_typ_ma", "part:esp32.deep_sleep_ua", "part:bme280.iddp_ma", "part:ldo33.iq_ua"} <= set(r.evidence)


def test_short_period_misses_the_target():
    d = reference_design()
    d.assumptions["period_s"] = 10  # radio on half the time: about 120 mA average
    r = run_b5(d, LIB)
    assert r.status == "fail" and r.label is None and "vs target 48 h" in r.detail


def test_target_is_a_threshold_not_a_label():
    d = reference_design()
    d.assumptions["target_hours"] = 10_000
    assert run_b5(d, LIB).status == "fail"


def test_missing_assumptions_are_unknown_never_pass():
    d = reference_design()
    del d.assumptions["battery_capacity_mah"]
    r = run_b5(d, LIB)
    assert r.status == "unknown" and r.label is None and "battery_capacity_mah" in r.detail


def test_unphysical_assumptions_fail():
    d = reference_design()
    d.assumptions["battery_usable_fraction"] = 1.5
    assert run_b5(d, LIB).status == "fail"
    d = reference_design()
    d.assumptions["active_s"] = 700
    assert run_b5(d, LIB).status == "fail"


def test_load_with_only_a_peak_current_makes_the_estimate_unknown():
    d = inject_fault(reference_design(), "regulator_overload")  # adds LOAD1 with peak_ma only
    r = run_b5(d, LIB)
    assert r.status == "unknown" and "LOAD1" in r.detail


def test_no_stated_current_is_unknown():
    d = reference_design()
    d.instances = [Instance(ref="R1", part="res")]
    d.nets = []
    d.mcu_assignments, d.firmware_pins, d.mcu_ref = [], [], None
    assert run_b5(d, LIB).status == "unknown"


def test_b5_stays_silent_on_every_catalogue_fault_except_the_one_adding_an_unmodelled_load():
    for f in FAULTS:
        got = run_b5(inject_fault(reference_design(), f.id), LIB).status
        assert got == ("unknown" if f.id == "regulator_overload" else "pass"), f.id


def test_full_ladder_on_the_clean_design():
    assert [(r.rung, r.status) for r in run_ladder(reference_design(), LIB)] == [(x, "pass") for x in IMPLEMENTED_RUNGS]
    assert IMPLEMENTED_RUNGS == ("B1", "B2", "B3", "B4", "B5")


def test_load_with_peak_and_sleep_currents_enters_the_model():
    d = reference_design()
    d.instances.append(Instance(ref="LOAD1", part="load", params={"peak_ma": 20, "sleep_ma": 0.01}))
    r = run_b5(d, LIB)
    assert r.status == "pass" and "LOAD1 20" in r.detail
