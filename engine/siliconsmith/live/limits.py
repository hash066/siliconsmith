"""Caps, the workload whitelist and input validation for the hosted live run. Everything a visitor sends is untrusted."""

from __future__ import annotations

import re
import time

DEFAULT_BUDGET_USD = 0.15
HARD_MAX_BUDGET_USD = 0.30
DEFAULT_SECONDS = 240.0
HARD_MAX_SECONDS = 280.0  # the hosted function's maxDuration is 300 s; the stream must end before it
MIN_SECONDS = 30.0
MAX_NOTE_CHARS = 280
MAX_BODY_BYTES = 4_000

# public id -> workload directory name (the only workloads a visitor can run)
WORKLOADS = {"w1": "w1_tinymaix_fc", "w2": "w2_monocypher_chacha20"}

_CONTROL = re.compile(r"[\x00-\x1f\x7f]+")


class LiveError(Exception):
    """A request the live endpoint refuses. `code` is machine readable, `status` the HTTP status to answer with."""

    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status

    def to_dict(self) -> dict:
        return {"ok": False, "error": {"code": self.code, "message": self.message}}


def check_caps(budget_usd, max_seconds) -> tuple[float, float]:
    ok = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)  # noqa: E731
    if not ok(budget_usd) or not (0 < budget_usd <= HARD_MAX_BUDGET_USD):
        raise LiveError("bad_budget", f"budget_usd must be above 0 and at most {HARD_MAX_BUDGET_USD}")
    if not ok(max_seconds) or not (MIN_SECONDS <= max_seconds <= HARD_MAX_SECONDS):
        raise LiveError("bad_time_cap", f"max_seconds must be from {MIN_SECONDS:g} to {HARD_MAX_SECONDS:g}")
    return float(budget_usd), float(max_seconds)


def check_workload(workload) -> str:
    if not isinstance(workload, str) or workload not in WORKLOADS:
        raise LiveError("bad_workload", f"workload must be one of {sorted(WORKLOADS)}", 422)
    return workload


def clean_note(note) -> str:
    """The optional visitor note: plain text only, at most MAX_NOTE_CHARS, control characters become spaces.
    It is shown to the architect model as untrusted text; it is never executed or interpreted."""
    if note is None:
        return ""
    if not isinstance(note, str):
        raise LiveError("bad_note", "note must be a string", 422)
    text = " ".join(_CONTROL.sub(" ", note).split())
    if len(text) > MAX_NOTE_CHARS:
        raise LiveError("note_too_long", f"note must be at most {MAX_NOTE_CHARS} characters", 422)
    return text


class Deadline:
    """One wall-clock budget shared by every model call and Sandbox run of a live run."""

    def __init__(self, max_seconds: float, clock=time.monotonic):
        self._clock, self.start, self.max_seconds = clock, clock(), max_seconds

    def elapsed(self) -> float:
        return self._clock() - self.start

    def remaining(self) -> float:
        return self.max_seconds - self.elapsed()
