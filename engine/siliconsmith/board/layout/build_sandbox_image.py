"""Build the Token Factory Sandbox image that routes boards: KiCad 7, Java, a virtual display and Freerouting.

    python -m siliconsmith.board.layout.build_sandbox_image [--tag siliconsmith-kicad:latest]

Ubuntu 24.04 (the ss-ubuntu2404 tag already in the account) + KiCad 7 (pcbnew's Python module, kicad-cli, the official footprint
libraries) + OpenJDK 21 + Xvfb + the Freerouting 1.9.0 jar, whose SHA-256 is checked. Needs NEBIUS credentials in the environment
(or .env.local, which siliconsmith.config loads); prints no secrets. Takes several minutes: the KiCad packages are large."""

from __future__ import annotations

import argparse
import time

from ... import config  # noqa: F401  (loads .env.local into the environment)

JAR_URL = "https://github.com/freerouting/freerouting/releases/download/v1.9.0/freerouting-1.9.0.jar"
JAR_SHA256 = "9084a4888937a7f31f857ecc12aa7a37407f51160e4d2892dff9c9bb47ae3102"

SCRIPT = f"""set -e
export HOME=/root  # the Sandbox starts with HOME empty, which KiCad refuses to run with
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends kicad kicad-footprints openjdk-21-jre xvfb xauth curl ca-certificates libxtst6 libxrender1 libxi6 fontconfig
mkdir -p /opt/freerouting
curl -fsSL -o /opt/freerouting/freerouting.jar {JAR_URL}
echo "{JAR_SHA256}  /opt/freerouting/freerouting.jar" | sha256sum -c -
python3 -c "import pcbnew; print('pcbnew', pcbnew.GetBuildVersion())"
kicad-cli version
java -version 2>&1 | head -1
which xvfb-run
"""


def main() -> int:
    from contree_sdk import ContreeSync

    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="siliconsmith-kicad:latest")
    a = ap.parse_args()
    sdk = ContreeSync()
    t0 = time.monotonic()
    handle = sdk.images.use("ss-ubuntu2404").run(shell=SCRIPT, timeout=2400, disposable=False)
    res = None
    for attempt in range(120):  # transient 500s on the status endpoint; the operation keeps running
        try:
            res = handle.wait()
            break
        except Exception as e:  # noqa: BLE001
            print(f"wait failed ({type(e).__name__}); retry {attempt + 1}", flush=True)
            time.sleep(15)
    if res is None:
        raise SystemExit("gave up waiting")
    print(f"exit={res.exit_code} after {time.monotonic() - t0:.0f}s: {(res.stdout or '')[-400:].strip()}")
    if res.exit_code != 0:
        print((res.stderr or "")[-1200:])
        return 1
    res.tag_as(a.tag)
    print("tagged", a.tag)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
