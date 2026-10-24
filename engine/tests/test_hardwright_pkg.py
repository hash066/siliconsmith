"""The public `hardwright` package: Python API, CLI and MCP server. Offline and deterministic."""

from __future__ import annotations

import io
import json

import pytest

import hardwright as hw
from hardwright import cli, mcp

FAULT = "fault_gpio12_vs_gpio14"


def test_clean_example_passes_all_five():
    r = hw.board_check(template="clean_sensor")
    assert r["passed"] is True
    assert [c["id"] for c in r["checks"]] == ["B1", "B2", "B3", "B4", "B5"]
    assert all(c["status"] == "pass" and c["claim"] for c in r["checks"])


def test_fault_example_fails_b4_and_unknown_is_never_a_pass():
    r = hw.board_check(template=FAULT)
    assert r["passed"] is False
    failed = [c for c in r["checks"] if c["status"] != "pass"]
    assert [c["id"] for c in failed] == ["B4"]
    assert failed[0]["claim"] is None and failed[0]["evidence"]


def test_fix_pin_repairs_the_fault_and_reports_the_change():
    r = hw.board_fix_pin(template=FAULT, function="wake_btn", pin="GPIO14")
    assert r["passed"] is True
    assert r["changed"] == {"function": "wake_btn", "from": "GPIO12", "to": "GPIO14"}


def test_fix_pin_rejects_unknown_function_and_does_not_mutate_the_template():
    with pytest.raises(hw.HardwrightError, match="no function"):
        hw.board_fix_pin(template=FAULT, function="nope", pin="GPIO14")
    assert hw.board_check(template=FAULT)["passed"] is False


def test_bad_input_is_an_error_with_a_fix_not_a_crash():
    with pytest.raises(hw.HardwrightError, match="available"):
        hw.board_check(template="nope")
    with pytest.raises(hw.HardwrightError, match="not valid JSON"):
        hw.board_check("{not json")
    with pytest.raises(hw.HardwrightError):
        hw.board_check()
    with pytest.raises(hw.HardwrightError):
        hw.board_check({"name": "empty"})


def test_design_from_a_file_path(tmp_path):
    p = tmp_path / "d.json"
    p.write_text(json.dumps(hw.board_template(FAULT)), encoding="utf-8")
    assert hw.board_check(str(p))["passed"] is False


def test_templates_parts_and_faults_are_listed():
    assert {t["id"] for t in hw.board_templates()} >= {"clean_sensor", FAULT}
    assert hw.board_parts()
    assert len(hw.board_faults()) == 8


def test_matter_simulate_returns_a_checked_result_and_writes_an_stl(tmp_path):
    out = tmp_path / "part.stl"
    r = hw.matter_simulate(power_w=5, gen_params={"n_fins": 6, "fin_len": 12}, stl_path=out)
    if r["solved"]:
        assert 25 < r["peak_c"] < 1000
        assert out.read_bytes()[:5] != b"" and r["stl_bytes"] == out.stat().st_size
    assert [c["id"] for c in r["checks"]] == ["M1", "M2", "M3", "M4", "M5"]
    with pytest.raises(hw.HardwrightError):
        hw.matter_simulate(power_w=-1)
    with pytest.raises(hw.HardwrightError):
        hw.matter_simulate(generator="nope")


def test_cli_exit_codes(capsys, tmp_path):
    assert cli.main(["board", "check", "--template", "clean_sensor"]) == 0
    assert cli.main(["board", "check", "--template", FAULT]) == 1
    assert cli.main(["board", "check", "--template", "nope"]) == 2
    assert cli.main(["board", "fix-pin", "--template", FAULT, "wake_btn", "GPIO14"]) == 0
    capsys.readouterr()
    assert cli.main(["board", "check", "--template", FAULT, "--json"]) == 1
    out = json.loads(capsys.readouterr().out)
    assert out["passed"] is False and out["checks"][3]["id"] == "B4"
    assert cli.main(["board", "templates"]) == 0
    assert cli.main(["matter", "simulate", "--power", "5", "--stl", str(tmp_path / "x.stl")]) in (0, 1)
    assert cli.main(["matter", "simulate", "--param", "bad"]) == 2


def rpc(method, params=None, mid=1):
    return {"jsonrpc": "2.0", "id": mid, "method": method, **({"params": params} if params is not None else {})}


def test_mcp_handshake_lists_tools_and_ignores_notifications():
    r = mcp.handle(rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}))
    assert r["result"]["protocolVersion"] == "2025-06-18"
    assert r["result"]["serverInfo"]["name"] == "hardwright"
    assert "tools" in r["result"]["capabilities"]
    assert mcp.handle({"jsonrpc": "2.0", "method": "notifications/initialized"}) is None
    tools = mcp.handle(rpc("tools/list"))["result"]["tools"]
    names = {t["name"] for t in tools}
    assert {"board_check", "board_fix_pin", "matter_simulate", "board_templates"} <= names
    assert all(t["inputSchema"]["type"] == "object" and t["description"] for t in tools)
    assert mcp.handle(rpc("ping"))["result"] == {}
    assert mcp.handle(rpc("nope"))["error"]["code"] == -32601
    # an unknown protocol version gets one we speak
    assert mcp.handle(rpc("initialize", {"protocolVersion": "1999-01-01"}))["result"]["protocolVersion"] in mcp.PROTOCOL_VERSIONS


def call(name, args):
    return mcp.handle(rpc("tools/call", {"name": name, "arguments": args}))


def test_mcp_board_check_reports_the_failure_in_plain_text_and_structure():
    res = call("board_check", {"template_id": FAULT})["result"]
    assert res["isError"] is False
    text = res["content"][0]["text"]
    assert "NOT ALL PASS" in text and "B4 FAIL" in text
    assert res["structuredContent"]["passed"] is False


def test_mcp_fix_pin_and_errors():
    ok = call("board_fix_pin", {"template_id": FAULT, "function": "wake_btn", "pin": "GPIO14"})["result"]
    assert ok["isError"] is False and "ALL 5 PASS" in ok["content"][0]["text"]
    bad = call("board_check", {"template_id": "nope"})["result"]
    assert bad["isError"] is True and "Not done" in bad["content"][0]["text"]
    assert call("no_such_tool", {})["error"]["code"] == -32602
    assert call("board_check", {"design": 5})["result"]["isError"] is True


def test_mcp_matter_refuses_unsafe_stl_paths(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    for p in ("/etc/x.stl", "../x.stl", "x.txt"):
        assert call("matter_simulate", {"power_w": 5, "stl_path": p})["result"]["isError"] is True
    ok = call("matter_simulate", {"power_w": 5, "stl_path": "part.stl"})["result"]
    assert ok["isError"] is False and "Peak" in ok["content"][0]["text"] or "Nothing was solved" in ok["content"][0]["text"]


def test_mcp_stdio_loop_round_trips_and_survives_garbage():
    lines = [json.dumps(rpc("initialize", {"protocolVersion": "2025-06-18"}, 1)), "not json", json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}), json.dumps(rpc("tools/list", None, 2)), ""]
    out = io.StringIO()
    mcp.serve(io.StringIO("\n".join(lines) + "\n"), out)
    replies = [json.loads(x) for x in out.getvalue().splitlines()]
    assert [r.get("id") for r in replies] == [1, None, 2]
    assert replies[1]["error"]["code"] == -32700
    assert len(replies[2]["result"]["tools"]) >= 5


def test_parts_list_carries_the_datasheet_sources_recorded_in_the_library():
    parts = {p["id"]: p for p in hw.board_parts()}
    assert parts["esp32"]["sources"] and all(u.startswith("http") for u in parts["esp32"]["sources"])
    assert "sources" in parts["res"] and isinstance(parts["res"]["sources"], list)
