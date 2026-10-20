"""Workloads: load a manifest, build its firmware for a given CPU config + patch, benchmark it."""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from .. import hwgen, paths
from .build import FirmwareBuild, SimResult, ToolError, build_firmware, build_sim, run_sim


@dataclass
class Workload:
    id: str
    dir: Path
    title: str
    sources: list[str]
    patchable: list[str]
    hot_symbol: str
    max_cycles: int
    manifest: dict = field(repr=False)

    @classmethod
    def load(cls, wid: str) -> "Workload":
        d = paths.WORKLOADS / wid
        if not d.is_dir():
            matches = [p for p in paths.WORKLOADS.iterdir() if p.is_dir() and p.name.startswith(wid)]
            if len(matches) != 1:
                raise ToolError("build", f"unknown workload {wid!r}")
            d = matches[0]
        m = json.loads((d / "manifest.json").read_text())
        return cls(
            id=m["id"], dir=d, title=m["title"], sources=m["sources"], patchable=m["patchable"],
            hot_symbol=m.get("hot_symbol", ""), max_cycles=int(m.get("max_cycles", 200_000_000)),
            manifest=m,
        )

    def original(self, name: str) -> str:
        return (self.dir / name).read_text()


@dataclass
class Build:
    cfg_dir: Path
    fw: FirmwareBuild
    sim: Path


def prepare(
    wl: Workload,
    cfg: hwgen.CpuConfig,
    work: Path,
    patch: dict[str, str] | None = None,
) -> Build:
    """Generate the CPU config, stage the workload (with patched files), build firmware + sim."""
    patch = patch or {}
    bad = set(patch) - set(wl.patchable)
    if bad:
        raise ToolError("build", f"patch touches non-patchable files: {sorted(bad)}")
    gen = work / "gen"
    shutil.rmtree(gen, ignore_errors=True)
    hwgen.write_config(cfg, gen)
    src = work / "src"
    shutil.rmtree(src, ignore_errors=True)
    src.mkdir(parents=True)
    for f in [*wl.sources, *wl.patchable]:
        (src / f).write_text(patch.get(f, wl.original(f)), newline="\n")
    fw = build_firmware([src / s for s in wl.sources], work / "fw", include_dirs=[src, gen])
    sim = build_sim(gen)
    return Build(cfg_dir=gen, fw=fw, sim=sim)


def bench(wl: Workload, build: Build, profile: Path | None = None, vcd: Path | None = None) -> SimResult:
    res = run_sim(build.sim, build.fw.hex, profile=profile, vcd=vcd, max_cycles=wl.max_cycles)
    if res.trap:
        raise ToolError("e2e", "CPU trapped (illegal or misaligned instruction?)", res.uart)
    if res.timeout:
        raise ToolError("e2e", f"timeout after {wl.max_cycles} cycles", res.uart)
    if not res.ok or res.cycles is None:
        raise ToolError("e2e", f"firmware exited with code {res.exit_code}", res.uart)
    return res
