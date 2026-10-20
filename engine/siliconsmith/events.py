"""Event bus implementing docs/contracts/events.md: NDJSON on disk + live subscribers (SSE)."""

from __future__ import annotations

import json
import queue
import threading
import time
from pathlib import Path
from typing import Any


class EventBus:
    def __init__(self, run_id: str, path: Path):
        self.run_id = run_id
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._fh = self.path.open("w", encoding="utf-8", newline="\n")
        self._lock = threading.Lock()
        self._seq = 0
        self._t0 = time.monotonic()
        self._subs: list[queue.Queue] = []
        self.closed = False

    def emit(self, type_: str, **fields: Any) -> dict:
        with self._lock:
            ev = {"v": 1, "seq": self._seq, "t": int((time.monotonic() - self._t0) * 1000),
                  "run_id": self.run_id, "type": type_, **fields}
            self._seq += 1
            line = json.dumps(ev, separators=(",", ":"), default=str)
            self._fh.write(line + "\n")
            self._fh.flush()
            for q in list(self._subs):
                q.put(line)
        return ev

    def log(self, msg: str, level: str = "info", node_id: str | None = None) -> None:
        extra = {"node_id": node_id} if node_id else {}
        self.emit("log", level=level, msg=msg, **extra)

    def subscribe(self) -> queue.Queue:
        """Replays everything emitted so far, then streams live lines; None marks the end."""
        q: queue.Queue = queue.Queue()
        with self._lock:
            self._fh.flush()
            for line in self.path.read_text(encoding="utf-8").splitlines():
                q.put(line)
            if self.closed:
                q.put(None)
            else:
                self._subs.append(q)
        return q

    def close(self) -> None:
        with self._lock:
            self.closed = True
            self._fh.close()
            for q in self._subs:
                q.put(None)
            self._subs.clear()
