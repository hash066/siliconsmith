"""Hosted Board entry points: check, explain_failure, run_agent, the HTTP contract, limits, templates and schema."""

import json
import threading
import urllib.error
import urllib.request
from dataclasses import dataclass
from http.server import HTTPServer

import pytest

from siliconsmith.board import limits, serverless
from siliconsmith.board.agent import DesignDraft, draft_from_design
from siliconsmith.board.faults import FAULTS, STRUCTURAL_FAULTS, inject_fault, reference_design
from siliconsmith.board.limits import InputError, RateLimiter, parse_design
from siliconsmith.board.netlist import dump_design
from siliconsmith.board.templates import SPECS, TEMPLATES_DIR, design_schema, template_files
from siliconsmith.board.vercel_handler import handler

RUNGS = ("B1", "B2", "B3", "B4", "B5")


def clean() -> dict:
    return json.loads(dump_design(reference_design()))


# ---- templates and schema files ------------------------------------------------------------------------------

def test_committed_template_and_schema_files_match_their_generators():
    for path, text in template_files().items():
        assert path.read_text(encoding="utf-8") == text, f"{path.name} is stale: run python -m siliconsmith.board.templates --write"


def test_three_templates_exist_and_expectations_are_what_the_checker_says():
    tpls = {s["id"]: json.loads((TEMPLATES_DIR / f"{s['id']}.json").read_text(encoding="utf-8")) for s in SPECS}
    assert set(tpls) == {"clean_sensor", "fault_gpio12_vs_gpio14", "fault_strapping_pin"}
    for t in tpls.values():
        res = serverless.check(t["design"], t["header"])
        assert res["ok"] and {r["rung"]: r["status"] for r in res["rungs"]} == t["expect"]
    assert tpls["clean_sensor"]["expect"] == {r: "pass" for r in RUNGS}
    assert tpls["fault_gpio12_vs_gpio14"]["expect"]["B4"] == "fail"
    assert tpls["fault_strapping_pin"]["expect"]["B4"] == "fail"


def test_schema_documents_the_limits_and_accepted_assumptions():
    s = design_schema()
    assert s["x-limits"]["max_instances"] == limits.MAX_INSTANCES and s["x-rungs"] == list(RUNGS)
    assert "i2c_cb_pf" in s["x-assumptions"] and s["x-assumptions"]["i2c_mode"] == {"enum": ["standard", "fast"]}
    assert "instances" in s["properties"] and "nets" in s["properties"]


# ---- check ---------------------------------------------------------------------------------------------------------

def test_check_clean_design_passes_every_rung_and_returns_labels_and_evidence():
    r = serverless.check(clean())
    assert r["ok"] and r["passed"]
    assert r["labels"] == ["Netlist is well formed", "Electrical limits respected (curated facts)",
                           "Bus and connector rules satisfied (curated facts)", "Firmware matches the netlist",
                           "Battery estimate meets target (model, not measured)"]
    assert r["evidence"] and all(v and v["source"] and "citation_checked" in v for v in r["evidence"].values())
    assert "author-curated" in r["notice"]


def test_check_accepts_json_text_and_edits_show_which_rung_fails():
    d = clean()
    next(i for i in d["instances"] if i["ref"] == "R1")["params"]["ohms"] = 100000
    r = serverless.check(json.dumps(d))
    st = {x["rung"]: x["status"] for x in r["rungs"]}
    assert not r["passed"] and st["B3"] == "fail" and st["B1"] == st["B2"] == st["B4"] == st["B5"] == "pass"
    assert len(r["labels"]) == 4 and "Bus and connector rules satisfied (curated facts)" not in r["labels"]
    b3 = next(x for x in r["rungs"] if x["rung"] == "B3")
    assert b3["label"] is None and "rise time" in b3["detail"]


def test_check_judges_a_visitor_supplied_header_text():
    header = serverless.check(clean())["header"]
    bad = header.replace("SS_PIN_WAKE_BTN 14", "SS_PIN_WAKE_BTN 12")
    r = serverless.check(clean(), bad)
    assert next(x for x in r["rungs"] if x["rung"] == "B4")["status"] == "fail"
    assert serverless.check(clean(), "int main(void) {}")["rungs"][3]["status"] == "fail"


def test_check_labels_only_on_pass_for_every_fault():
    for f in FAULTS + STRUCTURAL_FAULTS:
        r = serverless.check(json.loads(dump_design(inject_fault(reference_design(), f.id))))
        assert r["ok"] and not r["passed"], f.id
        for x in r["rungs"]:
            assert (x["label"] is not None) == (x["status"] == "pass")
            assert x["status"] != "pass" or x["label"] in r["labels"]
        assert len(r["labels"]) == sum(x["status"] == "pass" for x in r["rungs"])


# ---- input validation -------------------------------------------------------------------------------------------

def test_malformed_json_gets_a_line_and_column():
    r = serverless.check('{"name": "x",\n "instances": [,]}')
    assert not r["ok"] and r["error"]["code"] == "bad_json" and "line 2" in r["error"]["message"]


def test_oversized_design_is_rejected_before_parsing():
    r = serverless.check(" " * (limits.MAX_BODY_BYTES + 1) + "{}")
    assert r["error"]["code"] == "too_large"


def test_schema_errors_name_the_field():
    d = clean()
    d["instances"][0]["part"] = 7
    r = serverless.check(d)
    assert r["error"]["code"] == "bad_design"
    assert any(e["path"].startswith("instances.0.part") for e in r["error"]["errors"])
    assert serverless.check([1, 2])["error"]["code"] == "bad_design"


def test_count_and_string_limits_are_enforced_with_paths():
    d = clean()
    d["instances"] = [{"ref": f"R{i}", "part": "res"} for i in range(limits.MAX_INSTANCES + 1)]
    r = serverless.check(d)
    assert r["error"]["code"] == "limits_exceeded" and r["error"]["errors"][0]["path"] == "instances"
    d = clean()
    d["nets"][0]["name"] = "N" * (limits.MAX_STRING + 1)
    assert serverless.check(d)["error"]["errors"][0]["path"] == "nets[0].name"
    d = clean()
    d["nets"][0]["pins"] = [f"R{i}.1" for i in range(limits.MAX_PINS_PER_NET + 1)]
    assert serverless.check(d)["error"]["errors"][0]["path"] == "nets[0].pins"


def test_assumptions_are_range_checked_and_unknown_keys_rejected():
    for key, val in (("i2c_cb_pf", -5), ("i2c_mode", "turbo"), ("battery_usable_fraction", 2), ("nope", 1), ("target_hours", "48")):
        d = clean()
        d["assumptions"][key] = val
        r = serverless.check(d)
        assert r["error"]["code"] == "bad_assumptions" and key in r["error"]["errors"][0]["path"], key
    d = clean()
    d["assumptions"]["i2c_cb_pf"] = 150
    assert serverless.check(d)["ok"]


def test_header_must_be_text_within_the_limit():
    assert serverless.check(clean(), 5)["error"]["code"] == "bad_header"
    assert serverless.check(clean(), "x" * (limits.MAX_HEADER_BYTES + 1))["error"]["code"] == "too_large"


# ---- explain_failure ----------------------------------------------------------------------------------------------

def test_explain_failure_gives_rule_problems_hints_and_provenance():
    r = serverless.check(json.loads(dump_design(inject_fault(reference_design(), "missing_cc_resistors"))))
    ex = serverless.explain_failure(r)
    assert ex["ok"] and not ex["all_passed"] and [f["rung"] for f in ex["failing"]] == ["B3"]
    f = ex["failing"][0]
    assert f["claim_if_passed"] == "Bus and connector rules satisfied (curated facts)" and "failed" in f["meaning"]
    assert any("CC1" in p["detail"] and "5.1 kohm" in p["hint"] for p in f["problems"])
    ev = next(e for e in f["evidence"] if e["id"] == "part:usbc.sink_rd_ohm")
    assert ev["citation_checked"] is False and ev["source"]


def test_explain_says_unknown_is_not_a_pass_and_accepts_a_rungs_list():
    d = clean()
    d["assumptions"].pop("i2c_cb_pf")
    r = serverless.check(d)
    ex = serverless.explain_failure(r["rungs"])
    assert any(f["status"] == "unknown" and "never a pass" in f["meaning"] for f in ex["failing"])
    assert serverless.explain_failure(serverless.check(clean()))["all_passed"]
    assert serverless.explain_failure({"rungs": "no"})["error"]["code"] == "bad_result"


# ---- rate limiter --------------------------------------------------------------------------------------------------

def test_rate_limiter_counts_per_visitor_and_window_and_budget():
    now = [0.0]
    rl = RateLimiter(2, 10, max_usd=0.10, clock=lambda: now[0])
    assert rl.allow("a", 0.04)[0] and rl.allow("a", 0.04)[0]
    ok, retry = rl.allow("a", 0.0)
    assert not ok and 0 < retry <= 10
    assert rl.allow("b", 0.04)[0]  # another visitor is unaffected
    now[0] = 11
    assert rl.allow("a", 0.04)[0]  # the window moved on
    rl.record("a", 0.09)
    ok, _ = rl.allow("a", 0.05)
    assert not ok  # 0.09 spent + 0.05 estimated > 0.10
    now[0] = 30
    assert rl.allow("a", 0.05)[0]


# ---- run_agent -----------------------------------------------------------------------------------------------------

@dataclass
class Reply:
    cost_usd: float = 0.0


class Scripted:
    def __init__(self, *designs, tokens=(1000, 500), cost=0.002):
        self.queue, self.calls, self.bus, self.spent_usd, self.tokens = list(designs), [], None, 0.0, 0
        self._tok, self._cost = tokens, cost

    def json(self, tier, role, messages, schema, *, think, node_id=None):
        self.calls.append((tier, role))
        item = self.queue.pop(0)
        if isinstance(item, Exception):
            raise item
        self.spent_usd += self._cost
        self.tokens += sum(self._tok)
        if self.bus is not None:
            self.bus.emit("llm.call", node_id=node_id, model={"ultra": "nemotron-ultra", "super": "nemotron-super"}[tier],
                          role=role, tokens_in=self._tok[0], tokens_out=self._tok[1], cost_usd=self._cost, latency_ms=5)
        return DesignDraft.model_validate(draft_from_design(item).model_dump()), Reply()


def test_run_agent_returns_events_artifacts_cost_and_a_run_id():
    bad = inject_fault(reference_design(), "nonexistent_pin")
    r = serverless.run_agent(llm=Scripted(bad, reference_design()))
    assert r["ok"] and r["passed"] and r["run_id"].startswith("board-")
    assert [e["seq"] for e in r["events"]] == list(range(len(r["events"])))
    assert r["events"][0]["type"] == "run.started" and r["events"][-1]["type"] == "run.completed"
    assert {a["kind"] for a in r["artifacts"]} == {"design", "kicad-netlist", "firmware-header", "bom"}
    import hashlib
    assert all(hashlib.sha256(a["content"].encode()).hexdigest() == a["sha256"] for a in r["artifacts"])
    c = r["cost"]
    assert set(c["per_model"]) == {"nemotron-ultra", "nemotron-super"} and c["total_usd"] == 0.004
    assert c["tokens_in"] == 2000 and c["tokens_out"] == 1000 and c["budget_usd"] == 0.05 and c["max_seconds"] == 120
    assert r["final"]["labels"] and [a["passed"] for a in r["attempts"]] == [False, True]


def test_run_agent_repairs_a_visitor_design_and_an_injected_fault():
    broken = json.loads(dump_design(inject_fault(reference_design(), "pin_mismatch")))
    llm = Scripted(reference_design())
    r = serverless.run_agent(design=broken, llm=llm)
    assert r["passed"] and llm.calls[0] == ("super", "repair") and len(r["attempts"]) == 2
    r = serverless.run_agent(fault_id="input_only_output", llm=Scripted(reference_design()))
    assert r["passed"] and "input_only_output" in r["events"][0]["workload"]["title"]


def test_run_agent_rejects_bad_caps_and_inputs_without_calling_a_model():
    llm = Scripted()
    for kw in ({"budget_usd": 0}, {"budget_usd": 5}, {"budget_usd": True}, {"max_seconds": 1}, {"max_seconds": 9999}):
        assert serverless.run_agent(llm=llm, **kw)["ok"] is False
    assert serverless.run_agent(fault_id="nope", llm=llm)["error"]["code"] == "bad_fault"
    assert serverless.run_agent(fault_id="pin_mismatch", design=clean(), llm=llm)["error"]["code"] == "bad_request"
    assert serverless.run_agent({"text": "x" * 5000}, llm=llm)["error"]["code"] == "too_large"
    assert serverless.run_agent({"assumptions": {"i2c_cb_pf": 99999}}, llm=llm)["error"]["code"] == "bad_assumptions"
    assert serverless.run_agent(design="{bad", llm=llm)["error"]["code"] == "bad_json"
    assert llm.calls == []


def test_run_agent_reports_a_model_failure_honestly_with_cost_so_far():
    r = serverless.run_agent(llm=Scripted(RuntimeError("upstream 500")))
    assert r["ok"] and not r["passed"] and "RuntimeError" in r["error"] and not r["artifacts"]
    assert r["events"][-1]["type"] == "run.failed"


def test_run_agent_without_a_key_is_a_clean_503(monkeypatch):
    import siliconsmith.config  # noqa: F401  (its first import loads .env.local: do that BEFORE removing the key)
    monkeypatch.delenv("NEBIUS_API_KEY", raising=False)
    r = serverless.run_agent()
    assert not r["ok"] and r["status"] == 503 and r["error"]["code"] == "model_unavailable"


def test_wall_time_cap_stops_new_model_calls():
    class FakeLLM:
        client = None

        def chat(self, *a, **k):
            return "reply"

    llm = FakeLLM()
    serverless._cap_wall_time(llm, serverless.time.monotonic() + 100)
    assert llm.chat() == "reply"
    serverless._cap_wall_time(llm, serverless.time.monotonic() - 1)
    with pytest.raises(TimeoutError):
        llm.chat()


def test_spend_cap_is_enforced_by_the_real_client_with_a_stub_transport():
    """Nemotron itself, with the network replaced: after one call over budget the next call is refused."""
    from siliconsmith.config import Settings
    from siliconsmith.llm import Nemotron

    bad = json.dumps(draft_from_design(inject_fault(reference_design(), "nonexistent_pin")).model_dump(mode="json"))

    class Msg:
        content, model_extra = bad, {}

    class Resp:
        choices = [type("C", (), {"message": Msg()})()]
        usage = type("U", (), {"prompt_tokens": 1000, "completion_tokens": 30000})()

    class Client:
        chat = type("Chat", (), {"completions": type("Comp", (), {"create": staticmethod(lambda **kw: Resp())})()})()

        def with_options(self, **kw):
            return self

    llm = Nemotron(Settings(api_key="stub", run_budget_usd=0.05))
    llm.client = Client()
    r = serverless.run_agent(llm=llm, budget_usd=0.05)
    assert r["ok"] and not r["passed"] and "BudgetExceeded" in r["error"]
    assert r["cost"]["total_usd"] > 0.05 and len(r["attempts"]) == 1  # exactly one call over, then refused
    assert r["cost"]["per_model"]["nemotron-ultra"]["calls"] == 1


# ---- HTTP contract ---------------------------------------------------------------------------------------------------

def call(method, path, body=None, ip="1.2.3.4"):
    raw = json.dumps(body).encode() if isinstance(body, (dict, list)) else body
    status, headers, text = serverless.handle_request(method, path, raw, {}, ip)
    return status, headers, (json.loads(text) if text else None)


def test_get_routes():
    s, _, b = call("GET", "/api/board/templates")
    assert s == 200 and [t["id"] for t in b["templates"]] == [x["id"] for x in SPECS]
    s, _, b = call("GET", "/api/board/templates/fault_gpio12_vs_gpio14")
    assert s == 200 and b["design"]["instances"] and "SS_PIN_WAKE_BTN 12" in b["header"]
    assert call("GET", "/api/board/templates/nope")[0] == 404
    s, _, b = call("GET", "/api/board/schema")
    assert s == 200 and "x-limits" in b
    s, _, b = call("GET", "/api/board/parts")
    assert s == 200 and {p["id"] for p in b["parts"]} >= {"esp32", "bme280", "mcp73831"}
    s, _, b = call("GET", "/api/board/faults")
    assert s == 200 and len(b["faults"]) == 8
    assert call("GET", "/api/board/nothing")[0] == 404 and call("GET", "/elsewhere")[0] == 404
    assert call("DELETE", "/api/board/check")[0] == 405


def test_post_check_statuses():
    s, h, b = call("POST", "/api/board/check", {"design": clean()})
    assert s == 200 and b["passed"] and h["Content-Type"].startswith("application/json") and h["Cache-Control"] == "no-store"
    assert call("POST", "/api/board/check", {"nodesign": 1})[0] == 400
    assert call("POST", "/api/board/check", b"{not json")[0] == 400
    s, _, b = call("POST", "/api/board/check", b" " * (limits.MAX_BODY_BYTES + 5))
    assert s == 413 and b["error"]["code"] == "too_large"
    bad = clean()
    bad["assumptions"]["i2c_mode"] = "x"
    s, _, b = call("POST", "/api/board/check", {"design": bad})
    assert s == 400 and b["error"]["code"] == "bad_assumptions"
    d = clean()
    d["instances"] = [{"ref": f"R{i}", "part": "res"} for i in range(200)]
    assert call("POST", "/api/board/check", {"design": d})[0] == 413


def test_post_explain():
    broken = json.loads(dump_design(inject_fault(reference_design(), "overvoltage_3v3_pin")))
    s, _, b = call("POST", "/api/board/explain", {"design": broken})
    assert s == 200 and b["check"]["passed"] is False and b["failing"][0]["rung"] == "B2"
    assert any(e["id"] == "part:bme280.vdd" for e in b["failing"][0]["evidence"])


def test_check_rate_limit_returns_429_with_retry_after(monkeypatch):
    monkeypatch.setattr(serverless, "CHECK_LIMITER", RateLimiter(2, 60))
    for _ in range(2):
        assert call("POST", "/api/board/check", {"design": clean()}, ip="9.9.9.9")[0] == 200
    s, h, b = call("POST", "/api/board/check", {"design": clean()}, ip="9.9.9.9")
    assert s == 429 and b["error"]["code"] == "rate_limited" and int(h["Retry-After"]) >= 1
    assert call("POST", "/api/board/check", {"design": clean()}, ip="8.8.8.8")[0] == 200


def test_run_route_enforces_per_visitor_and_global_budgets_and_records_spend(monkeypatch):
    spent = {"usd": 0.03}
    monkeypatch.setattr(serverless, "RUN_LIMITER", RateLimiter(5, 3600, 0.05))
    monkeypatch.setattr(serverless, "GLOBAL_RUN_LIMITER", RateLimiter(5, 3600, 0.08))
    monkeypatch.setattr(serverless, "run_agent", lambda *a, **k: {"ok": True, "cost": {"total_usd": spent["usd"]}})
    assert call("POST", "/api/board/run", {}, ip="a")[0] == 200
    s, h, b = call("POST", "/api/board/run", {}, ip="a")  # 0.03 spent + 0.05 estimate > 0.05
    assert s == 429 and "Retry-After" in h
    assert call("POST", "/api/board/run", {}, ip="b")[0] == 200
    assert call("POST", "/api/board/run", {}, ip="c")[0] == 429  # global 0.06 spent + 0.05 > 0.08


def test_run_route_maps_agent_errors_to_status(monkeypatch):
    monkeypatch.setattr(serverless, "RUN_LIMITER", RateLimiter(50, 3600, 5))
    monkeypatch.setattr(serverless, "GLOBAL_RUN_LIMITER", RateLimiter(50, 3600, 5))
    s, _, b = call("POST", "/api/board/run", {"budget_usd": 9})
    assert s == 400 and b["error"]["code"] == "bad_budget"
    import siliconsmith.config  # noqa: F401  (its first import loads .env.local: do that BEFORE removing the key)
    monkeypatch.delenv("NEBIUS_API_KEY", raising=False)
    s, _, b = call("POST", "/api/board/run", {})
    assert s == 503 and b["error"]["code"] == "model_unavailable"


# ---- FastAPI router and Vercel handler ---------------------------------------------------------------------------------

def test_fastapi_router_serves_the_same_contract(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from siliconsmith.board.api import router

    app = FastAPI()
    app.include_router(router)
    c = TestClient(app)
    assert c.get("/api/board/templates").json()["ok"]
    r = c.post("/api/board/check", json={"design": clean()})
    assert r.status_code == 200 and r.json()["passed"]
    assert c.post("/api/board/check", content=b"{x").status_code == 400
    monkeypatch.setattr(serverless, "CHECK_LIMITER", RateLimiter(1, 60))
    assert c.post("/api/board/check", json={"design": clean()}).status_code == 200
    r = c.post("/api/board/check", json={"design": clean()})
    assert r.status_code == 429 and "retry-after" in r.headers


def test_vercel_handler_class_serves_requests_over_http():
    srv = HTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        base = f"http://127.0.0.1:{srv.server_port}"
        with urllib.request.urlopen(base + "/api/board/templates") as resp:
            assert resp.status == 200 and json.load(resp)["ok"]
        req = urllib.request.Request(base + "/api/board/check", data=json.dumps({"design": clean()}).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req) as resp:
            assert json.load(resp)["passed"]
        bad = urllib.request.Request(base + "/api/board/check", data=b"{x", method="POST")
        with pytest.raises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(bad)
        assert e.value.code == 400
    finally:
        srv.shutdown()


def test_parse_design_is_the_one_gate():
    assert parse_design(json.dumps(clean())).mcu_ref == "U1"
    with pytest.raises(InputError):
        parse_design("[]")
