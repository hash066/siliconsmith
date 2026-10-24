"""HTTP face of the Sandbox layout (FastAPI router, mounted by the hosted `app.py`).

    GET  /api/board/layout/status   configured? caps. Free.
    POST /api/board/layout          body {"design": <design object or JSON text>}  ->  NDJSON stream

The stream carries {"type":"progress","message"}, {"type":"heartbeat","seconds"} every few seconds (so no proxy sees a silent
connection), then one {"type":"result", summary, board, downloads, seconds} or {"type":"error", code, message}. It costs no model
tokens, only Sandbox compute, so it spends no demo credits; it is limited per visitor and overall, in memory per server instance
(a best-effort guard; the Sandbox cap and the provider-side budget are the hard backstops). Finished boards are cached by netlist.
"""

from __future__ import annotations

import json
import os
import queue
import threading
import time
from collections import OrderedDict
from typing import Any, Callable

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from ...live.limits import Deadline
from ..checks import IMPLEMENTED_RUNGS  # noqa: F401
from ..limits import RateLimiter, InputError, parse_design
from ..netlist import Design
from ..serverless import check as run_check
from ..serverless import library as load_library
from . import place as P
from .canonical import canonical_netlist
from .constraints import MAX_CHARS, parse_constraints
from .sandbox import LayoutSandboxError, generate_in_sandbox

NO_STORE = {"Cache-Control": "no-store", "X-Accel-Buffering": "no"}
MAX_BODY = 64 * 1024
SECONDS = 270.0
HEARTBEAT_S = 8.0


def _env(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


class Guard:
    def __init__(self) -> None:
        self.per_visitor = RateLimiter(int(_env("SS_LAYOUT_PER_IP_HOUR", 6)), 3600, 0.0)
        self.overall = RateLimiter(int(_env("SS_LAYOUT_PER_DAY", 120)), 86400, 0.0)
        self.max_active = int(_env("SS_LAYOUT_MAX_ACTIVE", 2))
        self._active: list[float] = []
        self._lock = threading.Lock()

    def acquire(self, visitor: str) -> tuple[bool, str, float]:
        with self._lock:
            now = time.monotonic()
            self._active = [t for t in self._active if now - t < SECONDS + 30]
            if len(self._active) >= self.max_active:
                return False, "busy: other boards are being made on this server; try again in a minute", 30.0
            ok, retry = self.per_visitor.allow(visitor, 0.0)
            if not ok:
                return False, "board limit reached for you for now", retry
            ok, retry = self.overall.allow("*", 0.0)
            if not ok:
                return False, "the shared board allowance on this server is used up; try again later", retry
            self._active.append(now)
        return True, "", 0.0

    def release(self) -> None:
        with self._lock:
            if self._active:
                self._active.pop(0)


def _visitor(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")) or "unknown"


def _err(code: str, message: str, status: int, headers: dict | None = None) -> JSONResponse:
    return JSONResponse({"ok": False, "error": {"code": code, "message": message}}, status_code=status, headers={**NO_STORE, **(headers or {})})


def make_router(generator: Callable[..., dict[str, Any]] = generate_in_sandbox, guard: Guard | None = None, cache_size: int = 8) -> APIRouter:
    router, guard = APIRouter(), guard or Guard()
    cache: "OrderedDict[str, dict[str, Any]]" = OrderedDict()
    lib = {}

    @router.get("/api/board/layout/status")
    def status():
        return JSONResponse({"ok": True, "configured": bool(os.environ.get("NEBIUS_API_KEY")), "max_seconds": SECONDS, "scope": "2-layer routed KiCad board for a design, made in a Sandbox; free (no model tokens), limited per visitor", "limits_scope": "in memory, per server instance"}, headers=NO_STORE)

    @router.post("/api/board/layout")
    async def layout(request: Request):
        raw = b""
        async for chunk in request.stream():
            raw += chunk
            if len(raw) > MAX_BODY:
                return _err("body_too_large", f"the body must be at most {MAX_BODY} bytes", 413)
        try:
            body = json.loads(raw.decode("utf-8") or "null")
        except (ValueError, UnicodeDecodeError):
            return _err("bad_json", "the body must be JSON", 400)
        if not isinstance(body, dict) or set(body) - {"design", "style", "constraints"}:
            return _err("bad_request", "the body must be {\"design\": ..., \"style\"?: \"default\"|\"smallest\"|\"emi\", \"constraints\"?: text}", 400)
        style = body.get("style", "default")
        if style not in P.STYLES:
            return _err("bad_style", f"style must be one of {sorted(P.STYLES)}", 422)
        ctext = body.get("constraints")
        if ctext is not None and (not isinstance(ctext, str) or len(ctext) > MAX_CHARS):
            return _err("bad_constraints", f"constraints must be text of at most {MAX_CHARS} characters", 422)
        cons = parse_constraints(ctext)
        try:
            design: Design = parse_design(body.get("design"))
        except InputError as e:
            return _err(e.code if hasattr(e, "code") else "bad_design", str(e), 422)
        if not lib:
            lib.update(load_library())
        key = canonical_netlist(design) + "|" + style + "|" + json.dumps(cons.as_dict(), sort_keys=True)
        hit = cache.get(key)
        if hit is not None:
            cache.move_to_end(key)

            def cached():
                yield json.dumps({"type": "progress", "message": "Found this board from a moment ago"}) + "\n"
                yield json.dumps({"type": "result", "cached": True, **hit}, separators=(",", ":")) + "\n"

            return StreamingResponse(cached(), media_type="application/x-ndjson", headers=NO_STORE)
        try:  # reject what cannot be placed before a Sandbox is started (this also finds a board size, so a too-small request fails here)
            P.build_and_place(design, lib, style=style, constraints=cons)
        except P.LayoutError as e:
            return _err("cannot_place", str(e), 422)
        visitor = _visitor(request)
        ok, reason, retry = guard.acquire(visitor)
        if not ok:
            return _err("rate_limited", reason, 429, {"Retry-After": str(int(retry) + 1)})
        q: "queue.Queue[dict | None]" = queue.Queue()

        def work() -> None:
            try:
                chk = None
                try:
                    chk = run_check(design.model_dump())
                except Exception:  # noqa: BLE001 - the markers are optional
                    chk = None
                res = generator(design, lib, check=chk, deadline=Deadline(SECONDS), progress=lambda m: q.put({"type": "progress", "message": m}), style=style, constraints=cons)
                cache[key] = res
                while len(cache) > cache_size:
                    cache.popitem(last=False)
                q.put({"type": "result", **res})
            except (LayoutSandboxError, P.LayoutError) as e:
                q.put({"type": "error", "code": "layout_failed", "message": str(e)})
            except Exception as e:  # noqa: BLE001 - never a bare disconnect
                q.put({"type": "error", "code": "internal", "message": f"{type(e).__name__}: {e}"[:300]})
            finally:
                q.put(None)

        threading.Thread(target=work, name="board-layout", daemon=True).start()

        def lines():
            t0 = time.monotonic()
            try:
                while True:
                    try:
                        ev = q.get(timeout=HEARTBEAT_S)
                    except queue.Empty:
                        if time.monotonic() - t0 > SECONDS + 20:
                            yield json.dumps({"type": "error", "code": "timeout", "message": "the board took longer than the cap"}) + "\n"
                            return
                        yield json.dumps({"type": "heartbeat", "seconds": round(time.monotonic() - t0)}) + "\n"
                        continue
                    if ev is None:
                        return
                    yield json.dumps(ev, separators=(",", ":"), default=str) + "\n"
            finally:
                guard.release()

        return StreamingResponse(lines(), media_type="application/x-ndjson", headers=NO_STORE)

    return router
