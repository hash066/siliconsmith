"""Child process that runs ONE agent-written geometry generator on a batch of parameter samples.

Run as `python -I -m siliconsmith.matter._genworker` with a JSON request on stdin:
    {"code": str, "samples": [params, ...], "n": int, "chip": [i0, i1, j0, j1],
     "mem_mb": int, "cpu_s": int, "per_call_s": float}
Writes one tagged line to stdout:  @@GEN@@ {"results": [{"ok": bool, "mask": b64 | null, "error": str}, ...]}

Limits applied here: address-space and CPU rlimits (POSIX), a per-call alarm, a restricted builtins/import
whitelist, sockets disabled. This is a best-effort local guard for a first-line defence; the real
isolation boundary for untrusted code is a Token Factory Sandbox with networking off.
"""

from __future__ import annotations

import base64
import builtins
import json
import sys

TAG = "@@GEN@@ "
ALLOWED_IMPORTS = {"numpy", "math", "itertools", "functools", "collections"}
SAFE_BUILTINS = [
    "abs", "all", "any", "bool", "dict", "divmod", "enumerate", "filter", "float", "int", "isinstance", "len",
    "list", "map", "max", "min", "pow", "range", "reversed", "round", "set", "slice", "sorted", "sum", "tuple",
    "zip", "ValueError", "TypeError", "IndexError", "KeyError", "Exception", "ZeroDivisionError", "True", "False",
    "None", "object", "str", "repr", "NotImplementedError", "ArithmeticError", "AssertionError",
]


def _limits(mem_mb: int, cpu_s: int) -> None:
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (mem_mb << 20, mem_mb << 20))
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_s, cpu_s + 1))
        resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
    except Exception:  # non-POSIX: parent timeout is then the only limit
        pass


def _block_network() -> None:
    import socket

    def _no(*_a, **_k):
        raise PermissionError("network access is disabled")

    socket.socket = _no  # type: ignore[assignment]
    socket.create_connection = _no  # type: ignore[assignment]
    socket.getaddrinfo = _no  # type: ignore[assignment]


def main() -> int:
    req = json.loads(sys.stdin.read())
    import numpy as np  # import before the address-space cap tightens and before the import guard

    _block_network()
    _limits(int(req.get("mem_mb", 1024)), int(req.get("cpu_s", 60)))

    real_import = builtins.__import__

    def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
        if level != 0 or name.split(".")[0] not in ALLOWED_IMPORTS:
            raise ImportError(f"import of {name!r} is not allowed in generators")
        return real_import(name, globals, locals, fromlist, level)

    safe = {k: getattr(builtins, k) for k in SAFE_BUILTINS if hasattr(builtins, k)}
    safe["__import__"] = guarded_import
    env: dict = {"__builtins__": safe, "__name__": "generator"}
    results = []
    try:
        exec(compile(req["code"], "<generator>", "exec"), env)
        gen = env.get("generate")
        if not callable(gen):
            raise ValueError("generator code must define generate(params, n, chip)")
    except BaseException as e:  # noqa: BLE001
        err = f"{type(e).__name__}: {str(e)[:400]}"
        results = [{"ok": False, "mask": None, "error": err} for _ in req["samples"]]
        print(TAG + json.dumps({"results": results}))
        return 0

    import signal

    class _Timeout(BaseException):
        pass

    def _alarm(_s, _f):
        raise _Timeout()

    if hasattr(signal, "setitimer"):
        signal.signal(signal.SIGALRM, _alarm)
    n, chip = int(req["n"]), tuple(req["chip"])
    for params in req["samples"]:
        try:
            if hasattr(signal, "setitimer"):
                signal.setitimer(signal.ITIMER_REAL, float(req.get("per_call_s", 5.0)))
            m = gen(dict(params), n, chip)
            if hasattr(signal, "setitimer"):
                signal.setitimer(signal.ITIMER_REAL, 0)
            m = np.asarray(m)
            if m.dtype != bool or m.shape != (n, n):
                raise ValueError(f"generate() must return a bool array of shape {(n, n)}, got {m.dtype} {m.shape}")
            results.append({"ok": True, "mask": base64.b64encode(np.packbits(m).tobytes()).decode(), "error": ""})
        except _Timeout:
            results.append({"ok": False, "mask": None, "error": "TimeoutError: generate() exceeded the per-call limit"})
        except BaseException as e:  # noqa: BLE001
            results.append({"ok": False, "mask": None, "error": f"{type(e).__name__}: {str(e)[:400]}"})
    print(TAG + json.dumps({"results": results}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
