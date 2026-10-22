"""Board workbench day-1 gate: parts schema, netlist model, rung B1, fault injection."""

import json

import pytest
from pydantic import ValidationError

from siliconsmith.board.checks import RUNG_LABELS, CheckResult, run_b1, run_ladder
from siliconsmith.board.faults import FAULTS, STRUCTURAL_FAULTS, inject_fault, reference_design
from siliconsmith.board.netlist import Design, dump_design, load_design
from siliconsmith.board.parts import Fact, Part, Provenance, load_library, resolve_fact

LIB = load_library()


def _prov():
    return {"source": "doc", "section": "sec"}


def _part(**over):
    base = {"id": "p", "name": "P", "package": "x", "kind": "ic", "origin": "author_defined",
            "pin_table_provenance": _prov(),
            "pins": [{"name": "A", "number": "1", "direction": "output"}, {"name": "B", "number": "2", "direction": "input", "required": True}]}
    base.update(over)
    return base


def _design(parts_nets, instances):
    return Design.model_validate({"name": "t", "instances": instances, "nets": parts_nets})


# ---- parts schema -------------------------------------------------------------------------------

def test_library_loads_and_seed_parts_present():
    assert {"esp32", "bme280", "ldo33"} <= set(LIB)
    esp = LIB["esp32"]
    for n in (34, 35, 36, 39):
        assert "input_only" in esp.pin(f"GPIO{n}").capabilities
    for n in (6, 7, 8, 9, 10, 11):
        assert "flash" in esp.pin(f"GPIO{n}").capabilities
    for n in (0, 2, 5, 12, 15):
        assert "strapping" in esp.pin(f"GPIO{n}").capabilities
    assert esp.pin("GPIO4").capabilities.count("strapping") == 0
    assert LIB["bme280"].fact("i2c_addr_sdo_low").value == "0x76"
    assert LIB["bme280"].fact("i2c_addr_sdo_high").value == "0x77"
    assert LIB["ldo33"].fact("iout_max_ma").value == 600


def test_checked_citations_carry_a_url_and_only_datasheet_parts_are_checked():
    """Only esp32 and bme280 were read in full (2026-10-22); everything else must stay unchecked."""
    for part in LIB.values():
        for fid, prov in part.fact_provenance().items():
            if prov.citation_checked:
                assert prov.url and part.id in ("esp32", "bme280"), fid
            elif part.id in ("esp32", "bme280"):
                raise AssertionError(f"{fid} should be checked")
        if part.origin == "author_defined":
            assert "author-defined" in part.pin_table_provenance.source or part.id == "usbc"
    assert not LIB["ldo33"].pin_table_provenance.citation_checked
    assert not LIB["usbc"].fact("sink_rd_ohm").provenance.citation_checked


def test_schema_rejects_fact_without_provenance():
    with pytest.raises(ValidationError):
        Fact.model_validate({"key": "vmax", "kind": "abs_max", "text": "x", "value": 3.6})
    with pytest.raises(ValidationError):
        Part.model_validate(_part(facts=[{"key": "vmax", "kind": "abs_max", "text": "x"}]))


def test_schema_rejects_part_without_pin_table_provenance():
    data = _part()
    del data["pin_table_provenance"]
    with pytest.raises(ValidationError):
        Part.model_validate(data)


def test_checked_citation_requires_url_and_blank_source_rejected():
    with pytest.raises(ValidationError):
        Provenance(source="doc", section="s", citation_checked=True)
    assert Provenance(source="doc", section="s", citation_checked=True, url="https://example.invalid/d.pdf").citation_checked
    with pytest.raises(ValidationError):
        Provenance(source="", section="s")


def test_schema_rejects_unknown_capability_and_duplicate_pins():
    with pytest.raises(ValidationError):
        Part.model_validate(_part(pins=[{"name": "A", "number": "1", "capabilities": ["gpoi"]}]))
    with pytest.raises(ValidationError):
        Part.model_validate(_part(pins=[{"name": "A", "number": "1"}, {"name": "A", "number": "2"}]))


def test_evidence_ids_resolve_to_provenance():
    prov = resolve_fact(LIB, "part:esp32.gpio12.strapping")
    assert prov is not None and prov.section.startswith("3 Boot Configurations")
    assert resolve_fact(LIB, "part:esp32.gpio99") is None
    assert resolve_fact(LIB, "nonsense") is None


# ---- netlist model ------------------------------------------------------------------------------

def test_design_json_round_trip(tmp_path):
    d = reference_design()
    f = tmp_path / "d.json"
    f.write_text(dump_design(d), encoding="utf-8")
    assert load_design(f) == d


def test_design_rejects_bad_connection_and_duplicate_refs():
    with pytest.raises(ValidationError):
        Design.model_validate({"name": "t", "instances": [], "nets": [{"name": "n", "pins": ["nodot"]}]})
    with pytest.raises(ValidationError):
        Design.model_validate({"name": "t", "instances": [{"ref": "U1", "part": "a"}, {"ref": "U1", "part": "a"}], "nets": []})


# ---- rung B1: clean design ----------------------------------------------------------------------

def test_clean_design_passes_b1_with_label_and_evidence():
    r = run_b1(reference_design(), LIB)
    assert r.status == "pass", r.detail
    assert r.rung == "B1" and r.label == "Netlist is well formed"
    assert r.evidence and all(resolve_fact(LIB, e) for e in r.evidence)
    assert all(f.status == "pass" for f in r.findings)
    assert [x.model_dump()["rung"] for x in run_ladder(reference_design(), LIB)] == ["B1"]


def test_result_has_the_documented_shape():
    r = run_b1(reference_design(), LIB).model_dump()
    assert {"rung", "status", "label", "detail", "evidence"} <= set(r)


def test_label_cannot_be_set_unless_pass():
    with pytest.raises(ValidationError):
        CheckResult(rung="B1", status="fail", label=RUNG_LABELS["B1"], detail="x")
    with pytest.raises(ValidationError):
        CheckResult(rung="B1", status="unknown", label=RUNG_LABELS["B1"], detail="x")
    with pytest.raises(ValidationError):
        CheckResult(rung="B1", status="pass", label=None, detail="x")


# ---- rung B1: faults it can detect --------------------------------------------------------------

@pytest.mark.parametrize("fault", STRUCTURAL_FAULTS, ids=lambda f: f.id)
def test_b1_detects_structural_faults(fault):
    clean = reference_design()
    faulty = inject_fault(clean, fault.id)
    r = run_b1(faulty, LIB)
    assert r.status == "fail" and r.label is None
    assert r.evidence


def test_floating_required_pin_names_the_pin_and_cites_it():
    r = run_b1(inject_fault(reference_design(), "floating_required_pin"), LIB)
    assert "U1.EN" in r.detail and "part:esp32.en" in r.evidence


def test_two_drivers_named():
    r = run_b1(inject_fault(reference_design(), "two_output_drivers"), LIB)
    assert "VBUS" in r.detail and "U2.VOUT" in r.detail and "J1.VBUS" in r.detail


def test_nonexistent_pin_fails_and_cites_pin_table():
    r = run_b1(inject_fault(reference_design(), "nonexistent_pin"), LIB)
    assert "GPIO99" in r.detail and "part:esp32.pin_table" in r.evidence


def test_pin_on_two_nets_fails():
    d = reference_design()
    d.net("SCL").pins.append("U1.GPIO21")
    r = run_b1(d, LIB)
    assert r.status == "fail" and "GPIO21" in r.detail


def test_assignment_to_nonexistent_mcu_pin_fails():
    d = reference_design()
    d.mcu_assignments[0].pin = "GPIO77"
    assert run_b1(d, LIB).status == "fail"


# ---- unknown handling ---------------------------------------------------------------------------

def test_unknown_part_is_unknown_never_pass():
    d = reference_design()
    d.instances.append(type(d.instances[0])(ref="X1", part="mystery_ic"))
    d.net("3V3").pins.append("X1.VCC")
    r = run_b1(d, LIB)
    assert r.status == "unknown" and r.label is None
    assert "mystery_ic" in r.detail


def test_failure_outranks_unknown():
    d = inject_fault(reference_design(), "floating_required_pin")
    d.instances.append(type(d.instances[0])(ref="X1", part="mystery_ic"))
    assert run_b1(d, LIB).status == "fail"


def test_unknown_direction_pin_with_driver_is_unknown():
    lib = {"p": Part.model_validate(_part(pins=[
        {"name": "A", "number": "1", "direction": "output"},
        {"name": "B", "number": "2", "direction": "unknown"}]))}
    d = _design([{"name": "n", "pins": ["U1.A", "U2.B"]}], [{"ref": "U1", "part": "p"}, {"ref": "U2", "part": "p"}])
    r = run_b1(d, lib)
    assert r.status == "unknown" and r.label is None


def test_unreferenced_instance_in_net_fails():
    d = reference_design()
    d.net("GND").pins.append("U9.GND")
    r = run_b1(d, LIB)
    assert r.status == "fail" and "U9" in r.detail


# ---- catalogue ----------------------------------------------------------------------------------

def test_catalogue_has_the_eight_named_faults():
    assert [f.id for f in FAULTS] == [
        "pin_mismatch", "strapping_pin_misuse", "input_only_output", "i2c_pullup_too_large",
        "missing_cc_resistors", "regulator_overload", "overvoltage_3v3_pin", "i2c_address_collision"]
    assert all(f.expected_rung in ("B2", "B3", "B4") and not f.implemented for f in FAULTS)


def test_injection_does_not_mutate_the_original():
    clean = reference_design()
    before = clean.model_dump()
    for f in FAULTS + STRUCTURAL_FAULTS:
        inject_fault(clean, f.id)
    assert clean.model_dump() == before


@pytest.mark.parametrize("fault", FAULTS, ids=lambda f: f.id)
def test_each_catalogue_fault_changes_the_design_and_stays_a_valid_design(fault):
    clean = reference_design()
    faulty = inject_fault(clean, fault.id)
    assert faulty.model_dump() != clean.model_dump()
    Design.model_validate(json.loads(dump_design(faulty)))


@pytest.mark.parametrize("fault", FAULTS, ids=lambda f: f.id)
def test_b1_does_not_claim_to_catch_b2_to_b4_faults(fault):
    """B1 is structurally clean for these; they are pending the rung named in the README, not detected."""
    r = run_b1(inject_fault(reference_design(), fault.id), LIB)
    assert r.status == "pass"


def test_unknown_fault_id_raises():
    with pytest.raises(KeyError):
        inject_fault(reference_design(), "nope")
