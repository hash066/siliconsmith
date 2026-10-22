"""Vercel Python function adapter: expose `handler` from a file under the web project's `api/` directory.

    # web/api/board.py  (or one file per route; see HOSTING.md)
    from siliconsmith.board.vercel_handler import handler   # noqa: F401

Vercel's Python runtime instantiates a `BaseHTTPRequestHandler` subclass named `handler`. This one forwards every
request to `serverless.handle_request`, so the hosted behaviour is identical to the FastAPI router. No ASGI needed.
"""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler

from .limits import MAX_BODY_BYTES
from .serverless import handle_request


class handler(BaseHTTPRequestHandler):  # noqa: N801 - the runtime looks for this exact name
    def _serve(self) -> None:
        length = int(self.headers.get("content-length") or 0)
        # read at most one byte past the limit so an oversized body is rejected without buffering all of it
        body = self.rfile.read(min(length, MAX_BODY_BYTES + 1)) if length else b""
        fwd = self.headers.get("x-forwarded-for", "")
        ip = fwd.split(",")[0].strip() if fwd else self.client_address[0]
        status, headers, text = handle_request(self.command, self.path, body, dict(self.headers), ip)
        payload = text.encode("utf-8")
        self.send_response(status)
        for k, v in headers.items():
            if v:
                self.send_header(k, v)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    do_GET = do_POST = do_OPTIONS = _serve

    def log_message(self, format: str, *args) -> None:  # keep request lines out of the platform log
        return
