"""Input validation, hard limits and a rate-limit hook for the hosted Matter endpoints.

Every number a caller can set has a range; errors name the field, the allowed range and the value received.
Callers send numbers and choices only, never free text, so nothing a user types can reach a model prompt
(no prompt-injection path from the request into the agent's instructions).
"""

from __future__ import annotations

import math
import threading
import time
from collections import defaultdict, deque

from .problem import Spreader

MAX_REQUEST_BYTES = 16_384
MAX_AGENT_BUDGET_USD = 0.50  # hosted hard cap per agent run
MAX_AGENT_SECONDS = 240.0
MAX_ROUNDS, MAX_IDEAS, MAX_SAMPLES = 6, 4, 16

# name -> (min, max, integer?)
SPREADER_RANGES: dict[str, tuple[float, float, bool]] = {
    "n": (30, 80, True),  # grid cells per side (grid size cap: 80 x 80)
    "dx_mm": (0.5, 2.0, False),
    "t_mm": (0.2, 10.0, False),
    "k": (5.0, 500.0, False),
    "h": (2.0, 500.0, False),
    "T_inf": (-20.0, 60.0, False),
    "Q": (0.1, 100.0, False),
    "chip": (2, 12, True),
    "budget_fraction": (0.05, 0.9, False),
    "min_feature": (1, 4, True),
}


class InputError(ValueError):
    def __init__(self, field: str, message: str):
        super().__init__(f"{field}: {message}")
        self.field, self.message = field, message

    def as_dict(self) -> dict:
        return {"field": self.field, "message": self.message}


def number(field: str, value, lo: float, hi: float, integer: bool = False) -> float | int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InputError(field, f"must be a number, got {type(value).__name__}")
    if not math.isfinite(value):
        raise InputError(field, "must be finite")
    if integer and float(value) != int(value):
        raise InputError(field, f"must be an integer, got {value}")
    if not (lo <= value <= hi):
        raise InputError(field, f"must be between {lo:g} and {hi:g}, got {value:g}")
    return int(value) if integer else float(value)


def spreader_from(d: dict | None) -> Spreader:
    """Validated Spreader from a request dict (unknown keys are rejected, not ignored)."""
    d = d or {}
    if not isinstance(d, dict):
        raise InputError("spreader", "must be an object")
    unknown = sorted(set(d) - set(SPREADER_RANGES))
    if unknown:
        raise InputError("spreader", f"unknown field(s) {unknown}; allowed: {sorted(SPREADER_RANGES)}")
    v = {k: number(f"spreader.{k}", x, *SPREADER_RANGES[k]) for k, x in d.items()}
    kw: dict = {}
    for k, x in v.items():
        if k == "dx_mm":
            kw["dx"] = x * 1e-3
        elif k == "t_mm":
            kw["t"] = x * 1e-3
        else:
            kw[k] = x
    sp = Spreader(**kw)
    if sp.chip >= sp.n // 2:
        raise InputError("spreader.chip", f"must be smaller than half the grid ({sp.n // 2}), got {sp.chip}")
    if sp.chip * sp.chip > sp.budget_cells:
        raise InputError("spreader.budget_fraction",
                         f"budget {sp.budget_cells} cells is smaller than the chip footprint {sp.chip * sp.chip}")
    return sp


def check_size(raw: bytes | str) -> None:
    n = len(raw.encode() if isinstance(raw, str) else raw)
    if n > MAX_REQUEST_BYTES:
        raise InputError("request", f"body is {n} bytes, limit is {MAX_REQUEST_BYTES}")


class RateLimiter:
    """Sliding-window limiter, IN MEMORY: per process / per serverless instance, so it is a courtesy limit,
    not a global guarantee. A hosted deployment needs a shared store (for example Vercel KV) for a real limit."""

    def __init__(self, max_calls: int, per_seconds: float, clock=time.monotonic):
        self.max, self.per, self.clock = max_calls, per_seconds, clock
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> tuple[bool, float]:
        """(allowed, seconds until the next call would be allowed)."""
        now = self.clock()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] >= self.per:
                q.popleft()
            if len(q) >= self.max:
                return False, self.per - (now - q[0])
            q.append(now)
            return True, 0.0
