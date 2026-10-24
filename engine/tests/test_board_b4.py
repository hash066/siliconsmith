"""Board rung B4: firmware pin header against the netlist."""

import pytest

from siliconsmith.board.checks import IMPLEMENTED_RUNGS, run_b4, run_ladder
from siliconsmith.board.faults import FAULTS, STRUCTURAL_FAULTS, inject_fault, reference_design
from siliconsmith.board.netlist import FirmwarePin
from siliconsmith.board.parts import load_library, resolve_fact

LIB = load_library()


def test_clean_design_passes_b4_with_label_and_resolvable_evidence():
    r = run_b4(reference_design(), LIB)
    assert r.status == "pass", r.detail
    assert r.label == "Firmware matches the netlist"
    assert r.evidence and all(resolve_fact(LIB, e) for e in r.evidence)


def test_pin_mismatch_is_detected_the_demo_fault():
    r = run_b4(inject_fault(reference_design(), "pin_mismatch"), LIB)
    assert r.status == "fail" and r.label is None
    assert "wake_btn: firmware says GPIO12, netlist wires GPIO14" in r.detail
    assert "part:esp32.gpio12" in r.evidence and "part:esp32.gpio14" in r.evidence
    # GPIO12 is also a strapping pin: the firmware's view is flagged for that too
    assert "boot-strapping" in r.detail and "part:esp32.gpio12.strapping" in r.evidence


def test_strapping_pin_misuse_is_detected_with_the_capability_fact():
    r = run_b4(inject_fault(reference_design(), "strapping_pin_misuse"), LIB)
    assert r.status == "fail" and "GPIO12" in r.detail and "part:esp32.gpio12.strapping" in r.evidence


def test_input_only_output_is_detected_with_the_capability_fact():
    r = run_b4(inject_fault(reference_design(), "input_only_output"), LIB)
    assert r.status == "fail" and "GPIO34" in r.detail and "input-only" in r.detail
    assert "part:esp32.gpio34.input_only" in r.evidence


def test_input_only_pin_used_as_input_is_fine():
    d = reference_design()
    d.net("WAKE").pins.remove("U1.GPIO14")
    d.net("WAKE").pins.append("U1.GPIO35")
    d.mcu_assignments[2].pin = "GPIO35"
    d.firmware_pins[2].pin = "GPIO35"
    assert run_b4(d, LIB).status == "pass"


def test_flash_pin_is_detected():
    d = reference_design()
    d.firmware_pins[3].pin = "GPIO6"
    d.mcu_assignments[3].pin = "GPIO6"
    d.net("LED_DRV").pins.remove("U1.GPIO4")
    d.net("LED_DRV").pins.append("U1.GPIO6")
    r = run_b4(d, LIB)
    assert r.status == "fail" and "SPI flash" in r.detail and "part:esp32.gpio6.flash" in r.evidence


def test_direction_disagreement_fails():
    d = reference_design()
    d.firmware_pins[0].use = "input"
    assert "firmware says input, netlist says bidir" in run_b4(d, LIB).detail


def test_function_missing_on_either_side_fails():
    d = reference_design()
    d.firmware_pins.pop()
    assert "firmware header does not declare" in run_b4(d, LIB).detail
    d = reference_design()
    d.firmware_pins.append(FirmwarePin(function="buzzer", pin="GPIO25", use="output"))
    assert "netlist has no such function" in run_b4(d, LIB).detail


def test_assignment_not_matching_wiring_fails():
    d = reference_design()
    d.net("WAKE").pins.remove("U1.GPIO14")
    d.net("SCL").pins.append("U1.GPIO14")
    r = run_b4(d, LIB)
    assert r.status == "fail" and "assignment says WAKE" in r.detail


def test_two_functions_on_one_pin_fail():
    d = reference_design()
    d.firmware_pins[3].pin = "GPIO21"
    d.mcu_assignments[3].pin = "GPIO21"
    assert "more than one function" in run_b4(d, LIB).detail


def test_unknown_mcu_is_unknown_never_pass():
    d = reference_design()
    d.mcu_ref = None
    r = run_b4(d, LIB)
    assert r.status == "unknown" and r.label is None


def test_b4_stays_silent_on_faults_owned_by_other_rungs():
    for f in FAULTS:
        if f.expected_rung != "B4":
            assert run_b4(inject_fault(reference_design(), f.id), LIB).status == "pass", f.id


def test_every_implemented_fault_is_caught_by_its_rung_and_the_clean_design_passes_all():
    assert all(r.status == "pass" for r in run_ladder(reference_design(), LIB))
    for f in FAULTS + STRUCTURAL_FAULTS:
        assert f.implemented and f.expected_rung in IMPLEMENTED_RUNGS
        got = {r.rung: r.status for r in run_ladder(inject_fault(reference_design(), f.id), LIB)}
        assert got[f.expected_rung] == "fail", f.id
