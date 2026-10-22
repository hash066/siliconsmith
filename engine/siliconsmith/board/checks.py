"""Board ladder, deterministic code only (no LLM). Implemented: B1 and B2.

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
IMPLEMENTED_RUNGS = ("B1", "B2")


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


def _net_voltage(design: Design, parts: dict[str, Part | None], net: str) -> tuple[float, float, list[str]] | None:
    """(min, max, evidence) of what the net's power_out pins drive; None when no source declares a range."""
    lo, hi, ev = None, None, []
    for n, ref, pin in design.connections():
        if n != net:
            continue
        part = parts.get(ref)
        rec = part.pin(pin) if part else None
        if rec and rec.direction == "power_out" and rec.v_out_min is not None and rec.v_out_max is not None:
            lo = rec.v_out_min if lo is None else min(lo, rec.v_out_min)
            hi = rec.v_out_max if hi is None else max(hi, rec.v_out_max)
            ev.append(part.pin_fact_id(pin))
    return None if lo is None else (lo, hi, ev)


def _load_ma(inst, part: Part) -> tuple[float, str] | None:
    """Current a rail load is budgeted at: instance peak_ma, else part peak, else the stated supply need."""
    if "peak_ma" in inst.params:
        return float(inst.params["peak_ma"]), f"{inst.ref}.params.peak_ma"
    for key in ("peak_ma", "iddp_ma", "supply_current_min_ma"):
        fact = part.fact(key)
        if fact is not None and isinstance(fact.value, (int, float)):
            return float(fact.value), f"part:{part.id}.{key}"
    return None


def run_b2(design: Design, library: dict[str, Part]) -> CheckResult:
    """Electrical limits from curated facts. Net voltage is what the net's power_out pins declare; passives
    and regulation behaviour are not traced. Rail current is budgeted per part (see _load_ma), not measured."""
    parts: dict[str, Part | None] = {i.ref: library.get(i.part) for i in design.instances}

    # supply pins within absolute maximum and recommended range
    fails, unknowns, ev_fail, ev_ok = [], [], [], []
    for net, ref, pin in design.connections():
        part = parts.get(ref)
        rec = part.pin(pin) if part else None
        if rec is None or rec.direction != "power_in":
            continue
        limits = (rec.v_abs_max, rec.v_rec_min, rec.v_rec_max)
        if all(x is None for x in limits):
            continue
        volt = _net_voltage(design, parts, net)
        if volt is None:
            unknowns.append(f"{ref}.{pin}: no source on net {net} declares a voltage")
            continue
        lo, hi, src = volt
        fid = part.pin_fact_id(pin)
        if rec.v_abs_max is not None and hi > rec.v_abs_max:
            fails.append(f"{ref}.{pin} on net {net} sees up to {hi:g} V, above its absolute maximum {rec.v_abs_max:g} V")
            ev_fail += [fid] + src
        elif (rec.v_rec_max is not None and hi > rec.v_rec_max) or (rec.v_rec_min is not None and lo < rec.v_rec_min):
            fails.append(f"{ref}.{pin} on net {net} spans {lo:g} to {hi:g} V, outside its recommended "
                         f"{rec.v_rec_min:g} to {rec.v_rec_max:g} V")
            ev_fail += [fid] + src
        else:
            ev_ok += [fid] + src
    supply = _finding("supply voltages", fails, unknowns, "every supply pin is within its voltage limits",
                      ev_fail, ev_ok)

    # signal pins in a voltage domain: a pin tolerates its domain voltage plus 0.3 V
    fails, ev_fail, ev_ok = [], [], []
    for net, ref, pin in design.connections():
        part = parts.get(ref)
        rec = part.pin(pin) if part else None
        if rec is None or rec.domain_v is None or rec.direction in ("power_in", "power_out", "ground"):
            continue
        volt = _net_voltage(design, parts, net)
        if volt is None:
            continue
        if volt[1] > rec.domain_v + 0.3:
            fails.append(f"{ref}.{pin} is a {rec.domain_v:g} V domain pin but net {net} is driven up to {volt[1]:g} V")
            ev_fail += [part.pin_fact_id(pin)] + volt[2]
        else:
            ev_ok += [part.pin_fact_id(pin)] + volt[2]
    signal = _finding("signal pin domains", fails, [], "no signal pin is over-driven for its voltage domain",
                      ev_fail, ev_ok)

    # regulator output current budget
    fails, unknowns, ev_fail, ev_ok, ok_lines = [], [], [], [], []
    for inst in design.instances:
        part = parts[inst.ref]
        limit = part.fact("iout_max_ma") if part else None
        if limit is None:
            continue
        for rec in part.pins:
            if rec.direction != "power_out":
                continue
            nets = design.nets_of(inst.ref, rec.name)
            if not nets:
                continue
            members = {(r, q) for n, r, q in design.connections() if n == nets[0]}
            total, terms, missing, loads_ev = 0.0, [], [], []
            for other in design.instances:
                opart = parts[other.ref]
                if other.ref == inst.ref or opart is None:
                    continue
                if not any((other.ref, p.name) in members for p in opart.pins if p.direction == "power_in"):
                    continue
                load = _load_ma(other, opart)
                if load is None:
                    missing.append(other.ref)
                else:
                    total += load[0]
                    terms.append(f"{other.ref} {load[0]:g}")
                    if load[1].startswith("part:"):
                        loads_ev.append(load[1])
            fid = f"part:{part.id}.iout_max_ma"
            if missing:
                unknowns.append(f"{inst.ref} rail {nets[0]}: no current fact for {', '.join(missing)}")
                ev_fail.append(fid)
                continue
            line = f"{inst.ref} rail {nets[0]}: " + (" + ".join(terms) or "0") + f" = {total:g} mA vs limit {limit.value:g} mA"
            if total > float(limit.value):
                fails.append(line + " (overloaded)")
                ev_fail += [fid] + loads_ev
            else:
                ok_lines.append(line)
                ev_ok += [fid] + loads_ev
    current = _finding("regulator current", fails, unknowns, "; ".join(ok_lines) or "no regulator on the board",
                       ev_fail, ev_ok)
    return _summarise("B2", [supply, signal, current])


def run_ladder(design: Design, library: dict[str, Part]) -> list[CheckResult]:
    """Implemented rungs only; a later rung is reported unknown (not run) when B1 did not pass.
    B3 to B5 are not run and are not reported as passed."""
    b1 = run_b1(design, library)
    if b1.status != "pass":
        b2 = CheckResult(rung="B2", status="unknown", detail="not run: B1 did not pass")
    else:
        b2 = run_b2(design, library)
    return [b1, b2]
