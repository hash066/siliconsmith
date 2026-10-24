"""KiCad side of the layout (run with the system python3 that has `pcbnew`; the rest of the package never imports pcbnew).

    python3 pcb_build.py build   job.json board.kicad_pcb board.dsn      # footprints, nets, outline, keep-outs, ground pours
    python3 pcb_build.py finish  board.kicad_pcb routed.ses out.kicad_pcb # import the autorouter's tracks, refill pours
    python3 pcb_build.py extract board.kicad_pcb board.json               # geometry for the web viewer

The 2-layer board uses 0.2 mm tracks, 0.15 mm clearance and 0.6/0.3 mm vias (typical cheap prototype-fab rules)."""

from __future__ import annotations

import json
import math
import os
import sys

import pcbnew

FP_ROOT = os.environ.get("KICAD7_FOOTPRINT_DIR", "/usr/share/kicad/footprints")
OX, OY = 100.0, 80.0  # board origin in the KiCad sheet (mm); keeps every coordinate positive for the autorouter
mm = pcbnew.FromMM
tomm = pcbnew.ToMM


def pt(x: float, y: float):
    return pcbnew.VECTOR2I(mm(OX + x), mm(OY + y))


def add_zone(b, layer, net, poly, rule_area=False):
    z = pcbnew.ZONE(b)
    z.SetLayer(layer)
    if net is not None:
        z.SetNet(net)
    o = z.Outline()
    o.NewOutline()
    for x, y in poly:
        o.Append(mm(OX + x), mm(OY + y))
    if rule_area:
        z.SetIsRuleArea(True)
        z.SetDoNotAllowCopperPour(True)
        z.SetDoNotAllowTracks(True)
        z.SetDoNotAllowVias(True)
        z.SetDoNotAllowPads(False)
        z.SetDoNotAllowFootprints(False)
        both = pcbnew.LSET()
        both.AddLayer(pcbnew.F_Cu)
        both.AddLayer(pcbnew.B_Cu)
        z.SetLayerSet(both)
    else:
        z.SetMinThickness(mm(0.15))
        z.SetPadConnection(pcbnew.ZONE_CONNECTION_FULL)  # solid: thermal spokes starve on small pads and fail the rule
        z.SetIslandRemovalMode(pcbnew.ISLAND_REMOVAL_MODE_ALWAYS)
    b.Add(z)
    return z


def add_ground_pours(b, nets) -> None:
    gnd = next((nets[n] for n in ("GND", "AGND", "VSS") if n in nets), None)
    if gnd is None:
        return
    box = b.GetBoardEdgesBoundingBox()
    x0, y0, x1, y1 = (tomm(box.GetLeft()) - OX + 0.3, tomm(box.GetTop()) - OY + 0.3, tomm(box.GetRight()) - OX - 0.3, tomm(box.GetBottom()) - OY - 0.3)
    ring = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    add_zone(b, pcbnew.F_Cu, gnd, ring)
    add_zone(b, pcbnew.B_Cu, gnd, ring)


def build(job: dict, out_pcb: str, out_dsn: str) -> None:
    b = pcbnew.BOARD()
    b.SetCopperLayerCount(2)
    ds = b.GetDesignSettings()
    nc = ds.m_NetSettings.m_DefaultNetClass
    nc.SetTrackWidth(mm(0.2))
    nc.SetClearance(mm(0.15))
    nc.SetViaDiameter(mm(0.6))
    nc.SetViaDrill(mm(0.3))
    ds.m_MinClearance = mm(0.15)
    ds.m_TrackMinWidth = mm(0.15)
    ds.m_ViasMinSize = mm(0.5)
    ds.m_MinThroughDrill = mm(0.2)
    ds.m_CopperEdgeClearance = mm(0.5)

    # board outline
    W, H = job["width"], job["height"]
    for (x0, y0), (x1, y1) in (((0, 0), (W, 0)), ((W, 0), (W, H)), ((W, H), (0, H)), ((0, H), (0, 0))):
        s = pcbnew.PCB_SHAPE(b)
        s.SetShape(pcbnew.SHAPE_T_SEGMENT)
        s.SetLayer(pcbnew.Edge_Cuts)
        s.SetWidth(mm(0.1))
        s.SetStart(pt(x0, y0))
        s.SetEnd(pt(x1, y1))
        b.Add(s)

    nets = {}
    for name in job["nets"]:
        n = pcbnew.NETINFO_ITEM(b, name)
        b.Add(n)
        nets[name] = n

    # pad name -> net, per ref
    assign: dict[str, dict[str, str]] = {}
    for name, rows in job["nets"].items():
        for ref, pad, _ in rows:
            assign.setdefault(ref, {})[pad] = name

    for inst in job["instances"]:
        lib, fpname = inst["footprint"].split(":", 1)
        fp = pcbnew.FootprintLoad(os.path.join(FP_ROOT, lib + ".pretty"), fpname)
        if fp is None:
            raise SystemExit(f"footprint not found: {inst['footprint']}")
        fp.SetFPID(pcbnew.LIB_ID(lib, fpname))
        fp.SetReference(inst["ref"])
        fp.SetValue(inst["value"])
        fp.Value().SetVisible(False)  # the value lives in the BOM; two labels per tiny part only crowd the silkscreen
        fp.Reference().SetTextSize(pcbnew.VECTOR2I(mm(0.8), mm(0.8)))
        fp.Reference().SetTextThickness(mm(0.15))
        fp.SetPosition(pt(inst["x"], inst["y"]))
        fp.SetOrientationDegrees(inst["rot"])
        for pad in fp.Pads():
            net = assign.get(inst["ref"], {}).get(pad.GetNumber())
            if net:
                pad.SetNet(nets[net])
        b.Add(fp)

    def zone(layer, net, poly, rule_area=False):
        return add_zone(b, layer, net, poly, rule_area)

    # a thin ring along the board edge where no track or via may go: copper must stay 0.5 mm from the edge (the autorouter does not know)
    ring_w = 0.55
    for r in ((0, 0, W, ring_w), (0, H - ring_w, W, H), (0, 0, ring_w, H), (W - ring_w, 0, W, H)):
        zone(pcbnew.F_Cu, None, [(r[0], r[1]), (r[2], r[1]), (r[2], r[3]), (r[0], r[3])], rule_area=True)
    for (x0, y0, x1, y1) in job.get("keepouts", []):
        zone(pcbnew.F_Cu, None, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], rule_area=True)
    # The ground pours are added AFTER routing (see finish): a pour on the bottom layer would be exported to the autorouter as a
    # plane and the router could then only use the top layer.

    t = pcbnew.PCB_TEXT(b)
    t.SetText(f"{job['name']}  |  2-layer prototype  |  not fabricated")
    t.SetPosition(pt(W / 2, H - 1.6))
    t.SetLayer(pcbnew.F_SilkS)
    t.SetTextSize(pcbnew.VECTOR2I(mm(0.9), mm(0.9)))
    t.SetTextThickness(mm(0.15))
    b.Add(t)

    pcbnew.SaveBoard(out_pcb, b)
    if not pcbnew.ExportSpecctraDSN(b, out_dsn):
        raise SystemExit("could not export the Specctra DSN")


def _sexp(text: str):
    """Minimal S-expression reader for the autorouter's session file."""
    toks, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if c in "()":
            toks.append(c)
            i += 1
        elif c.isspace():
            i += 1
        elif c == '"':
            j = text.index('"', i + 1)
            toks.append(text[i + 1 : j])
            i = j + 1
        else:
            j = i
            while j < n and not text[j].isspace() and text[j] not in "()":
                j += 1
            toks.append(text[i:j])
            i = j
    stack: list = [[]]
    for tk in toks:
        if tk == "(":
            stack.append([])
        elif tk == ")":
            done = stack.pop()
            stack[-1].append(done)
        else:
            stack[-1].append(tk)
    return stack[0][0]


def _find(node, head):
    return [c for c in node if isinstance(c, list) and c and c[0] == head]


def _seg_dist(px, py, x0, y0, x1, y1) -> float:
    dx, dy = x1 - x0, y1 - y0
    L = dx * dx + dy * dy
    t = 0.0 if L == 0 else max(0.0, min(1.0, ((px - x0) * dx + (py - y0) * dy) / L))
    return math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))


def split_t_junctions(b, tol_nm: int = 2000) -> int:
    """Where one track ends on the middle of another of the same net and layer, split the second track there, so the two are
    joined end to end (KiCad's connectivity, and the DRC, expect that; the autorouter does not always write it that way)."""
    splits = 0
    changed = True
    while changed:
        changed = False
        tracks = [t for t in b.GetTracks() if t.GetClass() == "PCB_TRACK"]
        for a in tracks:
            for end in (a.GetStart(), a.GetEnd()):
                for o in tracks:
                    if o is a or o.GetNetCode() != a.GetNetCode() or o.GetLayer() != a.GetLayer():
                        continue
                    s, e = o.GetStart(), o.GetEnd()
                    if (end.x == s.x and end.y == s.y) or (end.x == e.x and end.y == e.y):
                        continue
                    dx, dy = e.x - s.x, e.y - s.y
                    L2 = dx * dx + dy * dy
                    if L2 == 0:
                        continue
                    t = ((end.x - s.x) * dx + (end.y - s.y) * dy) / L2
                    if not (0.0 < t < 1.0):
                        continue
                    d = math.hypot(end.x - (s.x + t * dx), end.y - (s.y + t * dy))
                    if d > tol_nm:
                        continue
                    new = pcbnew.PCB_TRACK(b)
                    new.SetStart(pcbnew.VECTOR2I(end.x, end.y))
                    new.SetEnd(pcbnew.VECTOR2I(e.x, e.y))
                    new.SetWidth(o.GetWidth())
                    new.SetLayer(o.GetLayer())
                    new.SetNet(o.GetNet())
                    o.SetEnd(pcbnew.VECTOR2I(end.x, end.y))
                    b.Add(new)
                    splits += 1
                    changed = True
                    break
                if changed:
                    break
            if changed:
                break
    return splits


def stitch(b, nets, pitch: float = 4.0) -> int:
    """Ground vias on a grid wherever they fit, so the top and bottom ground pours are one connected plane."""
    gnd = next((nets[n] for n in ("GND", "AGND", "VSS") if n in nets), None)
    if gnd is None:
        return 0
    box = b.GetBoardEdgesBoundingBox()
    x0, y0, x1, y1 = (tomm(box.GetLeft()), tomm(box.GetTop()), tomm(box.GetRight()), tomm(box.GetBottom()))
    via_r, clr, margin = 0.3, 0.2, 1.0
    pads = []
    for fp in b.GetFootprints():
        for p in fp.Pads():
            bb = p.GetBoundingBox()
            pads.append((tomm(bb.GetLeft()), tomm(bb.GetTop()), tomm(bb.GetRight()), tomm(bb.GetBottom())))
    segs = [(tomm(t.GetStart().x), tomm(t.GetStart().y), tomm(t.GetEnd().x), tomm(t.GetEnd().y), tomm(t.GetWidth()) / 2, t.GetNetname() == gnd.GetNetname()) for t in b.GetTracks() if t.GetClass() == "PCB_TRACK"]
    vias = [(tomm(t.GetPosition().x), tomm(t.GetPosition().y), tomm(t.GetWidth()) / 2) for t in b.GetTracks() if t.GetClass() == "PCB_VIA"]
    kos = []
    for z in b.Zones():
        if z.GetIsRuleArea():
            zb = z.GetBoundingBox()
            kos.append((tomm(zb.GetLeft()), tomm(zb.GetTop()), tomm(zb.GetRight()), tomm(zb.GetBottom())))
    for fp in b.GetFootprints():
        for z in fp.Zones():
            if z.GetIsRuleArea():
                zb = z.GetBoundingBox()
                kos.append((tomm(zb.GetLeft()), tomm(zb.GetTop()), tomm(zb.GetRight()), tomm(zb.GetBottom())))
    count = 0
    y = y0 + margin + pitch / 2
    while y < y1 - margin:
        x = x0 + margin + pitch / 2
        while x < x1 - margin:
            ok = True
            r = via_r + clr
            if any(px0 - r < x < px1 + r and py0 - r < y < py1 + r for px0, py0, px1, py1 in pads):
                ok = False
            if ok and any(k0 - r < x < k2 + r and k1 - r < y < k3 + r for k0, k1, k2, k3 in kos):
                ok = False
            if ok and any(_seg_dist(x, y, sx0, sy0, sx1, sy1) < via_r + w + (0.0 if same else clr) for sx0, sy0, sx1, sy1, w, same in segs):
                ok = False
            if ok and any(math.hypot(x - vx, y - vy) < via_r + vr + clr for vx, vy, vr in vias):
                ok = False
            if ok:
                v = pcbnew.PCB_VIA(b)
                v.SetPosition(pcbnew.VECTOR2I(mm(x), mm(y)))
                v.SetViaType(pcbnew.VIATYPE_THROUGH)
                v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
                v.SetWidth(mm(0.6))
                v.SetDrill(mm(0.3))
                v.SetNet(gnd)
                b.Add(v)
                vias.append((x, y, via_r))
                count += 1
            x += pitch
        y += pitch
    return count


def finish(in_pcb: str, ses: str, out_pcb: str) -> None:
    """Add the autorouter's tracks and vias (read from its Specctra session file) and refill the ground pours.
    KiCad 7's own SES importer only works inside the GUI, so the file is read here: units are resolution-per-um, y is flipped."""
    b = pcbnew.LoadBoard(in_pcb)
    tree = _sexp(open(ses, encoding="utf-8").read())
    routes = _find(tree, "routes")[0]
    res = _find(routes, "resolution")[0]
    per_um = float(res[2])
    to_mm = lambda v: float(v) / per_um / 1000.0  # noqa: E731
    nets = {n.GetNetname(): n for n in b.GetNetInfo().NetsByName().values()}
    layers = {"F.Cu": pcbnew.F_Cu, "B.Cu": pcbnew.B_Cu}
    n_tracks = n_vias = 0
    for out in _find(routes, "network_out"):
        for net in _find(out, "net"):
            name = net[1]
            ni = nets.get(name)
            if ni is None:
                raise SystemExit(f"the routed session names a net the board does not have: {name}")
            for wire in _find(net, "wire"):
                for path in _find(wire, "path"):
                    layer, width, coords = layers[path[1]], to_mm(path[2]), [to_mm(v) for v in path[3:]]
                    pts = [(coords[k], -coords[k + 1]) for k in range(0, len(coords), 2)]
                    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
                        tr = pcbnew.PCB_TRACK(b)
                        tr.SetStart(pcbnew.VECTOR2I(mm(x0), mm(y0)))
                        tr.SetEnd(pcbnew.VECTOR2I(mm(x1), mm(y1)))
                        tr.SetWidth(mm(width))
                        tr.SetLayer(layer)
                        tr.SetNet(ni)
                        b.Add(tr)
                        n_tracks += 1
            for via in _find(net, "via"):
                # padstack names look like Via[0-1]_800:400_um
                size, drill = (float(v) / 1000.0 for v in via[1].split("_")[1].split(":"))
                v = pcbnew.PCB_VIA(b)
                v.SetPosition(pcbnew.VECTOR2I(mm(to_mm(via[2])), mm(-to_mm(via[3]))))
                v.SetViaType(pcbnew.VIATYPE_THROUGH)
                v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
                v.SetWidth(mm(size))
                v.SetDrill(mm(drill))
                v.SetNet(ni)
                b.Add(v)
                n_vias += 1
    joined = split_t_junctions(b)
    stitched = stitch(b, nets)
    add_ground_pours(b, nets)
    pcbnew.ZONE_FILLER(b).Fill(b.Zones())
    pcbnew.SaveBoard(out_pcb, b)
    print(json.dumps({"tracks": n_tracks, "vias": n_vias, "stitching_vias": stitched, "t_junction_splits": joined}))


def drc(in_pcb: str, out_txt: str) -> None:
    """KiCad's own design-rule check (kicad-cli only gained 'pcb drc' in KiCad 8). Writes KiCad's text report."""
    b = pcbnew.LoadBoard(in_pcb)
    pcbnew.ZONE_FILLER(b).Fill(b.Zones())
    if not pcbnew.WriteDRCReport(b, out_txt, pcbnew.EDA_UNITS_MILLIMETRES, True):
        raise SystemExit("DRC could not run")


def _poly_pts(poly) -> list[list[float]]:
    return [[round(tomm(poly.CPoint(i).x) - OX, 3), round(tomm(poly.CPoint(i).y) - OY, 3)] for i in range(poly.PointCount())]


def extract(in_pcb: str, out_json: str) -> None:
    b = pcbnew.LoadBoard(in_pcb)
    ol = {}
    for d in b.GetDrawings():
        if d.GetLayer() == pcbnew.Edge_Cuts and d.GetClass() == "PCB_SHAPE":
            s, e = d.GetStart(), d.GetEnd()
            ol.setdefault("segments", []).append([round(tomm(s.x) - OX, 3), round(tomm(s.y) - OY, 3), round(tomm(e.x) - OX, 3), round(tomm(e.y) - OY, 3)])
    xs = [v for s in ol.get("segments", []) for v in (s[0], s[2])]
    ys = [v for s in ol.get("segments", []) for v in (s[1], s[3])]
    out = {"width": max(xs) if xs else 0, "height": max(ys) if ys else 0, "outline": ol.get("segments", []), "footprints": [], "tracks": [], "vias": [], "zones": [], "keepouts": [], "texts": []}
    for fp in b.GetFootprints():
        pos = fp.GetPosition()
        pads = []
        for p in fp.Pads():
            pp, sz, dr = p.GetPosition(), p.GetSize(), p.GetDrillSize()
            pads.append({"name": p.GetNumber(), "net": p.GetNetname(), "x": round(tomm(pp.x) - OX, 3), "y": round(tomm(pp.y) - OY, 3), "w": round(tomm(sz.x), 3), "h": round(tomm(sz.y), 3), "rot": round(p.GetOrientationDegrees(), 2), "shape": {pcbnew.PAD_SHAPE_CIRCLE: "circle", pcbnew.PAD_SHAPE_OVAL: "oval", pcbnew.PAD_SHAPE_ROUNDRECT: "roundrect"}.get(p.GetShape(), "rect"), "through": p.GetAttribute() == pcbnew.PAD_ATTRIB_PTH, "npth": p.GetAttribute() == pcbnew.PAD_ATTRIB_NPTH, "drill": round(tomm(dr.x), 3) if dr.x else 0, "side": "B" if p.IsOnLayer(pcbnew.B_Cu) and not p.IsOnLayer(pcbnew.F_Cu) else "F"})
        silk = []
        for g in fp.GraphicalItems():
            if g.GetLayer() not in (pcbnew.F_SilkS, pcbnew.F_CrtYd) or g.GetClass() not in ("PCB_SHAPE", "FP_SHAPE", "MGRAPHIC"):
                continue
            kind = {pcbnew.SHAPE_T_SEGMENT: "line", pcbnew.SHAPE_T_RECT: "rect", pcbnew.SHAPE_T_CIRCLE: "circle", pcbnew.SHAPE_T_ARC: "arc", pcbnew.SHAPE_T_POLY: "poly"}.get(g.GetShape())
            if kind in ("line", "rect"):
                s, e = g.GetStart(), g.GetEnd()
                silk.append({"k": kind, "layer": "crt" if g.GetLayer() == pcbnew.F_CrtYd else "silk", "p": [round(tomm(s.x) - OX, 3), round(tomm(s.y) - OY, 3), round(tomm(e.x) - OX, 3), round(tomm(e.y) - OY, 3)]})
            elif kind == "circle":
                c, e = g.GetStart(), g.GetEnd()
                silk.append({"k": "circle", "layer": "silk" if g.GetLayer() == pcbnew.F_SilkS else "crt", "p": [round(tomm(c.x) - OX, 3), round(tomm(c.y) - OY, 3), round(math.hypot(tomm(e.x - c.x), tomm(e.y - c.y)), 3)]})
            elif kind == "arc":
                a0, a1, am = g.GetStart(), g.GetEnd(), g.GetArcMid()
                silk.append({"k": "arc", "layer": "silk" if g.GetLayer() == pcbnew.F_SilkS else "crt", "p": [round(tomm(a0.x) - OX, 3), round(tomm(a0.y) - OY, 3), round(tomm(am.x) - OX, 3), round(tomm(am.y) - OY, 3), round(tomm(a1.x) - OX, 3), round(tomm(a1.y) - OY, 3)]})
        out["footprints"].append({"ref": fp.GetReference(), "value": fp.GetValue(), "footprint": fp.GetFPIDAsString(), "x": round(tomm(pos.x) - OX, 3), "y": round(tomm(pos.y) - OY, 3), "rot": round(fp.GetOrientationDegrees(), 2), "pads": pads, "graphics": silk})
    for tr in b.GetTracks():
        if tr.GetClass() == "PCB_VIA":
            p = tr.GetPosition()
            out["vias"].append({"x": round(tomm(p.x) - OX, 3), "y": round(tomm(p.y) - OY, 3), "d": round(tomm(tr.GetWidth()), 3), "drill": round(tomm(tr.GetDrillValue()), 3), "net": tr.GetNetname()})
        elif tr.GetClass() == "PCB_TRACK":
            s, e = tr.GetStart(), tr.GetEnd()
            out["tracks"].append({"x0": round(tomm(s.x) - OX, 3), "y0": round(tomm(s.y) - OY, 3), "x1": round(tomm(e.x) - OX, 3), "y1": round(tomm(e.y) - OY, 3), "w": round(tomm(tr.GetWidth()), 3), "layer": "F" if tr.GetLayer() == pcbnew.F_Cu else "B", "net": tr.GetNetname()})
    for z in b.Zones():
        if z.GetIsRuleArea():
            bb = z.GetBoundingBox()
            out["keepouts"].append([round(tomm(bb.GetLeft()) - OX, 3), round(tomm(bb.GetTop()) - OY, 3), round(tomm(bb.GetRight()) - OX, 3), round(tomm(bb.GetBottom()) - OY, 3)])
            continue
        for layer in z.GetLayerSet().Seq():
            if layer not in (pcbnew.F_Cu, pcbnew.B_Cu):
                continue
            polys = z.GetFilledPolysList(layer)
            for i in range(polys.OutlineCount()):
                outline = polys.Outline(i)
                out["zones"].append({"layer": "F" if layer == pcbnew.F_Cu else "B", "net": z.GetNetname(), "outline": _poly_pts(outline), "holes": [_poly_pts(polys.Hole(i, h)) for h in range(polys.HoleCount(i))]})
    for d in b.GetDrawings():
        if d.GetClass() == "PCB_TEXT" and d.GetLayer() == pcbnew.F_SilkS:
            p = d.GetPosition()
            out["texts"].append({"text": d.GetText(), "x": round(tomm(p.x) - OX, 3), "y": round(tomm(p.y) - OY, 3), "size": round(tomm(d.GetTextHeight()), 3)})
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "build":
        build(json.load(open(sys.argv[2], encoding="utf-8")), sys.argv[3], sys.argv[4])
    elif cmd == "finish":
        finish(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == "drc":
        drc(sys.argv[2], sys.argv[3])
    elif cmd == "extract":
        extract(sys.argv[2], sys.argv[3])
    else:
        raise SystemExit(f"unknown command {cmd}")
