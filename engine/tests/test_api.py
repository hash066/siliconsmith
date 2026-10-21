"""API guard rails: no LLM or toolchain is touched, runs are never actually started."""
import json

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")
from fastapi.testclient import TestClient  # noqa: E402

from siliconsmith import api, paths  # noqa: E402


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(api, "LEDGER", tmp_path / "ledger.json")
    monkeypatch.setattr(api, "server", api.Server())
    monkeypatch.setattr(paths, "RUN_LOGS", tmp_path / "logs")
    (tmp_path / "logs").mkdir()
    return TestClient(api.app), tmp_path


def test_health_and_workloads(client):
    c, _ = client
    assert c.get("/api/health").json()["ok"] is True
    ids = {w["id"] for w in c.get("/api/workloads").json()}
    assert {"w1", "w2"} <= ids


def test_unknown_workload_and_caps_are_rejected(client):
    c, _ = client
    assert c.post("/api/runs", json={"workload": "../etc"}).status_code == 404
    assert c.post("/api/runs", json={"workload": "w1", "k": 99}).status_code == 422
    assert c.post("/api/runs", json={"workload": "w1", "area_budget": 90}).status_code == 422


def test_daily_budget_blocks_new_runs(client, monkeypatch):
    c, tmp = client
    api.server.ledger.add(api.DAILY_BUDGET_USD)
    r = c.post("/api/runs", json={"workload": "w1"})
    assert r.status_code == 503 and "budget" in r.json()["detail"]


def test_finished_run_streams_from_its_log_and_ids_are_validated(client):
    c, tmp = client
    lines = [json.dumps({"v": 1, "seq": i, "t": i, "run_id": "r_x", "type": "log", "level": "info", "msg": "m"})
             for i in range(3)]
    (tmp / "logs" / "r_x.ndjson").write_text("\n".join(lines) + "\n", encoding="utf-8")
    body = c.get("/api/runs/r_x/events").text
    assert [json.loads(p[6:])["seq"] for p in body.strip().split("\n\n")] == [0, 1, 2]
    assert c.get("/api/runs/r_missing/events").status_code == 404
    assert c.get("/api/runs/..%2f..%2fsecret/events").status_code in (400, 404)
