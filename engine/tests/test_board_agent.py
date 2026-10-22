"""Board agent loop, exercised with a scripted stand-in for the model. These tests prove the loop and the judging;
they say nothing about how well Nemotron designs boards (that needs live runs against Nebius)."""

from dataclasses import dataclass

from siliconsmith.board.agent import Brief, library_brief, propose_design, repair_design
from siliconsmith.board.faults import FAULTS, STRUCTURAL_FAULTS, inject_fault, reference_design
from siliconsmith.board.parts import load_library
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

    def json(self, tier, role, messages, schema, *, think, node_id=None):
        self.calls.append({"tier": tier, "role": role, "messages": messages, "think": think})
        self.spent_usd += 0.001
        item = self.queue.pop(0)
        if isinstance(item, Exception):
            raise item
        return item, Reply()


def test_library_brief_lists_parts_and_pins_but_not_the_standard_rules():
    text = library_brief(LIB)
    assert "PART esp32" in text and "pin GPIO34 #6 input" in text and "input_only" in text
    assert "std_i2c" not in text and "NEBIUS" not in text


def test_first_try_pass():
    llm = Scripted(reference_design())
    r = propose_design(llm, BRIEF, LIB)
    assert r.passed and len(r.attempts) == 1 and r.error is None
    assert llm.calls[0]["role"] == "board.propose" and llm.calls[0]["think"] is True
    assert r.cost_usd > 0


def test_rejected_design_is_fed_back_with_rung_detail_and_evidence_then_repaired():
    llm = Scripted(inject_fault(reference_design(), "nonexistent_pin"), reference_design())
    r = propose_design(llm, BRIEF, LIB)
    assert r.passed and len(r.attempts) == 2
    assert not r.attempts[0].passed
    feedback = llm.calls[1]["messages"][-1]["content"]
    assert "B1 FAIL" in feedback and "GPIO99" in feedback and "part:esp32.pin_table" in feedback
    assert llm.calls[1]["think"] is False


def test_model_cannot_change_the_users_assumptions_to_pass_b5():
    cheat = reference_design()
    cheat.assumptions["battery_capacity_mah"] = 1_000_000
    cheat.assumptions["target_hours"] = 1
    r = propose_design(Scripted(cheat), BRIEF, LIB)
    assert r.design.assumptions == BRIEF.assumptions


def test_round_limit_reports_honest_failure_with_the_last_design():
    bad = inject_fault(reference_design(), "two_output_drivers")
    r = propose_design(Scripted(bad, bad, bad), BRIEF, LIB, max_rounds=3)
    assert not r.passed and len(r.attempts) == 3 and "round limit" in r.error
    assert r.design is not None and r.attempts[-1].results[0].status == "fail"


def test_llm_failure_is_reported_not_swallowed():
    r = propose_design(Scripted(LLMError("board.propose: model did not return valid JSON")), BRIEF, LIB)
    assert not r.passed and r.design is None and "LLMError" in r.error and r.attempts == []


def test_passing_design_never_counts_if_a_rung_is_not_pass():
    d = reference_design()
    d.assumptions.clear()  # B3 and B5 become unknown; _apply_brief restores the brief's assumptions
    assert propose_design(Scripted(d), BRIEF, LIB).passed
    r = propose_design(Scripted(d), Brief("x", "y", assumptions={}), LIB, max_rounds=1)
    assert not r.passed  # unknown is not pass


def test_repair_judges_before_calling_the_model_and_skips_it_when_clean():
    llm = Scripted()
    r = repair_design(llm, reference_design(), BRIEF, LIB)
    assert r.passed and llm.calls == []


def test_repair_each_fault_with_a_model_that_returns_the_clean_design():
    for f in FAULTS + STRUCTURAL_FAULTS:
        llm = Scripted(reference_design())
        r = repair_design(llm, inject_fault(reference_design(), f.id), BRIEF, LIB)
        assert r.passed, f.id
        assert len(r.attempts) == 2 and llm.calls[0]["role"] == "board.repair", f.id
        assert not r.attempts[0].passed, f.id


def test_events_report_each_attempt():
    seen = []
    llm = Scripted(reference_design())
    repair_design(llm, inject_fault(reference_design(), "pin_mismatch"), BRIEF, LIB,
                  on_event=lambda t, p: seen.append((t, p["round"], p["passed"], p["rungs"]["B4"])))
    assert seen == [("board.attempt", 1, False, "fail"), ("board.attempt", 2, True, "pass")]
