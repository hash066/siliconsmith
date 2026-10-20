"""Check Token Factory Sandboxes (Contree) access: one disposable run on a public image.

    /opt/ss-venv/bin/python scripts/contree_probe.py
Prints the account limits and the microVM's resources. Never prints credentials.
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
from siliconsmith import config  # noqa: E402,F401  (loads .env.local into the environment)

from contree_sdk import ContreeSync  # noqa: E402

sdk = ContreeSync()
try:
    info = sdk.get_token_info()
    print("token info:", {k: v for k, v in vars(info).items() if "token" not in k.lower()}
          if hasattr(info, "__dict__") else info)
except Exception as e:  # noqa: BLE001
    print("token info unavailable:", type(e).__name__, str(e)[:300])

t0 = time.monotonic()
img = sdk.images.use("ubuntu:24.04")
res = img.run(shell="uname -sr; nproc; free -m | head -2; df -h / | tail -1; "
                    "curl -sI https://github.com | head -1 || echo no-curl").wait()
print(f"exit={res.exit_code} in {time.monotonic() - t0:.1f}s")
print(res.stdout)
if res.stderr:
    print("stderr:", res.stderr[-1000:])
