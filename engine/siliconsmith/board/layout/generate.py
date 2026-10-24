"""Design -> real, routed 2-layer KiCad board plus everything you can open in other tools.

    from siliconsmith.board.layout.generate import generate
    res = generate(design, "out/")        # needs KiCad 7 (pcbnew, kicad-cli), Java and Freerouting; see layout/README.md

Steps: deterministic placement (place.py) -> runner.run_pipeline (KiCad board, Freerouting, routed board, KiCad's DRC, exports) ->
viewer JSON with the firmware-versus-board check markers on the right pads. Nothing is hidden: unrouted nets and DRC
violations are counted and returned. The same pipeline runs inside a Token Factory Sandbox (sandbox.py) where KiCad is installed."""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..netlist import Design
from ..parts import Part
from . import place as P
from . import runner
from .runner import RULES_NOTE, TOOL_NOTE, ToolMissing, available, bom_csv, parse_drc, tools  # noqa: F401  (re-exported)

HERE = Path(__file__).parent


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


def markers_for(design: Design, library: dict[str, Part], check: dict[str, Any] | None) -> list[dict[str, Any]]:
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


def summary_for(design: Design, library: dict[str, Part], job: P.Job, rr: dict[str, Any], check: dict[str, Any] | None, seconds: float) -> dict[str, Any]:
    """The summary JSON the web app reads (same shape as web/public/boards/<template>/summary.json)."""
    drc, counts = rr["drc"], rr["counts"]
    unrouted = drc["unconnected"]
    mcu = design.instance(design.mcu_ref) if design.mcu_ref else None
    padmap = {p.name: P.pad_names(P.load_footprints(), library[mcu.part], p.name) for p in library[mcu.part].pins} if mcu else {}
    stats = {
        "parts": len(job.instances),
        "added_parts": sum(1 for i in job.instances if i.added_by_layout),
        "nets": sum(1 for n, rows in job.nets.items() if len(rows) >= 2),
        "tracks": counts["tracks"],
        "vias": counts["vias"],
        "board_mm": [job.width, job.height],
        "layers": 2,
        "unrouted_connections": unrouted,
        "fully_routed": unrouted == 0,
        "seconds": round(seconds, 1),
        "timings": rr["timings"],
        "wirelength_estimate_mm": round(P.wirelength(job), 1),
        "route_attempts": rr["attempts"],
    }
    files = {"kicad_pcb": "routed.kicad_pcb", "gerber_zip": "gerbers-and-drill.zip", "positions": "positions.csv", "bom": "bom.csv", "viewer": "board.json", "markers": "markers.json", "drc_report": "drc.txt", **{f"svg_{k}": v for k, v in rr["svgs"].items()}}
    status = f"{'Fully routed' if unrouted == 0 else f'{unrouted} connection(s) NOT routed'}; KiCad DRC: {drc['errors']} error(s), {drc['warnings']} warning(s). {TOOL_NOTE}"
    return {
        "design_name": design.name,
        "mcu_ref": design.mcu_ref,
        "mcu_padmap": padmap,
        "status": status,
        "stats": stats,
        "drc": drc,
        "markers": markers_for(design, library, check),
        "notes": job.notes + [RULES_NOTE],
        "request": job.request,
        "files": files,
        "tool_note": TOOL_NOTE,
        "generated_with": {"kicad": "7.0.11", "router": "Freerouting 1.9.0", "rules": RULES_NOTE.rstrip(".")},
    }


def generate(design: Design, out_dir: str | Path, library: dict[str, Part] | None = None, *, width: float | None = None, height: float | None = None, check: dict[str, Any] | None = None, route_timeout: int = 240, style: str | None = None, constraints: Any = None) -> LayoutResult:
    """Run the whole pipeline here. Raises ToolMissing if KiCad/Java/Freerouting are absent, P.LayoutError for a design it cannot place."""
    ok, why = available()
    if not ok:
        raise ToolMissing(why)
    if library is None:
        from ..serverless import library as _lib

        library = _lib()
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.monotonic()
    job = P.build_and_place(design, library, width=width, height=height, style=style, constraints=constraints)
    (out / "job.json").write_text(json.dumps(P.to_json(job)), encoding="utf-8")
    t_place = round(time.monotonic() - t0, 1)
    rr = runner.run_pipeline(out, route_timeout=route_timeout)
    rr["timings"] = {"place": t_place, **rr["timings"]}
    summ = summary_for(design, library, job, rr, check, time.monotonic() - t0)
    (out / "markers.json").write_text(json.dumps(summ["markers"]), encoding="utf-8")
    return LayoutResult(ok=True, out_dir=out, files=summ["files"], stats=summ["stats"], drc=summ["drc"], markers=summ["markers"], notes=summ["notes"], status=summ["status"])
