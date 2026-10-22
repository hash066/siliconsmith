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


def _search(args: argparse.Namespace):
    import os

    from .config import settings
    from .search import Search, SearchConfig

    if getattr(args, "backend", None):
        os.environ["SS_BACKEND"] = args.backend
    cfg = SearchConfig(k_root=args.k, k_child=args.k_child, beam=args.beam, max_depth=args.depth,
                       area_budget_pct=args.area_budget, max_concurrency=args.concurrency,
                       vectors=args.vectors, polish=not args.no_polish)
    srch = Search(Workload.load(args.workload), settings(), cfg, run_id=args.run_id)
    console = os.environ.get("SS_CONSOLE_URL", "").rstrip("/")
    print(f"SiliconSmith run {srch.run_id} on {srch.backend.name}", file=sys.stderr)
    print(f"  watch: {console}/runs/{srch.run_id}" if console else f"  events: {srch.bus.path}",
          file=sys.stderr, flush=True)
    return srch


def cmd_run(args: argparse.Namespace) -> int:
    """Full agent run: Nemotron proposes, implements and repairs; the ladder verifies; beam search."""
    srch = _search(args)
    best = srch.run()
    _emit({"run_id": srch.run_id, "best": best.id, "speedup": best.speedup, "area_delta_pct": best.area_delta,
           "isa": [i.mnemonic for i in best.isa], "cost_usd": round(srch.llm.spent_usd, 4),
           "events": str(srch.bus.path)})
    return 0


def cmd_accelerate(args: argparse.Namespace) -> int:
    """The product command: search, verify, then write the adoptable bundle (RTL, intrinsics, patch, report)."""
    from .bundle import write_bundle

    srch = _search(args)
    best = srch.run()
    out = write_bundle(Path(args.out).resolve() / srch.run_id, srch.wl, srch.base, best, srch.bus.path)
    _emit({"run_id": srch.run_id, "speedup": round(srch.base.cycles / best.measured.cycles, 3),
           "area_delta_pct": best.area_delta, "isa": [i.mnemonic for i in best.isa],
           "cost_usd": round(srch.llm.spent_usd, 4), "bundle": str(out), "report": str(out / "REPORT.md")})
    return 0 if best.id != "root" else 3


def cmd_pr(args: argparse.Namespace) -> int:
    """Turn a bundle into a branch on a TinyMaix checkout; push and open the PR only with --push --open."""
    from . import pr

    try:
        info = pr.prepare(Path(args.bundle), Path(args.repo), args.function, args.branch)
        url = pr.push_and_open(info, base=args.base, upstream=args.upstream) if args.push and args.open else None
    except pr.PrError as e:
        _emit({"ok": False, "error": str(e)})
        return 2
    (Path(args.repo) / ".git" / "SILICONSMITH_PR_BODY.md").write_text(info["body"], encoding="utf-8")
    _emit({"branch": info["branch"], "title": info["title"], "pr_url": url,
           "pr_body": str(Path(args.repo) / ".git" / "SILICONSMITH_PR_BODY.md"), "pushed": bool(url)})
    return 0


def cmd_library(args: argparse.Namespace) -> int:
    """List the evidence library: proven instructions, each reproducible with `verify-entry`."""
    from . import library

    _emit([{"id": e.id, "mnemonic": e.manifest["instruction"]["mnemonic"], "workload": e.manifest["source"]["workload"],
            "speedup": e.manifest["metrics"]["speedup"], "area_delta_pct": e.manifest["metrics"]["area_delta_pct"],
            "run": e.manifest["source"]["run_id"]} for e in library.list_entries()])
    return 0


def cmd_verify_entry(args: argparse.Namespace) -> int:
    """Re-run lint, the unit vectors and the formal proof on a library entry (no LLM). Exit 0 only if all pass."""
    from . import library

    res = library.verify_entry(library.load_entry(args.id), vectors=args.vectors)
    _emit(res)
    return 0 if res["reproduced"] else 3


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="siliconsmith",
        description="SiliconSmith: invents, implements and proves custom RISC-V instructions for your hot loops.")
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
    for name, help_ in (("accelerate", "invent + prove custom instructions for a workload and write the bundle"),
                        ("run", "run the search only (no bundle)")):
        p = sub.add_parser(name, help=help_)
        p.add_argument("workload")
        p.add_argument("--k", type=int, default=6, help="proposals at depth 1")
        p.add_argument("--k-child", type=int, default=4, help="proposals per expanded node")
        p.add_argument("--beam", type=int, default=3)
        p.add_argument("--depth", type=int, default=2)
        p.add_argument("--area-budget", type=float, default=5.0, help="max extra LUT-equivalent area, percent")
        p.add_argument("--concurrency", type=int, default=4)
        p.add_argument("--vectors", type=int, default=1_000_000)
        p.add_argument("--backend", choices=["local", "subprocess", "contree"])
        p.add_argument("--no-polish", action="store_true", help="skip the area/software polish of each round's winners")
        p.add_argument("--run-id")
        if name == "accelerate":
            p.add_argument("--out", default="siliconsmith-out", help="bundle directory")
    sub.add_parser("library", help="list the evidence library of proven instructions")
    p = sub.add_parser("verify-entry", help="re-run lint, vectors and the formal proof on a library entry (no LLM)")
    p.add_argument("id")
    p.add_argument("--vectors", type=int, default=1_000_000)
    p = sub.add_parser("pr", help="turn a bundle into a branch (and with --push --open, a PR) on a TinyMaix checkout")
    p.add_argument("bundle")
    p.add_argument("--repo", required=True, help="path to a TinyMaix clone (must be clean)")
    p.add_argument("--function", default="tm_dot_prod")
    p.add_argument("--branch")
    p.add_argument("--base", default="main")
    p.add_argument("--upstream", help="owner/repo to open the PR against (when --repo is a fork)")
    p.add_argument("--push", action="store_true", help="push the branch (outward-facing)")
    p.add_argument("--open", action="store_true", help="open the PR with gh (needs --push)")
    args = ap.parse_args(argv)
    try:
        return {"hello": cmd_hello, "bench": cmd_bench, "golden": cmd_golden, "run": cmd_run,
                "accelerate": cmd_accelerate, "pr": cmd_pr,
                "library": cmd_library, "verify-entry": cmd_verify_entry}[args.cmd](args)
    except ToolError as e:
        _emit({"ok": False, "stage": e.stage, "error": e.message, "log": e.log})
        return 2


if __name__ == "__main__":
    sys.exit(main())
