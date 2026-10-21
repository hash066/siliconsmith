"""Build the SiliconSmith sandbox image inside Token Factory Sandboxes (no local Docker needed).

    /opt/ss-venv/bin/python scripts/build_sandbox_image.py [--tag siliconsmith-base:latest]

Imports ubuntu:24.04, installs the toolchain (scripts/setup-toolchain.sh), copies hw/ firmware/ workloads/
engine/ to /work, runs the worker's baseline once as a smoke test, and tags the result. Prints no secrets.
"""
import argparse
import io
import sys
import tarfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
from siliconsmith import config  # noqa: E402,F401  (loads .env.local)
from contree_sdk import ContreeSync  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--tag", default="siliconsmith-base:latest")
ap.add_argument("--base-tag", default="ss-ubuntu2404")
args = ap.parse_args()

buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode="w:gz") as tar:
    for d in ("hw", "firmware", "workloads", "engine"):
        tar.add(ROOT / d, arcname=f"work/{d}", filter=lambda ti: None if any(
            p in ti.name for p in ("__pycache__", ".egg-info", "/.pytest_cache", "/obj_dir", "/build/")) else ti)
    tar.add(ROOT / "scripts" / "setup-toolchain.sh", arcname="work/scripts/setup-toolchain.sh")
print(f"source archive: {buf.tell() / 1e6:.1f} MB", flush=True)

sdk = ContreeSync()
base = sdk.images.use(args.base_tag)
t0 = time.monotonic()
script = (
    "set -e; mkdir -p /work && tar xzf /tmp/ss_src.tgz -C / && "
    "bash /work/scripts/setup-toolchain.sh && "
    "pip3 install --break-system-packages -q pydantic && "
    "export PATH=/opt/oss-cad-suite/bin:$PATH SS_ROOT=/work && cd /work/engine && "
    "PYTHONPATH=/work/engine python3 -m siliconsmith.worker baseline w1 | tail -3"
)
handle = base.run(shell=script, files={"/tmp/ss_src.tgz": buf.getvalue()}, timeout=3600, disposable=False,
                  truncate_output_at=4 * 1024 * 1024)
for attempt in range(60):  # the status endpoint returns a transient 500 now and then; the operation keeps running
    try:
        res = handle.wait()
        break
    except Exception as e:  # noqa: BLE001
        print(f"wait failed ({type(e).__name__}: {str(e)[:90]}); retry {attempt + 1}", flush=True)
        time.sleep(15)
else:
    raise SystemExit("gave up waiting")
print(f"exit={res.exit_code} after {time.monotonic() - t0:.0f}s")
print((res.stdout or "")[-2500:])
if res.exit_code != 0:
    print("stderr tail:", (res.stderr or "")[-1500:])
    raise SystemExit(1)
res.tag_as(args.tag)
print("tagged", args.tag, "->", res.uuid)
