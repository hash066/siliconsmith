"""Runs INSIDE the Token Factory Sandbox only (the host ships this file as text and never imports it).

    python3 /tmp/ss_live_worker.py spec <job.json>   # validate a golden spec: lint + agreement with the C reference
    python3 /tmp/ss_live_worker.py eval <job.json>   # the engine's worker, plus a `dt` (seconds) on every stage line
    python3 /tmp/ss_live_worker.py viz <job.json>    # the views of a verified instruction, with a signal trace
    python3 /tmp/ss_live_worker.py pairs <job.json>  # the instruction on operand pairs the visitor chose, with a signal trace
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


_VIZ_HARNESS = r"""
#include "V{top}.h"
#include "verilated.h"
#include "verilated_vcd_c.h"
#include <cstdint>
#include <cstdio>
static inline uint32_t ss_ref(uint32_t rs1, uint32_t rs2) {{
{c_ref}
}}
int main() {{
    VerilatedContext ctx;
    ctx.traceEverOn(true);
    V{top}* u = new V{top}{{&ctx}};
    VerilatedVcdC* tf = new VerilatedVcdC;
    u->trace(tf, 99);
    tf->open("wave.vcd");
    static const uint32_t v[][2] = {{ {pairs} }};
    for (unsigned i = 0; i < sizeof(v) / sizeof(v[0]); i++) {{
        u->rs1 = v[i][0]; u->rs2 = v[i][1]; u->eval();
        tf->dump((uint64_t)i * 10);
        std::printf("SS_ROW %08x %08x %08x %08x\n", v[i][0], v[i][1], u->rd, ss_ref(v[i][0], v[i][1]));
    }}
    tf->dump((uint64_t)(sizeof(v) / sizeof(v[0])) * 10);
    tf->close();
    delete tf;
    delete u;
    return 0;
}}
"""

# operand pairs that show what an instruction does: zeros, ones, byte-lane patterns, the extremes, then two fixed mixed pairs
_VIZ_PAIRS = [(0, 0), (1, 1), (0x01020304, 0x01010101), (0x7F7F7F7F, 0x7F7F7F7F), (0x80808080, 0x80808080), (0xFF01FF01, 0x01FF01FF),
              (0xFFFFFFFF, 0x00000001), (0x12345678, 0x9ABCDEF0)]


def _sh(cmd, cwd, timeout=300):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


MAX_VCD = 400_000


def _simulate(work, top, rtl, c_ref, pairs):
    """Build the instruction with Verilator (tracing every signal) and run it on the operand pairs beside the C reference.
    Returns (rows, vcd text); both are empty if the build failed."""
    import re
    import shutil

    shutil.rmtree(work / "obj", ignore_errors=True)
    (work / (top + ".v")).write_text(rtl, encoding="utf-8")
    plist = ", ".join("{0x%08xu, 0x%08xu}" % (a & 0xFFFFFFFF, b & 0xFFFFFFFF) for a, b in pairs)
    body = "\n".join("\t" + ln for ln in c_ref.strip().splitlines())
    (work / "h.cpp").write_text(_VIZ_HARNESS.format(top=top, c_ref=body, pairs=plist), encoding="utf-8")
    rc, _log = _sh(["verilator", "--cc", "--exe", "--build", "--trace", "-j", "0", "-O0", "-Wno-fatal", "-Wno-lint", "-Wno-style", "--top-module", top, "-Mdir", "obj", "-o", str(work / "viz"), top + ".v", "h.cpp"], work, 600)
    rows, vcd = [], ""
    if rc == 0:
        (work / "wave.vcd").unlink(missing_ok=True)
        rc, log = _sh([str(work / "viz")], work)
        for ln in log.splitlines():
            m = re.match(r"SS_ROW (\w+) (\w+) (\w+) (\w+)", ln)
            if m:
                rows.append([int(g, 16) for g in m.groups()])
        if (work / "wave.vcd").exists():
            vcd = (work / "wave.vcd").read_text(encoding="utf-8", errors="replace")[:MAX_VCD]
    return rows, vcd


def cmd_pairs(job_path):
    """Run the instruction on operand pairs the visitor chose (at most 16), beside the C reference; the signal trace comes back too."""
    import shutil

    job = json.loads(Path(job_path).read_text(encoding="utf-8"))
    top = "ss_insn_" + job["name"]
    work = Path("/tmp/pairs")
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    rows, vcd = _simulate(work, top, job["rtl"], job["c_ref"], [tuple(p) for p in job["pairs"]])
    if not rows:
        sys.stdout.write("SS_PAIRS " + json.dumps({"ok": False, "message": "the instruction could not be simulated"}) + "\n")
        return 0
    sys.stdout.write("SS_PAIRS " + json.dumps({"ok": True, "rows": rows, "vcd": vcd}, separators=(",", ":")) + "\n")
    return 0


def cmd_viz(job_path):
    """Show the instruction as the tools see it: Yosys's word-level netlist (multipliers, adders and shifts as boxes), gate counts and
    the longest path once mapped to simple gates, and the instruction run on a few operand pairs beside the C reference (Verilator)."""
    import re
    import shutil

    job = json.loads(Path(job_path).read_text(encoding="utf-8"))
    name = job["name"]
    top = "ss_insn_" + name
    work = Path("/tmp/viz")
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    (work / (top + ".v")).write_text(job["rtl"], encoding="utf-8")
    out = {"name": name, "ok": True}
    script = f"read_verilog -sv {top}.v; hierarchy -top {top}; proc; opt; wreduce; opt_clean; tee -o wstat.txt stat -width; write_json word.json"
    rc, log = _sh(["yosys", "-q", "-p", script], work)
    if rc != 0:
        _outcome({"ok": False, "message": "yosys could not read the instruction", "log": log[-800:]})
        return 0
    mod = json.loads((work / "word.json").read_text(encoding="utf-8"))["modules"][top]
    keep = ("A_WIDTH", "B_WIDTH", "Y_WIDTH", "A_SIGNED", "B_SIGNED", "WIDTH", "S_WIDTH", "OFFSET")
    out["ports"] = {k: {"dir": v["direction"], "bits": v["bits"]} for k, v in mod["ports"].items()}
    out["cells"] = [
        {"name": n, "type": c["type"], "params": {k: v for k, v in c.get("parameters", {}).items() if k in keep}, "dirs": c.get("port_directions", {}), "conn": c["connections"]}
        for n, c in mod["cells"].items()
    ]
    wstat = work / "wstat.txt"
    out["word_stat"] = wstat.read_text(encoding="utf-8")[-1500:] if wstat.exists() else ""
    script = f"read_verilog -sv {top}.v; synth -top {top} -flatten; abc -g AND,NAND,OR,NOR,XOR,XNOR,MUX; opt_clean; tee -o gstat.txt stat; tee -o ltp.txt ltp -noff"
    rc, log = _sh(["yosys", "-q", "-p", script], work)
    gates = {}
    if rc == 0 and (work / "gstat.txt").exists():
        for m in re.finditer(r"^\s*(\d+)\s+(\$_\w+_)\s*$", (work / "gstat.txt").read_text(encoding="utf-8"), re.M):
            gates[m.group(2).strip("$_")] = int(m.group(1))
    out["gates"] = gates
    out["gate_total"] = sum(gates.values())
    depth = None
    if (work / "ltp.txt").exists():
        m = re.search(r"length=(\d+)", (work / "ltp.txt").read_text(encoding="utf-8"))
        depth = int(m.group(1)) if m else None
    out["depth"] = depth
    out["rows"], vcd = _simulate(work, top, job["rtl"], job["c_ref"], _VIZ_PAIRS)  # rows: [rs1, rs2, rd from the hardware, rd from the C reference]
    out["vcd"] = vcd
    out["c_ref"] = job["c_ref"]  # echoed so the page can ask for more operand pairs without a second copy of the source
    sys.stdout.write("SS_VIZ " + json.dumps(out, separators=(",", ":")) + "\n")
    return 0


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
    if len(sys.argv) == 3 and sys.argv[1] == "viz":
        sys.exit(cmd_viz(sys.argv[2]))
    if len(sys.argv) == 3 and sys.argv[1] == "pairs":
        sys.exit(cmd_pairs(sys.argv[2]))
    if len(sys.argv) == 2 and sys.argv[1] == "tools":
        sys.exit(cmd_tools())
    sys.exit(2)
