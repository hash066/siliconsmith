"""Held-out repair scenarios for the two weakest fault families (regulator overload, I2C address collision).

Written BEFORE any change to the model-facing layer so a baseline could be recorded on them (see README). They use
different refs, load values, nets, strap choices and pull-up values than the catalogue faults the prompts were tuned on.
Scenarios are data: edit operations on the clean reference design, in the same language as `faults.py`. They are only
scored by the deterministic ladder (the expected rung must fail on the injected design; the repair must pass B1 to B5).
"""

from __future__ import annotations

from typing import Any


def _sensor(ref: str, sdo_net: str) -> list[dict[str, Any]]:
    """Add a second BME280 on the shared I2C bus with its SDO strapped to `sdo_net`."""
    ops: list[dict[str, Any]] = [{"op": "add_instance", "ref": ref, "part": "bme280"}]
    for pin, net in (("VDD", "3V3"), ("VDDIO", "3V3"), ("CSB", "3V3"), ("GND1", "GND"), ("GND2", "GND"),
                     ("SDO", sdo_net), ("SDI", "SDA"), ("SCK", "SCL")):
        ops.append({"op": "connect", "ref": ref, "pin": pin, "net": net})
    return ops


def _load(ref: str, peak_ma: float, sleep_ma: float | None = None) -> list[dict[str, Any]]:
    params: dict[str, Any] = {"peak_ma": peak_ma}
    if sleep_ma is not None:
        params["sleep_ma"] = sleep_ma
    return [{"op": "add_instance", "ref": ref, "part": "load", "params": params},
            {"op": "connect", "ref": ref, "pin": "VCC", "net": "3V3"},
            {"op": "connect", "ref": ref, "pin": "GND", "net": "GND"}]


HELDOUT: list[dict[str, Any]] = [
    {"id": "overload_motor_650", "family": "regulator_overload", "expected_rung": "B2",
     "ops": _load("MOTOR1", 650, 0.2)},
    {"id": "overload_pump_fan", "family": "regulator_overload", "expected_rung": "B2",
     "ops": _load("PUMP1", 300, 0.1) + _load("FAN1", 250, 0.1)},
    {"id": "overload_ledstrip_1200", "family": "regulator_overload", "expected_rung": "B2",
     "ops": _load("STRIP1", 1200)},
    {"id": "collision_second_sensor", "family": "i2c_address_collision", "expected_rung": "B3",
     "ops": _sensor("SENS2", "GND")},
    {"id": "collision_both_high", "family": "i2c_address_collision", "expected_rung": "B3",
     "ops": [{"op": "disconnect", "ref": "U3", "pin": "SDO"}, {"op": "connect", "ref": "U3", "pin": "SDO", "net": "3V3"}]
     + _sensor("U6", "3V3")},
    {"id": "collision_2k2_pullups", "family": "i2c_address_collision", "expected_rung": "B3",
     "ops": [{"op": "set_param", "ref": "R1", "key": "ohms", "value": 2200},
             {"op": "set_param", "ref": "R2", "key": "ohms", "value": 2200}] + _sensor("U9", "GND")},
]
