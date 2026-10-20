import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HW = ROOT / "hw"
RTL = HW / "rtl"
TB = HW / "tb"
FIRMWARE = ROOT / "firmware"
WORKLOADS = ROOT / "workloads"
# Scratch + caches. On WSL the repo lives on a slow /mnt drive, so default to native Linux disk there.
RUNS = Path(os.environ.get("SS_RUNS") or (
    "/var/tmp/ss-runs" if str(ROOT).startswith("/mnt/") else ROOT / "runs"))
# Persistent run logs (events.ndjson) always live in the repo so the web app can replay them.
RUN_LOGS = ROOT / "runs" / "logs"

CORE_RTL = [RTL / "vendor" / "picorv32.v", RTL / "ss_core.v"]
SOC_RTL = CORE_RTL + [RTL / "ss_soc.v"]
