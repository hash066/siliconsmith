"""Board rung B2: electrical limits from curated facts."""

import pytest

from siliconsmith.board.checks import IMPLEMENTED_RUNGS, run_b2, run_ladder
from siliconsmith.board.faults import FAULTS, STRUCTURAL_FAULTS, inject_fault, reference_design
from siliconsmith.board.netlist import Instance
from siliconsmith.board.parts import Part, load_library, resolve_fact

LIB = load_library()


def test_clean_design_passes_b2_with_label_and_resolvable_evidence():
    r = run_b2(reference_design(), LIB)
    assert r.status == "pass", r.detail
    assert r.label == "Electrical limits respected (curated facts)"
    assert r.evidence and all(resolve_fact(LIB, e) for e in r.evidence)
    assert any("mA vs limit 600 mA" in f.detail for f in r.findings)


def test_overvoltage_fault_is_detected_with_pin_and_source_evidence():
    r = run_b2(inject_fault(reference_design(), "overvoltage_3v3_pin"), LIB)
    assert r.status == "fail" and r.label is None
    assert "U3.VDD" in r.detail and "5 V" in r.detail
    assert "part:bme280.vdd" in r.evidence and "part:usbc.vbus" in r.evidence


def test_regulator_overload_is_detected_with_the_arithmetic():
    r = run_b2(inject_fault(reference_design(), "regulator_overload"), LIB)
    assert r.status == "fail"
    assert "1300.71 mA vs limit 600 mA" in r.detail
    assert "part:ldo33.iout_max_ma" in r.evidence


def test_five_volts_on_a_gpio_fails_signal_domain():
    d = reference_design()
    d.net("LED_DRV").pins.remove("U1.GPIO4")
    d.net("VBUS").pins.append("U1.GPIO4")
    r = run_b2(d, LIB)
    assert r.status == "fail" and "GPIO4" in r.detail and "3.3 V domain" in r.detail


def test_net_without_a_declared_source_is_unknown_not_pass():
    d = reference_design()
    d.net("3V3").pins.remove("U2.VOUT")
    r = run_b2(d, LIB)
    assert r.status == "unknown" and r.label is None


def test_load_without_current_fact_makes_the_rail_unknown():
    d = reference_design()
    d.instances.append(Instance(ref="U9", part="led"))  # placeholder with no power_in pin: not a load
    assert run_b2(d, LIB).status == "pass"
    d.instances.append(Instance(ref="X1", part="mystery"))
    assert run_b2(d, LIB).status == "pass"  # unknown parts are B1's problem; B2 only budgets known loads
    # a library part with a power_in pin on the rail but no current data
    lib = dict(LIB)
    lib["gizmo"] = Part.model_validate({
        "id": "gizmo", "name": "G", "package": "x", "kind": "ic", "origin": "author_defined",
        "pin_table_provenance": {"source": "s", "section": "s"},
        "pins": [{"name": "VCC", "number": "1", "direction": "power_in", "required": True}]})
    d2 = reference_design()
    d2.instances.append(Instance(ref="U7", part="gizmo"))
    d2.net("3V3").pins.append("U7.VCC")
    r = run_b2(d2, lib)
    assert r.status == "unknown" and "U7" in r.detail


def test_b2_stays_silent_on_faults_owned_by_other_rungs():
    for f in FAULTS:
        if f.expected_rung != "B2":
            assert run_b2(inject_fault(reference_design(), f.id), LIB).status == "pass", f.id


def test_ladder_skips_b2_when_b1_fails():
    out = run_ladder(inject_fault(reference_design(), "floating_required_pin"), LIB)
    assert [r.rung for r in out] == ["B1", "B2"]
    assert out[0].status == "fail" and out[1].status == "unknown" and "B1" in out[1].detail


def test_every_fault_with_an_implemented_rung_is_detected_by_exactly_that_rung():
    for f in FAULTS + STRUCTURAL_FAULTS:
        if f.expected_rung not in IMPLEMENTED_RUNGS:
            continue
        by_rung = {r.rung: r.status for r in run_ladder(inject_fault(reference_design(), f.id), LIB)}
        assert by_rung[f.expected_rung] == "fail", f.id
    assert all(r.status == "pass" for r in run_ladder(reference_design(), LIB))
