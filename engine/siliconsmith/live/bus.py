"""In-memory event bus for one live run: the same envelope as events.EventBus, nothing written to disk
(the hosted filesystem is read-only), plus a queue the HTTP stream drains and a secret scrubber."""

from __future__ import annotations

import json
import queue
import threading
import time
from typing import Any


class LiveBus:
    def __init__(self, run_id: str, secrets: tuple[str, ...] = ()):
        self.run_id = run_id
        self.events: list[dict] = []
        self.queue: queue.Queue = queue.Queue()
        self.closed = False
        # while set (ms since run start), events are stamped with it instead of "now": the backend uses this to replay
        # the stage lines of a finished Sandbox run at the offsets they really happened inside it
        self.stage_clock: int | None = None
        self._secrets = tuple(s for s in secrets if s and len(s) >= 6)
        self._seq, self._t0, self._lock = 0, time.monotonic(), threading.Lock()

    def _scrub(self, ev: dict) -> dict:
        """Defence in depth: no event may carry a secret value, whatever put it there."""
        if not self._secrets:
            return ev
        text = json.dumps(ev, separators=(",", ":"), default=str)
        if not any(s in text for s in self._secrets):
            return ev
        for s in self._secrets:
            text = text.replace(s, "[redacted]")
        return json.loads(text)

    def elapsed_ms(self) -> int:
        return int((time.monotonic() - self._t0) * 1000)

    def emit(self, type_: str, **fields: Any) -> dict:
        with self._lock:
            if self.closed:
                return {}
            now = self.elapsed_ms()
            t = now
            if self.stage_clock is not None:  # never earlier than the previous event, never later than now
                t = max(self.events[-1]["t"] if self.events else 0, min(now, self.stage_clock))
            ev = self._scrub({"v": 1, "seq": self._seq, "t": t, "run_id": self.run_id, "type": type_, **fields})
            self._seq += 1
            self.events.append(ev)
            self.queue.put(ev)
        return ev

    def log(self, msg: str, level: str = "info", node_id: str | None = None) -> None:
        self.emit("log", level=level, msg=msg, **({"node_id": node_id} if node_id else {}))

    def close(self) -> None:
        with self._lock:
            if not self.closed:
                self.closed = True
                self.queue.put(None)
