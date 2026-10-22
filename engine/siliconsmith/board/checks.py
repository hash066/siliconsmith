"""Board ladder, deterministic code only (no LLM). Day 1 implements rung B1.

B1 "Netlist is well formed": every connected pin exists in its part's pin table; required pins are
connected; no pin sits on two nets; no net has two output drivers. Status rules: any failed
finding fails the rung; otherwise any unknown finding makes it unknown; only then pass. The label
is attached only on pass, and unknown never counts as pass.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, model_validator

from .netlist import Design, split_pin
from .parts import DRIVER_DIRECTIONS, Part

Status = Literal["pass", "fail", "unknown"]

RUNG_LABELS = {
    "B1": "Netlist is well formed",
    "B2": "Electrical limits respected (curated facts)",
    "B3": "Bus and connector rules satisfied (curated facts)",
    "B4": "Firmware matches the netlist",
    "B5": "Battery estimate meets target (model, not measured)",
}
IMPLEMENTED_RUNGS = ("B1",)


class Finding(BaseModel):
    check: str
    status: Status
    detail: str
    evidence: list[str] = []


class CheckResult(BaseModel):
    rung: str
    status: Status
    label: str | None = None
    detail: str
    evidence: list[str] = []
    findings: list[Finding] = []

    @model_validator(mode="after")
    def _label_only_on_pass(self) -> "CheckResult":
        want = RUNG_LABELS.get(self.rung) if self.status == "pass" else None
        if self.label != want:
            raise ValueError(f"label for {self.rung} must be {want!r} (set only on pass), got {self.label!r}")
        return self


def _dedupe(items: list[str]) -> list[str]:
    return list(dict.fromkeys(items))


def _worst(statuses: list[Status]) -> Status:
    if "fail" in statuses:
        return "fail"
    return "unknown" if "unknown" in statuses else "pass"


def _summarise(rung: str, findings: list[Finding]) -> CheckResult:
    status = _worst([f.status for f in findings])
    if status == "pass":
        detail = "; ".join(f"{f.check}: ok" for f in findings)
    else:
        detail = "; ".join(f.detail for f in findings if f.status == status)
    return CheckResult(
        rung=rung, status=status, label=RUNG_LABELS[rung] if status == "pass" else None,
        detail=detail, evidence=_dedupe([e for f in findings if f.status != "pass" for e in f.evidence]) or
        _dedupe([e for f in findings for e in f.evidence]), findings=findings,
    )


def _finding(check: str, fails: list[str], unknowns: list[str], ok_text: str, ev_fail: list[str], ev_ok: list[str]) -> Finding:
    if fails:
        return Finding(check=check, status="fail", detail="; ".join(fails), evidence=_dedupe(ev_fail))
    if unknowns:
        return Finding(check=check, status="unknown", detail="; ".join(unknowns), evidence=_dedupe(ev_fail))
    return Finding(check=check, status="pass", detail=ok_text, evidence=_dedupe(ev_ok))


def run_b1(design: Design, library: dict[str, Part]) -> CheckResult:
    parts: dict[str, Part | None] = {i.ref: library.get(i.part) for i in design.instances}
    unknown_refs = [i.ref for i in design.instances if parts[i.ref] is None]

    # 1. every connected pin exists in its part's pin table
    fails, unknowns, ev_fail, ev_ok = [], [], [], []
    for r in unknown_refs:
        inst = design.instance(r)
        unknowns.append(f"{r} uses part {inst.part!r}, which is not in the parts library; its pins cannot be checked")
    for net, ref, pin in design.connections():
        inst = design.instance(ref)
        if inst is None:
            fails.append(f"net {net} references unknown instance {ref}")
            continue
        part = parts[ref]
        if part is None:
            continue
        if part.pin(pin) is None:
            fails.append(f"{ref}.{pin} (net {net}) is not a pin of {part.id}")
            ev_fail.append(f"part:{part.id}.pin_table")
        else:
            ev_ok.append(part.pin_fact_id(pin))
    pins_exist = _finding("pins exist", fails, unknowns, "every connected pin exists in its part's pin table", ev_fail, ev_ok)

    # 2. required pins connected
    connected = {(r, p) for _, r, p in design.connections()}
    fails, unknowns, ev_fail, ev_ok = [], [], [], []
    for inst in design.instances:
        part = parts[inst.ref]
        if part is None:
            unknowns.append(f"{inst.ref}: required pins unknown (part {inst.part!r} not in library)")
            continue
        for pin in part.pins:
            if pin.required:
                if (inst.ref, pin.name) in connected:
                    ev_ok.append(part.pin_fact_id(pin.name))
                else:
                    fails.append(f"required pin {inst.ref}.{pin.name} is not connected")
                    ev_fail.append(part.pin_fact_id(pin.name))
    required = _finding("required pins connected", fails, unknowns, "every required pin is connected", ev_fail, ev_ok)

    # 3. a pin sits on one net only
    fails, ev_fail = [], []
    seen: dict[tuple[str, str], str] = {}
    for net, ref, pin in design.connections():
        first = seen.setdefault((ref, pin), net)
        if first != net:
            fails.append(f"{ref}.{pin} is on both net {first} and net {net}")
            part = parts.get(ref)
            if part:
                ev_fail.append(part.pin_fact_id(pin))
    single = _finding("one net per pin", fails, [], "no pin is on two nets", ev_fail, [])

    # 4. at most one output driver per net
    fails, unknowns, ev_fail, ev_ok = [], [], [], []
    for net in design.nets:
        drivers, maybe = [], []
        for ref_pin in net.pins:
            ref, pin = split_pin(ref_pin)
            part = parts.get(ref)
            pin_rec = part.pin(pin) if part else None
            if pin_rec is None:
                continue  # already reported by "pins exist"
            if pin_rec.direction in DRIVER_DIRECTIONS:
                drivers.append((ref_pin, part.pin_fact_id(pin)))
            elif pin_rec.direction == "unknown":
                maybe.append((ref_pin, part.pin_fact_id(pin)))
        if len(drivers) >= 2:
            fails.append(f"net {net.name} has {len(drivers)} output drivers: {', '.join(d for d, _ in drivers)}")
            ev_fail += [e for _, e in drivers]
        elif drivers and maybe or len(maybe) >= 2:
            names = ", ".join(d for d, _ in drivers + maybe)
            unknowns.append(f"net {net.name} may have two drivers (direction unknown for some pins): {names}")
            ev_fail += [e for _, e in drivers + maybe]
        else:
            ev_ok += [e for _, e in drivers]
    drivers = _finding("single driver per net", fails, unknowns, "no net has two output drivers", ev_fail, ev_ok)

    # 5. MCU pin assignments name real MCU pins
    fails, unknowns, ev_fail, ev_ok = [], [], [], []
    if design.mcu_assignments:
        mcu = design.instance(design.mcu_ref) if design.mcu_ref else None
        part = parts.get(mcu.ref) if mcu else None
        if mcu is None:
            fails.append("MCU pin assignments exist but mcu_ref does not name an instance")
        elif part is None:
            unknowns.append(f"MCU {mcu.ref} part {mcu.part!r} not in library; assignments cannot be checked")
        else:
            for a in design.mcu_assignments:
                if part.pin(a.pin) is None:
                    fails.append(f"assignment {a.function} uses {a.pin}, not a pin of {part.id}")
                    ev_fail.append(f"part:{part.id}.pin_table")
                else:
                    ev_ok.append(part.pin_fact_id(a.pin))
    assign = _finding("MCU assignments exist", fails, unknowns, "every MCU pin assignment names a real pin", ev_fail, ev_ok)

    return _summarise("B1", [pins_exist, required, single, drivers, assign])


def run_ladder(design: Design, library: dict[str, Part]) -> list[CheckResult]:
    """Implemented rungs only. B2 to B5 are not run and are not reported as passed."""
    return [run_b1(design, library)]
