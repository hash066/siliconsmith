"""Engine HTTP API: start a run, stream its events (SSE), list runs.

The web console reads the same event stream whether it comes from here (live) or from a replay file.
Guard rails for a public deployment (all env-configurable):
  * only whitelisted workloads can be run (no arbitrary code is accepted by this API);
  * search parameters are clamped to a server-side maximum;
  * a per-IP hourly run limit, one active run per server by default, and a daily spend cap
    (SS_DAILY_BUDGET_USD) tracked in a ledger file, so a public URL cannot drain the credits.

Run:  uvicorn siliconsmith.api:app --host 0.0.0.0 --port 8080
"""

from __future__ import annotations

import dataclasses
import json
import os
import re
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import paths
from .config import settings
from .search import Search, SearchConfig
from .tools.workload import Workload

RUN_ID = re.compile(r"^r_[A-Za-z0-9_]{1,48}$")
LEDGER = paths.ROOT / "runs" / "ledger.json"


def _env_f(name: str, default: float) -> float:
    return float(os.environ.get(name, default))


DAILY_BUDGET_USD = _env_f("SS_DAILY_BUDGET_USD", 3.0)
MAX_ACTIVE_RUNS = int(_env_f("SS_MAX_ACTIVE_RUNS", 1))
RUNS_PER_IP_HOUR = int(_env_f("SS_RUNS_PER_IP_HOUR", 3))
LIMITS = {"k": 6, "k_child": 4, "beam": 2, "depth": 2, "concurrency": 4, "area_budget": 10.0}


def workloads() -> dict[str, dict]:
    out = {}
    for d in sorted(paths.WORKLOADS.iterdir()):
        mf = d / "manifest.json"
        if mf.exists():
            m = json.loads(mf.read_text(encoding="utf-8"))
            out[d.name.split("_")[0]] = {"id": d.name.split("_")[0], "dir": d.name, "title": m.get("title", d.name),
                                         "source": m.get("source", {})}
    return out


class RunRequest(BaseModel):
    workload: str
    k: int = Field(6, ge=1)
    k_child: int = Field(4, ge=1)
    beam: int = Field(2, ge=1)
    depth: int = Field(2, ge=1)
    area_budget: float = Field(5.0, gt=0)
    polish: bool = True


class Ledger:
    """Spend per UTC day, persisted so a restart cannot reset the cap."""

    def __init__(self, path: Path):
        self.path, self._lock = path, threading.Lock()

    def _read(self) -> dict:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def spent_today(self) -> float:
        return float(self._read().get(time.strftime("%Y-%m-%d", time.gmtime()), 0.0))

    def add(self, usd: float) -> None:
        with self._lock:
            data = self._read()
            day = time.strftime("%Y-%m-%d", time.gmtime())
            data[day] = round(float(data.get(day, 0.0)) + usd, 6)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps(data), encoding="utf-8")


class Handle:
    def __init__(self, search: Search, workload: str):
        self.search, self.workload = search, workload
        self.status = "running"
        self.error: str | None = None
        self.started = time.time()


class Server:
    def __init__(self) -> None:
        self.runs: dict[str, Handle] = {}
        self.ledger = Ledger(LEDGER)
        self._lock = threading.Lock()
        self._ip_hits: dict[str, deque] = defaultdict(deque)

    def active(self) -> int:
        return sum(1 for h in self.runs.values() if h.status == "running")

    def check_ip(self, ip: str) -> None:
        now, q = time.time(), self._ip_hits[ip]
        while q and now - q[0] > 3600:
            q.popleft()
        if len(q) >= RUNS_PER_IP_HOUR:
            raise HTTPException(429, f"limit of {RUNS_PER_IP_HOUR} runs per hour reached; watch a replay instead")
        q.append(now)

    def start(self, req: RunRequest, ip: str) -> Handle:
        wl = workloads().get(req.workload)
        if wl is None:
            raise HTTPException(404, f"unknown workload {req.workload!r}; available: {', '.join(workloads())}")
        for name, val in (("k", req.k), ("k_child", req.k_child), ("beam", req.beam), ("depth", req.depth),
                          ("area_budget", req.area_budget)):
            if val > LIMITS[name]:
                raise HTTPException(422, f"{name} is capped at {LIMITS[name]} on this server")
        with self._lock:
            remaining = DAILY_BUDGET_USD - self.ledger.spent_today()
            if remaining <= 0.05:
                raise HTTPException(503, "daily Nemotron budget is used up; watch a replay instead")
            if self.active() >= MAX_ACTIVE_RUNS:
                raise HTTPException(429, "a run is already in progress; watch it or try again shortly")
            self.check_ip(ip)
            s = settings()
            s = dataclasses.replace(s, run_budget_usd=min(s.run_budget_usd, remaining))
            cfg = SearchConfig(k_root=req.k, k_child=req.k_child, beam=req.beam, max_depth=req.depth,
                               area_budget_pct=req.area_budget, max_concurrency=LIMITS["concurrency"], polish=req.polish)
            search = Search(Workload.load(wl["dir"]), s, cfg, run_id=time.strftime("r_%Y%m%d_%H%M%S"))
            h = Handle(search, req.workload)
            self.runs[search.run_id] = h
        threading.Thread(target=self._run, args=(h,), daemon=True, name=search.run_id).start()
        return h

    def _run(self, h: Handle) -> None:
        try:
            h.search.run()
            h.status = "completed"
        except Exception as e:  # the failure is already in the event log (run.failed)
            h.status, h.error = "failed", f"{type(e).__name__}: {e}"[:300]
        finally:
            self.ledger.add(h.search.llm.spent_usd)


server = Server()
app = FastAPI(title="SiliconSmith engine", version="1.3")
app.add_middleware(CORSMiddleware, allow_origins=[o for o in os.environ.get("SS_CORS_ORIGINS", "").split(",") if o],
                   allow_methods=["GET", "POST"], allow_headers=["*"])


def _log_path(run_id: str) -> Path:
    if not RUN_ID.match(run_id):
        raise HTTPException(400, "bad run id")
    return paths.RUN_LOGS / f"{run_id}.ndjson"


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "active_runs": server.active(), "spent_today_usd": round(server.ledger.spent_today(), 4),
            "daily_budget_usd": DAILY_BUDGET_USD, "backend": settings().backend}


@app.get("/api/workloads")
def list_workloads() -> list[dict]:
    return [{k: v for k, v in w.items() if k != "dir"} for w in workloads().values()]


@app.get("/api/runs")
def list_runs() -> list[dict]:
    out = []
    for p in sorted(paths.RUN_LOGS.glob("r_*.ndjson"), key=lambda p: p.stat().st_mtime, reverse=True)[:50]:
        h = server.runs.get(p.stem)
        out.append({"run_id": p.stem, "status": h.status if h else "finished", "live": bool(h and h.status == "running")})
    return out


@app.post("/api/runs", status_code=201)
def start_run(req: RunRequest, request: Request) -> dict:
    # X-Forwarded-For is client-controlled unless a trusted proxy sets it, so it is only read when asked for.
    peer = request.client.host if request.client else "?"
    ip = (request.headers.get("x-forwarded-for", peer).split(",")[-1].strip()
          if os.environ.get("SS_TRUST_PROXY") == "1" else peer)
    h = server.start(req, ip)
    return {"run_id": h.search.run_id, "events": f"/api/runs/{h.search.run_id}/events"}


@app.get("/api/runs/{run_id}/events")
def run_events(run_id: str) -> StreamingResponse:
    """SSE; each `data:` line is one contract event. Finished runs are streamed from their log."""
    path = _log_path(run_id)
    h = server.runs.get(run_id)

    def live():
        q = h.search.bus.subscribe()
        while True:
            line = q.get()
            if line is None:
                return
            yield f"data: {line}\n\n"

    def replay():
        for line in path.read_text(encoding="utf-8").splitlines():
            yield f"data: {line}\n\n"

    if h is None and not path.exists():
        raise HTTPException(404, "no such run")
    gen = live() if h is not None and h.status == "running" else replay()
    return StreamingResponse(gen, media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
