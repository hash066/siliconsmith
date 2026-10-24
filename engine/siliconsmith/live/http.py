"""HTTP face of the live run (FastAPI router, mounted by the hosted `app.py`).

    GET  /api/silicon/status    configured? workloads, caps. Free.
    POST /api/silicon/run       body {"workload": "w1"|"w2", "note"?: str}  ->  NDJSON stream, one v2 event per line
    POST /api/silicon/pairs     body {"name", "rtl", "c_ref", "pairs": [[rs1, rs2], ...]}  ->  JSON {rows, vcd}; no model tokens

Guard rails, all env-tunable: input whitelist and size limits, a per-visitor and a global rate limit, a cap on concurrent
runs. The rate limits and the concurrency cap are IN MEMORY: they live in one serverless instance, reset on a cold start
and are not shared between instances. They are a best-effort guard; the hard backstops are the per-run spend and time caps
in `run_live` and the provider-side budget.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import threading
import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from ..board.limits import RateLimiter
from .limits import (DEFAULT_BUDGET_USD, Deadline, DEFAULT_SECONDS, HARD_MAX_BUDGET_USD, HARD_MAX_SECONDS, MAX_BODY_BYTES,
                     MAX_NOTE_CHARS, WORKLOADS, LiveError)
from .pipeline import run_live

NO_STORE = {"Cache-Control": "no-store", "X-Accel-Buffering": "no"}


def _env(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


class Guard:
    """Per-visitor + global in-memory limits and the concurrent-run cap (a slot expires on its own after the run's cap)."""

    def __init__(self) -> None:
        self.per_visitor = RateLimiter(int(_env("SS_LIVE_RUNS_PER_IP_HOUR", 4)), 3600, _env("SS_LIVE_USD_PER_IP_HOUR", 0.60))
        self.overall = RateLimiter(int(_env("SS_LIVE_RUNS_PER_DAY", 150)), 86400, _env("SS_LIVE_USD_PER_DAY", 12.0))
        self.max_active = int(_env("SS_LIVE_MAX_ACTIVE", 3))
        self._active: list[float] = []
        self._lock = threading.Lock()

    def acquire(self, visitor: str, est_usd: float) -> tuple[bool, str, float]:
        """(allowed, reason, retry_after_s)."""
        with self._lock:
            now = time.monotonic()
            self._active = [t for t in self._active if now - t < HARD_MAX_SECONDS + 30]
            if len(self._active) >= self.max_active:
                return False, "busy: too many live runs are in progress on this server; try again in a minute", 30.0
            ok, retry = self.per_visitor.allow(visitor, est_usd)
            if not ok:
                return False, "run limit reached for you for now; watch a recorded run meanwhile", retry
            ok, retry = self.overall.allow("*", est_usd)
            if not ok:
                return False, "the shared live-run allowance on this server is used up; try again later", retry
            self._active.append(now)
        return True, "", 0.0

    def release(self, visitor: str, spent_usd: float) -> None:
        with self._lock:
            if self._active:
                self._active.pop(0)
        self.per_visitor.record(visitor, spent_usd)
        self.overall.record("*", spent_usd)


def _visitor(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")) or "unknown"


def _err(e: LiveError, headers: dict | None = None) -> JSONResponse:
    return JSONResponse(e.to_dict(), status_code=e.status, headers={**NO_STORE, **(headers or {})})


PAIRS_MAX = 16
RTL_MAX = 16 * 1024
C_REF_MAX = 4 * 1024
PAIRS_SECONDS = 150.0
_NAME = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
_FORBIDDEN_RTL = re.compile(r"\$(system|fopen|fwrite|fdisplay|readmem|writemem)|`include|`define\s+\w+\s+\$", re.I)


class PairsGuard:
    """Operand-pair runs cost Sandbox compute only; limited per visitor, overall and in flight (in memory, per server instance)."""

    def __init__(self) -> None:
        self.per_visitor = RateLimiter(int(_env("SS_PAIRS_PER_IP_HOUR", 20)), 3600, 0.0)
        self.overall = RateLimiter(int(_env("SS_PAIRS_PER_DAY", 300)), 86400, 0.0)
        self.max_active = int(_env("SS_PAIRS_MAX_ACTIVE", 2))
        self._active = 0
        self._lock = threading.Lock()

    def acquire(self, visitor: str) -> tuple[bool, str, float]:
        with self._lock:
            if self._active >= self.max_active:
                return False, "busy: other operand runs are in progress; try again in a minute", 30.0
            ok, retry = self.per_visitor.allow(visitor, 0.0)
            if not ok:
                return False, "operand-pair limit reached for you for now", retry
            ok, retry = self.overall.allow("*", 0.0)
            if not ok:
                return False, "the shared operand-pair allowance on this server is used up; try again later", retry
            self._active += 1
        return True, "", 0.0

    def release(self) -> None:
        with self._lock:
            self._active = max(0, self._active - 1)


def validate_pairs_body(body: object) -> dict:
    """The checked request, or a LiveError. The source is only ever run inside a Sandbox; these limits keep it small and plain."""
    if not isinstance(body, dict):
        raise LiveError("bad_request", "the body must be a JSON object {name, rtl, c_ref, pairs}", 400)
    extra = set(body) - {"name", "rtl", "c_ref", "pairs"}
    if extra:
        raise LiveError("bad_request", f"unknown field(s): {sorted(extra)[:3]}", 422)
    name, rtl, c_ref, pairs = body.get("name"), body.get("rtl"), body.get("c_ref"), body.get("pairs")
    if not isinstance(name, str) or not _NAME.match(name):
        raise LiveError("bad_name", "name must be lower-case letters, digits and underscores, starting with a letter", 422)
    if not isinstance(rtl, str) or not rtl.strip() or len(rtl) > RTL_MAX or f"module ss_insn_{name}" not in rtl:
        raise LiveError("bad_rtl", f"rtl must be the instruction's Verilog module ss_insn_{name}, at most {RTL_MAX} characters", 422)
    if _FORBIDDEN_RTL.search(rtl):
        raise LiveError("bad_rtl", "the Verilog may not use file or system tasks or include files", 422)
    if not isinstance(c_ref, str) or not c_ref.strip() or len(c_ref) > C_REF_MAX:
        raise LiveError("bad_c_ref", f"c_ref must be the C reference body, at most {C_REF_MAX} characters", 422)
    if not isinstance(pairs, list) or not 1 <= len(pairs) <= PAIRS_MAX:
        raise LiveError("bad_pairs", f"pairs must be a list of 1 to {PAIRS_MAX} [rs1, rs2] pairs", 422)
    clean: list[list[int]] = []
    for p in pairs:
        if not (isinstance(p, list) and len(p) == 2 and all(type(x) is int and 0 <= x <= 0xFFFFFFFF for x in p)):
            raise LiveError("bad_pairs", "each pair must be two whole numbers from 0 to 4294967295", 422)
        clean.append([p[0], p[1]])
    return {"name": name, "rtl": rtl, "c_ref": c_ref, "pairs": clean}


def run_pairs_in_sandbox(req: dict) -> dict:
    from .backend import LiveBackend, SandboxCapReached

    try:
        return LiveBackend(Deadline(PAIRS_SECONDS)).pairs(req["name"], req["rtl"], req["c_ref"], req["pairs"])
    except SandboxCapReached:
        raise LiveError("no_time", "not enough time left to start the Sandbox", 503) from None
    except LiveError:
        raise
    except RuntimeError as e:
        raise LiveError("simulation_failed", str(e)[:300], 422) from None
    except Exception as e:  # noqa: BLE001 - a transport or permission error: say which kind, never the details
        raise LiveError("sandbox_failed", f"the Sandbox could not run this ({type(e).__name__})", 502) from None


def make_router(runner=run_live, guard: Guard | None = None, pairs_runner=run_pairs_in_sandbox, pairs_guard: PairsGuard | None = None) -> APIRouter:
    router, guard = APIRouter(), guard or Guard()
    pairs_guard = pairs_guard or PairsGuard()
    budget = min(_env("SS_LIVE_BUDGET_USD", DEFAULT_BUDGET_USD), HARD_MAX_BUDGET_USD)
    seconds = min(_env("SS_LIVE_MAX_SECONDS", DEFAULT_SECONDS), HARD_MAX_SECONDS)

    @router.get("/api/silicon/status")
    def status():
        return JSONResponse({
            "ok": True, "configured": bool(os.environ.get("NEBIUS_API_KEY")), "workloads": sorted(WORKLOADS),
            "caps": {"budget_usd": budget, "max_seconds": seconds}, "max_note_chars": MAX_NOTE_CHARS,
            "limits_scope": "in memory, per server instance",
            "scope": "one candidate instruction, up to 2 repairs, no Fmax: cycle speedup and area, not wall-clock"},
            headers=NO_STORE)

    @router.post("/api/silicon/run")
    async def run(request: Request):
        try:
            raw = b""
            async for chunk in request.stream():
                raw += chunk
                if len(raw) > MAX_BODY_BYTES:
                    raise LiveError("body_too_large", f"request body must be at most {MAX_BODY_BYTES} bytes", 413)
            try:
                body = json.loads(raw.decode("utf-8") or "null")
            except (ValueError, UnicodeDecodeError):
                raise LiveError("bad_json", "the body must be JSON", 400) from None
            if not isinstance(body, dict):
                raise LiveError("bad_request", "the body must be a JSON object {workload, note?}", 400)
            extra = set(body) - {"workload", "note"}
            if extra:
                raise LiveError("bad_request", f"unknown field(s): {sorted(extra)[:3]}; the caps are set by the server", 422)
            # validates the request and returns the stream; nothing runs until the first event is read
            stream = runner(body.get("workload"), budget, seconds, note=body.get("note"))
        except LiveError as e:
            return _err(e)
        visitor = _visitor(request)
        ok, reason, retry = guard.acquire(visitor, budget)
        if not ok:
            return _err(LiveError("rate_limited", reason, 429), {"Retry-After": str(int(retry) + 1)})

        def lines():
            spent = 0.0
            try:
                for ev in stream:
                    if ev.get("type") == "run.completed":
                        spent = float((ev.get("totals") or {}).get("cost_usd") or 0.0)
                    yield json.dumps(ev, separators=(",", ":"), default=str) + "\n"
            finally:
                guard.release(visitor, spent if spent > 0 else budget)  # unknown spend counts as the whole cap

        return StreamingResponse(lines(), media_type="application/x-ndjson", headers=NO_STORE)

    @router.post("/api/silicon/pairs")
    async def pairs(request: Request):
        raw = b""
        async for chunk in request.stream():
            raw += chunk
            if len(raw) > RTL_MAX + C_REF_MAX + 4096:
                return _err(LiveError("body_too_large", "the request is too large", 413))
        try:
            body = json.loads(raw.decode("utf-8") or "null")
        except (ValueError, UnicodeDecodeError):
            return _err(LiveError("bad_json", "the body must be JSON", 400))
        try:
            req = validate_pairs_body(body)
        except LiveError as e:
            return _err(e)
        ok, reason, retry = pairs_guard.acquire(_visitor(request))
        if not ok:
            return _err(LiveError("rate_limited", reason, 429), {"Retry-After": str(int(retry) + 1)})
        try:
            res = await asyncio.get_running_loop().run_in_executor(None, pairs_runner, req)
        except LiveError as e:
            return _err(e)
        finally:
            pairs_guard.release()
        return JSONResponse({"ok": True, **res}, headers=NO_STORE)

    return router
