"""Run agent-written geometry generators under resource limits.

A generator is Python source that defines

    def generate(params: dict, n: int, chip: tuple[int, int, int, int]) -> numpy.ndarray   # bool (n, n)

(chip = i0, i1, j0, j1 cell indices of the chip footprint, which is always material). It may import only
numpy, math, itertools, functools, collections. It never touches the physics: the solver, the budget and
the printability rules are applied by us afterwards.

Isolation, stated honestly (details in runners.py): the AST screen and import allow-list are a best-effort guard;
the boundary is WHERE the code runs. The default local runner is a development fallback (scrubbed environment,
empty cwd, rlimits, network namespace when the OS allows it). The Token Factory Sandbox runner is the boundary
for untrusted code: a microVM that never receives our secrets.
"""

from __future__ import annotations

import base64
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np

from ._genworker import TAG
from .runners import local_runner

# The screen lives in _genworker.py (it runs again where the code runs); re-exported for callers and tests.
from ._genworker import GeneratorRejected, screen_source  # noqa: E402,F401


@dataclass
class GenOutcome:
    ok: bool
    mask: np.ndarray | None
    error: str


def run_generator(
    code: str,
    samples: list[dict],
    n: int,
    chip: tuple[int, int, int, int],
    *,
    timeout_s: float = 60.0,
    mem_mb: int = 1024,
    per_call_s: float = 5.0,
    runner: "Callable[[str, float], tuple[str, str, int]] | None" = None,
) -> list[GenOutcome]:
    """Run `generate` once per parameter sample in a limited subprocess. Never raises for generator faults."""
    try:
        screen_source(code)
    except GeneratorRejected as e:
        return [GenOutcome(False, None, f"rejected: {e}") for _ in samples]
    req = json.dumps({"code": code, "samples": samples, "n": n, "chip": list(chip), "mem_mb": mem_mb,
                      "cpu_s": int(timeout_s), "per_call_s": per_call_s})
    try:
        stdout, stderr, rc = (runner or local_runner)(req, timeout_s)
    except subprocess.TimeoutExpired:
        return [GenOutcome(False, None, f"TimeoutError: generator exceeded {timeout_s:.0f}s") for _ in samples]
    line = next((ln for ln in stdout.splitlines() if ln.startswith(TAG)), None)
    if line is None:
        tail = (stderr or stdout)[-300:].strip().replace(chr(10), " ")
        return [GenOutcome(False, None, f"generator process died (exit {rc}): {tail}") for _ in samples]
    out = []
    for r in json.loads(line[len(TAG):])["results"]:
        if r["ok"]:
            bits = np.unpackbits(np.frombuffer(base64.b64decode(r["mask"]), np.uint8))[: n * n]
            out.append(GenOutcome(True, bits.reshape(n, n).astype(bool), ""))
        else:
            out.append(GenOutcome(False, None, r["error"]))
    return out
