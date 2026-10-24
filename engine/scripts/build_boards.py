"""Generate the routed boards for the built-in templates and write what the web app serves (KiCad cannot run on Vercel).

    python engine/scripts/build_boards.py [--out web/public/boards] [template ...]

Needs KiCad 7, Java and Freerouting (see siliconsmith/board/layout/generate.py). Writes, per template:
  <out>/<template>/{board.json, summary.json, markers.json, bom.csv, positions.csv, drc.txt, routed.kicad_pcb, gerbers-and-drill.zip, all-layers.svg}
and <out>/index.json mapping each canonical netlist to a directory, so the app can find a layout for any design with that netlist
(the firmware pin table does not change the board, so the clean and fault examples share one layout's geometry)."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "engine"))

from siliconsmith.board.layout import generate as G  # noqa: E402
from siliconsmith.board.layout import place as P  # noqa: E402
from siliconsmith.board.layout.canonical import canonical_netlist  # noqa: E402
from siliconsmith.board.netlist import load_design  # noqa: E402
from siliconsmith.board.serverless import check, library  # noqa: E402
from siliconsmith.board.templates import list_templates, load_template  # noqa: E402

KEEP = ["board.json", "markers.json", "bom.csv", "positions.csv", "drc.txt", "routed.kicad_pcb", "gerbers-and-drill.zip", "all-layers.svg"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "web" / "public" / "boards"))
    ap.add_argument("templates", nargs="*")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    lib = library()
    ids = a.templates or [t["id"] for t in list_templates()]
    index: dict[str, dict] = {}
    if (out / "index.json").exists():
        index = json.loads((out / "index.json").read_text(encoding="utf-8")).get("layouts", {})
    for tid in ids:
        d = load_design(load_template(tid)["design"])
        chk = check(d.model_dump())
        work = Path(tempfile.mkdtemp(prefix=f"board_{tid}_"))
        t0 = time.time()
        res = G.generate(d, work, lib, check=chk)
        mcu = d.instance(d.mcu_ref)
        padmap = {p.name: P.pad_names(P.load_footprints(), lib[mcu.part], p.name) for p in lib[mcu.part].pins}
        dest = out / tid
        if dest.exists():
            shutil.rmtree(dest)
        dest.mkdir(parents=True)
        for f in KEEP:
            shutil.copy(work / f, dest / f)
        summary = {
            "template": tid,
            "design_name": d.name,
            "mcu_ref": d.mcu_ref,
            "mcu_padmap": padmap,
            "status": res.status,
            "stats": res.stats,
            "drc": res.drc,
            "markers": res.markers,
            "notes": res.notes,
            "files": {k: v for k, v in res.files.items() if v in KEEP},
            "tool_note": G.TOOL_NOTE,
            "generated_with": {"kicad": "7.0.11", "router": "Freerouting 1.9.0", "rules": "2 layers, 0.2 mm tracks, 0.15 mm clearance, 0.6/0.3 mm vias"},
        }
        (dest / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
        canon = canonical_netlist(d)
        index[hashlib.sha256(canon.encode()).hexdigest()[:16]] = {"dir": tid, "canonical": canon, "templates": sorted({tid, *(index.get(hashlib.sha256(canon.encode()).hexdigest()[:16], {}).get("templates", []))})}
        print(f"{tid}: {res.status} ({time.time() - t0:.0f}s)")
    (out / "index.json").write_text(json.dumps({"layouts": index}, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
