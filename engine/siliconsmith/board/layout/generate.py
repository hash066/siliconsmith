"""Design -> real, routed 2-layer KiCad board plus everything you can open in other tools.

    from siliconsmith.board.layout.generate import generate
    res = generate(design, "out/")        # needs KiCad 7 (pcbnew, kicad-cli), Java and Freerouting; see layout/README.md

Steps: deterministic placement (place.py) -> KiCad board (pcb_build.py) -> Freerouting -> routed board -> KiCad's DRC -> exports
(Gerber and drill zip, pick-and-place, BOM, one SVG per layer, KiCad board) -> viewer JSON with the firmware-versus-board check
markers on the right pads. Nothing is hidden: unrouted nets and DRC violations are counted and returned.

Tool locations come from the environment, with the defaults of the project's WSL image:
  HW_KICAD_PYTHON (python3 with pcbnew), HW_KICAD_CLI (kicad-cli), HW_FREEROUTING_JAR, HW_JAVA, HW_XVFB_RUN."""

from __future__ import annotations

import csv
import io
import json
import os
import re
import shutil
import subprocess
import time
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..netlist import Design
from ..parts import Part
from . import place as P

HERE = Path(__file__).parent
TOOL_NOTE = "Checked by KiCad 7 DRC, the autorouter's completion and rungs B1 to B5. Not fabricated, not tested electrically."


class ToolMissing(RuntimeError):
    """KiCad, Java or Freerouting is not installed where the layout looks for it."""


def tools() -> dict[str, str]:
    e = os.environ.get
    return {
        "python": e("HW_KICAD_PYTHON", "/usr/bin/python3"),
        "cli": e("HW_KICAD_CLI", "kicad-cli"),
        "jar": e("HW_FREEROUTING_JAR", "/opt/freerouting/freerouting.jar"),
        "java": e("HW_JAVA", "java"),
        "xvfb": e("HW_XVFB_RUN", "xvfb-run"),
    }


def available() -> tuple[bool, str]:
    t = tools()
    for name, label in (("python", "python3 with pcbnew"), ("cli", "kicad-cli"), ("java", "java"), ("xvfb", "xvfb-run")):
        if not shutil.which(t[name]):
            return False, f"{label} was not found ({t[name]})"
    if not Path(t["jar"]).is_file():
        return False, f"Freerouting jar not found ({t['jar']})"
    try:
        r = subprocess.run([t["python"], "-c", "import pcbnew"], capture_output=True, timeout=30)
        if r.returncode != 0:
            return False, "the Python used for KiCad cannot import pcbnew"
    except (OSError, subprocess.SubprocessError):
        return False, "could not run the KiCad Python"
    return True, "ok"


@dataclass
class LayoutResult:
    ok: bool
    out_dir: Path
    files: dict[str, str] = field(default_factory=dict)  # role -> relative path
    stats: dict[str, Any] = field(default_factory=dict)
    drc: dict[str, Any] = field(default_factory=dict)
    markers: list[dict[str, Any]] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    status: str = ""

    def summary(self) -> dict[str, Any]:
        return {"ok": self.ok, "status": self.status, "files": self.files, "stats": self.stats, "drc": self.drc, "markers": self.markers, "notes": self.notes}


def _run(cmd: list[str], *, cwd: Path | None = None, timeout: int = 240, label: str = "") -> subprocess.CompletedProcess[str]:
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"{label or cmd[0]} took longer than {timeout} s") from None
    if r.returncode != 0:
        raise RuntimeError(f"{label or cmd[0]} failed: {(r.stderr or r.stdout).strip()[-400:]}")
    return r


# Checks that say nothing about this board: the standalone project has no footprint-library table, so KiCad cannot compare
# a footprint with "its" library. The footprints are loaded straight from KiCad's official libraries.
IGNORED_DRC = {"lib_footprint_issues", "lib_footprint_mismatch"}


def parse_drc(text: str) -> dict[str, Any]:
    """KiCad's text DRC report -> errors and warnings (by type) and the first few of each.
    Unconnected pads are errors. Silkscreen findings are warnings in KiCad and stay warnings here."""
    errors: dict[str, int] = {}
    warnings: dict[str, int] = {}
    examples: list[str] = []
    blocks = re.split(r"(?m)^(?=\[\w+\]: )", text)
    unconnected = 0
    for blk in blocks:
        h = re.match(r"\[(\w+)\]: (.*)", blk)
        if not h:
            continue
        kind, desc = h.group(1), h.group(2)
        if kind in IGNORED_DRC:
            continue
        sev = re.search(r"Severity: (\w+)", blk)
        severity = sev.group(1) if sev else "error"
        if kind == "unconnected_items":
            unconnected += 1
        bucket = warnings if severity == "warning" else errors
        bucket[kind] = bucket.get(kind, 0) + 1
        if severity != "warning" and len(examples) < 8:
            where = re.findall(r"@\([^)]*\): ([^\n]*)", blk)
            examples.append(f"{kind}: {desc[:90]}" + (f" ({'; '.join(w[:50] for w in where[:2])})" if where else ""))
    return {"errors": sum(errors.values()), "warnings": sum(warnings.values()), "unconnected": unconnected, "error_types": errors, "warning_types": warnings, "examples": examples}


def _markers(design: Design, library: dict[str, Part], job: P.Job, check: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Firmware-versus-board findings drawn on the pads they are about."""
    out: list[dict[str, Any]] = []
    mcu = design.instance(design.mcu_ref) if design.mcu_ref else None
    if mcu is None:
        return out
    part = library[mcu.part]
    fpmap = P.load_footprints()

    def pads(pin: str) -> list[str]:
        try:
            return P.pad_names(fpmap, part, pin)
        except P.LayoutError:
            return []

    wired = {a.function: a.pin for a in design.mcu_assignments}
    for fw in design.firmware_pins:
        nl = wired.get(fw.function)
        if nl and nl != fw.pin:
            for pad in pads(fw.pin):
                out.append({"ref": mcu.ref, "pad": pad, "kind": "fail", "rung": "B4", "text": f"Firmware says {fw.function} is on {fw.pin}, but the board wires it to {nl}."})
            for pad in pads(nl):
                out.append({"ref": mcu.ref, "pad": pad, "kind": "wired", "rung": "B4", "text": f"{fw.function} is actually wired here ({nl})."})
    if check:
        names = {p.name.lower(): p.name for p in part.pins}
        for r in check.get("rungs", []):
            if r.get("status") == "pass":
                continue
            for ev in r.get("evidence", []):
                m = re.match(rf"part:{re.escape(mcu.part)}\.(\w+)", ev)
                pin = names.get(m.group(1)) if m else None
                if pin and "strapping" in ev:
                    for pad in pads(pin):
                        if not any(x["ref"] == mcu.ref and x["pad"] == pad for x in out):
                            out.append({"ref": mcu.ref, "pad": pad, "kind": "warn", "rung": r.get("rung", "B4"), "text": f"{pin} is a boot-strapping pin: its level at reset selects boot behaviour."})
    return out


def _bom(job: P.Job) -> str:
    groups: dict[tuple[str, str, str], list[str]] = {}
    for i in job.instances:
        groups.setdefault((i.value, i.footprint, "layout" if i.added_by_layout else "design"), []).append(i.ref)
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["Refs", "Qty", "Value", "Footprint", "Source"])
    for (val, fp, src), refs in sorted(groups.items(), key=lambda kv: kv[1][0]):
        w.writerow([" ".join(sorted(refs)), len(refs), val, fp, "added by the layout (not in the checked netlist)" if src == "layout" else "design"])
    return buf.getvalue()


def generate(design: Design, out_dir: str | Path, library: dict[str, Part] | None = None, *, width: float | None = None, height: float | None = None, check: dict[str, Any] | None = None, route_timeout: int = 240) -> LayoutResult:
    """Run the whole pipeline. Raises ToolMissing if KiCad/Java/Freerouting are absent, P.LayoutError for a design it cannot place."""
    ok, why = available()
    if not ok:
        raise ToolMissing(why)
    if library is None:
        from ..serverless import library as _lib

        library = _lib()
    t = tools()
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.monotonic()
    timings: dict[str, float] = {}

    def lap(name: str, since: float) -> float:
        now = time.monotonic()
        timings[name] = round(now - since, 1)
        return now

    s = t0
    job = P.build_and_place(design, library, width=width, height=height)
    (out / "job.json").write_text(json.dumps(P.to_json(job)), encoding="utf-8")
    s = lap("place", s)
    script = str(HERE / "pcb_build.py")
    _run([t["python"], script, "build", "job.json", "board.kicad_pcb", "board.dsn"], cwd=out, label="KiCad board build")
    s = lap("build", s)
    # Route; if the checker still finds unrouted connections, route again with more passes (and, last, from a clean start).
    drc: dict[str, Any] = {}
    counts: dict[str, Any] = {}
    attempts = []
    for passes in ("100", "300"):
        (out / "board.ses").unlink(missing_ok=True)
        _run([t["xvfb"], "-a", t["java"], "-jar", t["jar"], "-de", "board.dsn", "-do", "board.ses", "-mp", passes, "-da"], cwd=out, timeout=route_timeout, label="Freerouting")
        if not (out / "board.ses").is_file():
            raise RuntimeError("Freerouting did not write a routed session")
        r = _run([t["python"], script, "finish", "board.kicad_pcb", "board.ses", "routed.kicad_pcb"], cwd=out, label="import routing")
        counts = json.loads(r.stdout.strip().splitlines()[-1])
        _run([t["python"], script, "drc", "routed.kicad_pcb", "drc.txt"], cwd=out, label="KiCad DRC")
        drc = parse_drc((out / "drc.txt").read_text(encoding="utf-8", errors="replace"))
        attempts.append({"passes": int(passes), "unrouted": drc["unconnected"], "errors": drc["errors"]})
        if drc["errors"] == 0:
            break
    s = lap("route+drc", s)
    _run([t["python"], script, "extract", "routed.kicad_pcb", "board.json"], cwd=out, label="extract geometry")
    gdir = out / "gerber"
    gdir.mkdir(exist_ok=True)
    _run([t["cli"], "pcb", "export", "gerbers", "--output", str(gdir) + "/", "routed.kicad_pcb"], cwd=out, label="Gerber export")
    _run([t["cli"], "pcb", "export", "drill", "--output", str(gdir) + "/", "routed.kicad_pcb"], cwd=out, label="drill export")
    _run([t["cli"], "pcb", "export", "pos", "--format", "csv", "--units", "mm", "--side", "both", "--output", "positions.csv", "routed.kicad_pcb"], cwd=out, label="position export")
    svgs = {}
    for layer, name in (("F.Cu", "top-copper"), ("B.Cu", "bottom-copper"), ("F.Silkscreen,Edge.Cuts", "silkscreen"), ("F.Cu,B.Cu,F.Silkscreen,Edge.Cuts", "all-layers")):
        f = f"{name}.svg"
        _run([t["cli"], "pcb", "export", "svg", "--layers", layer, "--page-size-mode", "2", "--exclude-drawing-sheet", "--output", f, "routed.kicad_pcb"], cwd=out, label=f"SVG {name}")
        svgs[name] = f
    s = lap("export", s)
    with zipfile.ZipFile(out / "gerbers-and-drill.zip", "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(gdir.iterdir()):
            z.write(f, f.name)
    (out / "bom.csv").write_text(_bom(job), encoding="utf-8")
    markers = _markers(design, library, job, check)
    (out / "markers.json").write_text(json.dumps(markers), encoding="utf-8")

    nets_total = sum(1 for n, rows in job.nets.items() if len(rows) >= 2)
    unrouted = drc["unconnected"]
    stats = {
        "parts": len(job.instances),
        "added_parts": sum(1 for i in job.instances if i.added_by_layout),
        "nets": nets_total,
        "tracks": counts["tracks"],
        "vias": counts["vias"],
        "board_mm": [job.width, job.height],
        "layers": 2,
        "unrouted_connections": unrouted,
        "fully_routed": unrouted == 0,
        "seconds": round(time.monotonic() - t0, 1),
        "timings": timings,
        "wirelength_estimate_mm": round(P.wirelength(job), 1),
        "route_attempts": attempts,
    }
    files = {"kicad_pcb": "routed.kicad_pcb", "gerber_zip": "gerbers-and-drill.zip", "positions": "positions.csv", "bom": "bom.csv", "viewer": "board.json", "markers": "markers.json", "drc_report": "drc.txt", **{f"svg_{k}": v for k, v in svgs.items()}}
    status = f"{'Fully routed' if unrouted == 0 else f'{unrouted} connection(s) NOT routed'}; KiCad DRC: {drc['errors']} error(s), {drc['warnings']} warning(s). {TOOL_NOTE}"
    return LayoutResult(ok=True, out_dir=out, files=files, stats=stats, drc=drc, markers=markers, notes=job.notes + ["2 layers, 0.2 mm tracks, 0.15 mm clearance, 0.6/0.3 mm vias."], status=status)
