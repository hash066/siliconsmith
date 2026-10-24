"""Deterministic board placement: no model, no randomness. Same design in, same coordinates out.

Pipeline (pure Python, no KiCad needed): design + part library + footprints.json + fp_cache.json -> `Job` (instances with
footprints, pad-level nets, board size, keep-out) -> placement by rules:

  1. the MCU module sits at the top centre with its antenna end at the board edge and a copper keep-out over the antenna area;
  2. connectors sit on the bottom edge (USB-C at the left, battery connector at the right);
  3. everything else is placed most-connected-first, at the grid position and rotation that gives the shortest connection length
     (half-perimeter wirelength, power nets weighted down, ground ignored because it is a pour), without overlapping a courtyard;
  4. one bypass capacitor per supply pin is ADDED next to its part. They are not in the checked netlist: the Job says so.

Coordinates: millimetres, board origin top-left, y down (as KiCad). Rotation is counter-clockwise on screen, 0/90/180/270.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..netlist import Design, split_pin
from ..parts import Part

HERE = Path(__file__).parent
GRID = 0.5
EDGE_MARGIN = 1.0
EDGE_INSET = 0.35  # connectors sit this far inside the edge so their pads keep the 0.5 mm copper-to-edge clearance

# Layout styles: each is a documented set of placer and routing settings, and `note` says exactly what it changes.
STYLES: dict[str, dict[str, Any]] = {
    "default": dict(power_w=0.35, clear_small=0.45, clear_ic=0.8, margin=1.0, stitch_pitch=4.0, area_factor=1.9, widths=(40.0, 44.0, 48.0, 52.0, 56.0),
                    note="Default: room for escape routing around every part, ground stitching vias every 4 mm."),
    "smallest": dict(power_w=0.35, clear_small=0.32, clear_ic=0.55, margin=0.8, stitch_pitch=4.0, area_factor=1.3, widths=tuple(float(w) for w in range(30, 58, 2)),
                     note="Smallest: tighter gaps between parts (0.32 mm small parts, 0.55 mm chips), 0.8 mm edge margin, and board sizes tried from 30 mm wide. Harder to route; the DRC result says whether it worked."),
    "emi": dict(power_w=1.6, clear_small=0.45, clear_ic=0.8, margin=1.0, stitch_pitch=2.5, area_factor=1.9, widths=(40.0, 44.0, 48.0, 52.0, 56.0),
                note="Reduce EMI: supply connections weigh more than signals in the placement score, and ground stitching vias every 2.5 mm (denser return paths)."),
}


def style_of(name: str | None) -> str:
    return name if name in STYLES else "default"
GROUND_NETS = {"GND", "AGND", "VSS"}
POWER_NETS = {"VBAT", "VBUS", "3V3", "VCC", "VDD", "5V"}

# bypass capacitors the layout adds: part id -> [(pin name, value)]
BYPASS = {"esp32": [("3V3", "10u")], "bme280": [("VDD", "100n")], "ldo33": [("VIN", "10u"), ("VOUT", "10u")], "mcp73831": [("VDD", "4u7"), ("VBAT", "4u7")]}


class LayoutError(ValueError):
    """A design the layout cannot place (a part without a footprint, nothing fits). The message says what to change."""


def load_footprints() -> dict[str, Any]:
    return json.loads((HERE / "footprints.json").read_text(encoding="utf-8"))


def load_cache() -> dict[str, Any]:
    return json.loads((HERE / "fp_cache.json").read_text(encoding="utf-8"))


def rot_xy(x: float, y: float, deg: int) -> tuple[float, float]:
    """Rotate a footprint-frame point counter-clockwise on screen (KiCad frame, y down)."""
    d = deg % 360
    c, s = {0: (1, 0), 90: (0, 1), 180: (-1, 0), 270: (0, -1)}[d]
    return x * c + y * s, -x * s + y * c


@dataclass
class Inst:
    ref: str
    part: str
    footprint: str
    value: str = ""
    x: float = 0.0
    y: float = 0.0
    rot: int = 0
    added_by_layout: bool = False
    placed: bool = False

    def pad_xy(self, pad: dict[str, Any]) -> tuple[float, float]:
        dx, dy = rot_xy(pad["x"], pad["y"], self.rot)
        return self.x + dx, self.y + dy

    def courtyard(self, cache: dict[str, Any], pad: float = 0.0) -> tuple[float, float, float, float]:
        x0, y0, x1, y1 = cache[self.footprint]["courtyard"]
        pts = [rot_xy(a, b, self.rot) for a, b in ((x0, y0), (x1, y0), (x0, y1), (x1, y1))]
        return (self.x + min(p[0] for p in pts) - pad, self.y + min(p[1] for p in pts) - pad, self.x + max(p[0] for p in pts) + pad, self.y + max(p[1] for p in pts) + pad)


@dataclass
class Job:
    name: str
    width: float
    height: float
    instances: list[Inst]
    nets: dict[str, list[tuple[str, str, str]]]  # net -> [(ref, pad name, logical pin)]
    keepouts: list[tuple[float, float, float, float]] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    style: str = "default"
    connector_edges: dict[str, str] = field(default_factory=dict)  # part id -> "left" | "right" | "bottom"
    request: dict[str, Any] = field(default_factory=dict)  # what was asked: style, understood, ignored

    def inst(self, ref: str) -> Inst:
        return next(i for i in self.instances if i.ref == ref)


def pad_names(fpmap: dict[str, Any], part: Part, pin_name: str) -> list[str]:
    row = fpmap[part.id]
    if pin_name in row.get("pad_map", {}):
        return list(row["pad_map"][pin_name])
    pin = next((p for p in part.pins if p.name == pin_name), None)
    if pin is None:
        raise LayoutError(f"part {part.id} has no pin {pin_name!r}")
    return [pin.number]


def build_job(design: Design, library: dict[str, Part], *, width: float = 50.0, height: float = 60.0, bypass: bool = True) -> Job:
    fpmap = load_footprints()
    cache = load_cache()
    missing = sorted({i.part for i in design.instances if i.part not in fpmap or fpmap[i.part].get("footprint") not in cache})
    if missing:
        raise LayoutError(f"no footprint for part(s) {', '.join(missing)}; the layout supports: {', '.join(k for k in fpmap if not k.startswith('_'))}")
    insts: list[Inst] = []
    for i in design.instances:
        part = library[i.part]
        val = ""
        if i.part == "res":
            ohms = float(i.params.get("ohms", 0))
            val = f"{ohms / 1000:g}k" if ohms >= 1000 else f"{ohms:g}"
        insts.append(Inst(ref=i.ref, part=i.part, footprint=fpmap[i.part]["footprint"], value=val or part.name))
    nets: dict[str, list[tuple[str, str, str]]] = {}
    by_ref = {i.ref: i for i in design.instances}
    for n in design.nets:
        rows = []
        for rp in n.pins:
            ref, pin = split_pin(rp)
            inst = by_ref.get(ref)
            if inst is None:
                raise LayoutError(f"net {n.name} refers to {ref}, which is not in the design")
            for pad in pad_names(fpmap, library[inst.part], pin):
                rows.append((ref, pad, pin))
        nets[n.name] = rows
    notes: list[str] = []
    if bypass:
        k = 0
        for inst in list(design.instances):
            for pin, val in BYPASS.get(inst.part, []):
                net = next((n.name for n in design.nets if f"{inst.ref}.{pin}" in n.pins), None)
                gnd = next((n.name for n in design.nets if n.name in GROUND_NETS), None)
                if net is None or gnd is None:
                    continue
                k += 1
                ref = f"C{100 + k}"
                insts.append(Inst(ref=ref, part="cap", footprint=fpmap["_added_by_layout"]["cap"]["footprint"], value=val, added_by_layout=True))
                nets[net].append((ref, "1", "1"))
                nets[gnd].append((ref, "2", "2"))
        if k:
            notes.append(f"{k} bypass capacitors were added by the layout (C101 and up). They are not part of the checked netlist; rungs B1 to B5 did not see them.")
    return Job(name=design.name or "board", width=width, height=height, instances=insts, nets=nets, notes=notes)


def _overlap(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _weight(net: str, power_w: float = 0.35) -> float:
    if net in GROUND_NETS:
        return 0.0
    return power_w if net in POWER_NETS else 1.0


def _hpwl(job: Job, cache: dict[str, Any], extra: Inst | None = None) -> float:
    total = 0.0
    pads_of = {i.ref: {p["name"]: p for p in cache[i.footprint]["pads"]} for i in job.instances}
    pw = STYLES[job.style]["power_w"]
    for net, rows in job.nets.items():
        w = _weight(net, pw)
        if not w:
            continue
        xs: list[float] = []
        ys: list[float] = []
        for ref, pad, _ in rows:
            inst = extra if extra is not None and extra.ref == ref else job.inst(ref)
            if not inst.placed and inst is not extra:
                continue
            p = pads_of[ref].get(pad)
            if p is None:
                continue
            x, y = inst.pad_xy(p)
            xs.append(x)
            ys.append(y)
        if len(xs) >= 2:
            total += w * ((max(xs) - min(xs)) + (max(ys) - min(ys)))
    return total


def place(job: Job) -> Job:
    """Fill in x, y, rot for every instance, or raise LayoutError."""
    cache = load_cache()
    fpmap = load_footprints()
    W, H = job.width, job.height
    placed_rects: list[tuple[float, float, float, float]] = []

    def commit(inst: Inst, x: float, y: float, rot: int, clearance: float) -> None:
        inst.x, inst.y, inst.rot, inst.placed = x, y, rot, True
        placed_rects.append(inst.courtyard(cache, clearance))

    mcu = next((i for i in job.instances if fpmap.get(i.part, {}).get("role") == "mcu"), None)
    if mcu is not None:
        x0, y0, x1, y1 = cache[mcu.footprint]["courtyard"]
        kos = cache[mcu.footprint].get("keepouts") or []
        # the module maker's antenna no-copper zone must lie off the board: the antenna end hangs over the top edge
        top = max((k[3] for k in kos), default=y0)
        commit(mcu, W / 2 - (x0 + x1) / 2, -top, 0, 0.3)
        job.notes.append("The module's antenna end hangs over the top board edge, as its maker recommends; nothing is placed in its no-copper zone.")
    sty = STYLES[job.style]
    margin, pw = sty["margin"], sty["power_w"]
    # connectors on an edge (bottom unless the request says left or right); the plug opening faces outward
    edge_parts = [i for i in job.instances if fpmap.get(i.part, {}).get("edge") == "bottom"]
    slots = {"usbc": 0.28, "batt": 0.78}
    side_slot = {"usbc": 0.55, "batt": 0.85}
    for c in sorted(edge_parts, key=lambda i: slots.get(i.part, 0.5)):
        where = job.connector_edges.get(c.part, "bottom")
        x0, y0, x1, y1 = cache[c.footprint]["courtyard"]
        if where == "bottom":
            cx = W * slots.get(c.part, 0.5)
            commit(c, cx - (x0 + x1) / 2, H - y1 - EDGE_INSET, 0, 0.3)
            if c.courtyard(cache)[2] > W - margin or c.courtyard(cache)[0] < margin:
                raise LayoutError(f"{c.ref} does not fit on the bottom edge of a {W:g} x {H:g} mm board; make the board wider")
            continue
        rot = 270 if where == "left" else 90  # rotates the opening (+y in the footprint) to point out of the board
        c.rot = rot
        r0 = c.courtyard(cache)  # at x = 0, y = 0
        dx = EDGE_INSET - r0[0] if where == "left" else (W - EDGE_INSET) - r0[2]
        want = H * side_slot.get(c.part, 0.7)
        placed_ok = False
        for k in range(0, int(H)):
            for sign in (1, -1):
                cy = want + sign * k
                c.x, c.y = dx, cy - (r0[1] + r0[3]) / 2
                rect = c.courtyard(cache, 0.3)
                if rect[1] < margin or rect[3] > H - margin:
                    continue
                if any(_overlap(rect, r) for r in placed_rects):
                    continue
                commit(c, c.x, c.y, rot, 0.3)
                placed_ok = True
                break
            if placed_ok:
                break
        if not placed_ok:
            raise LayoutError(f"{c.ref} does not fit on the {where} edge of a {W:g} x {H:g} mm board; make the board taller")
    rest = [i for i in job.instances if not i.placed]

    def shared(inst: Inst) -> int:
        have = {r for n in job.nets.values() for r, _, _ in n if any(j.ref == r and j.placed for j in job.instances)}
        return sum(1 for n, rows in job.nets.items() if _weight(n, pw) and any(r == inst.ref for r, _, _ in rows) and any(r in have and r != inst.ref for r, _, _ in rows))

    def area(inst: Inst) -> float:
        x0, y0, x1, y1 = cache[inst.footprint]["courtyard"]
        return (x1 - x0) * (y1 - y0)

    while rest:
        rest.sort(key=lambda i: (-shared(i), -area(i), i.ref))
        inst = rest.pop(0)
        clearance = sty["clear_small"] if area(inst) < 6 else sty["clear_ic"]  # room for escape routing and a via beside every pad
        best: tuple[float, float, float, int] | None = None
        pads_of = {p["name"]: p for p in cache[inst.footprint]["pads"]}
        # search window: around the connected, already placed pads (or the whole board if there are none)
        pts = []
        for n, rows in job.nets.items():
            if not _weight(n, pw) or not any(r == inst.ref for r, _, _ in rows):
                continue
            for r, pad, _ in rows:
                o = job.inst(r)
                if r != inst.ref and o.placed:
                    p = {q["name"]: q for q in cache[o.footprint]["pads"]}.get(pad)
                    if p:
                        pts.append(o.pad_xy(p))
        cx, cy = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)) if pts else (W / 2, H / 2)
        reach = 14.0 if pts else max(W, H)
        step = GRID
        gx = int((cx - reach) / step)
        while gx * step <= cx + reach:
            gy = int((cy - reach) / step)
            while gy * step <= cy + reach:
                for rot in (0, 90, 180, 270) if len(pads_of) <= 10 else (0, 90, 180, 270):
                    inst.x, inst.y, inst.rot = gx * step, gy * step, rot
                    rect = inst.courtyard(cache, clearance)
                    if rect[0] < margin or rect[1] < margin or rect[2] > W - margin or rect[3] > H - margin:
                        continue
                    if any(_overlap(rect, r) for r in placed_rects) or any(_overlap(rect, k) for k in job.keepouts):
                        continue
                    cost = _hpwl(job, cache, inst) + 0.002 * math.hypot(inst.x - cx, inst.y - cy)
                    key = (round(cost, 6), inst.x, inst.y, rot)
                    if best is None or key < (round(best[0], 6), best[1], best[2], best[3]):
                        best = (cost, inst.x, inst.y, rot)
                gy += 1
            gx += 1
        if best is None:
            raise LayoutError(f"no room for {inst.ref} ({inst.part}) on a {W:g} x {H:g} mm board; make the board bigger")
        commit(inst, best[1], best[2], best[3], clearance)
    return job


def build_and_place(design: Design, library: dict[str, Part], *, width: float | None = None, height: float | None = None, style: str | None = None, constraints: Any = None) -> Job:
    """Place on the smallest board that fits (or the size given, or the size asked for in `constraints`). Sizes are tried smallest area first.
    `style` is one of STYLES; `constraints` is a constraints.Constraints (board size, connector edges) with its understood/ignored lists."""
    st = style_of(style)
    sty = STYLES[st]
    if constraints is not None and constraints.width and constraints.height and width is None:
        width, height = constraints.width, constraints.height

    def make(w: float, h: float) -> Job:
        job = build_job(design, library, width=w, height=h)
        job.style = st
        if constraints is not None:
            job.connector_edges = dict(constraints.connector_edges)
        job.notes.append(sty["note"])
        job.request = {"style": st, "understood": list(constraints.understood) if constraints else [], "ignored": list(constraints.ignored) if constraints else []}
        return job

    if width is not None and height is not None:
        return place(make(width, height))
    cache = load_cache()
    probe = build_job(design, library, width=50.0, height=60.0)
    need = 0.0
    for i in probe.instances:
        x0, y0, x1, y1 = cache[i.footprint]["courtyard"]
        need += (x1 - x0 + 1.6) * (y1 - y0 + 1.6)
    sizes = sorted(((w, h) for w in sty["widths"] for h in range(32, 80, 2)), key=lambda s: (s[0] * s[1], s[0]))
    last: LayoutError | None = None
    for w, h in sizes:
        if w * h < need * sty["area_factor"]:
            continue
        try:
            return place(make(w, float(h)))
        except LayoutError as e:
            last = e
    raise LayoutError(f"no board size up to {max(sty['widths']):g} x 78 mm fits this design ({last})")


def wirelength(job: Job) -> float:
    return _hpwl(job, load_cache())


def to_json(job: Job) -> dict[str, Any]:
    return {
        "name": job.name,
        "width": job.width,
        "height": job.height,
        "keepouts": job.keepouts,
        "notes": job.notes,
        "style": job.style,
        "stitch_pitch": STYLES[job.style]["stitch_pitch"],
        "request": job.request,
        "instances": [{"ref": i.ref, "part": i.part, "footprint": i.footprint, "value": i.value, "x": round(i.x, 4), "y": round(i.y, 4), "rot": i.rot, "added_by_layout": i.added_by_layout} for i in job.instances],
        "nets": {n: [[r, p, lg] for r, p, lg in rows] for n, rows in job.nets.items()},
    }
