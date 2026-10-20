"""Evaluate one candidate CPU (parent ISA + one new instruction + patched software) on the ladder.

Stage order (docs/contracts/events.md): implement → lint → unit → e2e → bench → prove → synth.
Cheap stages run first, and formal proof + synthesis only run for candidates that actually speed
the workload up. Failures raise StageFailure (repairable) or Prune (not worth repairing).
"""

from __future__ import annotations

import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from . import hwgen
from .tools import profile as prof
from .tools import verify
from .tools.build import ToolError, compiler_errors, run
from .tools.workload import Workload, bench, prepare

StageCb = Callable[[str, str, str, dict | None], None]  # stage, status, detail, artifacts


class StageFailure(Exception):
    def __init__(self, stage: str, message: str, log: str = "", artifacts: dict | None = None):
        super().__init__(f"[{stage}] {message}")
        self.stage, self.message, self.log, self.artifacts = stage, message, log, artifacts or {}


class Prune(Exception):
    def __init__(self, stage: str, reason: str):
        super().__init__(reason)
        self.stage, self.reason = stage, reason


@dataclass
class Measured:
    cycles: int
    hash: str
    area: verify.Area
    hotspots: list[dict]
    disasm: str
    extra: dict = field(default_factory=dict)


def measure(wl: Workload, cfg: hwgen.CpuConfig, patch: dict[str, str], work: Path) -> Measured:
    b = prepare(wl, cfg, work, patch=patch)
    hist = work / "profile.txt"
    res = bench(wl, b, profile=hist)
    p = prof.analyze(b.fw.elf, hist)
    return Measured(cycles=res.cycles or 0, hash=res.hash or "", area=verify.synth_core(b.cfg_dir),
                    hotspots=p["hotspots"], disasm=prof.disassemble_hot(b.fw.elf, hist))


def host_check(wl: Workload, cfg: hwgen.CpuConfig, patch: dict[str, str], d: Path) -> str:
    """Differential test of the patched software vs the original on the host (instructions fall back
    to their C reference). Returns a short summary, raises ToolError with the first failing case."""
    hc = wl.manifest.get("host_check")
    if not hc:
        return ""
    shutil.rmtree(d, ignore_errors=True)
    (d / "orig").mkdir(parents=True)
    hwgen.write_config(cfg, d / "gen")
    for f in wl.patchable:
        # GCC treats byte-identical headers as one file under #pragma once, which would silently
        # drop the patched copy when it equals the original; the orig copy doesn't need the guard.
        orig = wl.original(f).replace("#pragma once", "/* #pragma once (removed for host check) */")
        (d / "orig" / f).write_text(orig, newline="\n")
        (d / f).write_text(patch.get(f, wl.original(f)), newline="\n")
    shutil.copy(wl.dir / hc, d / hc)
    r = run(["gcc", "-O1", "-std=gnu11", "-w", f"-I{d / 'gen'}", d / hc, "-o", d / "hc"], cwd=d, timeout=120)
    if not r.ok:
        raise ToolError("unit", "patched software does not compile on the host", compiler_errors(r.output))
    r = run([d / "hc", "5000"], timeout=120)
    m = re.search(r"SS_HOSTCHECK (ok calls=(\d+)|FAIL .*)", r.stdout)
    if not m or not m.group(1).startswith("ok"):
        raise ToolError("unit", "patched software differs from the original: "
                        + (m.group(1) if m else r.output[-500:]), r.output)
    return f"patched software == original on {int(m.group(2)):,} random calls"


_SS_DEF = re.compile(
    r"^\s*#\s*define\s+(ss_\w+)|^[\w\s\*]*?\b(ss_\w+)\s*\([^;{]*\)\s*\{", re.M)


def check_patch_hygiene(patch: dict[str, str]) -> None:
    """The patched sources may only CALL ss_* intrinsics; ss_intrinsics.h generates them."""
    for name, text in patch.items():
        m = _SS_DEF.search(text)
        if m:
            sym = m.group(1) or m.group(2)
            raise StageFailure("lint", f"{name} defines `{sym}`, but every ss_* name is generated into "
                               "ss_intrinsics.h; remove that definition and just call the intrinsic")


def _vector_values(ins: hwgen.Instruction, spec_rtl: str, rs1: int, rs2: int, work: Path) -> dict[str, int | None]:
    """Evaluate RTL, spec and C reference on one vector (to explain a counterexample)."""
    vals: dict[str, int | None] = {"rtl": None, "spec": None, "c": None}
    for label, rtl in (("rtl", ins.rtl), ("spec", spec_rtl.replace(f"module ss_spec_{ins.name}",
                                                                      f"module ss_insn_{ins.name}"))):
        probe = hwgen.Instruction(name=ins.name, mnemonic=ins.mnemonic, funct7=ins.funct7, rtl=rtl, c_ref=ins.c_ref)
        try:
            verify.unit_test(probe, work / f"cex_{label}", n_random=0, extra_pairs=[(rs1, rs2)])
            vals[label] = None  # equals C on this vector
        except ToolError as e:
            import re
            m = re.search(r"expected=0x(\w+) got=0x(\w+)", e.message)
            if m:
                vals["c"] = int(m[1], 16)
                vals[label] = int(m[2], 16)
    if vals["c"] is not None:
        for k in ("rtl", "spec"):
            if vals[k] is None:
                vals[k] = vals["c"]
    return vals


def evaluate(
    wl: Workload,
    base: Measured,
    parent: Measured,
    parent_isa: list[hwgen.Instruction],
    ins: hwgen.Instruction,
    spec_rtl: str,
    patch: dict[str, str],
    work: Path,
    on_stage: StageCb,
    area_budget_pct: float,
    min_gain: float = 1.01,
    vectors: int = 1_000_000,
    require_gain: bool = True,
    shrink_vs: verify.Area | None = None,
) -> Measured:
    """Ladder for a new (or area-polished) instruction. Area polish passes require_gain=False
    (must not be slower) and shrink_vs=<the area it has to beat>."""
    def stage(name: str, fn, detail_fn):
        on_stage(name, "running", "", None)
        try:
            out = fn()
        except ToolError as e:
            raise StageFailure(name, e.message, e.log) from e
        on_stage(name, "pass", detail_fn(out), None)
        return out

    on_stage("lint", "running", "", None)
    check_patch_hygiene(patch)
    lint = stage("lint", lambda: verify.lint_unit(ins, work / "lint"),
                 lambda r: f"Verilator -Wall: {len(r.warnings)} warnings, 0 errors")
    del lint
    def _unit():
        r = verify.unit_test(ins, work / "unit", n_random=vectors)
        return r, host_check(wl, hwgen.CpuConfig([*parent_isa, ins]), patch, work / "hostcheck")

    stage("unit", _unit, lambda o: f"{o[0].vectors:,} vectors · 0 mismatches vs C reference"
          + (f" · {o[1]}" if o[1] else ""))

    cfg = hwgen.CpuConfig([*parent_isa, ins])
    m = _e2e_bench(wl, base, parent, cfg, patch, work, on_stage, min_gain if require_gain else None)
    speedup = base.cycles / m.cycles

    on_stage("prove", "running", "", None)
    try:
        pr = verify.prove_equiv(ins, spec_rtl, work / "prove")
    except ToolError as e:
        arts: dict = {}
        cex = getattr(e, "counterexample", None)
        if cex and "rs1" in cex and "rs2" in cex:
            v = _vector_values(ins, spec_rtl, cex["rs1"], cex["rs2"], work)
            sig = lambda n, x: {"name": n, "width": 32, "values": ["-" if x is None else f"{x:08x}"]}
            arts["counterexample"] = {"cycles": 1, "signals": [
                sig("rs1", cex["rs1"]), sig("rs2", cex["rs2"]), sig("rd (RTL)", v["rtl"]),
                sig("rd (spec)", v["spec"]), sig("rd (C reference)", v["c"])]}
            arts["culprit"] = "spec" if v["rtl"] == v["c"] else "rtl"
        elif getattr(e, "culprit", None) == "spec":
            arts["culprit"] = "spec"
        raise StageFailure("prove", e.message, e.log, arts) from e
    on_stage("prove", "pass", f"formally equivalent to spec for all 2^64 inputs ({pr.seconds:.0f}s)", None)

    on_stage("synth", "running", "", None)
    area_delta = 100.0 * (m.area.lut_equiv - base.area.lut_equiv) / base.area.lut_equiv
    m.extra = {"speedup": speedup, "area_delta_pct": area_delta}
    if area_delta > area_budget_pct:
        on_stage("synth", "fail", f"+{area_delta:.1f}% LUT-equivalent exceeds budget +{area_budget_pct:.0f}%", None)
        raise Prune("synth", f"over area budget (+{area_delta:.1f}%)")
    if shrink_vs is not None and (m.area.lut_equiv, m.area.dsps) >= (shrink_vs.lut_equiv, shrink_vs.dsps):
        on_stage("synth", "fail", f"{m.area.lut_equiv:,} LUT+ALU · {m.area.dsps} DSP: no saving over "
                 f"{shrink_vs.lut_equiv:,} LUT+ALU · {shrink_vs.dsps} DSP", None)
        raise Prune("synth", f"no area saving ({m.area.lut_equiv:,} vs {shrink_vs.lut_equiv:,} LUT+ALU)")
    on_stage("synth", "pass", f"{m.area.lut_equiv:,} LUT+ALU (+{area_delta:.1f}%) · {m.area.dsps} DSP", None)
    return m


def _e2e_bench(wl: Workload, base: Measured, parent: Measured, cfg: hwgen.CpuConfig, patch: dict[str, str],
               work: Path, on_stage: StageCb, min_gain: float | None) -> Measured:
    """Full-SoC run: output must be bit-identical to the baseline; then the cycle check.
    min_gain=None means 'must not be slower than the parent' (used by area polish)."""
    on_stage("e2e", "running", "", None)
    try:
        m = measure(wl, cfg, patch, work / "soc")
    except ToolError as e:
        raise StageFailure("e2e" if e.stage in ("e2e", "build") else e.stage, e.message, e.log) from e
    if m.hash != base.hash:
        raise StageFailure("e2e", f"program output differs: hash {m.hash} != baseline {base.hash}",
                           "The patched software computes different results than the original.")
    on_stage("e2e", "pass", "bit-identical program output", None)

    speedup = base.cycles / m.cycles
    on_stage("bench", "running", "", None)
    slow = m.cycles > parent.cycles if min_gain is None else m.cycles >= parent.cycles / min_gain
    if slow:
        on_stage("bench", "fail", f"{m.cycles:,} cycles: no gain over parent ({parent.cycles:,})", None)
        raise Prune("bench", f"no speedup ({speedup:.2f}x vs parent {base.cycles / parent.cycles:.2f}x)")
    on_stage("bench", "pass", f"{m.cycles:,} cycles · {speedup:.2f}x", None)
    return m


def evaluate_software(
    wl: Workload,
    base: Measured,
    parent: Measured,
    isa: list[hwgen.Instruction],
    patch: dict[str, str],
    work: Path,
    on_stage: StageCb,
    min_gain: float = 1.01,
) -> Measured:
    """Software polish: same CPU, new code. The hardware (and so its proofs) is unchanged."""
    on_stage("lint", "running", "", None)
    check_patch_hygiene(patch)
    on_stage("lint", "pass", "hardware unchanged · patched source only calls intrinsics", None)
    cfg = hwgen.CpuConfig(list(isa))
    on_stage("unit", "running", "", None)
    try:
        summary = host_check(wl, cfg, patch, work / "hostcheck")
    except ToolError as e:
        raise StageFailure("unit", e.message, e.log) from e
    on_stage("unit", "pass", summary or "patched software builds", None)
    m = _e2e_bench(wl, base, parent, cfg, patch, work, on_stage, min_gain)
    on_stage("prove", "skipped", "hardware unchanged: formal proofs carry over", None)
    area_delta = 100.0 * (m.area.lut_equiv - base.area.lut_equiv) / base.area.lut_equiv
    m.extra = {"speedup": base.cycles / m.cycles, "area_delta_pct": area_delta}
    on_stage("synth", "pass", f"unchanged hardware · {m.area.lut_equiv:,} LUT+ALU (+{area_delta:.1f}%)", None)
    return m
