import json

import pytest

from siliconsmith import hwgen
from siliconsmith.events import EventBus
from siliconsmith.llm import extract_json

RTL = "module ss_insn_x(input wire [31:0] rs1, input wire [31:0] rs2, output wire [31:0] rd); assign rd = rs1; endmodule"


def test_normalize_body_passthrough():
    assert hwgen.normalize_c_ref("return rs1 + rs2;") == "return rs1 + rs2;"


def test_normalize_full_definition():
    src = "uint32_t dot4(uint32_t rs1, uint32_t rs2) {\n    return rs1 ^ rs2;\n}"
    assert hwgen.normalize_c_ref(src).strip() == "return rs1 ^ rs2;"


def test_normalize_renamed_params():
    src = "static inline uint32_t f(uint32_t a, uint32_t b) { return a - b; }"
    out = hwgen.normalize_c_ref(src)
    assert "uint32_t a = rs1;" in out and "uint32_t b = rs2;" in out and "return a - b;" in out


def test_instruction_validation():
    with pytest.raises(ValueError):
        hwgen.Instruction(name="Bad-Name", mnemonic="x", funct7=0, rtl=RTL, c_ref="return 0;")
    with pytest.raises(ValueError):
        hwgen.Instruction(name="x", mnemonic="x", funct7=200, rtl=RTL, c_ref="return 0;")
    ins = hwgen.Instruction(name="x", mnemonic="x", funct7=3, rtl=RTL,
                            c_ref="uint32_t f(uint32_t rs1, uint32_t rs2) { return rs1; }")
    assert ins.c_ref.strip() == "return rs1;"


def test_pcpi_and_intrinsics_render():
    ins = hwgen.Instruction(name="x", mnemonic="x.y", funct7=5, rtl=RTL, c_ref="return rs1;")
    cfg = hwgen.CpuConfig([ins])
    v = hwgen.render_pcpi(cfg)
    assert "7'd5:" in v and "ss_insn_x u_x" in v
    h = hwgen.render_intrinsics(cfg)
    assert ".insn r 0x0B, 0, 5," in h and "ss_ref_x" in h
    assert cfg.next_funct7() == 0


def test_extract_json_variants():
    assert extract_json('noise {"a": {"b": "}"}} tail') == {"a": {"b": "}"}}
    assert extract_json('```json\n{"k": 1}\n```') == {"k": 1}
    with pytest.raises(ValueError):
        extract_json("no json here")


def test_event_bus_contract(tmp_path):
    bus = EventBus("r_test", tmp_path / "e.ndjson")
    bus.emit("run.started", workload={"id": "w"})
    q = bus.subscribe()
    bus.emit("log", level="info", msg="hi")
    bus.close()
    lines = [json.loads(l) for l in (tmp_path / "e.ndjson").read_text().splitlines()]
    assert [e["seq"] for e in lines] == [0, 1]
    assert all(e["v"] == 1 and e["run_id"] == "r_test" for e in lines)
    got = []
    while (item := q.get(timeout=1)) is not None:
        got.append(json.loads(item)["type"])
    assert got == ["run.started", "log"]
