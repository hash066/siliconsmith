"""Tang Nano 9K flow: Yosys synth_gowin → nextpnr-himbaechel (Fmax) → gowin_pack (bitstream).

Fmax from place-and-route turns cycle speedups into honest wall-clock speedups:
    wall_speedup = (base_cycles / cycles) * (fmax / base_fmax)
"""

from __future__ import annotations

import hashlib
import re
import shutil
import threading
from dataclasses import dataclass
from pathlib import Path

from .. import paths
from .build import ToolError, run

DEVICE = "GW1NR-LV9QN88PC6/I5"
FAMILY = "GW1N-9C"
FPGA_DIR = paths.ROOT / "fpga"


@dataclass
class FpgaResult:
    fmax_mhz: float
    bitstream: Path | None
    util: dict[str, str]


def place_and_route(cfg_dir: Path, firmware_hex: Path | None = None, bitstream: bool = False,
                    cache_root: Path | None = None, seed: int = 1) -> FpgaResult:
    """Fmax of the full FPGA SoC with this CPU config (cached). Firmware only matters for bitstreams."""
    rtl = [*paths.CORE_RTL, *sorted(cfg_dir.glob("*.v")), FPGA_DIR / "ss_fpga_top.v"]
    h = hashlib.sha256(f"seed={seed};bit={bitstream}".encode())
    for f in rtl + [FPGA_DIR / "tangnano9k.cst"] + ([firmware_hex] if firmware_hex and bitstream else []):
        h.update(f.read_bytes())
    key = h.hexdigest()[:16]
    cache_root = cache_root or (paths.RUNS / ".cache" / "fpga")
    out = cache_root / key
    if not (out / "result.txt").exists():
        tmp = cache_root / f"{key}.tmp{threading.get_ident()}"
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir(parents=True)
        hexsrc = firmware_hex if firmware_hex else None
        if hexsrc:
            shutil.copy(hexsrc, tmp / "firmware.hex")
        else:
            (tmp / "firmware.hex").write_text("00000013\n")  # nop; Fmax does not depend on RAM contents
        reads = "\n".join(f"read_verilog {f}" for f in rtl)
        (tmp / "synth.ys").write_text(f"{reads}\nsynth_gowin -top ss_fpga_top -json top.json\n", newline="\n")
        r = run(["yosys", "-q", "-l", "synth.log", "synth.ys"], cwd=tmp, timeout=1800)
        if not r.ok:
            shutil.rmtree(tmp, ignore_errors=True)
            raise ToolError("synth", "FPGA synthesis failed", r.output)
        r = run(["nextpnr-himbaechel", "--json", "top.json", "--write", "pnr.json", "--device", DEVICE,
                 "--vopt", f"family={FAMILY}", "--vopt", f"cst={FPGA_DIR / 'tangnano9k.cst'}",
                 "--freq", "27", "--seed", str(seed), "--log", "pnr.log"], cwd=tmp, timeout=1800)
        log = (tmp / "pnr.log").read_text(errors="replace") if (tmp / "pnr.log").exists() else r.output
        if not r.ok:
            shutil.rmtree(tmp, ignore_errors=True)
            raise ToolError("synth", "place-and-route failed", log)
        fmaxes = [float(x) for x in re.findall(r"Max frequency for clock\s+'[^']*':\s*([\d.]+)\s*MHz", log)]
        if not fmaxes:
            raise ToolError("synth", "nextpnr reported no Fmax", log)
        util = dict(re.findall(r"^Info:\s+(\w+):\s+(\d+/\s*\d+\s+\d+%)", log, re.M))
        if bitstream:
            r = run(["gowin_pack", "-d", FAMILY, "-o", "ss.fs", "pnr.json"], cwd=tmp, timeout=600)
            if not r.ok:
                raise ToolError("synth", "bitstream packing failed", r.output)
        (tmp / "result.txt").write_text(f"{fmaxes[-1]}\n" + "\n".join(f"{k}={v}" for k, v in util.items()))
        for junk in ("top.json", "pnr.json"):
            (tmp / junk).unlink(missing_ok=True) if not bitstream else None
        try:
            tmp.rename(out)
        except OSError:
            shutil.rmtree(tmp, ignore_errors=True)
    lines = (out / "result.txt").read_text().splitlines()
    util = dict(ln.split("=", 1) for ln in lines[1:] if "=" in ln)
    return FpgaResult(fmax_mhz=float(lines[0]), bitstream=(out / "ss.fs") if bitstream else None, util=util)
