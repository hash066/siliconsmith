import json

from siliconsmith import bundle, examples, ladder
from siliconsmith.search import Node
from siliconsmith.tools.verify import Area
from siliconsmith.tools.workload import Workload


def _m(cycles: int) -> ladder.Measured:
    return ladder.Measured(cycles=cycles, hash="c729ebe8", area=Area(2500, 67, 923, 2, 0, 11334),
                           hotspots=[], disasm="")


def test_bundle_contains_rtl_intrinsics_patch_and_honest_report(tmp_path):
    wl = Workload.load("w1")
    ex = examples.load("dot4_s8")
    root = Node(id="root", parent=None, depth=0, isa=[], patch={}, measured=_m(860_730), status="scored")
    best = Node(id="n1", parent=root, depth=1, isa=[ex.instruction], patch=ex.patch, measured=_m(228_000),
                status="scored", area_delta=3.2)
    events = [
        {"type": "node.created", "node_id": "n1", "proposal": {"mnemonic": "dot4.s8"}},
        {"type": "node.stage", "node_id": "n1", "stage": "prove", "status": "fail", "detail": "cex"},
        {"type": "node.stage", "node_id": "n1", "stage": "prove", "status": "pass", "detail": "all 2^64 inputs"},
        {"type": "node.created", "node_id": "n2", "proposal": {"mnemonic": "pmul2"}},
        {"type": "node.pruned", "node_id": "n2", "reason": "no speedup (0.85x)"},
        {"type": "llm.call", "model": "ultra", "tokens_in": 1000, "tokens_out": 200, "cost_usd": 0.0016},
    ]
    log = tmp_path / "run.ndjson"
    log.write_text("\n".join(json.dumps(e) for e in events))
    out = bundle.write_bundle(tmp_path / "out", wl, root.measured, best, log)

    assert (out / "rtl" / "ss_pcpi.v").exists()
    assert (out / "rtl" / f"ss_insn_{ex.instruction.name}.v").exists()
    assert "ss_ref_" in (out / "include" / "ss_intrinsics.h").read_text()
    assert set(p.name for p in (out / "src").iterdir()) == set(ex.patch)
    report = (out / "REPORT.md").read_text(encoding="utf-8")
    assert "3.78x faster" in report and "+3.2% LUT" in report
    assert "all 2^64 inputs" in report and "cex" not in report  # only the surviving attempt is reported
    assert "pmul2" in report and "no speedup" in report
    assert "$0.002" in report


def test_report_when_nothing_beat_baseline(tmp_path):
    wl = Workload.load("w1")
    root = Node(id="root", parent=None, depth=0, isa=[], patch={}, measured=_m(1000), status="scored")
    text = bundle.render_report(wl, root.measured, root, [])
    assert "No custom instruction beat the baseline" in text
