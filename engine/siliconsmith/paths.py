from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HW = ROOT / "hw"
RTL = HW / "rtl"
TB = HW / "tb"
FIRMWARE = ROOT / "firmware"
WORKLOADS = ROOT / "workloads"
RUNS = ROOT / "runs"

CORE_RTL = [RTL / "vendor" / "picorv32.v", RTL / "ss_core.v"]
SOC_RTL = CORE_RTL + [RTL / "ss_soc.v"]
