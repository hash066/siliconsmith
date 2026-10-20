import os

import pytest

from siliconsmith import backends, examples, hwgen, ladder, paths
from siliconsmith.tools.workload import Workload
from siliconsmith.worker import OUTCOME_TAG, STAGE_TAG


def test_parse_worker_lines_forwards_stages_and_returns_outcome():
    seen = []
    lines = [
        "noise from a tool\n",
        STAGE_TAG + '{"stage": "lint", "status": "pass", "detail": "ok", "artifacts": null}\n',
        OUTCOME_TAG + '{"ok": false, "kind": "prune", "stage": "bench", "message": "no speedup"}\n',
    ]
    out = backends.parse_worker_lines(lines, lambda *a: seen.append(a))
    assert seen == [("lint", "pass", "ok", None)]
    with pytest.raises(ladder.Prune) as e:
        backends.raise_for_outcome(out)
    assert e.value.stage == "bench"


def test_missing_outcome_is_a_stage_failure():
    with pytest.raises(ladder.StageFailure) as e:
        backends.parse_worker_lines(["Traceback (most recent call last):\n", "boom\n"], None)
    assert "boom" in e.value.log


def test_failure_outcome_keeps_artifacts():
    out = {"ok": False, "kind": "failure", "stage": "prove", "message": "cex", "log": "l",
           "artifacts": {"culprit": "rtl"}}
    with pytest.raises(ladder.StageFailure) as e:
        backends.raise_for_outcome(out)
    assert e.value.stage == "prove" and e.value.artifacts == {"culprit": "rtl"}


@pytest.mark.skipif(not os.environ.get("SS_SLOW"), reason="needs the hardware toolchain; set SS_SLOW=1")
def test_subprocess_worker_matches_in_process_on_golden_example(tmp_path):
    wl = Workload.load("w1")
    ex = examples.load("dot4_s8")
    sub, loc = backends.SubprocessBackend(), backends.LocalBackend()
    base_s, img = sub.baseline(wl, tmp_path / "root_s")
    base_l, _ = loc.baseline(wl, tmp_path / "root_l")
    assert img == "subprocess:root" and base_s.cycles == base_l.cycles and base_s.hash == base_l.hash
    stages = []
    job = backends.EvalJob(node_id="t1", attempt=0, workload=wl.id, parent_image=img, base=base_s,
                           parent=base_s, parent_isa=[], ins=ex.instruction, spec_rtl=ex.spec_rtl,
                           patch=ex.patch, area_budget_pct=10.0, vectors=20_000)
    r = sub.evaluate(job, lambda st, status, d, a: stages.append((st, status)), tmp_path / "t1")
    assert ("prove", "pass") in stages and ("e2e", "pass") in stages
    assert r.measured.hash == base_s.hash and r.measured.cycles < base_s.cycles


def test_patch_hygiene_flags_ss_definitions_but_not_calls():
    ex = examples.load("dot4_s8")
    ladder.check_patch_hygiene(ex.patch)  # the golden patch only calls intrinsics
    ok = {"tm_dot.h": "for (i = 0; i < n; i++) {\n    sum += ss_dot4_s8(a[i], b[i]);\n}\nif (ss_x(1, 2)) {\n}\n"}
    ladder.check_patch_hygiene(ok)
    for bad in ("#define ss_ref_dot2_hi(a, b) ((a) * (b))\n",
                "static inline uint32_t ss_dot2_hi(uint32_t rs1, uint32_t rs2) {\n  return 0;\n}\n"):
        with pytest.raises(ladder.StageFailure) as e:
            ladder.check_patch_hygiene({"tm_dot.h": bad})
        assert e.value.stage == "lint" and "ss_intrinsics.h" in e.value.message


BIG_DOT4 = """module ss_insn_dot4_s8 (input wire [31:0] rs1, input wire [31:0] rs2, output wire [31:0] rd);
    wire signed [31:0] p0 = $signed(rs1[ 7: 0]) * $signed(rs2[ 7: 0]);
    wire signed [31:0] p1 = $signed(rs1[15: 8]) * $signed(rs2[15: 8]);
    wire signed [31:0] p2 = $signed(rs1[23:16]) * $signed(rs2[23:16]);
    wire signed [31:0] p3 = $signed(rs1[31:24]) * $signed(rs2[31:24]);
    assign rd = p0 + p1 + p2 + p3;
endmodule
"""


def _slow_patch(golden: str) -> str:
    """The golden kernel with its 4x unroll removed (1 intrinsic per iteration)."""
    start = golden.index("    for (; i + 4 <= n4; i += 4) {")
    end = golden.index("    for (; i < n4; i++)")
    return golden[:start] + golden[end:]


@pytest.mark.skipif(not os.environ.get("SS_SLOW"), reason="needs the hardware toolchain; set SS_SLOW=1")
def test_polish_modes_area_shrinks_and_software_speeds_up(tmp_path):
    import dataclasses

    wl = Workload.load("w1")
    ex = examples.load("dot4_s8")
    be = backends.LocalBackend()
    base, img = be.baseline(wl, tmp_path / "root")
    name = next(iter(ex.patch))
    slow = {name: _slow_patch(ex.patch[name])}
    big = dataclasses.replace(ex.instruction, rtl=BIG_DOT4)

    def job(node_id, parent, isa, ins, patch, mode):
        return backends.EvalJob(node_id=node_id, attempt=0, workload=wl.id, parent_image=img, base=base,
                                parent=parent, parent_isa=isa, ins=ins, spec_rtl=ex.spec_rtl, patch=patch,
                                area_budget_pct=50.0, vectors=20_000, mode=mode)

    n1 = be.evaluate(job("n1", base, [], big, slow, "instruction"), lambda *a: None, tmp_path / "n1").measured
    stages = []
    area = be.evaluate(job("n1.1", n1, [], ex.instruction, slow, "area"),
                       lambda st, s, d, a: stages.append((st, s)), tmp_path / "n1.1").measured
    assert ("prove", "pass") in stages and area.cycles == n1.cycles and area.hash == base.hash
    assert (area.area.lut_equiv, area.area.dsps) < (n1.area.lut_equiv, n1.area.dsps)

    stages.clear()
    sw = be.evaluate(job("n1.1.1", area, [ex.instruction], None, ex.patch, "software"),
                     lambda st, s, d, a: stages.append((st, s)), tmp_path / "sw").measured
    assert ("prove", "skipped") in stages and sw.hash == base.hash and sw.cycles < area.cycles
    assert sw.area == area.area

    with pytest.raises(ladder.Prune):  # polishing the area again with the same RTL saves nothing
        be.evaluate(job("x", area, [], ex.instruction, slow, "area"), lambda *a: None, tmp_path / "x")
