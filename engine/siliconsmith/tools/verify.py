"""Verification ladder for a single custom instruction + area for a CPU configuration.

L1 lint   : Verilator -Wall on the unit (errors fail; warnings reported)
L2 unit   : Verilated unit vs the C reference on edge-case + random vectors
L3 prove  : SAT miter: unit == independently written spec RTL, for ALL 2^64 inputs
L5 synth  : Yosys synth_gowin of ss_core (PicoRV32 + custom slot) -> LUT/ALU/FF/DSP counts
(L4, whole-program bit-identical output, lives in workload.bench.)
"""

from __future__ import annotations

import hashlib
import re
import shutil
import threading
from dataclasses import dataclass, field
from pathlib import Path

from .. import hwgen, paths
from .build import ToolError, compiler_errors, run

# Bytes that break sign handling, saturation and carries; combined per lane below.
_EDGE_BYTES = [0x00, 0x01, 0x02, 0x7F, 0x80, 0x81, 0xFE, 0xFF, 0x55, 0xAA]


def _edge_words() -> list[int]:
    words = {int.from_bytes(bytes([b] * 4), "little") for b in _EDGE_BYTES}
    words |= {0x7F80FF01, 0x80017FFF, 0x0000FFFF, 0xFFFF0000, 0x00FF00FF, 0xFF00FF00,
              0x80000000, 0x7FFFFFFF, 0x00000080, 0x12345678, 0x87654321, 0xDEADBEEF}
    return sorted(words)


@dataclass
class LintResult:
    ok: bool
    warnings: list[str] = field(default_factory=list)
    log: str = ""


def lint_unit(ins: hwgen.Instruction, work: Path) -> LintResult:
    work.mkdir(parents=True, exist_ok=True)
    f = work / f"ss_insn_{ins.name}.v"
    f.write_text(ins.rtl, newline="\n")
    r = run(["verilator", "--lint-only", "-Wall", "-Wno-fatal", "-Wno-DECLFILENAME",
             "--top-module", f"ss_insn_{ins.name}", f], cwd=work, timeout=120)
    warnings = [ln.strip() for ln in r.output.splitlines() if ln.startswith("%Warning")]
    errors = [ln for ln in r.output.splitlines() if ln.startswith("%Error")]
    if errors or not r.ok:
        raise ToolError("lint", "RTL does not compile", r.output)
    return LintResult(ok=True, warnings=warnings[:20], log=r.output[-2000:])


@dataclass
class UnitResult:
    vectors: int
    seconds: float


_HARNESS = r"""
#include "V{top}.h"
#include "verilated.h"
#include <cstdint>
#include <cstdio>
#include <cstdlib>

static inline uint32_t ss_ref(uint32_t rs1, uint32_t rs2) {{
{c_ref}
}}

int main(int argc, char** argv) {{
    VerilatedContext ctx;
    V{top}* u = new V{top}{{&ctx}};
    unsigned long long n_random = argc > 1 ? strtoull(argv[1], nullptr, 10) : 1000000ULL;
    static const uint32_t edges[] = {{ {edges} }};
    const int n_edges = sizeof(edges) / sizeof(edges[0]);
    static const uint32_t pairs[][2] = {{ {pairs} }};
    unsigned long long checked = 0;
    auto check = [&](uint32_t a, uint32_t b) -> bool {{
        u->rs1 = a; u->rs2 = b; u->eval();
        uint32_t got = u->rd, exp = ss_ref(a, b);
        checked++;
        if (got != exp) {{
            std::printf("SS_MISMATCH rs1=%08x rs2=%08x expected=%08x got=%08x\n", a, b, exp, got);
            return false;
        }}
        return true;
    }};
    for (unsigned p = 0; p < sizeof(pairs) / sizeof(pairs[0]); p++)
        if (!check(pairs[p][0], pairs[p][1])) return 1;
    for (int i = 0; i < n_edges; i++)
        for (int j = 0; j < n_edges; j++)
            if (!check(edges[i], edges[j])) return 1;
    uint64_t x = 0x9E3779B97F4A7C15ULL;
    for (unsigned long long k = 0; k < n_random; k++) {{
        x ^= x << 13; x ^= x >> 7; x ^= x << 17;
        if (!check((uint32_t)x, (uint32_t)(x >> 32))) return 1;
    }}
    std::printf("SS_UNIT ok vectors=%llu\n", checked);
    delete u;
    return 0;
}}
"""


def unit_test(
    ins: hwgen.Instruction,
    work: Path,
    n_random: int = 1_000_000,
    extra_pairs: list[tuple[int, int]] | None = None,
) -> UnitResult:
    top = f"ss_insn_{ins.name}"
    work.mkdir(parents=True, exist_ok=True)
    (work / f"{top}.v").write_text(ins.rtl, newline="\n")
    edges = ", ".join(f"0x{w:08x}u" for w in _edge_words())
    pairs = ", ".join(f"{{0x{a:08x}u, 0x{b:08x}u}}" for a, b in (extra_pairs or [(0, 0)]))
    c_ref = "\n".join("\t" + ln for ln in ins.c_ref.strip().splitlines())
    (work / "harness.cpp").write_text(
        _HARNESS.format(top=top, c_ref=c_ref, edges=edges, pairs=pairs), newline="\n")
    obj = work / "obj_unit"
    shutil.rmtree(obj, ignore_errors=True)
    r = run(["verilator", "--cc", "--exe", "--build", "-j", "0", "-O2", "-Wno-fatal", "-Wno-lint",
             "-Wno-style", "--top-module", top, "-Mdir", obj, "-o", work / "unit",
             work / f"{top}.v", work / "harness.cpp"], cwd=work, timeout=600)
    if not r.ok:
        raise ToolError("unit", "unit harness failed to build (the C reference does not compile as the "
                        "body of uint32_t f(uint32_t rs1, uint32_t rs2))", compiler_errors(r.output))
    r = run([work / "unit", str(n_random)], timeout=600)
    shutil.rmtree(obj, ignore_errors=True)
    m = re.search(r"SS_MISMATCH rs1=(\w+) rs2=(\w+) expected=(\w+) got=(\w+)", r.stdout)
    if m:
        raise ToolError("unit", f"RTL disagrees with C reference: rs1=0x{m[1]} rs2=0x{m[2]} "
                        f"expected=0x{m[3]} got=0x{m[4]}", r.stdout)
    m = re.search(r"SS_UNIT ok vectors=(\d+)", r.stdout)
    if not m:
        raise ToolError("unit", "unit harness crashed", r.output)
    return UnitResult(vectors=int(m[1]), seconds=r.seconds)


@dataclass
class ProveResult:
    proven: bool
    method: str
    seconds: float
    counterexample: dict[str, str] | None = None


def prove_equiv(ins: hwgen.Instruction, spec_rtl: str, work: Path, timeout_s: int = 300) -> ProveResult:
    """SAT-prove unit == spec for every input. Spec module must be named ss_spec_<name>."""
    gate, gold = f"ss_insn_{ins.name}", f"ss_spec_{ins.name}"
    if f"module {gold}" not in spec_rtl:
        raise ToolError("prove", f"spec must define module {gold}")
    work.mkdir(parents=True, exist_ok=True)
    (work / "gate.v").write_text(ins.rtl, newline="\n")
    (work / "gold.v").write_text(spec_rtl, newline="\n")
    script = (
        "read_verilog -sv gate.v\nread_verilog -sv gold.v\nproc\nopt_clean\n"
        f"miter -equiv -flatten -make_assert {gold} {gate} miter\n"
        "hierarchy -top miter\nflatten\nopt -fast\n"
        f"sat -verify -prove-asserts -show-ports -timeout {timeout_s} miter\n"
    )
    (work / "prove.ys").write_text(script, newline="\n")
    r = run(["yosys", "-q", "-l", "prove.log", "prove.ys"], cwd=work, timeout=timeout_s + 60)
    log = (work / "prove.log").read_text(errors="replace") if (work / "prove.log").exists() else r.output
    if "SUCCESS!" in log and r.ok:
        return ProveResult(proven=True, method="yosys SAT miter (all inputs)", seconds=r.seconds)
    if "FAIL!" in log:
        cex = {k: int(v) for k, v in re.findall(r"\\in_(rs[12])\s+(\d+)\s+[0-9a-fx]+", log)}
        err = ToolError("prove", "formal counterexample: " +
                        ", ".join(f"{k}=0x{v:08x}" for k, v in sorted(cex.items())), log)
        err.counterexample = cex  # type: ignore[attr-defined]
        raise err
    if "timeout" in log.lower() or r.code == 124:
        raise ToolError("prove", f"proof timed out after {timeout_s}s", log)
    err = ToolError("prove", "prover could not read the designs", compiler_errors(log))
    if "gold.v" in log and "gate.v" not in log.split("ERROR")[-1]:
        err.culprit = "spec"  # type: ignore[attr-defined]
    raise err


# ------------------------------------------------------------------ synthesis

@dataclass
class Area:
    luts: int
    alus: int
    ffs: int
    dsps: int
    bram: int
    cells: int

    @property
    def lut_equiv(self) -> int:
        return self.luts + self.alus


def synth_core(cfg_dir: Path, cache_root: Path | None = None) -> Area:
    """Yosys synth_gowin of ss_core with the generated slot in cfg_dir (cached by content)."""
    gen = sorted(cfg_dir.glob("*.v"))
    rtl = [*paths.CORE_RTL, *gen]
    h = hashlib.sha256()
    for f in rtl:
        h.update(f.read_bytes())
    key = h.hexdigest()[:16]
    cache_root = cache_root or (paths.RUNS / ".cache" / "synth")
    out = cache_root / key
    stat = out / "stat.txt"
    if not stat.exists():
        tmp = cache_root / f"{key}.tmp{threading.get_ident()}"
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir(parents=True)
        reads = "\n".join(f"read_verilog -sv {f}" for f in rtl)
        (tmp / "synth.ys").write_text(
            f"{reads}\nsynth_gowin -top ss_core\ntee -o stat.txt stat\n", newline="\n")
        r = run(["yosys", "-q", "-l", "synth.log", "synth.ys"], cwd=tmp, timeout=1200)
        if not r.ok or not (tmp / "stat.txt").exists():
            shutil.rmtree(tmp, ignore_errors=True)
            raise ToolError("synth", "synthesis failed", r.output)
        try:
            tmp.rename(out)
        except OSError:
            shutil.rmtree(tmp, ignore_errors=True)
    return _parse_stat(stat.read_text())


def _parse_stat(text: str) -> Area:
    counts: dict[str, int] = {}
    for m in re.finditer(r"^\s+(\d+)\s+[\d.]*\s*([A-Za-z_$][\w$]*)\s*$", text, re.M):
        counts[m[2]] = counts.get(m[2], 0) + int(m[1])
    for m in re.finditer(r"^\s+([A-Za-z_$][\w$]*)\s+(\d+)\s*$", text, re.M):
        counts[m[1]] = counts.get(m[1], 0) + int(m[2])

    def total(pred) -> int:
        return sum(v for k, v in counts.items() if pred(k))

    return Area(
        luts=total(lambda k: k.startswith("LUT")),
        alus=total(lambda k: k == "ALU"),
        ffs=total(lambda k: k.startswith("DFF")),
        dsps=total(lambda k: k.startswith("MULT") or k.startswith("ALU54") or k.startswith("MULTALU")),
        bram=total(lambda k: k.startswith(("BSRAM", "SDPB", "DPB", "SP", "RAM16"))),
        cells=total(lambda k: True),
    )
