"""Fault catalogue (as data), the clean reference design, and fault injection.

A fault is a list of small edit operations applied to a copy of the clean design:
    connect {ref, pin, net}      disconnect {ref, pin}
    add_instance {ref, part, params}   remove_instance {ref}   set_param {ref, key, value}
    set_assignment {function, pin, net?}   set_firmware {function, pin}
`expected_rung` is the rung that will catch the fault once built; `implemented` says whether that rung
exists yet. Nothing here claims a fault is detected: the tests and the README table do that.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel

from .checks import IMPLEMENTED_RUNGS
from .netlist import DESIGNS_DIR, Design, Net, load_design, split_pin

REFERENCE_TEMPLATE = "battery_env_sensor"


class Fault(BaseModel):
    id: str
    title: str
    description: str
    expected_rung: Literal["B1", "B2", "B3", "B4"]
    ops: list[dict[str, Any]]

    @property
    def implemented(self) -> bool:
        """Is expected_rung implemented in checks.py today?"""
        return self.expected_rung in IMPLEMENTED_RUNGS


FAULTS: list[Fault] = [
    Fault(id="pin_mismatch", title="Firmware and netlist disagree on a pin",
          description="Firmware header puts the wake button on GPIO12; the netlist wires it to GPIO14.",
          expected_rung="B4",
          ops=[{"op": "set_firmware", "function": "wake_btn", "pin": "GPIO12"}]),
    Fault(id="strapping_pin_misuse", title="Wake button on a strapping pin",
          description="The wake button is wired and declared on GPIO12, a boot-strapping pin, with a switch to ground.",
          expected_rung="B4",
          ops=[{"op": "disconnect", "ref": "U1", "pin": "GPIO14"},
               {"op": "connect", "ref": "U1", "pin": "GPIO12", "net": "WAKE"},
               {"op": "set_assignment", "function": "wake_btn", "pin": "GPIO12", "net": "WAKE"},
               {"op": "set_firmware", "function": "wake_btn", "pin": "GPIO12"}]),
    Fault(id="input_only_output", title="Output function on an input-only pin",
          description="The status LED driver is moved to GPIO34, which is input-only, in netlist and firmware.",
          expected_rung="B4",
          ops=[{"op": "disconnect", "ref": "U1", "pin": "GPIO4"},
               {"op": "connect", "ref": "U1", "pin": "GPIO34", "net": "LED_DRV"},
               {"op": "set_assignment", "function": "status_led", "pin": "GPIO34", "net": "LED_DRV"},
               {"op": "set_firmware", "function": "status_led", "pin": "GPIO34"}]),
    Fault(id="i2c_pullup_too_large", title="I2C pull-ups too large",
          description="SDA and SCL pull-ups are 100 kOhm, too weak for the bus rise-time limit.",
          expected_rung="B3",
          ops=[{"op": "set_param", "ref": "R1", "key": "ohms", "value": 100000},
               {"op": "set_param", "ref": "R2", "key": "ohms", "value": 100000}]),
    Fault(id="missing_cc_resistors", title="USB-C CC resistors missing",
          description="The two 5.1 kOhm sink pull-downs on CC1 and CC2 are not fitted.",
          expected_rung="B3",
          ops=[{"op": "remove_instance", "ref": "R5"}, {"op": "remove_instance", "ref": "R6"}]),
    Fault(id="regulator_overload", title="Regulator overloaded",
          description="An 800 mA external load is added to the 3.3 V rail of a 600 mA regulator.",
          expected_rung="B2",
          ops=[{"op": "add_instance", "ref": "LOAD1", "part": "load", "params": {"peak_ma": 800}},
               {"op": "connect", "ref": "LOAD1", "pin": "VCC", "net": "3V3"},
               {"op": "connect", "ref": "LOAD1", "pin": "GND", "net": "GND"}]),
    Fault(id="overvoltage_3v3_pin", title="5 V on a 3.3 V supply pin",
          description="The BME280 VDD pin is moved from the 3.3 V rail to the USB VBUS net.",
          expected_rung="B2",
          ops=[{"op": "disconnect", "ref": "U3", "pin": "VDD"},
               {"op": "connect", "ref": "U3", "pin": "VDD", "net": "VBUS"}]),
    Fault(id="i2c_address_collision", title="Two sensors at the same I2C address",
          description="A second BME280 with SDO to ground shares the bus with the first, both at 0x76.",
          expected_rung="B3",
          ops=[{"op": "add_instance", "ref": "U4", "part": "bme280"},
               {"op": "connect", "ref": "U4", "pin": "VDD", "net": "3V3"},
               {"op": "connect", "ref": "U4", "pin": "VDDIO", "net": "3V3"},
               {"op": "connect", "ref": "U4", "pin": "CSB", "net": "3V3"},
               {"op": "connect", "ref": "U4", "pin": "GND1", "net": "GND"},
               {"op": "connect", "ref": "U4", "pin": "GND2", "net": "GND"},
               {"op": "connect", "ref": "U4", "pin": "SDO", "net": "GND"},
               {"op": "connect", "ref": "U4", "pin": "SDI", "net": "SDA"},
               {"op": "connect", "ref": "U4", "pin": "SCK", "net": "SCL"}]),
]

# Structural faults: outside the 8-fault demo catalogue, they exercise the B1 rung that exists today.
STRUCTURAL_FAULTS: list[Fault] = [
    Fault(id="floating_required_pin", title="Required pin left unconnected",
          description="The ESP32 EN pin is disconnected.", expected_rung="B1",
          ops=[{"op": "disconnect", "ref": "U1", "pin": "EN"}]),
    Fault(id="two_output_drivers", title="Two drivers on one net",
          description="The regulator output is tied to the USB VBUS net, which the connector also drives.",
          expected_rung="B1",
          ops=[{"op": "connect", "ref": "U2", "pin": "VOUT", "net": "VBUS"}]),
    Fault(id="nonexistent_pin", title="Connection to a pin the part does not have",
          description="A net is wired to U1.GPIO99, which is not in the ESP32 pin table.", expected_rung="B1",
          ops=[{"op": "connect", "ref": "U1", "pin": "GPIO99", "net": "SDA"}]),
]


def reference_design() -> Design:
    """The clean 'battery environmental sensor' design. Partial: no charger IC part exists yet, so the
    USB-C VBUS net ends at the connector."""
    return load_design(DESIGNS_DIR / f"{REFERENCE_TEMPLATE}.json")


def fault_by_id(fault_id: str) -> Fault:
    for f in FAULTS + STRUCTURAL_FAULTS:
        if f.id == fault_id:
            return f
    raise KeyError(f"unknown fault {fault_id!r}")


def _net(design: Design, name: str) -> Net:
    net = design.net(name)
    if net is None:
        net = Net(name=name, pins=[])
        design.nets.append(net)
    return net


def _disconnect(design: Design, ref: str, pin: str) -> None:
    key = f"{ref}.{pin}"
    for n in design.nets:
        n.pins = [p for p in n.pins if p != key]


def _apply(design: Design, op: dict[str, Any]) -> None:
    kind = op["op"]
    if kind == "connect":
        _net(design, op["net"]).pins.append(f"{op['ref']}.{op['pin']}")
    elif kind == "disconnect":
        _disconnect(design, op["ref"], op["pin"])
    elif kind == "add_instance":
        from .netlist import Instance
        design.instances.append(Instance(ref=op["ref"], part=op["part"], params=op.get("params", {})))
    elif kind == "remove_instance":
        design.instances = [i for i in design.instances if i.ref != op["ref"]]
        for n in design.nets:
            n.pins = [p for p in n.pins if split_pin(p)[0] != op["ref"]]
    elif kind == "set_param":
        inst = design.instance(op["ref"])
        if inst is None:
            raise ValueError(f"set_param: no instance {op['ref']}")
        inst.params[op["key"]] = op["value"]
    elif kind == "set_assignment":
        a = next((a for a in design.mcu_assignments if a.function == op["function"]), None)
        if a is None:
            raise ValueError(f"set_assignment: no function {op['function']}")
        a.pin = op["pin"]
        a.net = op.get("net", a.net)
    elif kind == "set_firmware":
        f = next((f for f in design.firmware_pins if f.function == op["function"]), None)
        if f is None:
            raise ValueError(f"set_firmware: no function {op['function']}")
        f.pin = op["pin"]
    else:
        raise ValueError(f"unknown fault op {kind!r}")


def inject_ops(design: Design, ops: list[dict[str, Any]]) -> Design:
    """Return a copy of `design` with the edit operations applied; the input is never modified."""
    out = design.copy()
    for op in ops:
        _apply(out, op)
    return out


def inject_fault(design: Design, fault_id: str) -> Design:
    """Return a copy of `design` with the named fault applied; the input is never modified."""
    return inject_ops(design, fault_by_id(fault_id).ops)
