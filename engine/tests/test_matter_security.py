"""Malicious generators must not see secrets or reach the network, in either runner.

Payloads are sent STRAIGHT to the worker protocol (bypassing the host-side screen), so the worker's own
defences and the runner's environment are what is tested. The sandbox runner tests are real Token Factory
Sandbox runs: set SS_TEST_SANDBOX=1 with credentials in the environment (skipped otherwise)."""

import json
import os
import subprocess
import sys

import pytest

pytest.importorskip("scipy")

from siliconsmith.matter import runners  # noqa: E402
from siliconsmith.matter._genworker import TAG  # noqa: E402

CANARY = "canary-secret-should-never-appear"

PAYLOADS = {
    "read_env": "import os\ndef generate(params, n, chip):\n    raise ValueError(str(os.environ))\n",
    "env_via_numpy": "import numpy as np\ndef generate(params, n, chip):\n    raise ValueError(str(np.os.environ))\n",
    "network": "import socket\ndef generate(params, n, chip):\n    socket.create_connection(('1.1.1.1', 443), 3)\n    return None\n",
    "write_file": "def generate(params, n, chip):\n    open('/tmp/pwned', 'w').write('x')\n",
    "np_file_read": "import numpy as np\ndef generate(params, n, chip):\n    return np.load('/etc/passwd', allow_pickle=True)\n",
    "np_datasource": "import numpy as np\ndef generate(params, n, chip):\n    return np.DataSource().open('/etc/passwd')\n",
    "dunder_escape": "def generate(params, n, chip):\n    return ().__class__.__bases__[0].__subclasses__()\n",
    "getattr_trick": "def generate(params, n, chip):\n    return getattr(__builtins__, 'open')('/etc/passwd')\n",
    "subprocess": "import subprocess\ndef generate(params, n, chip):\n    return subprocess.check_output(['env'])\n",
}


def request(code: str) -> str:
    return json.dumps({"code": code, "samples": [{}], "n": 60, "chip": [27, 33, 27, 33], "mem_mb": 512,
                       "cpu_s": 30, "per_call_s": 5.0})


def run_raw(runner, code: str) -> dict:
    out, err, rc = runner(request(code), 60)
    line = next((x for x in out.splitlines() if x.startswith(TAG)), None)
    assert line is not None, f"worker gave no result line (exit {rc}): {err[-200:]}"
    return json.loads(line[len(TAG):])["results"][0]


@pytest.fixture(autouse=True)
def canary(monkeypatch):
    monkeypatch.setenv("SS_CANARY_SECRET", CANARY)
    monkeypatch.setenv("NEBIUS_API_KEY", CANARY)


@pytest.mark.parametrize("name", sorted(PAYLOADS))
def test_local_runner_blocks_malicious_generators(name):
    r = run_raw(runners.local_runner, PAYLOADS[name])
    assert not r["ok"], name
    assert CANARY not in json.dumps(r)
    assert "not allowed" in r["error"] or "rejected" in r["error"] or "Error" in r["error"]


def test_local_runner_environment_is_scrubbed(monkeypatch):
    seen = {}
    real = subprocess.run

    def spy(*a, **k):
        seen["env"], seen["cwd"] = k.get("env"), k.get("cwd")
        return real(*a, **k)

    monkeypatch.setattr(subprocess, "run", spy)
    run_raw(runners.local_runner, PAYLOADS["read_env"])
    assert seen["env"] == runners.scrubbed_env()
    assert CANARY not in json.dumps(seen["env"]) and "HOME" not in seen["env"]
    assert seen["cwd"] and seen["cwd"] != os.getcwd()
    child = real([sys.executable, "-c", "import os,json;print(json.dumps(dict(os.environ)))"],
                 env=runners.scrubbed_env(), capture_output=True, text=True).stdout
    assert CANARY not in child


@pytest.mark.skipif(not runners.netns_available(), reason="no network namespace permission on this host")
def test_local_runner_has_no_network_interfaces():
    code = "import socket;s=socket.socket();s.settimeout(3)\ntry:\n    s.connect(('1.1.1.1',443));print('NET-OPEN')\nexcept OSError:\n    print('NET-BLOCKED')"
    p = subprocess.run(["unshare", "-rn", sys.executable, "-c", code], capture_output=True, text=True, timeout=20,
                       env=runners.scrubbed_env())
    assert "NET-BLOCKED" in p.stdout


# ---------------------------------------------------------------- real sandbox

REAL = os.environ.get("SS_TEST_SANDBOX") == "1"


@pytest.fixture(scope="module")
def sandbox():
    pytest.importorskip("contree_sdk")
    return runners.SandboxRunner()


@pytest.mark.skipif(not REAL, reason="set SS_TEST_SANDBOX=1 (needs Token Factory credentials)")
@pytest.mark.parametrize("name", sorted(PAYLOADS))
def test_sandbox_runner_blocks_malicious_generators(sandbox, name):
    r = run_raw(sandbox, PAYLOADS[name])
    assert not r["ok"], name
    assert CANARY not in json.dumps(r)


@pytest.mark.skipif(not REAL, reason="set SS_TEST_SANDBOX=1 (needs Token Factory credentials)")
def test_sandbox_has_no_secrets_no_network_and_runs_a_real_generator(sandbox):
    # the sandbox environment itself: no credentials, no route out under `unshare -n`
    shell = ("env; unshare -n -- python3 -c \"import socket;s=socket.socket();s.settimeout(3)\n"
             "try:\n s.connect(('1.1.1.1',443));print('NET-OPEN')\nexcept OSError:\n print('NET-BLOCKED')\"")
    res = sandbox.sdk.images.use(runners.SANDBOX_IMAGE).run(shell=shell, env={}, timeout=120, disposable=True).wait()
    out = res.stdout or ""
    assert "NET-BLOCKED" in out and "NET-OPEN" not in out
    assert "NEBIUS" not in out and CANARY not in out and "KEY" not in out.upper().replace("MONKEY", "")
    # and an honest generator works end to end in the sandbox
    from siliconsmith.matter import generators, reference_generators as ref
    from siliconsmith.matter.problem import Spreader

    sp = Spreader()
    g = generators.run_generator(ref.RECT_FINS["source"], [{"spine": 8, "n_fins": 6, "fin_w": 3, "fin_len": 12}],
                                 sp.n, sp.chip_cells, runner=sandbox)[0]
    assert g.ok and g.mask.shape == (sp.n, sp.n)
