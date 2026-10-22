"""Matter agent loop driven by a SCRIPTED model (a test double, not Nemotron): the loop, the event contract
and the ladder verdicts are checked deterministically. The real-model run is a separate manual/eval step."""

import hashlib
import json
from types import SimpleNamespace

import pytest

pytest.importorskip("scipy")

from siliconsmith.events import EventBus  # noqa: E402
from siliconsmith.matter import reference_generators as ref  # noqa: E402
from siliconsmith.matter.agent import Ideas, MatterRun, extract_code, pareto_front, sample_params  # noqa: E402
from siliconsmith.matter.problem import Spreader  # noqa: E402

import numpy as np  # noqa: E402

FLAKY = ref.RECT_FINS["source"].replace("def generate", "def generate_old")  # no generate(): fails until repaired


class ScriptedLLM:
    spent_usd = 0.0
    tokens = 0

    def __init__(self, rounds):
        self.rounds, self.calls, self.repairs = rounds, 0, 0

    def json(self, tier, role, messages, schema, *, think, node_id=None, max_tokens=0, attempts=3):
        ideas = self.rounds[min(self.calls, len(self.rounds) - 1)]
        self.calls += 1
        return schema.model_validate({"ideas": ideas}), None

    def chat(self, tier, role, messages, *, think, max_tokens=0, temperature=0, node_id=None):
        text = messages[-1]["content"]
        src = {"rect_fins": ref.RECT_FINS["source"], "radial_spokes": ref.RADIAL_SPOKES["source"]}
        for name, code in src.items():
            if f"Idea: {name}" in text:
                return SimpleNamespace(content=f"```python{code}```")
        if "Idea: flaky" in text:
            if "failed with" in text:
                self.repairs += 1
                return SimpleNamespace(content=f"```python{ref.RECT_FINS['source']}```")
            return SimpleNamespace(content=f"```python{FLAKY}```")
        return SimpleNamespace(content="```python\nimport os\ndef generate(params, n, chip):\n    return None\n```")


def idea(name, space):
    return {"name": name, "title": name, "rationale": "scripted", "param_space": space}


def test_loop_events_and_verdicts(tmp_path):
    rounds = [[idea("rect_fins", ref.RECT_FINS["param_space"]), idea("radial_spokes", ref.RADIAL_SPOKES["param_space"]),
               idea("flaky", ref.RECT_FINS["param_space"])],
              [idea("evil", {"a": [1, 2]})]]
    llm = ScriptedLLM(rounds)
    log = tmp_path / "events.ndjson"
    bus = EventBus("r_test", log)
    sp = Spreader()
    s = MatterRun(sp, llm, bus, tmp_path / "out", rounds=2, ideas_per_round=3, samples=6, seed=1).run()
    bus.close()
    ev = [json.loads(x) for x in log.read_text().splitlines()]
    types = [e["type"] for e in ev]
    assert ev[0]["type"] == "run.started" and ev[0]["domain"] == "matter"
    assert [r["id"] for r in ev[0]["ladder"]] == ["M1", "M2", "M3", "M4", "M5"]
    assert types[-1] == "run.completed"
    stages = {(e["node_id"], e["stage"]) for e in ev if e["type"] == "node.stage"}
    assert ("root", "M1") in stages and ("n1", "implement") in stages
    assert {e["stage"] for e in ev if e["type"] == "node.stage"} <= {"implement", "M1", "M2", "M3", "M4", "M5"}
    scored = [e for e in ev if e["type"] == "node.scored"]
    assert scored and all(set(e["ladder"]) == {"M1", "M2", "M3", "M4", "M5"} for e in scored)
    assert all(e["metrics"]["peak_temp_c"] > sp.T_inf for e in scored)
    # the evil generator (disallowed import) is rejected and pruned; flaky is repaired once
    assert s["nodes"]["n4"]["status"] == "pruned" and "rejected" in s["nodes"]["n4"]["reason"]
    assert llm.repairs == 1
    assert s["nodes"]["n3"]["status"] == "scored"
    # artifacts exist and carry correct hashes
    arts = [e for e in ev if e["type"] == "artifact.created"]
    assert {a["kind"] for a in arts} >= {"stl", "code", "results", "report"}
    for a in arts:
        assert hashlib.sha256(open(a["path"], "rb").read()).hexdigest() == a["sha256"]
    # honest verdict: our own rect fins cannot beat the equal-material rectangular-fin baseline
    assert s["nodes"]["n1"]["ladder"]["M5"] in ("fail", "skipped")
    print("\nSCRIPTED RUN:", {k: (v["ladder"], v["peak_c"]) for k, v in s["nodes"].items()}, "baseline", s["baseline_peak_c"])


def test_helpers():
    assert "x = 1" in extract_code("hi ```python\nx = 1\n``` bye")
    rng = np.random.default_rng(0)
    ps = sample_params({"a": [1, 5], "b": [0.5, 1.5]}, 5, rng)
    assert ps[0] == {"a": 3, "b": 1.0} and all(isinstance(p["a"], int) for p in ps)
    assert pareto_front([(0.2, 90, "a"), (0.3, 80, "b"), (0.3, 95, "c"), (0.4, 80, "d")]) == {"a", "b"}
    Ideas.model_validate({"ideas": [idea("abc", {"x": [1, 2]})]})
