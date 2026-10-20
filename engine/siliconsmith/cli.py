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


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="ss", description="SiliconSmith tools")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("hello", help="boot PicoRV32 and print hello (toolchain smoke test)")
    p = sub.add_parser("bench", help="build + run a workload on the baseline CPU")
    p.add_argument("workload")
    p.add_argument("--profile", action="store_true", help="collect and symbolize a PC histogram")
    p.add_argument("--disasm", action="store_true", help="include hot disassembly (needs --profile)")
    args = ap.parse_args(argv)
    try:
        return {"hello": cmd_hello, "bench": cmd_bench}[args.cmd](args)
    except ToolError as e:
        _emit({"ok": False, "stage": e.stage, "error": e.message, "log": e.log})
        return 2


if __name__ == "__main__":
    sys.exit(main())
