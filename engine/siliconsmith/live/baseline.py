"""The workload BASELINE measurement, cached as committed JSON so a live run does not spend a Sandbox on it.

    baselines/<id>.json = {workload, measured (cycles, hash, area, hotspots, disasm), tool_versions, measured_at,
                           run_uuid, image}

Regenerate (real Sandbox run, needs the key in .env.local):  python -m siliconsmith.live baseline w1
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from .. import ladder
from ..worker import measured_from_dict, measured_to_dict
from .limits import WORKLOADS

DIR = Path(__file__).with_name("baselines")


def path_for(wid: str) -> Path:
    return DIR / f"{wid}.json"


def load(wid: str) -> tuple[ladder.Measured, dict]:
    """(measured baseline, the file's metadata: tool_versions, measured_at, ...). Raises FileNotFoundError."""
    d = json.loads(path_for(wid).read_text(encoding="utf-8"))
    if d.get("workload") != WORKLOADS[wid]:
        raise ValueError(f"baseline file for {wid} was measured for {d.get('workload')!r}")
    return measured_from_dict(d["measured"]), {k: v for k, v in d.items() if k != "measured"}


def generate(wid: str) -> Path:
    """Measure the baseline in a real Sandbox and write baselines/<id>.json (overwrites)."""
    from ..backends import ContreeBackend
    from ..tools.workload import Workload

    wl = Workload.load(WORKLOADS[wid])
    be = ContreeBackend()
    t0 = time.time()
    m, image = be.baseline(wl, Path("."))
    tools = be._run(be.base_image, "export PATH=/opt/oss-cad-suite/bin:$PATH; python3 -c \"import sys;print(sys.version)\" >/dev/null; "
                    "verilator --version; yosys -V; riscv64-unknown-elf-gcc --version | head -1")
    lines = [ln.strip() for ln in (tools.stdout or "").splitlines() if ln.strip()]
    versions = {"verilator": lines[0] if lines else "?", "yosys": lines[1] if len(lines) > 1 else "?",
                "riscv-gcc": lines[2] if len(lines) > 2 else "?", "sandbox_image": be.base_image}
    out = path_for(wid)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "workload": WORKLOADS[wid], "measured": measured_to_dict(m), "tool_versions": versions,
        "measured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0)), "baseline_run_image": image,
        "note": "Measured once in a real Token Factory Sandbox by `python -m siliconsmith.live baseline`; "
                "live runs reuse it instead of re-measuring."}, indent=1) + "\n", encoding="utf-8", newline="\n")
    return out
