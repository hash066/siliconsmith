"""`ss` command line. Every subcommand prints one JSON object on stdout."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import hwgen, paths
from .tools.build import ToolError, build_firmware, build_sim, run_sim


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


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="ss", description="SiliconSmith tools")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("hello", help="boot PicoRV32 and print hello (toolchain smoke test)")
    args = ap.parse_args(argv)
    try:
        return {"hello": cmd_hello}[args.cmd](args)
    except ToolError as e:
        _emit({"ok": False, "stage": e.stage, "error": e.message, "log": e.log})
        return 2


if __name__ == "__main__":
    sys.exit(main())
