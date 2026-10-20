"""Hand-built reference solutions: regression tests for the ladder and few-shot examples for the agent."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from ..hwgen import Instruction

HERE = Path(__file__).parent


@dataclass
class Example:
    instruction: Instruction
    spec_rtl: str
    patch: dict[str, str]


def load(name: str, funct7: int = 0) -> Example:
    d = HERE / name
    meta = json.loads((d / "meta.json").read_text())
    ins = Instruction(
        name=meta["name"], mnemonic=meta["mnemonic"], funct7=funct7,
        rtl=(d / "insn.v").read_text(), c_ref=(d / "c_ref.c").read_text(),
        title=meta.get("title", ""), rationale=meta.get("rationale", ""),
    )
    patch = {p.name: p.read_text() for p in d.glob("*.h")}
    return Example(instruction=ins, spec_rtl=(d / "spec.v").read_text(), patch=patch)
