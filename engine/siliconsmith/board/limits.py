"""Input validation, size limits and an in-memory rate limiter for the hosted Board endpoints.

Everything a visitor sends is untrusted: size is checked before parsing, shape by the pydantic Design model, and the
counts and string lengths below bound the work the deterministic checks can be asked to do. `InputError` carries a
machine code, a message and a list of `{path, message}` problems so the UI can point at the exact field.

The rate limiter is IN MEMORY: it is per process, resets on restart, and a serverless platform may run several
instances that do not share it. Treat it as a best-effort guard; the hard backstops are the per-run spend cap in
`serverless.run_agent` and the provider-side budget.
"""

from __future__ import annotations

import json
import threading
import time
from collections import defaultdict, deque
from typing import Any

from pydantic import ValidationError

from .netlist import Design

MAX_BODY_BYTES = 64_000
MAX_HEADER_BYTES = 8_000
MAX_BRIEF_CHARS = 1_500
MAX_INSTANCES = 100
MAX_NETS = 200
MAX_PINS_PER_NET = 200
MAX_ASSIGNMENTS = 100
MAX_STRING = 80          # any single string value in a design (names, refs, pins)
MAX_PARAMS_PER_INSTANCE = 16

# What a visitor may change in `assumptions`, with the range accepted (inclusive). Anything else is rejected.
ASSUMPTION_RANGES: dict[str, tuple[float, float]] = {
    "i2c_cb_pf": (1, 1000),
    "battery_capacity_mah": (10, 100_000),
    "battery_usable_fraction": (0.05, 1.0),
    "target_hours": (1, 100_000),
    "active_s": (0.01, 86_400),
    "period_s": (0.01, 86_400 * 7),
}
ASSUMPTION_CHOICES = {"i2c_mode": ("standard", "fast")}


class InputError(ValueError):
    def __init__(self, code: str, message: str, errors: list[dict[str, str]] | None = None, status: int = 400):
        super().__init__(message)
        self.code, self.message, self.errors, self.status = code, message, errors or [], status

    def to_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "errors": self.errors}


def _walk_strings(node: Any, path: str, out: list[dict[str, str]]) -> None:
    if isinstance(node, str):
        if len(node) > MAX_STRING:
            out.append({"path": path, "message": f"string longer than {MAX_STRING} characters"})
    elif isinstance(node, dict):
        for k, v in node.items():
            if isinstance(k, str) and len(k) > MAX_STRING:
                out.append({"path": f"{path}.{k[:20]}...", "message": f"key longer than {MAX_STRING} characters"})
            _walk_strings(v, f"{path}.{k}" if path else str(k), out)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            _walk_strings(v, f"{path}[{i}]", out)


def _load_json(payload: str | bytes | dict | list, what: str) -> Any:
    if isinstance(payload, (str, bytes)):
        size = len(payload.encode("utf-8")) if isinstance(payload, str) else len(payload)
        if size > MAX_BODY_BYTES:
            raise InputError("too_large", f"{what} is {size} bytes; the limit is {MAX_BODY_BYTES}", status=413)
        try:
            return json.loads(payload)
        except json.JSONDecodeError as e:
            raise InputError("bad_json", f"{what} is not valid JSON: {e.msg} at line {e.lineno} column {e.colno}",
                             [{"path": "", "message": f"line {e.lineno}, column {e.colno}: {e.msg}"}])
    return payload


def parse_design(payload: str | bytes | dict) -> Design:
    """Validated Design from JSON text or an already-parsed object, or InputError with precise problems."""
    data = _load_json(payload, "design")
    if not isinstance(data, dict):
        raise InputError("bad_design", "design must be a JSON object", [{"path": "", "message": "expected an object"}])
    problems: list[dict[str, str]] = []
    _walk_strings(data, "", problems)
    for key, limit in (("instances", MAX_INSTANCES), ("nets", MAX_NETS), ("mcu_assignments", MAX_ASSIGNMENTS),
                       ("firmware_pins", MAX_ASSIGNMENTS)):
        v = data.get(key)
        if isinstance(v, list) and len(v) > limit:
            problems.append({"path": key, "message": f"{len(v)} entries; the limit is {limit}"})
    for i, n in enumerate(data.get("nets", []) if isinstance(data.get("nets"), list) else []):
        pins = n.get("pins") if isinstance(n, dict) else None
        if isinstance(pins, list) and len(pins) > MAX_PINS_PER_NET:
            problems.append({"path": f"nets[{i}].pins", "message": f"{len(pins)} pins; the limit is {MAX_PINS_PER_NET}"})
    for i, inst in enumerate(data.get("instances", []) if isinstance(data.get("instances"), list) else []):
        params = inst.get("params") if isinstance(inst, dict) else None
        if isinstance(params, dict) and len(params) > MAX_PARAMS_PER_INSTANCE:
            problems.append({"path": f"instances[{i}].params", "message": f"more than {MAX_PARAMS_PER_INSTANCE} parameters"})
    if problems:
        raise InputError("limits_exceeded", "design exceeds the size limits", problems, status=413)
    try:
        design = Design.model_validate(data)
    except ValidationError as e:
        raise InputError("bad_design", "design does not match the schema", [
            {"path": ".".join(str(p) for p in err["loc"]), "message": err["msg"]} for err in e.errors()[:25]])
    check_assumptions(design.assumptions)
    return design


def check_assumptions(assumptions: dict[str, Any]) -> None:
    problems = []
    for k, v in assumptions.items():
        if k in ASSUMPTION_CHOICES:
            if v not in ASSUMPTION_CHOICES[k]:
                problems.append({"path": f"assumptions.{k}", "message": f"must be one of {list(ASSUMPTION_CHOICES[k])}"})
        elif k in ASSUMPTION_RANGES:
            lo, hi = ASSUMPTION_RANGES[k]
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not (lo <= v <= hi):
                problems.append({"path": f"assumptions.{k}", "message": f"must be a number from {lo:g} to {hi:g}"})
        else:
            problems.append({"path": f"assumptions.{k}", "message": "unknown assumption key"})
    if problems:
        raise InputError("bad_assumptions", "assumptions are not valid", problems)


def check_header(header: Any) -> str | None:
    if header is None:
        return None
    if not isinstance(header, str):
        raise InputError("bad_header", "header must be a string of C text", [{"path": "header", "message": "expected a string"}])
    if len(header.encode("utf-8")) > MAX_HEADER_BYTES:
        raise InputError("too_large", f"header is larger than {MAX_HEADER_BYTES} bytes", status=413)
    return header


def check_brief_text(text: Any) -> str | None:
    if text is None:
        return None
    if not isinstance(text, str) or not text.strip():
        raise InputError("bad_brief", "brief text must be a non-empty string", [{"path": "brief.text", "message": "expected text"}])
    if len(text) > MAX_BRIEF_CHARS:
        raise InputError("too_large", f"brief text is longer than {MAX_BRIEF_CHARS} characters", status=413)
    return text.strip()


def parse_body(raw: bytes | str | None) -> dict[str, Any]:
    """A request body as a JSON object (empty body is {}), with the size limit applied first."""
    if raw is None or len(raw) == 0:
        return {}
    data = _load_json(raw, "request body")
    if not isinstance(data, dict):
        raise InputError("bad_request", "request body must be a JSON object")
    return data


class RateLimiter:
    """Sliding-window limiter keyed by visitor: `max_calls` per `window_s` seconds and, optionally, `max_usd` of
    recorded spend per window. In memory (see module docstring). Thread-safe."""

    def __init__(self, max_calls: int, window_s: float, max_usd: float | None = None, clock=time.monotonic):
        self.max_calls, self.window_s, self.max_usd, self._clock = max_calls, window_s, max_usd, clock
        self._calls: dict[str, deque[float]] = defaultdict(deque)
        self._spend: dict[str, deque[tuple[float, float]]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _trim(self, key: str, now: float) -> None:
        cutoff = now - self.window_s
        calls, spend = self._calls[key], self._spend[key]
        while calls and calls[0] <= cutoff:
            calls.popleft()
        while spend and spend[0][0] <= cutoff:
            spend.popleft()

    def allow(self, key: str, est_usd: float = 0.0) -> tuple[bool, float]:
        """(allowed, retry_after_seconds). A call is counted when allowed. `est_usd` is checked against the
        remaining spend budget of the window."""
        with self._lock:
            now = self._clock()
            self._trim(key, now)
            calls, spend = self._calls[key], self._spend[key]
            if len(calls) >= self.max_calls:
                return False, max(self.window_s - (now - calls[0]), 0.0)
            if self.max_usd is not None and sum(u for _, u in spend) + est_usd > self.max_usd:
                return False, max(self.window_s - (now - spend[0][0]), 0.0) if spend else self.window_s
            calls.append(now)
            return True, 0.0

    def record(self, key: str, usd: float) -> None:
        with self._lock:
            now = self._clock()
            self._trim(key, now)
            self._spend[key].append((now, max(usd, 0.0)))
