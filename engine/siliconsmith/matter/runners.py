"""Where agent-written generator code runs. Two runners with one protocol (see _genworker.py):

    runner(request_json: str, timeout_s: float) -> (stdout, stderr, exit_code)

* local_runner: a subprocess with a SCRUBBED environment (no API keys, no HOME), an empty temporary working
  directory, rlimits, and, when the OS allows it (`unshare -rn`), a network namespace with no interfaces.
  Development fallback. The process that holds our secrets never executes the generator.
* SandboxRunner: a Token Factory Sandbox (microVM) started from the small `siliconsmith-matter:latest` image
  (python3 + numpy, built by build_sandbox_image.py). Only the worker script and the request are uploaded; the
  host's environment is never sent. The sandbox's default network is OPEN (the SDK has no switch), so the worker
  is started inside `unshare -n` and the run FAILS CLOSED if that namespace cannot be created.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
from functools import lru_cache
from pathlib import Path

WORKER = Path(__file__).with_name("_genworker.py")
SANDBOX_IMAGE = "siliconsmith-matter:latest"


def scrubbed_env() -> dict[str, str]:
    """The only environment a generator process ever sees. Deliberately minimal: nothing is inherited."""
    return {"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8", "PYTHONHASHSEED": "0", "OMP_NUM_THREADS": "1"}


@lru_cache(maxsize=1)
def netns_available() -> bool:
    if sys.platform != "linux":
        return False
    try:
        return subprocess.run(["unshare", "-rn", "true"], capture_output=True, timeout=10, env=scrubbed_env()).returncode == 0
    except Exception:  # noqa: BLE001
        return False


def local_runner(request_json: str, timeout_s: float) -> tuple[str, str, int]:
    cmd = [sys.executable, "-I", str(WORKER)]
    if netns_available():
        cmd = ["unshare", "-rn", *cmd]
    with tempfile.TemporaryDirectory(prefix="ss-gen-") as d:
        p = subprocess.run(cmd, input=request_json, capture_output=True, text=True, timeout=timeout_s,
                           cwd=d, env=scrubbed_env())
    return p.stdout, p.stderr, p.returncode


class SandboxRunner:
    """Runs the worker in a Token Factory Sandbox. Needs contree_sdk and credentials in the HOST environment
    (used only by the SDK client on the host; never uploaded)."""

    SHELL = ("unshare -n true || { echo NO-NETNS-ISOLATION >&2; exit 97; }; "
             "cd /tmp && exec unshare -n -- python3 -I /opt/gw/_genworker.py < /tmp/req.json")

    def __init__(self, image: str = SANDBOX_IMAGE):
        from contree_sdk import ContreeSync  # optional dependency

        self.sdk = ContreeSync()
        self.image = image

    def __call__(self, request_json: str, timeout_s: float) -> tuple[str, str, int]:
        handle = self.sdk.images.use(self.image).run(
            shell=self.SHELL, env={}, timeout=timeout_s + 30, disposable=True, truncate_output_at=8 * 1024 * 1024,
            files={"/opt/gw/_genworker.py": WORKER.read_bytes(), "/tmp/req.json": request_json.encode()})
        res = None
        for attempt in range(30):  # the status endpoint answers a transient 500 now and then; the run continues
            try:
                res = handle.wait()
                break
            except Exception as e:  # noqa: BLE001
                if attempt == 29 or "500" not in str(e):
                    raise
                time.sleep(5)
        return res.stdout or "", res.stderr or "", int(res.exit_code)


def make_runner(name: str):
    if name == "local":
        return local_runner
    if name == "sandbox":
        return SandboxRunner()
    raise ValueError(f"unknown generator runner {name!r} (local | sandbox)")


def isolation_report() -> dict:
    """What the local runner can actually enforce on this machine (shown in docs and API responses)."""
    return {"local_network_namespace": netns_available(), "local_env_scrubbed": True,
            "rlimits": sys.platform != "win32", "sandbox_image": SANDBOX_IMAGE}
