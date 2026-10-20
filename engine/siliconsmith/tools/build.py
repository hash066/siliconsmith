"""Build + run primitives: firmware (RISC-V GCC), simulator (Verilator), simulation.

These run wherever the toolchain lives: the local WSL distro or a Contree sandbox.
Every function raises ToolError with a stage name and a trimmed log on failure, which is
exactly what the agent's repair loop consumes.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

from .. import paths

RV_PREFIX = "riscv64-unknown-elf-"
RV_CFLAGS = [
    "-march=rv32im_zicsr",
    "-mabi=ilp32",
    "-O2",
    "-g",
    "-ffreestanding",
    "-nostdlib",
    "-nostartfiles",
    "-fno-common",
    "-ffunction-sections",
    "-fdata-sections",
    "-Wall",
]
VERILATOR_FLAGS = [
    "--cc", "--exe", "--build", "-j", "0", "-O3",
    "--x-assign", "fast", "--x-initial", "fast", "--noassert",
    "-Wno-fatal", "-Wno-lint", "-Wno-style",
    "--top-module", "ss_soc",
]
LOG_TAIL = 6000


class ToolError(Exception):
    def __init__(self, stage: str, message: str, log: str = ""):
        super().__init__(f"[{stage}] {message}")
        self.stage = stage
        self.message = message
        self.log = log[-LOG_TAIL:]


@dataclass
class CmdResult:
    code: int
    stdout: str
    stderr: str
    seconds: float

    @property
    def ok(self) -> bool:
        return self.code == 0

    @property
    def output(self) -> str:
        return (self.stdout + "\n" + self.stderr).strip()


def run(cmd: list[str], cwd: Path | None = None, timeout: float = 900) -> CmdResult:
    t0 = time.monotonic()
    try:
        p = subprocess.run(
            [str(c) for c in cmd], cwd=cwd, capture_output=True, text=True,
            timeout=timeout, errors="replace",
        )
        return CmdResult(p.returncode, p.stdout, p.stderr, time.monotonic() - t0)
    except subprocess.TimeoutExpired as e:
        out = e.stdout if isinstance(e.stdout, str) else (e.stdout or b"").decode(errors="replace")
        return CmdResult(124, out, f"timeout after {timeout}s", time.monotonic() - t0)


def _digest(files: list[Path], extra: str = "") -> str:
    h = hashlib.sha256(extra.encode())
    for f in sorted(files, key=lambda p: p.name):
        h.update(f.name.encode())
        h.update(f.read_bytes())
    return h.hexdigest()[:16]


# ---------------------------------------------------------------- firmware

@dataclass
class FirmwareBuild:
    elf: Path
    hex: Path
    text_bytes: int


def bin_to_hex(bin_path: Path, hex_path: Path) -> None:
    data = bin_path.read_bytes()
    data += b"\0" * (-len(data) % 4)
    words = (int.from_bytes(data[i:i + 4], "little") for i in range(0, len(data), 4))
    hex_path.write_text("".join(f"{w:08x}\n" for w in words))


def build_firmware(
    sources: list[Path],
    out_dir: Path,
    include_dirs: list[Path] | None = None,
    defines: dict[str, str] | None = None,
    name: str = "firmware",
) -> FirmwareBuild:
    out_dir.mkdir(parents=True, exist_ok=True)
    elf = out_dir / f"{name}.elf"
    binf = out_dir / f"{name}.bin"
    hexf = out_dir / f"{name}.hex"
    incs = [f"-I{d}" for d in [paths.FIRMWARE, *(include_dirs or [])]]
    defs = [f"-D{k}={v}" for k, v in (defines or {}).items()]
    srcs = [paths.FIRMWARE / "start.S", paths.FIRMWARE / "runtime.c", *sources]
    cmd = [
        f"{RV_PREFIX}gcc", *RV_CFLAGS, *incs, *defs,
        "-T", paths.FIRMWARE / "link.ld", "-Wl,--gc-sections",
        *srcs, "-lgcc", "-o", elf,
    ]
    r = run(cmd, cwd=out_dir)
    if not r.ok:
        raise ToolError("build", "firmware compile failed", r.output)
    r = run([f"{RV_PREFIX}objcopy", "-O", "binary", elf, binf])
    if not r.ok:
        raise ToolError("build", "objcopy failed", r.output)
    bin_to_hex(binf, hexf)
    size = run([f"{RV_PREFIX}size", "-A", elf]).stdout
    m = re.search(r"^\.text\s+(\d+)", size, re.M)
    return FirmwareBuild(elf=elf, hex=hexf, text_bytes=int(m.group(1)) if m else 0)


# ---------------------------------------------------------------- simulator

def build_sim(gen_dir: Path, cache_root: Path | None = None, trace: bool = False) -> Path:
    """Verilate ss_soc with the generated custom-instruction slot in gen_dir.
    Builds are cached by content hash, so identical CPUs are never rebuilt."""
    gen_files = sorted(gen_dir.glob("*.v"))
    rtl = [*paths.SOC_RTL, *gen_files]
    tb = paths.TB / "tb.cpp"
    key = _digest([*rtl, tb], extra=f"trace={trace};" + " ".join(VERILATOR_FLAGS))
    cache_root = cache_root or (paths.RUNS / ".cache" / "sim")
    out = cache_root / key
    exe = out / "ss_sim"
    if exe.exists():
        return exe
    tmp = cache_root / f"{key}.tmp{os.getpid()}"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    cmd = ["verilator", *VERILATOR_FLAGS, *(["--trace"] if trace else []),
           "-Mdir", tmp / "obj_dir", "-o", tmp / "ss_sim", *rtl, tb]
    r = run(cmd, cwd=tmp, timeout=1200)
    if not r.ok or not (tmp / "ss_sim").exists():
        shutil.rmtree(tmp, ignore_errors=True)
        raise ToolError("lint", "verilator build failed", r.output)
    shutil.rmtree(tmp / "obj_dir", ignore_errors=True)
    if out.exists():  # another worker won the race
        shutil.rmtree(tmp, ignore_errors=True)
    else:
        tmp.rename(out)
    return exe


@dataclass
class SimResult:
    exit_code: int
    trap: bool
    timeout: bool
    sim_cycles: int
    cycles: int | None  # measured region (SS_RESULT)
    hash: str | None
    uart: str
    seconds: float

    @property
    def ok(self) -> bool:
        return self.exit_code == 0 and not self.trap and not self.timeout


_SIM_RE = re.compile(r"SS_SIM exit=(-?\d+) trap=(\d) timeout=(\d) sim_cycles=(\d+)")
_RES_RE = re.compile(r"SS_RESULT cycles=(\d+) hash=([0-9a-f]{8})")


def run_sim(
    sim: Path,
    hexf: Path,
    profile: Path | None = None,
    vcd: Path | None = None,
    max_cycles: int = 200_000_000,
    timeout: float = 900,
) -> SimResult:
    args = [sim, f"+firmware={hexf}", f"+max_cycles={max_cycles}"]
    if profile:
        args.append(f"+profile={profile}")
    if vcd:
        args.append(f"+vcd={vcd}")
    r = run(args, timeout=timeout)
    m = _SIM_RE.search(r.stdout)
    if not m:
        raise ToolError("e2e", "simulator produced no status line", r.output)
    res = _RES_RE.search(r.stdout)
    uart = r.stdout[: m.start()]
    return SimResult(
        exit_code=int(m.group(1)), trap=m.group(2) == "1", timeout=m.group(3) == "1",
        sim_cycles=int(m.group(4)),
        cycles=int(res.group(1)) if res else None, hash=res.group(2) if res else None,
        uart=uart, seconds=r.seconds,
    )
