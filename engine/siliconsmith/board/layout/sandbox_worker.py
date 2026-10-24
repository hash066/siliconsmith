"""Runs INSIDE the Token Factory Sandbox only (the host ships this file as text and never imports it).

    cd /tmp/layout && python3 sandbox_worker.py

Expects /tmp/layout/{job.json, pcb_build.py, runner.py}. Runs the routing pipeline (KiCad, Freerouting, KiCad's DRC, exports) and
prints, on stdout, SS_PROGRESS lines, then one SS_LAYOUT line (JSON: the pipeline's report and the output files, base64) or one
SS_LAYOUT_ERROR line. Standard library only."""

import base64
import json
import sys
from pathlib import Path

OUT = Path("/tmp/layout")
sys.path.insert(0, str(OUT))

KEEP = ["board.json", "routed.kicad_pcb", "gerbers-and-drill.zip", "positions.csv", "bom.csv", "drc.txt", "all-layers.svg"]


def main() -> int:
    try:
        import runner

        rr = runner.run_pipeline(OUT, script=OUT / "pcb_build.py", progress=lambda m: print("SS_PROGRESS " + m, flush=True))
        files = {n: base64.b64encode((OUT / n).read_bytes()).decode("ascii") for n in KEEP}
    except Exception as e:  # noqa: BLE001 - any failure is reported, never a bare crash
        print("SS_LAYOUT_ERROR " + json.dumps({"message": f"{type(e).__name__}: {e}"[-700:]}), flush=True)
        return 0
    print("SS_LAYOUT " + json.dumps({"rr": rr, "files": files}, separators=(",", ":")), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
