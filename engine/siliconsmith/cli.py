"""`ss` command line. Every subcommand prints one JSON object on stdout."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import hwgen, paths
from .tools import profile as prof
from .tools.build import ToolError, build_firmware, build_sim, run_sim
from .tools.workload import Workload, bench, prepare


def _emit(obj: dict) -> None:
    print(json.dumps(obj, indent=2))


def cmd_hello(_: argparse.Namespace) -> int:
    work = paths.RUNS / "hello"
    gen = work / "gen"
    hwgen.write_config(hwgen.CpuConfig(), gen)
    fw = build_firmware([paths.FIRMWARE / "hello.c"], work / "fw", include_dirs=[gen])
    sim = build_sim(gen)
    res = run_sim(sim, fw.hex)
    _emit({"ok": res.ok, "uart": res.uart, "cycles": res.cycles, "hash": res.hash,
           "sim_cycles": res.sim_cycles, "seconds": round(res.seconds, 3)})
    return 0 if res.ok else 1


def cmd_bench(args: argparse.Namespace) -> int:
    wl = Workload.load(args.workload)
    work = paths.RUNS / "bench" / wl.id
    b = prepare(wl, hwgen.CpuConfig(), work)
    hist = work / "profile.txt" if args.profile else None
    res = bench(wl, b, profile=hist)
    out = {"ok": True, "workload": wl.id, "cycles": res.cycles, "hash": res.hash,
           "text_bytes": b.fw.text_bytes, "sim_seconds": round(res.seconds, 3)}
    if hist:
        out["profile"] = prof.analyze(b.fw.elf, hist)
        if args.disasm:
            out["hot_disassembly"] = prof.disassemble_hot(b.fw.elf, hist)
    _emit(out)
    return 0


def cmd_golden(args: argparse.Namespace) -> int:
    """Run the hand-built example through the whole ladder (L1-L5) and report the speedup."""
    from . import examples
    from .tools import verify

    wl = Workload.load(args.workload)
    ex = examples.load(args.example)
    ins = ex.instruction
    work = paths.RUNS / "golden" / ins.name
    out: dict = {"workload": wl.id, "instruction": ins.mnemonic, "ladder": {}}

    base = prepare(wl, hwgen.CpuConfig(), work / "baseline")
    base_res = bench(wl, base)
    base_area = verify.synth_core(base.cfg_dir)
    out["baseline"] = {"cycles": base_res.cycles, "hash": base_res.hash, "area": vars(base_area)}

    lint = verify.lint_unit(ins, work / "lint")
    out["ladder"]["L1_lint"] = {"ok": lint.ok, "warnings": lint.warnings}
    unit = verify.unit_test(ins, work / "unit", n_random=args.vectors)
    out["ladder"]["L2_unit"] = {"vectors": unit.vectors, "seconds": round(unit.seconds, 2)}
    pr = verify.prove_equiv(ins, ex.spec_rtl, work / "prove")
    out["ladder"]["L3_prove"] = {"proven": pr.proven, "method": pr.method, "seconds": round(pr.seconds, 2)}

    cfg = hwgen.CpuConfig([ins])
    b = prepare(wl, cfg, work / "candidate", patch=ex.patch)
    res = bench(wl, b)
    if res.hash != base_res.hash:
        raise ToolError("e2e", f"output hash {res.hash} != baseline {base_res.hash}")
    out["ladder"]["L4_e2e"] = {"cycles": res.cycles, "hash": res.hash, "bit_identical": True}
    area = verify.synth_core(b.cfg_dir)
    out["ladder"]["L5_synth"] = {"area": vars(area)}
    out["speedup"] = round(base_res.cycles / res.cycles, 3)
    out["area_delta_pct"] = round(100.0 * (area.lut_equiv - base_area.lut_equiv) / base_area.lut_equiv, 2)
    _emit(out)
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="ss", description="SiliconSmith tools")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("hello", help="boot PicoRV32 and print hello (toolchain smoke test)")
    p = sub.add_parser("bench", help="build + run a workload on the baseline CPU")
    p.add_argument("workload")
    p.add_argument("--profile", action="store_true", help="collect and symbolize a PC histogram")
    p.add_argument("--disasm", action="store_true", help="include hot disassembly (needs --profile)")
    p = sub.add_parser("golden", help="run a hand-built example through the full ladder")
    p.add_argument("--workload", default="w1")
    p.add_argument("--example", default="dot4_s8")
    p.add_argument("--vectors", type=int, default=1_000_000)
    args = ap.parse_args(argv)
    try:
        return {"hello": cmd_hello, "bench": cmd_bench, "golden": cmd_golden}[args.cmd](args)
    except ToolError as e:
        _emit({"ok": False, "stage": e.stage, "error": e.message, "log": e.log})
        return 2


if __name__ == "__main__":
    sys.exit(main())
