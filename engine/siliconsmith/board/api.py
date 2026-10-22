"""FastAPI router for the Board workbench; a thin shell over `serverless.handle_request` (the contract lives there).

Mount it in the engine API without editing it here:

    from siliconsmith.board.api import router
    app.include_router(router)

Routes: GET /api/board/{templates, templates/{id}, schema, parts, faults}; POST /api/board/{check, explain, run}.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response

from .serverless import handle_request

router = APIRouter(prefix="/api/board", tags=["board"])


def client_ip(request: Request) -> str:
    """Visitor key for rate limits: first X-Forwarded-For entry when a proxy sets it (spoofable), else the socket peer."""
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "anon"


async def _dispatch(request: Request) -> Response:
    body = await request.body()
    status, headers, text = await run_in_threadpool(
        handle_request, request.method, request.url.path, body, dict(request.headers), client_ip(request))
    headers = {k: v for k, v in headers.items() if k.lower() != "content-length"}
    return Response(content=text, status_code=status, headers=headers)


for _path, _methods in (("/templates", ["GET"]), ("/templates/{template_id}", ["GET"]), ("/schema", ["GET"]),
                        ("/parts", ["GET"]), ("/faults", ["GET"]), ("/check", ["POST"]), ("/explain", ["POST"]),
                        ("/run", ["POST"])):
    router.add_api_route(_path, _dispatch, methods=_methods, include_in_schema=True)
