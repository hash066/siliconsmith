"""The part of the board pipeline that needs KiCad, Java and Freerouting: job.json in, a routed and checked board plus exports out.

Standard library only, so the very same file runs on this machine (generate.py) and inside the Token Factory Sandbox
(sandbox_worker.py ships it together with pcb_build.py). Tool locations come from the environment, with the defaults of the
project's WSL and Sandbox images:
  HW_KICAD_PYTHON (python3 with pcbnew), HW_KICAD_CLI (kicad-cli), HW_FREEROUTING_JAR, HW_JAVA, HW_XVFB_RUN.

Steps: build the KiCad board -> route with Freerouting (more passes if the checker still finds unrouted connections) -> import the
routing -> KiCad's design-rule check -> geometry for the viewer -> Gerber, drill, positions and SVG exports -> BOM."""

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
from pathlib import Path
from typing import Any, Callable

HERE = Path(__file__).parent
TOOL_NOTE = "Checked by KiCad 7 DRC, the autorouter's completion and rungs B1 to B5. Not fabricated, not tested electrically."
RULES_NOTE = "2 layers, 0.2 mm tracks, 0.15 mm clearance, 0.6/0.3 mm vias."


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


def run(cmd: list[str], *, cwd: Path | None = None, timeout: int = 240, label: str = "") -> subprocess.CompletedProcess[str]:
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
    unconnected = 0
    for blk in re.split(r"(?m)^(?=\[\w+\]: )", text):
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


def bom_csv(job: dict[str, Any]) -> str:
    groups: dict[tuple[str, str, str], list[str]] = {}
    for i in job["instances"]:
        groups.setdefault((i["value"], i["footprint"], "layout" if i.get("added_by_layout") else "design"), []).append(i["ref"])
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["Refs", "Qty", "Value", "Footprint", "Source"])
    for (val, fp, src), refs in sorted(groups.items(), key=lambda kv: kv[1][0]):
        w.writerow([" ".join(sorted(refs)), len(refs), val, fp, "added by the layout (not in the checked netlist)" if src == "layout" else "design"])
    return buf.getvalue()


def run_pipeline(out: Path, *, script: Path | None = None, route_timeout: int = 240, passes: tuple[str, ...] = ("100", "300"), progress: Callable[[str], None] | None = None) -> dict[str, Any]:
    """`out/job.json` must exist. Returns {drc, counts, attempts, timings, svgs}; every output file is written into `out`."""
    t = tools()
    script = script or HERE / "pcb_build.py"
    say = progress or (lambda _m: None)
    timings: dict[str, float] = {}
    t0 = time.monotonic()

    def lap(name: str, since: float) -> float:
        now = time.monotonic()
        timings[name] = round(now - since, 1)
        return now

    s = t0
    say("Building the KiCad board")
    run([t["python"], str(script), "build", "job.json", "board.kicad_pcb", "board.dsn"], cwd=out, label="KiCad board build")
    s = lap("build", s)
    drc: dict[str, Any] = {}
    counts: dict[str, Any] = {}
    attempts = []
    for n in passes:
        say(f"Routing with Freerouting ({n} passes)")
        (out / "board.ses").unlink(missing_ok=True)
        run([t["xvfb"], "-a", t["java"], "-jar", t["jar"], "-de", "board.dsn", "-do", "board.ses", "-mp", n, "-da"], cwd=out, timeout=route_timeout, label="Freerouting")
        if not (out / "board.ses").is_file():
            raise RuntimeError("Freerouting did not write a routed session")
        r = run([t["python"], str(script), "finish", "board.kicad_pcb", "board.ses", "routed.kicad_pcb"], cwd=out, label="import routing")
        counts = json.loads(r.stdout.strip().splitlines()[-1])
        say("Checking the board with KiCad's design-rule check")
        run([t["python"], str(script), "drc", "routed.kicad_pcb", "drc.txt"], cwd=out, label="KiCad DRC")
        drc = parse_drc((out / "drc.txt").read_text(encoding="utf-8", errors="replace"))
        attempts.append({"passes": int(n), "unrouted": drc["unconnected"], "errors": drc["errors"]})
        if drc["errors"] == 0:
            break
    s = lap("route+drc", s)
    say("Exporting Gerbers, drill, positions and pictures")
    run([t["python"], str(script), "extract", "routed.kicad_pcb", "board.json"], cwd=out, label="extract geometry")
    gdir = out / "gerber"
    gdir.mkdir(exist_ok=True)
    run([t["cli"], "pcb", "export", "gerbers", "--output", str(gdir) + "/", "routed.kicad_pcb"], cwd=out, label="Gerber export")
    run([t["cli"], "pcb", "export", "drill", "--output", str(gdir) + "/", "routed.kicad_pcb"], cwd=out, label="drill export")
    run([t["cli"], "pcb", "export", "pos", "--format", "csv", "--units", "mm", "--side", "both", "--output", "positions.csv", "routed.kicad_pcb"], cwd=out, label="position export")
    svgs = {}
    for layer, name in (("F.Cu", "top-copper"), ("B.Cu", "bottom-copper"), ("F.Silkscreen,Edge.Cuts", "silkscreen"), ("F.Cu,B.Cu,F.Silkscreen,Edge.Cuts", "all-layers")):
        f = f"{name}.svg"
        run([t["cli"], "pcb", "export", "svg", "--layers", layer, "--page-size-mode", "2", "--exclude-drawing-sheet", "--output", f, "routed.kicad_pcb"], cwd=out, label=f"SVG {name}")
        svgs[name] = f
    with zipfile.ZipFile(out / "gerbers-and-drill.zip", "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(gdir.iterdir()):
            z.write(f, f.name)
    job = json.loads((out / "job.json").read_text(encoding="utf-8"))
    (out / "bom.csv").write_text(bom_csv(job), encoding="utf-8")
    s = lap("export", s)
    timings["total"] = round(time.monotonic() - t0, 1)
    return {"drc": drc, "counts": counts, "attempts": attempts, "timings": timings, "svgs": svgs}
