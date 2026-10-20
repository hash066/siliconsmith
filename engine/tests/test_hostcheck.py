import pytest

from siliconsmith import examples, hwgen, paths
from siliconsmith.ladder import host_check
from siliconsmith.tools.build import ToolError
from siliconsmith.tools.workload import Workload


def test_host_check_accepts_golden_and_rejects_bug(tmp_path):
    wl = Workload.load("w1")
    ex = examples.load("dot4_s8")
    cfg = hwgen.CpuConfig([ex.instruction])
    assert "random calls" in host_check(wl, cfg, ex.patch, tmp_path / "ok")
    broken = {"tm_dot.h": ex.patch["tm_dot.h"].replace("i < size; i++) sum +=", "i < size; i++) sum -=")}
    with pytest.raises(ToolError, match="differs from the original"):
        host_check(wl, cfg, broken, tmp_path / "bad")
