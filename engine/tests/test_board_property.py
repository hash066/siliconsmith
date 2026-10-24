"""Property-style tests: seeded random variation of the clean design must never turn a seeded fault into a pass, the
B3 and B5 verdicts must agree with independent hand calculations, and every result keeps its honesty invariants."""

import random

import pytest

from siliconsmith.board.checks import IMPLEMENTED_RUNGS, run_b3, run_b5, run_ladder
from siliconsmith.board.faults import FAULTS, STRUCTURAL_FAULTS, inject_fault, reference_design
from siliconsmith.board.netlist import Design
from siliconsmith.board.parts import load_library, resolve_fact

LIB = load_library()
ESP = LIB["esp32"]
SAFE = [p.name for p in ESP.pins if "gpio" in p.capabilities and not {"flash", "strapping", "input_only"} & set(p.capabilities)]
FUNCS = ["i2c_sda", "i2c_scl", "wake_btn", "status_led"]
SEEDS = range(40)


def permuted(seed: int) -> Design:
    """The clean design with its four MCU functions moved to random distinct safe GPIOs, consistently in the
    netlist, the assignments and the firmware table."""
    rnd = random.Random(seed)
    new = rnd.sample(SAFE, len(FUNCS))
    d = reference_design()
    mapping = {a.pin: new[FUNCS.index(a.function)] for a in d.mcu_assignments}
    for net in d.nets:
        net.pins = [f"U1.{mapping[p.split('.', 1)[1]]}" if p.startswith("U1.") and p.split(".", 1)[1] in mapping else p
                    for p in net.pins]
    for a in d.mcu_assignments:
        a.pin = mapping[a.pin]
    for f in d.firmware_pins:
        f.pin = mapping[f.pin]
    return d


def status(d: Design) -> dict:
    return {r.rung: r.status for r in run_ladder(d, LIB)}


@pytest.mark.parametrize("seed", SEEDS)
def test_random_safe_pin_permutations_of_the_clean_design_still_pass_everything(seed):
    assert status(permuted(seed)) == {r: "pass" for r in IMPLEMENTED_RUNGS}


@pytest.mark.parametrize("seed", SEEDS)
def test_a_seeded_fault_is_never_a_pass_on_any_permuted_design(seed):
    for f in FAULTS + STRUCTURAL_FAULTS:
        st = status(inject_fault(permuted(seed), f.id))
        if f.expected_rung == "B1":
            assert st["B1"] == "fail", (seed, f.id)
        else:
            # the fault's own rung must not pass; B1 may legitimately fail first and make later rungs unknown
            assert st[f.expected_rung] in ("fail", "unknown") and st["B1"] in ("pass", "fail"), (seed, f.id, st)
            assert not all(v == "pass" for v in st.values()), (seed, f.id)
            if st["B1"] == "pass":
                assert st[f.expected_rung] == "fail", (seed, f.id, st)


def test_every_unsafe_gpio_choice_is_caught_for_each_function():
    """Move the LED to every flash, strapping or input-only pin of the module: B4 must fail each time."""
    unsafe = [p.name for p in ESP.pins if "gpio" in p.capabilities and p.name not in SAFE]
    assert len(unsafe) >= 15
    for pin in unsafe:
        d = reference_design()
        d.net("LED_DRV").pins = [f"U1.{pin}" if p == "U1.GPIO4" else p for p in d.net("LED_DRV").pins]
        d.mcu_assignments[3].pin = pin
        d.firmware_pins[3].pin = pin
        assert status(d)["B4"] == "fail", pin


def test_unsafe_pins_are_fine_where_the_pin_class_allows_it():
    """Input-only pins as the wake input are legal; strapping/flash never are."""
    for pin in ("GPIO34", "GPIO35", "GPIO36", "GPIO39"):
        d = reference_design()
        d.net("WAKE").pins = [f"U1.{pin}" if p == "U1.GPIO14" else p for p in d.net("WAKE").pins]
        d.mcu_assignments[2].pin = d.firmware_pins[2].pin = pin
        assert status(d)["B4"] == "pass", pin


# ---- B3 against an independent hand calculation ------------------------------------------------------------------------

def hand_pullup_ok(rp: float, cb_pf: float, mode: str, vcc: float = 3.3) -> bool:
    tr_limit = {"standard": 1000.0, "fast": 300.0}[mode]
    rise_ns = 0.8473 * rp * cb_pf * 1e-12 * 1e9
    rp_min = (vcc - 0.4) / 0.003
    return rise_ns <= tr_limit and rp >= rp_min


@pytest.mark.parametrize("seed", range(60))
def test_b3_pullup_verdict_matches_the_hand_calculation(seed):
    rnd = random.Random(1000 + seed)
    rp = round(10 ** rnd.uniform(2.3, 5.0))
    cb = rnd.choice([10, 50, 100, 200, 400])
    mode = rnd.choice(["standard", "fast"])
    d = reference_design()
    for ref in ("R1", "R2"):
        d.instance(ref).params["ohms"] = rp
    d.assumptions["i2c_cb_pf"], d.assumptions["i2c_mode"] = cb, mode
    rise = 0.8473 * rp * cb * 1e-3
    limit = 1000.0 if mode == "standard" else 300.0
    if abs(rise - limit) / limit < 1e-6 or abs(rp - 2900 / 3) < 1e-3:
        pytest.skip("knife edge")
    finding = next(f for f in run_b3(d, LIB).findings if f.check == "I2C pull-ups")
    assert (finding.status == "pass") == hand_pullup_ok(rp, cb, mode), (rp, cb, mode, finding.detail)
    assert finding.status in ("pass", "fail")


# ---- B5 against an independent hand calculation ------------------------------------------------------------------------

@pytest.mark.parametrize("seed", range(60))
def test_b5_arithmetic_matches_the_hand_calculation(seed):
    rnd = random.Random(2000 + seed)
    cap = rnd.choice([100, 500, 1000, 2000, 5000])
    usable = rnd.choice([0.5, 0.7, 0.8, 0.9, 1.0])
    period = rnd.choice([10, 60, 600, 3600, 86400])
    active = rnd.choice([0.5, 1, 5, 20])
    if active > period:
        active = period / 2
    target = rnd.choice([12, 48, 100, 500, 5000])
    d = reference_design()
    d.assumptions.update(battery_capacity_mah=cap, battery_usable_fraction=usable, period_s=period, active_s=active,
                         target_hours=target)
    # hand calculation from the cited facts: ESP32 Wi-Fi TX 240 mA / deep sleep 10 uA, BME280 714 uA / 0.1 uA, LDO Iq 50 uA
    i_act = 240 + 0.714 + 0.050
    i_slp = 0.010 + 0.0001 + 0.050
    avg = (i_act * active + i_slp * (period - active)) / period
    life = cap * usable / avg
    if abs(life - target) / target < 1e-6:
        pytest.skip("knife edge")
    r = run_b5(d, LIB)
    assert r.status == ("pass" if life >= target else "fail")
    assert f"average {avg:.3f} mA" in r.detail and f"= {life:.0f} h vs target {target:g} h" in r.detail


# ---- honesty invariants over many variants ---------------------------------------------------------------------------

def mutations(seed: int) -> Design:
    rnd = random.Random(3000 + seed)
    d = permuted(seed)
    for _ in range(rnd.randint(1, 3)):
        kind = rnd.choice(["drop_conn", "swap_nets", "ohms", "rename_part", "dup_pin", "assumption", "firmware"])
        nets = [n for n in d.nets if n.pins]
        if kind == "drop_conn":
            n = rnd.choice(nets)
            n.pins.remove(rnd.choice(n.pins))
        elif kind == "swap_nets":
            a, b = rnd.sample(nets, 2)
            if a.pins and b.pins:
                pa, pb = rnd.choice(a.pins), rnd.choice(b.pins)
                a.pins.remove(pa), b.pins.remove(pb)
                a.pins.append(pb), b.pins.append(pa)
        elif kind == "ohms":
            r = rnd.choice([i for i in d.instances if i.part == "res"])
            r.params["ohms"] = rnd.choice([0, 1, 100, 4700, 5100, 100000, 10**9])
        elif kind == "rename_part":
            rnd.choice(d.instances).part = "mystery_part"
        elif kind == "dup_pin":
            n, m = rnd.sample(nets, 2)
            m.pins.append(rnd.choice(n.pins))
        elif kind == "assumption":
            d.assumptions[rnd.choice(["i2c_cb_pf", "period_s", "active_s", "battery_capacity_mah"])] = rnd.choice([1, 50, 1e6])
        else:
            d.firmware_pins[rnd.randrange(len(d.firmware_pins))].pin = rnd.choice(["GPIO12", "GPIO6", "GPIO34", "GPIO99"])
    return d


@pytest.mark.parametrize("seed", range(120))
def test_honesty_invariants_hold_on_random_mutations(seed):
    d = mutations(seed)
    results = run_ladder(d, LIB)
    assert [r.rung for r in results] == list(IMPLEMENTED_RUNGS)
    for r in results:
        assert (r.label is not None) == (r.status == "pass")           # labels only on pass
        assert r.status in ("pass", "fail", "unknown")
        for e in r.evidence:                                            # every cited fact id resolves
            assert resolve_fact(LIB, e) is not None, (r.rung, e)
        if r.status != "pass":
            assert r.detail
    if results[0].status != "pass":                                     # later rungs never pass after a failed B1
        assert all(r.status == "unknown" and "B1" in r.detail for r in results[1:])
    if any(r.status != "pass" for r in results):
        assert not (all(r.status == "pass" for r in results))
