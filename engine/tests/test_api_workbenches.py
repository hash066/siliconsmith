"""The engine API mounts the Board and Matter workbenches; only the free, deterministic endpoints are called here."""
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")
from fastapi.testclient import TestClient  # noqa: E402

from siliconsmith import api  # noqa: E402


def client():
    return TestClient(api.app)


def test_board_templates_and_check_are_mounted():
    c = client()
    t = c.get("/api/board/templates")
    assert t.status_code == 200
    ids = {x["id"] for x in t.json()["templates"]} if isinstance(t.json(), dict) else {x["id"] for x in t.json()}
    assert {"clean_sensor", "fault_gpio12_vs_gpio14", "fault_strapping_pin"} <= ids
    one = c.get("/api/board/templates/clean_sensor").json()
    r = c.post("/api/board/check", json={"design": one["design"]})
    assert r.status_code == 200 and r.json()["ok"] is True


def test_board_rejects_a_malformed_design_with_a_precise_error():
    r = client().post("/api/board/check", json={"design": "{not json"})
    assert r.status_code in (400, 422) and r.json()["ok"] is False


def test_matter_simulate_is_mounted_and_validates_input():
    pytest.importorskip("scipy")
    c = client()
    ok = c.post("/api/matter/simulate", json={})
    assert ok.status_code == 200 and ok.json()["ok"] is True
    bad = c.post("/api/matter/simulate", json={"spreader": {"Q": -5}})
    assert bad.status_code == 422 and bad.json()["ok"] is False


def test_silicon_api_still_works_beside_the_workbenches():
    assert client().get("/api/health").json()["ok"] is True
