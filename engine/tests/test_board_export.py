"""Board exports: firmware pin header, BOM, KiCad netlist."""

import re

import pytest

from siliconsmith.board.export import bom, firmware_header, kicad_netlist
from siliconsmith.board.faults import inject_fault, reference_design
from siliconsmith.board.netlist import FirmwarePin, Instance
from siliconsmith.board.parts import load_library

LIB = load_library()


def test_firmware_header_lists_every_function_with_its_gpio_number():
    h = firmware_header(reference_design())
    assert "#define SS_PIN_WAKE_BTN 14  /* input */" in h
    assert "#define SS_PIN_I2C_SDA 21  /* bidir */" in h
    assert h.count("#define SS_PIN_") == 4
    assert h.index("#ifndef SS_BOARD_PINS_H") < h.index("#endif")


def test_header_reflects_the_firmware_view_of_a_faulty_design():
    assert "#define SS_PIN_WAKE_BTN 12" in firmware_header(inject_fault(reference_design(), "pin_mismatch"))


def test_header_rejects_non_gpio_pin_names():
    d = reference_design()
    d.firmware_pins.append(FirmwarePin(function="x", pin="EN", use="input"))
    with pytest.raises(ValueError):
        firmware_header(d)


def test_bom_groups_by_part_and_value_and_counts_every_instance():
    rows = bom(reference_design(), LIB)
    assert sum(int(r["quantity"]) for r in rows) == len(reference_design().instances)
    pull = next(r for r in rows if r["value"] == "4700 ohm")
    assert pull["refs"] == "R1, R2" and pull["quantity"] == "2"
    cc = next(r for r in rows if r["value"] == "5100 ohm")
    assert cc["refs"] == "R5, R6"
    esp = next(r for r in rows if r["part"] == "esp32")
    assert esp["origin"] == "datasheet"
    assert next(r for r in rows if r["part"] == "led")["origin"] == "author_defined"


def test_bom_keeps_unknown_parts_visible():
    d = reference_design()
    d.instances.append(Instance(ref="X1", part="mystery"))
    row = next(r for r in bom(d, LIB) if r["part"] == "mystery")
    assert row["origin"] == "unknown" and row["refs"] == "X1"


def test_kicad_netlist_has_every_component_and_every_connection():
    d = reference_design()
    net = kicad_netlist(d, LIB)
    assert net.startswith('(export (version "E")')
    assert len(re.findall(r"\(comp \(ref", net)) == len(d.instances)
    assert len(re.findall(r"\(node \(ref", net)) == sum(len(n.pins) for n in d.nets)
    assert '(node (ref "U1") (pin "25") (pinfunction "GPIO0"))' not in net  # GPIO0 is unused
    assert '(node (ref "U1") (pin "14") (pinfunction "GPIO12"))' not in net
    assert '(node (ref "U1") (pin "13") (pinfunction "GPIO14"))' in net  # pad numbers, not pin names
    assert net.count("(") == net.count(")")
    assert '(footprint "")' in net  # honest: no footprints


def test_kicad_netlist_is_deterministic():
    d = reference_design()
    assert kicad_netlist(d, LIB) == kicad_netlist(d.copy(), LIB)
