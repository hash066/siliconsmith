"""Board layout: placement rules, pad maps against the real footprints, and (when KiCad is installed) a full routed board.

The pure-Python parts run everywhere. The KiCad parts are skipped unless KiCad 7, Java and Freerouting are installed (see
siliconsmith/board/layout/generate.py: available())."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

import pytest

from siliconsmith.board.layout import generate as G
from siliconsmith.board.layout import place as P
from siliconsmith.board.netlist import load_design
from siliconsmith.board.serverless import library
from siliconsmith.board.templates import load_template

LIB = library()
FPMAP = P.load_footprints()
CACHE = P.load_cache()
SYMBOLS = Path("/usr/share/kicad/symbols")


def design(tid: str):
    return load_design(load_template(tid)["design"])


# ---------------------------------------------------------------------------------------------------------------- pad maps


def test_every_part_has_a_footprint_that_exists_in_the_cache():
    for part_id in LIB:
        if part_id in ("load", "std_i2c"):
            continue  # abstract parts: no physical form
        assert part_id in FPMAP, f"{part_id} has no footprint row"
        assert FPMAP[part_id]["footprint"] in CACHE, f"{part_id}: footprint {FPMAP[part_id]['footprint']} is not in fp_cache.json"


@pytest.mark.parametrize("part_id", [k for k in FPMAP if not k.startswith("_")])
def test_pad_map_covers_every_pin_with_real_pads_and_no_pad_is_shared(part_id):
    part = LIB[part_id]
    pads = {p["name"] for p in CACHE[FPMAP[part_id]["footprint"]]["pads"]}
    used: dict[str, str] = {}
    for pin in part.pins:
        names = P.pad_names(FPMAP, part, pin.name)
        assert names, f"{part_id}.{pin.name} maps to no pad"
        for n in names:
            assert n in pads, f"{part_id}.{pin.name} -> pad {n!r}, but the footprint has only {sorted(pads)[:12]}"
            assert used.setdefault(n, pin.name) == pin.name, f"pad {n} of {part_id} is claimed by both {used[n]} and {pin.name}"


def _kicad_symbol_pins(file: str, symbol: str) -> dict[str, str]:
    text = (SYMBOLS / file).read_text(encoding="utf-8")
    i = text.index(f'(symbol "{symbol}"')
    depth, j = 0, i
    while True:
        depth += text[j] == "("
        depth -= text[j] == ")"
        if depth == 0:
            break
        j += 1
    return {num: name for name, num in re.findall(r'\(pin \w+ \w+.*?\(name "([^"]*)".*?\(number "([^"]*)"', text[i : j + 1], re.S)}


@pytest.mark.skipif(not SYMBOLS.exists(), reason="KiCad symbol library not installed")
@pytest.mark.parametrize(
    "part_id,file,symbol",
    [("esp32", "RF_Module.kicad_sym", "ESP32-WROOM-32"), ("bme280", "Sensor.kicad_sym", "BME280"), ("mcp73831", "Battery_Management.kicad_sym", "MCP73831-2-OT")],
)
def test_our_pin_tables_agree_with_kicads_symbol_library(part_id, file, symbol):
    """An independent source (KiCad's own symbols): every pin of ours that has a pad number must carry the same function there."""
    theirs = _kicad_symbol_pins(file, symbol)

    def norm(s: str) -> str:
        s = re.sub(r"[{}_^]", "", s).upper()
        s = s.replace("GPIO", "IO").replace("VDD", "3V3") if part_id == "esp32" else s
        return re.sub(r"(?<=[A-Z])\d$", "", s) if s.startswith("GND") else s

    bad = []
    for pin in LIB[part_id].pins:
        their = theirs.get(pin.number)
        if their is None:
            bad.append(f"{pin.name}: pad {pin.number} is not in the KiCad symbol")
            continue
        a, b = norm(pin.name), norm(their)
        alias = {"SENSORVP": "IO36", "SENSORVN": "IO39", "RXD0/IO3": "IO3", "TXD0/IO1": "IO1"}
        flash = {"GPIO9": "SD2", "GPIO10": "SD3", "GPIO11": "CMD", "GPIO6": "CLK", "GPIO7": "SD0", "GPIO8": "SD1"}  # the flash pins, named by their SD role
        if part_id == "esp32" and pin.name in flash and flash[pin.name] in their.upper().split("/"):
            continue
        if a != b and alias.get(b) != a and a not in b.split("/"):
            bad.append(f"{pin.name} (pad {pin.number}) is '{their}' in KiCad")
    assert not bad, bad


def test_led_polarity_matches_kicads_numbering():
    assert FPMAP["led"]["pad_map"] == {"A": ["2"], "K": ["1"]}  # KiCad LED footprints number the cathode 1 and the anode 2


# ---------------------------------------------------------------------------------------------------------------- placement


def placed(tid: str = "clean_sensor") -> P.Job:
    return P.build_and_place(design(tid), LIB)


def test_placement_is_deterministic():
    a, b = P.to_json(placed()), P.to_json(placed())
    assert a == b


def test_every_part_is_placed_inside_the_board_without_overlap():
    job = placed()
    mcu = next(i for i in job.instances if i.part == "esp32")
    rects = {i.ref: i.courtyard(CACHE) for i in job.instances}
    for ref, r in rects.items():
        if ref == mcu.ref:
            continue
        assert r[0] >= 0.5 and r[1] >= 0.5 and r[2] <= job.width - 0.5 and r[3] <= job.height + 0.01, f"{ref} outside the board {r}"
    refs = sorted(rects)
    for i, a in enumerate(refs):
        for b in refs[i + 1 :]:
            ra, rb = rects[a], rects[b]
            overlap = ra[0] < rb[2] and rb[0] < ra[2] and ra[1] < rb[3] and rb[1] < ra[3]
            assert not overlap, f"courtyards of {a} and {b} overlap"


def test_antenna_zone_is_off_the_board_and_connectors_sit_on_the_bottom_edge():
    job = placed()
    mcu = next(i for i in job.instances if i.part == "esp32")
    ko = CACHE[mcu.footprint]["keepouts"][0]
    assert mcu.y + ko[3] <= 0.01, "the module's antenna keep-out must lie above the top board edge"
    for ref in ("J1", "J2"):
        r = job.inst(ref).courtyard(CACHE)
        assert job.height - r[3] < 1.0, f"{ref} is not at the bottom edge"


def test_bypass_capacitors_are_added_and_labelled():
    job = placed()
    caps = [i for i in job.instances if i.added_by_layout]
    assert len(caps) == 6 and all(i.part == "cap" for i in caps)
    assert any("not part of the checked netlist" in n for n in job.notes)
    # each cap sits between a supply net and ground
    for c in caps:
        nets = [n for n, rows in job.nets.items() if any(r == c.ref for r, _, _ in rows)]
        assert len(nets) == 2 and any(n == "GND" for n in nets)


def test_connections_are_conserved_into_pad_level_nets():
    d = design("clean_sensor")
    job = P.build_job(d, LIB)
    for net in d.nets:
        rows = {(r, lg) for r, _, lg in job.nets[net.name] if not r.startswith("C1")}
        assert {tuple(p.split(".", 1)) for p in net.pins} <= rows, net.name


def test_a_part_without_a_footprint_is_a_clear_error():
    d = design("clean_sensor")
    d.instances.append(type(d.instances[0])(ref="X1", part="load"))
    with pytest.raises(P.LayoutError, match="no footprint"):
        P.build_job(d, LIB)


def test_rotation_helper_matches_kicads_convention():
    assert P.rot_xy(1, 0, 90) == (0, -1)  # counter-clockwise on screen with y down
    assert P.rot_xy(1, 0, 180) == (-1, 0)
    assert P.rot_xy(0, 1, 270) == (-1, 0) or P.rot_xy(0, 1, 270) == (1, 0)


# ---------------------------------------------------------------------------------------------------------------- DRC report


def test_drc_report_is_split_into_errors_and_warnings_and_ignores_the_library_table_check():
    text = """** Found 4 DRC violations **
[silk_overlap]: Silkscreen overlap
    Rule: board setup constraints silk; Severity: warning
    @(1 mm, 2 mm): Reference 'C1'
[lib_footprint_issues]: The current configuration does not include the library ''
    Local override; Severity: error
[clearance]: Clearance violation
    Rule: board setup constraints; Severity: error
    @(3.0 mm, 4.0 mm): Track [GND] on F.Cu
** Found 1 unconnected pads **
[unconnected_items]: Missing connection between items
    Local override; Severity: error
    @(5 mm, 6 mm): Pad 1 [GND] of U3 on F.Cu
"""
    d = G.parse_drc(text)
    assert d["errors"] == 2 and d["warnings"] == 1 and d["unconnected"] == 1
    assert d["error_types"] == {"clearance": 1, "unconnected_items": 1} and "lib_footprint_issues" not in d["error_types"]


# ---------------------------------------------------------------------------------------------------------------- full run (KiCad)

TOOLS_OK, TOOLS_WHY = G.available()


@pytest.mark.skipif(not TOOLS_OK, reason=f"KiCad layout tools unavailable: {TOOLS_WHY}")
@pytest.mark.skipif(os.environ.get("HW_SKIP_SLOW") == "1", reason="HW_SKIP_SLOW=1")
def test_full_run_fault_template_routes_cleanly_and_marks_the_wrong_pad(tmp_path):
    d = design("fault_gpio12_vs_gpio14")
    from siliconsmith.board.serverless import check

    res = G.generate(d, tmp_path, LIB, check=check(d.model_dump()))
    assert res.ok and res.stats["fully_routed"], res.status
    assert res.drc["errors"] == 0, res.drc["examples"]
    assert res.stats["seconds"] < 240
    marks = {(m["kind"], m["pad"]) for m in res.markers if m["ref"] == "U1"}
    assert ("fail", "14") in marks and ("wired", "13") in marks  # GPIO12 is pad 14, GPIO14 is pad 13 on the module
    board = json.loads((tmp_path / "board.json").read_text())
    assert board["tracks"] and board["zones"]
    # the round trip: every pad's net in the finished board equals the net in our job
    job = json.loads((tmp_path / "job.json").read_text())
    want = {(r, p): n for n, rows in job["nets"].items() for r, p, _ in rows}
    for fp in board["footprints"]:
        for pad in fp["pads"]:
            if pad["net"]:
                assert want.get((fp["ref"], pad["name"])) == pad["net"], (fp["ref"], pad["name"], pad["net"])
    # our rotation maths agrees with KiCad's: same pad coordinates
    inst = {i["ref"]: i for i in job["instances"]}
    for fp in board["footprints"]:
        i = P.Inst(ref=fp["ref"], part=inst[fp["ref"]]["part"], footprint=inst[fp["ref"]]["footprint"], x=inst[fp["ref"]]["x"], y=inst[fp["ref"]]["y"], rot=inst[fp["ref"]]["rot"])
        by_name = {}
        for p in CACHE[i.footprint]["pads"]:
            by_name.setdefault(p["name"], []).append(i.pad_xy(p))
        for pad in fp["pads"]:
            assert any(abs(pad["x"] - x) < 0.01 and abs(pad["y"] - y) < 0.01 for x, y in by_name.get(pad["name"], [])), (fp["ref"], pad["name"])
    assert (tmp_path / "gerbers-and-drill.zip").stat().st_size > 10_000
    assert "Ref" in (tmp_path / "positions.csv").read_text()


# ---------------------------------------------------------------------------------------------------------------- styles and constraints

from siliconsmith.board.layout.constraints import parse_constraints  # noqa: E402


def test_constraints_understood_and_ignored_are_both_reported():
    c = parse_constraints("40x30mm, USB-C on the left edge, GND pour on the bottom, keep the antenna corner clear, make it blue")
    assert (c.width, c.height) == (40.0, 30.0)
    assert c.connector_edges == {"usbc": "left"}
    assert any("antenna" in u.lower() for u in c.understood)
    assert any("ground pours" in i for i in c.ignored)
    assert any("make it blue" in i for i in c.ignored)
    assert parse_constraints("").as_dict() == parse_constraints(None).as_dict()


def test_constraint_limits_and_unsupported_edges_are_ignored_with_a_reason():
    c = parse_constraints("5 x 5 mm; USB on the top edge; battery near the edge")
    assert c.width is None and c.connector_edges == {}
    assert len(c.ignored) == 3 and "between 25 and 120" in c.ignored[0]
    assert parse_constraints("battery connector on the right, 60 x 45")  .connector_edges == {"batt": "right"}
    assert len(parse_constraints("x" * 5000).understood) == 0  # clipped, not a crash


def test_styles_do_what_their_notes_say():
    d = design("clean_sensor")
    base = P.build_and_place(d, LIB)
    small = P.build_and_place(d, LIB, style="smallest")
    emi = P.build_and_place(d, LIB, style="emi")
    assert small.width * small.height <= base.width * base.height
    assert P.STYLES["emi"]["stitch_pitch"] < P.STYLES["default"]["stitch_pitch"]
    assert any("Smallest" in n for n in small.notes) and any("Reduce EMI" in n for n in emi.notes)
    assert P.STYLES['emi']['power_w'] > P.STYLES['default']['power_w']
    assert P.to_json(emi)["stitch_pitch"] == 2.5 and P.to_json(base)["request"]["style"] == "default"


def test_an_unknown_style_falls_back_to_default():
    assert P.style_of("nope") == "default" and P.style_of(None) == "default" and P.style_of("emi") == "emi"


@pytest.mark.parametrize("edge", ["left", "right"])
def test_connectors_can_sit_on_a_side_edge_facing_outward_without_overlap(edge):
    d = design("clean_sensor")
    c = parse_constraints(f"USB-C on the {edge} edge, 50 x 50 mm")
    job = P.build_and_place(d, LIB, constraints=c)
    usb = job.inst("J1")
    r = usb.courtyard(CACHE)
    assert (r[0] <= 0.5) if edge == "left" else (r[2] >= job.width - 0.5)  # flush with the chosen edge
    assert usb.rot == (270 if edge == "left" else 90)
    assert any(u.startswith("Board size") for u in job.request["understood"])
    rects = {i.ref: i.courtyard(CACHE) for i in job.instances if i.ref != "U1"}
    refs = sorted(rects)
    for i, a in enumerate(refs):
        for b in refs[i + 1:]:
            ra, rb = rects[a], rects[b]
            assert not (ra[0] < rb[2] and rb[0] < ra[2] and ra[1] < rb[3] and rb[1] < ra[3]), f"{a} overlaps {b}"


def test_a_requested_size_that_cannot_hold_the_design_fails_with_a_clear_message():
    with pytest.raises(P.LayoutError, match="no room|does not fit"):
        P.build_and_place(design("clean_sensor"), LIB, constraints=parse_constraints("26 x 26 mm"))
