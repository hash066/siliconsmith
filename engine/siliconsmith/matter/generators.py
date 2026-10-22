"""Run agent-written geometry generators under resource limits.

A generator is Python source that defines

    def generate(params: dict, n: int, chip: tuple[int, int, int, int]) -> numpy.ndarray   # bool (n, n)

(chip = i0, i1, j0, j1 cell indices of the chip footprint, which is always material). It may import only
numpy, math, itertools, functools, collections. It never touches the physics: the solver, the budget and
the printability rules are applied by us afterwards.

Isolation, stated honestly: local runs use a subprocess with timeout, RLIMIT_AS / RLIMIT_CPU, no file writes,
sockets disabled, an import allow-list and an AST screen. That is a best-effort guard, not a security
boundary. The intended boundary for untrusted code is a Token Factory Sandbox with networking off, which
is NOT wired up yet.
"""

from __future__ import annotations

import ast
import base64
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ._genworker import ALLOWED_IMPORTS, TAG

FORBIDDEN_NAMES = {
    "exec", "eval", "open", "compile", "__import__", "globals", "locals", "getattr", "setattr", "delattr",
    "vars", "input", "breakpoint", "memoryview", "type", "super", "classmethod", "staticmethod", "property",
}
FORBIDDEN_ATTRS = {
    "load", "save", "savez", "loadtxt", "savetxt", "genfromtxt", "fromfile", "tofile", "memmap", "ctypeslib",
    "testing", "f2py", "distutils", "lib", "ctypes", "system", "popen", "dump", "dumps", "fromstring",
}
MAX_CODE_CHARS = 12000


class GeneratorRejected(ValueError):
    pass


def screen_source(code: str) -> None:
    """AST screen; raises GeneratorRejected with a short reason. Best effort, not a sandbox."""
    if len(code) > MAX_CODE_CHARS:
        raise GeneratorRejected(f"generator source too long ({len(code)} > {MAX_CODE_CHARS} chars)")
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        raise GeneratorRejected(f"SyntaxError: {e.msg} (line {e.lineno})") from e
    has_generate = False
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name.split(".")[0] not in ALLOWED_IMPORTS:
                    raise GeneratorRejected(f"import {a.name!r} is not allowed (allowed: {sorted(ALLOWED_IMPORTS)})")
        elif isinstance(node, ast.ImportFrom):
            if node.level or (node.module or "").split(".")[0] not in ALLOWED_IMPORTS:
                raise GeneratorRejected(f"import from {node.module!r} is not allowed")
        elif isinstance(node, ast.Name) and node.id in FORBIDDEN_NAMES:
            raise GeneratorRejected(f"name {node.id!r} is not allowed")
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith("__") or node.attr in FORBIDDEN_ATTRS:
                raise GeneratorRejected(f"attribute {node.attr!r} is not allowed")
        elif isinstance(node, ast.FunctionDef) and node.name == "generate":
            has_generate = True
    if not has_generate:
        raise GeneratorRejected("no `def generate(params, n, chip)` found")


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
) -> list[GenOutcome]:
    """Run `generate` once per parameter sample in a limited subprocess. Never raises for generator faults."""
    try:
        screen_source(code)
    except GeneratorRejected as e:
        return [GenOutcome(False, None, f"rejected: {e}") for _ in samples]
    req = json.dumps({"code": code, "samples": samples, "n": n, "chip": list(chip), "mem_mb": mem_mb,
                      "cpu_s": int(timeout_s), "per_call_s": per_call_s})
    try:
        p = subprocess.run([sys.executable, "-I", str(Path(__file__).with_name("_genworker.py"))], input=req,
                           capture_output=True, text=True, timeout=timeout_s)
    except subprocess.TimeoutExpired:
        return [GenOutcome(False, None, f"TimeoutError: generator exceeded {timeout_s:.0f}s") for _ in samples]
    line = next((ln for ln in p.stdout.splitlines() if ln.startswith(TAG)), None)
    if line is None:
        tail = (p.stderr or p.stdout)[-300:].strip().replace("\n", " ")
        return [GenOutcome(False, None, f"generator process died (exit {p.returncode}): {tail}") for _ in samples]
    out = []
    for r in json.loads(line[len(TAG):])["results"]:
        if r["ok"]:
            bits = np.unpackbits(np.frombuffer(base64.b64decode(r["mask"]), np.uint8))[: n * n]
            out.append(GenOutcome(True, bits.reshape(n, n).astype(bool), ""))
        else:
            out.append(GenOutcome(False, None, r["error"]))
    return out
