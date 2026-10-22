"""Board rung B3: I2C pull-ups and addresses, USB-C sink CC pull-downs."""

import pytest

from siliconsmith.board.checks import run_b3, run_ladder
from siliconsmith.board.faults import FAULTS, STRUCTURAL_FAULTS, inject_fault, reference_design
from siliconsmith.board.parts import load_library, resolve_fact

LIB = load_library()


def test_clean_design_passes_b3_with_label_and_resolvable_evidence():
    r = run_b3(reference_design(), LIB)
    assert r.status == "pass", r.detail
    assert r.label == "Bus and connector rules satisfied (curated facts)"
    assert r.evidence and all(resolve_fact(LIB, e) for e in r.evidence)
    detail = " ".join(f.detail for f in r.findings)
    assert "rise time 398 ns <= 1000 ns" in detail and "0x76" in detail


@pytest.mark.parametrize("fault,needle,evidence", [
    ("i2c_pullup_too_large", "rise time 8473 ns", "part:std_i2c.tr_max_standard_ns"),
    ("missing_cc_resistors", "J1.CC1 has no 5100 ohm pull-down", "part:usbc.sink_rd_ohm"),
    ("i2c_address_collision", "U4 and U3 are both at I2C address 0x76", "part:bme280.i2c_addr_sdo_low"),
])
def test_b3_detects_its_faults(fault, needle, evidence):
    r = run_b3(inject_fault(reference_design(), fault), LIB)
    assert r.status == "fail" and r.label is None
    assert needle in r.detail
    assert evidence in r.evidence


def test_address_collision_resolves_when_sdo_goes_high():
    d = inject_fault(reference_design(), "i2c_address_collision")
    d.net("GND").pins.remove("U4.SDO")
    d.net("3V3").pins.append("U4.SDO")
    r = run_b3(d, LIB)
    assert r.status == "pass", r.detail
    assert "0x77" in " ".join(f.detail for f in r.findings)


def test_pullup_too_small_fails_on_low_level_drive():
    d = reference_design()
    d.instance("R1").params["ohms"] = 500
    r = run_b3(d, LIB)
    assert r.status == "fail" and "below the minimum" in r.detail and "part:std_i2c.vol_max_v" in r.evidence


def test_fast_mode_rejects_the_standard_mode_pullup():
    d = reference_design()
    d.assumptions["i2c_mode"] = "fast"  # 398 ns > 300 ns
    assert run_b3(d, LIB).status == "fail"


def test_missing_bus_assumptions_are_unknown_never_pass():
    d = reference_design()
    d.assumptions.clear()
    r = run_b3(d, LIB)
    assert r.status == "unknown" and r.label is None and "i2c_cb_pf" in r.detail


def test_excess_bus_capacitance_fails():
    d = reference_design()
    d.assumptions["i2c_cb_pf"] = 500
    assert run_b3(d, LIB).status == "fail"


def test_floating_sdo_makes_the_address_unknown():
    d = reference_design()
    d.net("GND").pins.remove("U3.SDO")
    r = run_b3(d, LIB)
    assert r.status == "unknown" and "address cannot be determined" in r.detail


def test_unstated_resistance_is_unknown():
    d = reference_design()
    del d.instance("R5").params["ohms"]
    assert run_b3(d, LIB).status == "unknown"


def test_wrong_cc_resistor_value_fails():
    d = reference_design()
    d.instance("R6").params["ohms"] = 10000
    r = run_b3(d, LIB)
    assert r.status == "fail" and "J1.CC2" in r.detail


def test_cc_resistor_to_a_non_ground_net_fails():
    d = reference_design()
    d.net("GND").pins.remove("R5.2")
    d.net("3V3").pins.append("R5.2")
    assert run_b3(d, LIB).status == "fail"


def test_b3_stays_silent_on_faults_owned_by_other_rungs():
    for f in FAULTS:
        if f.expected_rung != "B3":
            assert run_b3(inject_fault(reference_design(), f.id), LIB).status == "pass", f.id


def test_ladder_includes_b3_and_skips_it_when_b1_fails():
    clean = {r.rung: r.status for r in run_ladder(reference_design(), LIB)}
    assert clean == {"B1": "pass", "B2": "pass", "B3": "pass", "B4": "pass"}
    broken = {r.rung: r.status for r in run_ladder(inject_fault(reference_design(), "nonexistent_pin"), LIB)}
    assert broken == {"B1": "fail", "B2": "unknown", "B3": "unknown", "B4": "unknown"}
