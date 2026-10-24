"""Print the geometry of KiCad footprints as JSON (run with the system python3 that has `pcbnew`):

    python3 pcbnew_pads.py Library:Footprint [Library:Footprint ...]

Used to build `fp_cache.json` (so placement runs without KiCad) and by the pad-map tests (a wrong pad number is a wrong board).
Coordinates are millimetres in the footprint's own frame (origin = footprint origin, y down, as KiCad draws it)."""

import json
import os
import sys

import pcbnew

FP_ROOT = os.environ.get("KICAD7_FOOTPRINT_DIR", "/usr/share/kicad/footprints")
SHAPES = {pcbnew.PAD_SHAPE_CIRCLE: "circle", pcbnew.PAD_SHAPE_RECT: "rect", pcbnew.PAD_SHAPE_OVAL: "oval", pcbnew.PAD_SHAPE_ROUNDRECT: "roundrect"}


def mm(v: int) -> float:
    return round(pcbnew.ToMM(v), 4)


def geometry(lib_fp: str) -> dict:
    lib, name = lib_fp.split(":", 1)
    fp = pcbnew.FootprintLoad(os.path.join(FP_ROOT, lib + ".pretty"), name)
    if fp is None:
        return {"error": f"footprint not found: {lib_fp}"}
    pads = []
    for p in fp.Pads():
        pos, size, drill = p.GetPosition(), p.GetSize(), p.GetDrillSize()
        pads.append(
            {
                "name": p.GetNumber(),
                "x": mm(pos.x),
                "y": mm(pos.y),
                "w": mm(size.x),
                "h": mm(size.y),
                "rot": round(p.GetOrientationDegrees(), 3),
                "shape": SHAPES.get(p.GetShape(), "rect"),
                "smd": p.GetAttribute() == pcbnew.PAD_ATTRIB_SMD,
                "npth": p.GetAttribute() == pcbnew.PAD_ATTRIB_NPTH,
                "drill": [mm(drill.x), mm(drill.y)] if drill.x else None,
            }
        )
    keepouts = []
    for z in fp.Zones():  # rule areas the footprint's maker drew (an antenna's no-copper zone, for example)
        if z.GetIsRuleArea():
            zb = z.GetBoundingBox()
            keepouts.append([mm(zb.GetLeft()), mm(zb.GetTop()), mm(zb.GetRight()), mm(zb.GetBottom())])
    cy = fp.GetCourtyard(pcbnew.F_CrtYd)
    if cy.OutlineCount():
        bb = cy.BBox()
        court = [mm(bb.GetLeft()), mm(bb.GetTop()), mm(bb.GetRight()), mm(bb.GetBottom())]
    else:  # no courtyard drawn: pads plus a 0.25 mm margin
        court = [min(p["x"] - p["w"] / 2 for p in pads) - 0.25, min(p["y"] - p["h"] / 2 for p in pads) - 0.25, max(p["x"] + p["w"] / 2 for p in pads) + 0.25, max(p["y"] + p["h"] / 2 for p in pads) + 0.25]
    return {"footprint": lib_fp, "pads": pads, "courtyard": court, "keepouts": keepouts}


if __name__ == "__main__":
    print(json.dumps({a: geometry(a) for a in sys.argv[1:]}))
