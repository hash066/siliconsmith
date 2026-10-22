"""Parts library schema for the Board workbench.

Every fact (pin record, rating, current, property) carries provenance: the DOCUMENT and SECTION it
was curated from and whether anyone has cross-checked that citation. Facts are author-curated and
`citation_checked` stays False until the cited document was actually read; the UI must say
"author-curated, not independently verified" for unchecked facts. Page numbers are never recorded.

Fact ids (used as evidence by checks):
    part:<part>.pin_table              the pin table as a whole
    part:<part>.<pin>                  one pin record (pin name lower-cased)
    part:<part>.<pin>.<capability>     one capability of one pin, e.g. part:esp32.gpio12.strapping
    part:<part>.<key>                  a rating / current / property fact
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, model_validator

PARTS_DIR = Path(__file__).parent / "parts"

Direction = Literal["input", "output", "bidir", "power_in", "power_out", "passive", "ground", "nc", "unknown"]
DRIVER_DIRECTIONS = frozenset({"output", "power_out"})
CAPABILITIES = frozenset({"gpio", "input_only", "adc", "i2c", "strapping", "flash", "power", "ground", "usb_cc", "boot", "enable"})
FactKind = Literal["abs_max", "recommended", "typical_current", "peak_current", "property"]
_KEY_RE = re.compile(r"^[a-z0-9_]+(\.[a-z0-9_]+)*$")


class Provenance(BaseModel):
    source: str = Field(min_length=1)
    section: str = Field(min_length=1)
    citation_checked: bool = False
    url: str | None = None

    @model_validator(mode="after")
    def _checked_needs_url(self) -> "Provenance":
        if self.citation_checked and not self.url:
            raise ValueError("citation_checked=true requires the exact url that was read")
        return self


class Pin(BaseModel):
    name: str = Field(min_length=1)
    number: str = Field(min_length=1)
    direction: Direction = "unknown"
    capabilities: list[str] = []
    required: bool = False
    domain_v: float | None = None
    v_abs_max: float | None = None
    v_rec_min: float | None = None
    v_rec_max: float | None = None
    provenance: Provenance | None = None  # falls back to the part's pin_table_provenance
    note: str | None = None

    @model_validator(mode="after")
    def _known_capabilities(self) -> "Pin":
        bad = [c for c in self.capabilities if c not in CAPABILITIES]
        if bad:
            raise ValueError(f"unknown capabilities {bad}; allowed: {sorted(CAPABILITIES)}")
        return self


class Fact(BaseModel):
    key: str
    kind: FactKind
    text: str = Field(min_length=1)
    value: float | str | None = None
    unit: str | None = None
    provenance: Provenance  # mandatory: a fact without provenance is rejected

    @model_validator(mode="after")
    def _key_shape(self) -> "Fact":
        if not _KEY_RE.match(self.key):
            raise ValueError(f"bad fact key {self.key!r}")
        return self


class Part(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9_]+$")
    name: str
    package: str
    kind: Literal["module", "ic", "passive", "connector", "placeholder"]
    origin: Literal["datasheet", "author_defined"]
    description: str = ""
    pin_table_provenance: Provenance
    pins: list[Pin]
    facts: list[Fact] = []

    @model_validator(mode="after")
    def _resolve(self) -> "Part":
        names = [p.name for p in self.pins]
        if len(set(names)) != len(names):
            raise ValueError("duplicate pin names in pin table")
        keys = [f.key for f in self.facts]
        if len(set(keys)) != len(keys):
            raise ValueError("duplicate fact keys")
        for p in self.pins:
            if p.provenance is None:
                p.provenance = self.pin_table_provenance
        return self

    def pin(self, name: str) -> Pin | None:
        return next((p for p in self.pins if p.name == name), None)

    def pin_fact_id(self, pin: str, capability: str | None = None) -> str:
        base = f"part:{self.id}.{pin.lower()}"
        return f"{base}.{capability}" if capability else base

    def fact_provenance(self) -> dict[str, Provenance]:
        """Every citable fact id of this part, mapped to its provenance."""
        out: dict[str, Provenance] = {f"part:{self.id}.pin_table": self.pin_table_provenance}
        for p in self.pins:
            assert p.provenance is not None
            out[self.pin_fact_id(p.name)] = p.provenance
            for c in p.capabilities:
                out[self.pin_fact_id(p.name, c)] = p.provenance
        for f in self.facts:
            out[f"part:{self.id}.{f.key}"] = f.provenance
        return out

    def fact(self, key: str) -> Fact | None:
        return next((f for f in self.facts if f.key == key), None)


def load_part(path: Path | str) -> Part:
    return Part.model_validate(json.loads(Path(path).read_text(encoding="utf-8")))


def load_library(directory: Path | str | None = None) -> dict[str, Part]:
    d = Path(directory) if directory else PARTS_DIR
    lib: dict[str, Part] = {}
    for f in sorted(d.glob("*.json")):
        part = load_part(f)
        if part.id in lib:
            raise ValueError(f"duplicate part id {part.id!r} in {f.name}")
        lib[part.id] = part
    return lib


def resolve_fact(library: dict[str, Part], fact_id: str) -> Provenance | None:
    """Provenance for an evidence id, or None when the id is not a fact of any library part."""
    if not fact_id.startswith("part:"):
        return None
    part = library.get(fact_id[5:].split(".", 1)[0])
    return part.fact_provenance().get(fact_id) if part else None
