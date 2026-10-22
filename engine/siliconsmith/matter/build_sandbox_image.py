"""Build the small Token Factory Sandbox image that runs agent-written geometry generators.

    python -m siliconsmith.matter.build_sandbox_image [--tag siliconsmith-matter:latest]

Ubuntu 24.04 (the ss-ubuntu2404 tag already in the account) + python3-numpy only (generators may import numpy and the stdlib; they never import scipy or any
siliconsmith code, and the host's secrets are never sent). Needs NEBIUS credentials in the environment for
the SDK; prints no secrets.
"""

from __future__ import annotations

import argparse
import time

SCRIPT = "set -e; export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y -qq python3-numpy util-linux; python3 -c 'import numpy;print(numpy.__version__)'"


def main() -> int:
    from contree_sdk import ContreeSync

    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="siliconsmith-matter:latest")
    a = ap.parse_args()
    sdk = ContreeSync()
    t0 = time.monotonic()
    handle = sdk.images.use("ss-ubuntu2404").run(shell=SCRIPT, timeout=900, disposable=False)
    for attempt in range(40):  # transient 500s on the status endpoint; the operation keeps running
        try:
            res = handle.wait()
            break
        except Exception as e:  # noqa: BLE001
            print(f"wait failed ({type(e).__name__}); retry {attempt + 1}", flush=True)
            time.sleep(10)
    else:
        raise SystemExit("gave up waiting")
    print(f"exit={res.exit_code} after {time.monotonic() - t0:.0f}s: {(res.stdout or '')[-200:].strip()}")
    if res.exit_code != 0:
        print((res.stderr or "")[-800:])
        return 1
    res.tag_as(a.tag)
    print("tagged", a.tag)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
