"""Shared adapter for the hosted Board and Matter functions (Vercel Python runtime, BaseHTTPRequestHandler).

The engine package is copied to api/_vendor by scripts/vendor-engine.mjs. Nothing here calls a model: the hosted build
serves only deterministic endpoints. Agent `/run` routes are disabled unless the server env flag says otherwise
(Board only; Matter's run route needs Sandboxes and is never served here).
"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlsplit

_HERE = os.path.dirname(os.path.abspath(__file__))
for p in (_HERE, os.path.join(_HERE, "_vendor")):
    if p not in sys.path:
        sys.path.insert(0, p)

MAX_BODY = 70_000


def _send(h: BaseHTTPRequestHandler, status: int, headers: dict, text: str) -> None:
    payload = text.encode("utf-8")
    h.send_response(status)
    for k, v in headers.items():
        if v:
            h.send_header(k, v)
    h.send_header("Content-Length", str(len(payload)))
    h.end_headers()
    if h.command != "HEAD":
        h.wfile.write(payload)


def _err(h, status: int, code: str, message: str) -> None:
    _send(h, status, {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"},
          json.dumps({"ok": False, "error": {"code": code, "message": message, "errors": []}}))


def resolve_path(raw_path: str, prefix: str) -> str:
    """The route as the engine expects it ("/api/board/check"). A rewrite may pass it as `?route=check` instead."""
    parts = urlsplit(raw_path)
    route = parse_qs(parts.query).get("route", [None])[0]
    if route is not None:
        return f"{prefix}/{route.strip('/')}"
    return parts.path


def client_ip(h: BaseHTTPRequestHandler) -> str:
    fwd = h.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() if fwd else h.client_address[0]


def read_body(h: BaseHTTPRequestHandler) -> bytes | None:
    length = int(h.headers.get("content-length") or 0)
    if length > MAX_BODY:
        return None
    return h.rfile.read(length) if length else b""


def make_board_handler():
    from siliconsmith.board.serverless import handle_request

    run_enabled = os.environ.get("BOARD_RUN_ENABLED") == "1"

    class handler(BaseHTTPRequestHandler):  # noqa: N801 - the runtime looks for this exact name
        def _serve(self) -> None:
            path = resolve_path(self.path, "/api/board")
            if path.rstrip("/").endswith("/run") and not run_enabled:
                return _err(self, 404, "disabled", "The Board agent run endpoint is not enabled on this deployment. /check is free and deterministic.")
            body = read_body(self)
            if body is None:
                return _err(self, 413, "too_large", "request body is too large")
            status, headers, text = handle_request(self.command, path, body, dict(self.headers), client_ip(self))
            _send(self, status, headers, text)

        do_GET = do_POST = do_OPTIONS = _serve

        def log_message(self, format: str, *args) -> None:
            return

    return handler


def make_matter_handler():
    from siliconsmith.matter.api import handle_request

    class handler(BaseHTTPRequestHandler):  # noqa: N801
        def _serve(self) -> None:
            path = resolve_path(self.path, "/api/matter").rstrip("/")
            h = {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}
            if not path.endswith("/simulate"):
                return _err(self, 404, "disabled" if path.endswith("/run") else "not_found",
                            "Only POST /api/matter/simulate is served here. Agent runs need Sandboxes and are not enabled.")
            if self.command != "POST":
                return _err(self, 405, "method_not_allowed", "use POST")
            body = read_body(self)
            if body is None:
                return _err(self, 413, "too_large", "request body is too large")
            status, payload = handle_request("POST", path, body, client_ip(self))
            _send(self, status, h, json.dumps(payload))

        do_GET = do_POST = do_OPTIONS = _serve

        def log_message(self, format: str, *args) -> None:
            return

    return handler
