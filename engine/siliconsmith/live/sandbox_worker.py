"""Runs INSIDE the Token Factory Sandbox only (the host ships this file as text and never imports it).

    python3 /tmp/ss_live_worker.py spec <job.json>   # validate a golden spec: lint + agreement with the C reference
    python3 /tmp/ss_live_worker.py eval <job.json>   # the engine's worker, plus a `dt` (seconds) on every stage line
    python3 /tmp/ss_live_worker.py tools             # tool versions, printed once when the baseline is generated

It speaks the same stdout protocol as siliconsmith.worker (SS_STAGE / SS_OUTCOME lines).
"""

import json
import subprocess
import sys
import time
from pathlib import Path

T0 = time.monotonic()


def _outcome(obj):
    sys.stdout.write("SS_OUTCOME " + json.dumps(obj) + "\n")
    sys.stdout.flush()


def cmd_spec(job_path):
    from siliconsmith import hwgen, paths
    from siliconsmith.tools import verify
    from siliconsmith.tools.build import ToolError

    job = json.loads(Path(job_path).read_text(encoding="utf-8"))
    name = job["name"]
    try:
        probe = hwgen.Instruction(name=name, mnemonic=name, funct7=0, c_ref=job["c_ref"],
                                  rtl=job["spec_rtl"].replace(f"module ss_spec_{name}", f"module ss_insn_{name}"))
        work = paths.RUNS / "spec"
        verify.lint_unit(probe, work / "lint")
        r = verify.unit_test(probe, work / "unit", n_random=int(job.get("vectors", 200_000)))
    except (ToolError, ValueError) as e:
        _outcome({"ok": False, "message": getattr(e, "message", str(e)), "log": getattr(e, "log", "")[-2500:]})
        return 0
    _outcome({"ok": True, "vectors": r.vectors})
    return 0


def cmd_eval(job_path):
    from siliconsmith import worker

    say = worker._say

    def timed(tag, obj):
        if tag == worker.STAGE_TAG:
            obj = {**obj, "dt": round(time.monotonic() - T0, 2)}
        say(tag, obj)

    worker._say = timed
    return worker.cmd_eval(job_path)


def cmd_tools():
    out = {}
    for name, cmd in (("verilator", ["verilator", "--version"]), ("yosys", ["yosys", "-V"]),
                      ("riscv-gcc", ["riscv64-unknown-elf-gcc", "--version"]),
                      ("python", ["python3", "--version"])):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            out[name] = (r.stdout or r.stderr).strip().splitlines()[0]
        except Exception as e:  # noqa: BLE001
            out[name] = f"unavailable: {e}"[:80]
    sys.stdout.write("SS_TOOLS " + json.dumps(out) + "\n")
    return 0


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "spec":
        sys.exit(cmd_spec(sys.argv[2]))
    if len(sys.argv) == 3 and sys.argv[1] == "eval":
        sys.exit(cmd_eval(sys.argv[2]))
    if len(sys.argv) == 2 and sys.argv[1] == "tools":
        sys.exit(cmd_tools())
    sys.exit(2)
