"""HTTP surface for Matter: a framework-free handler plus a FastAPI router the engine API can mount.

    POST /api/matter/simulate   deterministic, no LLM          (30 calls / minute / client, in-memory limiter)
    POST /api/matter/run        the Nemotron agent, hard-capped (2 calls / hour / client, in-memory limiter)

`handle_request(method, path, body, client_key)` returns (status, json_dict) and is what a Vercel Python function
calls (see HOSTING.md). Limits are in-memory per process: a courtesy, not a global guarantee.
"""

from __future__ import annotations

import json

from . import limits as lim
from . import serverless

SIM_LIMITER = lim.RateLimiter(30, 60.0)
RUN_LIMITER = lim.RateLimiter(2, 3600.0)
DEFAULT_RUN_BUDGET_USD = 0.30
DEFAULT_RUN_SECONDS = 200.0


def _body(raw: bytes | str | None) -> dict:
    if not raw:
        return {}
    lim.check_size(raw)
    try:
        v = json.loads(raw)
    except json.JSONDecodeError as e:
        raise lim.InputError("request", f"body is not valid JSON ({e.msg} at char {e.pos})") from e
    if not isinstance(v, dict):
        raise lim.InputError("request", "body must be a JSON object")
    return v


def handle_request(method: str, path: str, body: bytes | str | None, client_key: str = "anon",
                   *, runner=None, llm=None, allow_local_runner: bool = False) -> tuple[int, dict]:
    path = path.rstrip("/")
    try:
        if method != "POST":
            return 405, {"ok": False, "error": {"field": "method", "message": "use POST"}}
        if path.endswith("/simulate"):
            ok, wait = SIM_LIMITER.allow(client_key)
            if not ok:
                return 429, {"ok": False, "error": {"field": "rate_limit", "message": f"too many simulations; retry in {wait:.0f}s"}}
            return 200, serverless.simulate(_body(body))
        if path.endswith("/run"):
            b = _body(body)
            ok, wait = RUN_LIMITER.allow(client_key)
            if not ok:
                return 429, {"ok": False, "error": {"field": "rate_limit", "message": f"agent runs are limited; retry in {wait / 60:.0f} min"}}
            extra = sorted(set(b) - {"spec", "budget_usd", "max_seconds"})
            if extra:
                raise lim.InputError("request", f"unknown field(s) {extra}; allowed: spec, budget_usd, max_seconds")
            out = serverless.run_agent(b.get("spec"), b.get("budget_usd", DEFAULT_RUN_BUDGET_USD),
                                       b.get("max_seconds", DEFAULT_RUN_SECONDS), runner=runner, llm=llm,
                                       allow_local_runner=allow_local_runner)
            return 200, out
        return 404, {"ok": False, "error": {"field": "path", "message": "use /api/matter/simulate or /api/matter/run"}}
    except lim.InputError as e:
        return 422, {"ok": False, "error": e.as_dict()}


def make_router():
    """FastAPI router; imported lazily so the serverless entrypoints stay light."""
    from fastapi import APIRouter, Request
    from fastapi.responses import JSONResponse

    router = APIRouter(prefix="/api/matter", tags=["matter"])

    async def _go(request: Request, path: str):
        raw = await request.body()
        client = request.client.host if request.client else "anon"
        status, payload = handle_request("POST", path, raw, client)
        return JSONResponse(payload, status_code=status)

    @router.post("/simulate")
    async def simulate(request: Request):
        return await _go(request, "/simulate")

    @router.post("/run")
    async def run(request: Request):
        return await _go(request, "/run")

    return router
