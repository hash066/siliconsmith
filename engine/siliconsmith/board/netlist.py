"""Netlist-level design model: part instances, nets, MCU pin assignments, firmware pin header.

Connections are written "REF.PIN" (split on the first dot). A pin may appear on at most one net;
B1 reports it when a design breaks that rule.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterator, Literal

from pydantic import BaseModel, Field, model_validator

DESIGNS_DIR = Path(__file__).parent / "designs"
PinUse = Literal["input", "output", "bidir"]


def split_pin(ref_pin: str) -> tuple[str, str]:
    ref, _, pin = ref_pin.partition(".")
    if not ref or not pin:
        raise ValueError(f"connection {ref_pin!r} must look like REF.PIN")
    return ref, pin


class Instance(BaseModel):
    ref: str = Field(min_length=1)
    part: str = Field(min_length=1)
    params: dict[str, float | int | str] = {}


class Net(BaseModel):
    name: str = Field(min_length=1)
    pins: list[str] = []

    @model_validator(mode="after")
    def _shape(self) -> "Net":
        for p in self.pins:
            split_pin(p)
        return self


class McuAssignment(BaseModel):
    """What the netlist says a function is wired to."""
    function: str
    pin: str
    use: PinUse
    net: str | None = None


class FirmwarePin(BaseModel):
    """What the firmware pin header claims (compared with the netlist from rung B4)."""
    function: str
    pin: str
    use: PinUse


class Design(BaseModel):
    name: str = ""  # models often omit it; the agent fills it from the brief
    template: str | None = None
    mcu_ref: str | None = None
    # design assumptions the checks need but the netlist cannot state, e.g. i2c_mode, i2c_cb_pf; never part facts
    assumptions: dict[str, float | int | str] = {}
    instances: list[Instance]
    nets: list[Net]
    mcu_assignments: list[McuAssignment] = []
    firmware_pins: list[FirmwarePin] = []

    @model_validator(mode="after")
    def _unique(self) -> "Design":
        refs = [i.ref for i in self.instances]
        if len(set(refs)) != len(refs):
            raise ValueError("duplicate instance refs")
        names = [n.name for n in self.nets]
        if len(set(names)) != len(names):
            raise ValueError("duplicate net names")
        return self

    def instance(self, ref: str) -> Instance | None:
        return next((i for i in self.instances if i.ref == ref), None)

    def net(self, name: str) -> Net | None:
        return next((n for n in self.nets if n.name == name), None)

    def connections(self) -> Iterator[tuple[str, str, str]]:
        """(net, ref, pin) for every connection."""
        for n in self.nets:
            for p in n.pins:
                ref, pin = split_pin(p)
                yield n.name, ref, pin

    def pins_on(self, net: str) -> list[tuple[str, str]]:
        return [(r, p) for n, r, p in self.connections() if n == net]

    def nets_of(self, ref: str, pin: str) -> list[str]:
        return [n for n, r, p in self.connections() if (r, p) == (ref, pin)]

    def copy(self) -> "Design":
        return self.model_copy(deep=True)


def load_design(src: Path | str | dict) -> Design:
    data = src if isinstance(src, dict) else json.loads(Path(src).read_text(encoding="utf-8"))
    return Design.model_validate(data)


def dump_design(design: Design) -> str:
    return json.dumps(design.model_dump(mode="json"), indent=2) + "\n"
