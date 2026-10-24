"""The Sandbox path for board layout: host orchestration, error handling and the HTTP endpoint. No KiCad needed: the Sandbox's
answer is replaced by the real files of a board the engine already made (web/public/boards/clean_sensor)."""

from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from siliconsmith.board.layout import http as H  # noqa: E402
from siliconsmith.board.layout import sandbox as S  # noqa: E402
from siliconsmith.board.layout.runner import run_pipeline  # noqa: E402,F401
from siliconsmith.board.netlist import load_design  # noqa: E402
from siliconsmith.board.serverless import library  # noqa: E402
from siliconsmith.board.templates import load_template  # noqa: E402
from siliconsmith.live.backend import SandboxCapReached  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
BOARD = ROOT / "web" / "public" / "boards" / "clean_sensor"
KEEP = ["board.json", "routed.kicad_pcb", "gerbers-and-drill.zip", "positions.csv", "bom.csv", "drc.txt", "all-layers.svg"]
LIB = library()
DESIGN = load_design(load_template("clean_sensor")["design"])


def canned_output() -> str:
    summary = json.loads((BOARD / "summary.json").read_text())
    rr = {"drc": summary["drc"], "counts": {"tracks": summary["stats"]["tracks"], "vias": summary["stats"]["vias"]}, "attempts": summary["stats"]["route_attempts"], "timings": {"total": 80.0}, "svgs": {"all-layers": "all-layers.svg"}}
    files = {n: base64.b64encode((BOARD / n).read_bytes()).decode() for n in KEEP}
    return "SS_PROGRESS Building the KiCad board\nnoise\nSS_LAYOUT " + json.dumps({"rr": rr, "files": files})


class FakeBackend:
    def __init__(self, out=None, exc=None):
        self.out, self.exc, self.files = out, exc, None

    def run_layout(self, files):
        self.files = files
        if self.exc:
            raise self.exc
        return self.out


def test_the_host_places_ships_the_job_and_builds_the_summary_from_what_comes_back():
    be = FakeBackend(canned_output())
    steps: list[str] = []
    res = S.generate_in_sandbox(DESIGN, LIB, backend=be, progress=steps.append)
    assert set(be.files) == {f"{S.DIR}/{n}" for n in ("job.json", "pcb_build.py", "runner.py", "sandbox_worker.py")}
    job = json.loads(be.files[f"{S.DIR}/job.json"])
    assert len(job["instances"]) == 21 and job["width"] > 0  # 15 parts plus 6 bypass capacitors
    s = res["summary"]
    assert s["stats"]["fully_routed"] is True and s["drc"]["errors"] == 0
    assert s["mcu_padmap"]["GPIO12"] == ["14"] and s["mcu_ref"] == "U1"
    assert any("Sandbox" in m for m in steps)
    assert res["board"]["footprints"] and res["board"]["tracks"]
    assert [d["name"] for d in res["downloads"]] == ["gerbers-and-drill.zip", "routed.kicad_pcb", "positions.csv", "bom.csv", "all-layers.svg", "drc.txt"]
    assert base64.b64decode(res["downloads"][0]["base64"])[:2] == b"PK"


def test_every_way_the_sandbox_can_fail_is_one_clear_error():
    with pytest.raises(S.LayoutSandboxError, match="Freerouting did not write"):
        S.generate_in_sandbox(DESIGN, LIB, backend=FakeBackend('SS_LAYOUT_ERROR {"message": "RuntimeError: Freerouting did not write a routed session"}'))
    with pytest.raises(S.LayoutSandboxError, match="ended without a board"):
        S.generate_in_sandbox(DESIGN, LIB, backend=FakeBackend("just noise\n"))
    with pytest.raises(S.LayoutSandboxError, match="not enough time"):
        S.generate_in_sandbox(DESIGN, LIB, backend=FakeBackend(exc=SandboxCapReached("5 s left")))
    with pytest.raises(S.LayoutSandboxError, match="could not run"):
        S.generate_in_sandbox(DESIGN, LIB, backend=FakeBackend(exc=RuntimeError("boom with a secret-looking key sk-123")))


def test_the_worker_and_runner_are_standard_library_only():
    for f in ("sandbox_worker.py", "runner.py", "pcb_build.py"):
        src = (ROOT / "engine" / "siliconsmith" / "board" / "layout" / f).read_text(encoding="utf-8")
        imports = {ln.split()[1].split(".")[0] for ln in src.splitlines() if ln.startswith(("import ", "from ")) and not ln.startswith("from __future__")}
        assert imports <= {"base64", "csv", "io", "json", "math", "os", "re", "shutil", "subprocess", "sys", "time", "zipfile", "pathlib", "typing", "runner", "pcbnew"}, (f, imports)


# ----------------------------------------------------------------------------------------------------------------- HTTP


def client(generator, guard=None):
    app = FastAPI()
    app.include_router(H.make_router(generator=generator, guard=guard))
    return TestClient(app)


def fake_generator(calls):
    def gen(design, library, *, check=None, deadline=None, progress=None):
        calls.append(1)
        progress("Placing the parts")
        return {"summary": {"status": "ok"}, "board": {"width": 1}, "downloads": [], "seconds": 1.0}

    return gen


def events(r):
    return [json.loads(x) for x in r.text.splitlines() if x]


def test_endpoint_streams_progress_then_a_result_and_caches_by_netlist():
    calls: list[int] = []
    c = client(fake_generator(calls))
    body = {"design": DESIGN.model_dump()}
    ev = events(c.post("/api/board/layout", json=body))
    assert [e["type"] for e in ev] == ["progress", "result"] and ev[-1]["summary"]["status"] == "ok"
    ev2 = events(c.post("/api/board/layout", json=body))
    assert ev2[-1]["cached"] is True and len(calls) == 1
    # the firmware table does not change the board: a design differing only there is a cache hit too
    d2 = DESIGN.model_dump()
    d2["firmware_pins"] = []
    assert events(c.post("/api/board/layout", json={"design": d2}))[-1]["cached"] is True and len(calls) == 1


def test_endpoint_rejects_bad_input_before_starting_a_sandbox():
    calls: list[int] = []
    c = client(fake_generator(calls))
    assert c.post("/api/board/layout", content=b"not json").status_code == 400
    assert c.post("/api/board/layout", json={"design": DESIGN.model_dump(), "extra": 1}).status_code == 400
    assert c.post("/api/board/layout", json={"design": {"instances": 5}}).status_code == 422
    assert c.post("/api/board/layout", content=b"x" * (H.MAX_BODY + 10)).status_code == 413
    d = DESIGN.model_dump()
    d["instances"].append({"ref": "X9", "part": "load", "params": {}})
    r = c.post("/api/board/layout", json={"design": d})
    assert r.status_code == 422 and "footprint" in r.json()["error"]["message"]
    assert calls == []


def test_endpoint_limits_and_reports_a_failed_layout():
    g = H.Guard()
    g.max_active = 0
    r = client(fake_generator([]), g).post("/api/board/layout", json={"design": DESIGN.model_dump()})
    assert r.status_code == 429 and r.headers["retry-after"]

    def failing(design, library, **kw):
        raise S.LayoutSandboxError("the Sandbox could not run the layout (ForbiddenError)")

    ev = events(client(failing).post("/api/board/layout", json={"design": DESIGN.model_dump()}))
    assert ev[-1]["type"] == "error" and "ForbiddenError" in ev[-1]["message"]


def test_status_is_free_and_says_what_it_does():
    j = client(fake_generator([])).get("/api/board/layout/status").json()
    assert j["ok"] is True and "Sandbox" in j["scope"]
