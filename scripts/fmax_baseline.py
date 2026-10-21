"""Place-and-route the baseline CPU on the Tang Nano 9K and print Fmax (seeds given on argv)."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
from siliconsmith import hwgen, paths  # noqa: E402
from siliconsmith.tools import fpga  # noqa: E402

gen = paths.RUNS / "fmax_baseline" / "gen"
hwgen.write_config(hwgen.CpuConfig(), gen)
for seed in [int(s) for s in sys.argv[1:]] or [1]:
    t0 = time.monotonic()
    r = fpga.place_and_route(gen, seed=seed)
    print(f"seed {seed}: Fmax {r.fmax_mhz:.2f} MHz in {time.monotonic() - t0:.0f}s  util={r.util}")
