"""Sanity check a workload's host differential test with the unpatched source (must report ok)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
from siliconsmith import hwgen, ladder  # noqa: E402
from siliconsmith.tools.workload import Workload  # noqa: E402

wl = Workload.load(sys.argv[1])
print(ladder.host_check(wl, hwgen.CpuConfig(), {}, Path("/var/tmp/ss-hostcheck") / wl.id))
