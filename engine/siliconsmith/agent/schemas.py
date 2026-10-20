"""Structured outputs the Nemotron roles must return (validated with pydantic)."""

from __future__ import annotations

import re

from pydantic import BaseModel, Field, field_validator

_NAME = re.compile(r"^[a-z][a-z0-9_]{0,30}$")


class Proposal(BaseModel):
    name: str = Field(description="C identifier, lowercase, e.g. dot4_s8")
    mnemonic: str = Field(description="assembly mnemonic, e.g. dot4.s8")
    title: str
    semantics_c: str = Field(description="C body of: uint32_t f(uint32_t rs1, uint32_t rs2) — the spec")
    rationale: str
    how_software_uses_it: str
    est_speedup: float = 1.0
    est_area_pct: float = 0.0

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip().lower().replace(".", "_").replace("-", "_")
        if not _NAME.match(v):
            raise ValueError("name must be a lowercase C identifier (<= 31 chars)")
        return v


class ProposalSet(BaseModel):
    hotspot_analysis: str
    proposals: list[Proposal]


def unescape_code(s: str) -> str:
    """Models sometimes double-escape code inside JSON (literal \\n); a // comment then swallows it all."""
    if "\\n" in s and s.count("\n") < 3:
        s = s.replace("\\r\\n", "\n").replace("\\n", "\n").replace("\\t", "\t").replace('\\"', '"')
    return s


class Implementation(BaseModel):
    rtl: str = Field(description="complete Verilog module ss_insn_<name>(input [31:0] rs1, rs2, output [31:0] rd)")
    c_ref: str = Field(description="C body of uint32_t f(uint32_t rs1, uint32_t rs2); may refine semantics_c")
    patched_files: dict[str, str] = Field(description="full new contents of each patchable file you change")
    notes: str = ""

    @field_validator("rtl", "c_ref")
    @classmethod
    def _code(cls, v: str) -> str:
        return unescape_code(v)

    @field_validator("patched_files")
    @classmethod
    def _files(cls, v: dict[str, str]) -> dict[str, str]:
        return {k: unescape_code(c) for k, c in v.items()}


class SpecRtl(BaseModel):
    spec_rtl: str = Field(description="complete Verilog module ss_spec_<name>, naive and obviously correct")

    @field_validator("spec_rtl")
    @classmethod
    def _code(cls, v: str) -> str:
        return unescape_code(v)


class Triage(BaseModel):
    stage: str
    summary: str = Field(description="one sentence a human can read in the UI")
    likely_cause: str
    fix_hint: str
