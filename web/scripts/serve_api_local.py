"""Serve the hosted Board and Matter functions on a plain local HTTP server (no Vercel login needed).

    python scripts/serve_api_local.py [port]      # default 8765; needs api/_vendor (npm run prebuild)

It mounts the very same `handler` classes Vercel runs (api/board.py, api/matter.py), routing by path prefix.
"""
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api")
sys.path.insert(0, API)
import board as board_fn  # noqa: E402
import matter as matter_fn  # noqa: E402


class Router(BaseHTTPRequestHandler):
    def _route(self):
        target = board_fn.handler if self.path.startswith("/api/board") else matter_fn.handler if self.path.startswith("/api/matter") else None
        if target is None:
            self.send_error(404)
            return
        # run the function's own handler logic on this connection
        getattr(target, "_serve")(self)

    do_GET = do_POST = do_OPTIONS = _route

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    ThreadingHTTPServer(("127.0.0.1", port), Router).serve_forever()
