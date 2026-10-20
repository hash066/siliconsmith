"""Evaluate one candidate CPU (parent ISA + one new instruction + patched software) on the ladder.

Stage order (docs/contracts/events.md): implement → lint → unit → e2e → bench → prove → synth.
Cheap stages run first, and formal proof + synthesis only run for candidates that actually speed
the workload up. Failures raise StageFailure (repairable) or Prune (not worth repairing).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from . import hwgen
from .tools import profile as prof
from .tools import verify
from .tools.build import ToolError
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
) -> Measured:
    def stage(name: str, fn, detail_fn):
        on_stage(name, "running", "", None)
        try:
            out = fn()
        except ToolError as e:
            raise StageFailure(name, e.message, e.log) from e
        on_stage(name, "pass", detail_fn(out), None)
        return out

    lint = stage("lint", lambda: verify.lint_unit(ins, work / "lint"),
                 lambda r: f"Verilator -Wall: {len(r.warnings)} warnings, 0 errors")
    del lint
    stage("unit", lambda: verify.unit_test(ins, work / "unit", n_random=vectors),
          lambda r: f"{r.vectors:,} vectors · 0 mismatches vs C reference")

    cfg = hwgen.CpuConfig([*parent_isa, ins])
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
    if m.cycles >= parent.cycles / min_gain:
        on_stage("bench", "fail", f"{m.cycles:,} cycles: no gain over parent ({parent.cycles:,})", None)
        raise Prune("bench", f"no speedup ({speedup:.2f}x vs parent {base.cycles / parent.cycles:.2f}x)")
    on_stage("bench", "pass", f"{m.cycles:,} cycles · {speedup:.2f}x", None)

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
        raise StageFailure("prove", e.message, e.log, arts) from e
    on_stage("prove", "pass", f"formally equivalent to spec for all 2^64 inputs ({pr.seconds:.0f}s)", None)

    on_stage("synth", "running", "", None)
    area_delta = 100.0 * (m.area.lut_equiv - base.area.lut_equiv) / base.area.lut_equiv
    m.extra = {"speedup": speedup, "area_delta_pct": area_delta}
    if area_delta > area_budget_pct:
        on_stage("synth", "fail", f"+{area_delta:.1f}% LUT-equivalent exceeds budget +{area_budget_pct:.0f}%", None)
        raise Prune("synth", f"over area budget (+{area_delta:.1f}%)")
    on_stage("synth", "pass", f"{m.area.lut_equiv:,} LUT+ALU (+{area_delta:.1f}%) · {m.area.dsps} DSP", None)
    return m
