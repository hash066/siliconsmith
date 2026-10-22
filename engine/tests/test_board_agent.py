"""Board agent loop and runner, exercised with a scripted stand-in for the model. These tests prove the loop, the judging,
the event shapes and the artifacts; they say nothing about how well Nemotron designs boards (live runs do)."""

import hashlib
import json
from dataclasses import dataclass

import pytest

from siliconsmith.board.agent import Brief, DesignDraft, draft_from_design, library_brief, propose_design, repair_design
from siliconsmith.board.faults import FAULTS, STRUCTURAL_FAULTS, inject_fault, reference_design
from siliconsmith.board.parts import load_library
from siliconsmith.board.run import run_board, template_brief
from siliconsmith.events import EventBus
from siliconsmith.llm import LLMError

LIB = load_library()
BRIEF = Brief("battery environmental sensor", "ESP32 module, I2C sensor, LiPo + USB-C, 48 h target.",
              assumptions=dict(reference_design().assumptions))


@dataclass
class Reply:
    cost_usd: float = 0.0


class Scripted:
    """Returns the next scripted design (or raises) from `json`; records every prompt it was shown."""
    def __init__(self, *designs):
        self.queue = list(designs)
        self.calls: list[dict] = []
        self.spent_usd = 0.0
        self.tokens = 0

    def json(self, tier, role, messages, schema, *, think, node_id=None):
        self.calls.append({"tier": tier, "role": role, "messages": messages, "think": think, "node_id": node_id})
        self.spent_usd += 0.001
        self.tokens += 100
        item = self.queue.pop(0)
        if isinstance(item, Exception):
            raise item
        return item, Reply()


class Bus:
    def __init__(self):
        self.events = []
        self.closed = False

    def emit(self, type_, **fields):
        self.events.append({"type": type_, **fields})

    def close(self):
        self.closed = True

    def of(self, type_):
        return [e for e in self.events if e["type"] == type_]


def test_library_brief_lists_parts_and_pins_but_not_the_standard_rules():
    text = library_brief(LIB)
    assert "PART esp32" in text and "pin GPIO34 #6 input" in text and "input_only" in text
    assert "std_i2c" not in text and "NEBIUS" not in text


def test_first_try_pass_uses_ultra_architect():
    llm = Scripted(reference_design())
    r = propose_design(llm, BRIEF, LIB)
    assert r.passed and len(r.attempts) == 1 and r.error is None
    assert (llm.calls[0]["tier"], llm.calls[0]["role"], llm.calls[0]["node_id"]) == ("ultra", "architect", "n1")
    assert r.cost_usd > 0


def test_rejected_design_is_fed_back_and_repaired_by_super():
    llm = Scripted(inject_fault(reference_design(), "nonexistent_pin"), reference_design())
    r = propose_design(llm, BRIEF, LIB)
    assert r.passed and len(r.attempts) == 2 and not r.attempts[0].passed
    feedback = llm.calls[1]["messages"][-1]["content"]
    assert "B1 FAIL" in feedback and "GPIO99" in feedback and "part:esp32.pin_table" in feedback
    assert (llm.calls[1]["tier"], llm.calls[1]["role"], llm.calls[1]["node_id"]) == ("super", "repair", "n1.1")


def test_model_cannot_change_the_users_assumptions_to_pass_b5():
    cheat = reference_design()
    cheat.assumptions["battery_capacity_mah"] = 1_000_000
    cheat.assumptions["target_hours"] = 1
    assert propose_design(Scripted(cheat), BRIEF, LIB).design.assumptions == BRIEF.assumptions


def test_repair_limit_reports_honest_failure_with_the_last_design():
    bad = inject_fault(reference_design(), "two_output_drivers")
    r = propose_design(Scripted(bad, bad, bad), BRIEF, LIB, max_repairs=2)
    assert not r.passed and len(r.attempts) == 3 and "repair limit" in r.error
    assert r.final.results[0].status == "fail"


def test_llm_failure_is_reported_not_swallowed():
    bus = Bus()
    r = propose_design(Scripted(LLMError("model did not return valid JSON")), BRIEF, LIB, bus=bus)
    assert not r.passed and r.design is None and "LLMError" in r.error and r.attempts == []
    assert bus.of("log")[0]["level"] == "error"


def test_unknown_is_not_pass():
    r = propose_design(Scripted(reference_design()), Brief("x", "y", assumptions={}), LIB, max_repairs=0)
    assert not r.passed  # B3 and B5 are unknown without the user's assumptions


def test_repair_judges_before_calling_the_model_and_skips_it_when_clean():
    llm = Scripted()
    assert repair_design(llm, reference_design(), BRIEF, LIB).passed and llm.calls == []


def test_repair_each_fault_with_a_model_that_returns_the_clean_design():
    for f in FAULTS + STRUCTURAL_FAULTS:
        llm = Scripted(reference_design())
        r = repair_design(llm, inject_fault(reference_design(), f.id), BRIEF, LIB)
        assert r.passed and len(r.attempts) == 2 and llm.calls[0]["role"] == "repair", f.id
        assert not r.attempts[0].passed, f.id


def test_event_stream_follows_contract_v2_for_a_fault_repair():
    bus = Bus()
    repair_design(Scripted(reference_design()), inject_fault(reference_design(), "pin_mismatch"), BRIEF, LIB, bus=bus)
    types = [e["type"] for e in bus.events]
    assert types[0] == "node.created" and bus.events[0]["node_id"] == "root"
    created = {e["node_id"] for e in bus.of("node.created")}
    assert created == {"root", "n1", "n1.1"}
    for e in bus.of("node.stage"):  # nodes exist before their stages
        assert e["node_id"] in created and e["stage"] in ("implement", "B1", "B2", "B3", "B4", "B5")
    first = [e for e in bus.of("node.stage") if e["node_id"] == "n1" and e["stage"] == "B4" and e["status"] != "running"][0]
    assert first["status"] == "fail" and "part:esp32.gpio12" in first["evidence"] and first["label"] is None
    scored = bus.of("node.scored")
    assert scored[0]["ladder"]["B4"] == "fail" and scored[0]["feasible"] is False
    assert scored[1]["ladder"] == {r: "pass" for r in ("B1", "B2", "B3", "B4", "B5")}
    assert bus.of("node.pruned")[0]["node_id"] == "n1" and bus.of("node.expanded")[0]["children"] == ["n1.1"]
    passed = [e for e in bus.of("node.stage") if e["node_id"] == "n1.1" and e["status"] == "pass" and e["stage"] == "B4"][0]
    assert passed["label"] == "Firmware matches the netlist"


def test_unknown_rungs_are_reported_skipped_never_pass():
    bus = Bus()
    propose_design(Scripted(inject_fault(reference_design(), "nonexistent_pin")), BRIEF, LIB, max_repairs=0, bus=bus)
    ladder = bus.of("node.scored")[0]["ladder"]
    assert ladder["B1"] == "fail" and set(ladder[r] for r in ("B2", "B3", "B4", "B5")) == {"skipped"}


def test_run_board_writes_event_log_and_hashed_artifacts_for_a_passing_design(tmp_path):
    bus = EventBus("t1", tmp_path / "logs" / "t1.ndjson")
    llm = Scripted(reference_design())
    r = run_board(llm, bus, template_brief(), LIB, out_dir=tmp_path / "out")
    assert r.passed
    events = [json.loads(line) for line in (tmp_path / "logs" / "t1.ndjson").read_text(encoding="utf-8").splitlines()]
    assert [e["seq"] for e in events] == list(range(len(events)))
    started = events[0]
    assert started["type"] == "run.started" and started["domain"] == "board"
    assert [x["id"] for x in started["ladder"]] == ["B1", "B2", "B3", "B4", "B5"]
    assert events[-1]["type"] == "run.completed" and events[-1]["best_node_id"] == "n1"
    arts = [e for e in events if e["type"] == "artifact.created"]
    assert {a["kind"] for a in arts} == {"design", "kicad-netlist", "firmware-header", "bom"}
    for a in arts:
        assert hashlib.sha256((tmp_path / "out" / a["path"]).read_bytes()).hexdigest() == a["sha256"] and a["node_id"] == "n1"


def test_run_board_fault_repair_and_failure_paths(tmp_path):
    bus = Bus()
    r = run_board(Scripted(reference_design()), bus, template_brief(), LIB, mode="repair", fault_id="pin_mismatch",
                  out_dir=tmp_path)
    assert r.passed and bus.closed and "pin_mismatch" in bus.of("run.started")[0]["workload"]["title"]
    bus = Bus()
    bad = inject_fault(reference_design(), "two_output_drivers")
    r = run_board(Scripted(bad, bad, bad), bus, template_brief(), LIB, out_dir=tmp_path / "fail")
    assert not r.passed and bus.of("run.failed") and not bus.of("artifact.created") and not (tmp_path / "fail" / "netlist.net").exists()
    with pytest.raises(ValueError):
        run_board(Scripted(), Bus(), template_brief(), LIB, mode="repair", out_dir=tmp_path)


def test_draft_round_trips_to_the_same_netlist_and_a_pin_cannot_sit_on_two_nets():
    d = reference_design()
    back = draft_from_design(d).to_design()
    assert {n.name: sorted(n.pins) for n in back.nets} == {n.name: sorted(n.pins) for n in d.nets}
    assert propose_design(Scripted(DesignDraft.model_validate(draft_from_design(d).model_dump())), BRIEF, LIB).passed
    data = draft_from_design(d).model_dump()
    assert len(data["connections"]) == sum(len(n.pins) for n in d.nets)  # one record per pin, none lost


def test_model_json_with_connections_validates_without_a_name():
    raw = draft_from_design(reference_design()).model_dump(exclude={"name"})
    assert DesignDraft.model_validate(raw).to_design().name == ""
