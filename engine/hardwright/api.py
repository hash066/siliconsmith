"""The public Python API: deterministic hardware checks an agent (or a person) can call and not argue with.

Everything here is offline, free and reproducible: no model, no network, no API key. A result says what was checked and
which facts it rests on, and it never turns "unknown" into "pass".

    import hardwright as hw
    report = hw.board_check(template="fault_gpio12_vs_gpio14")
    report["passed"]            # False
    [c["id"] for c in report["checks"] if c["status"] == "fail"]   # ['B4']
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

from siliconsmith.board import serverless as _board
from siliconsmith.board.templates import list_templates, load_template

# The same one-line meaning of each board check the web app shows.
BOARD_CHECKS = {
    "B1": "The netlist is well formed (every pin, net and part exists).",
    "B2": "Electrical rules: pins are used in the way the part's datasheet facts allow.",
    "B3": "Power budget: supply and battery cover the load for the stated duty cycle.",
    "B4": "Firmware pin table agrees with the netlist, and no pin is a boot-strapping hazard.",
    "B5": "Bus rules: I2C addresses, pull-ups and rise time are consistent.",
}


class HardwrightError(ValueError):
    """Bad input (an unknown template, a malformed design, a value out of range). The message says what to change."""


def _as_design(design: Any = None, template: str | None = None) -> dict[str, Any]:
    if template is not None:
        try:
            return copy.deepcopy(load_template(template)["design"])
        except KeyError:
            ids = ", ".join(t["id"] for t in list_templates())
            raise HardwrightError(f"unknown template {template!r}; available: {ids}") from None
    if design is None:
        raise HardwrightError("give a design (a dict, JSON text or a path to a .json file) or a template id")
    if isinstance(design, (str, Path)):
        text = str(design)
        p = Path(text)
        if not text.lstrip().startswith("{") and p.suffix == ".json" and p.is_file():
            text = p.read_text(encoding="utf-8")
        try:
            design = json.loads(text)
        except json.JSONDecodeError as e:
            raise HardwrightError(f"the design is not valid JSON: {e}") from None
    if not isinstance(design, dict):
        raise HardwrightError("a design must be a JSON object with instances and nets")
    return copy.deepcopy(design)


def board_templates() -> list[dict[str, Any]]:
    """The built-in example designs (one clean, two with a known wiring fault): id, title, description, expected results."""
    return list_templates()


def board_template(template: str) -> dict[str, Any]:
    """One example design as a dict, ready to edit and pass to `board_check`."""
    return _as_design(template=template)


def board_check(design: Any = None, *, template: str | None = None, header: str | None = None) -> dict[str, Any]:
    """Run the five board checks (B1 to B5) on a netlist-level design.

    Returns {"passed": bool, "checks": [{id, meaning, status, claim, detail, evidence}], "notice": str, "design_name": str}.
    `status` is "pass", "fail" or "unknown"; only "pass" carries a `claim`. `passed` is True only if all five pass.
    This checks the netlist against author-curated part facts. It does not prove a board works."""
    d = _as_design(design, template)
    res = _board.check(d, header)
    if not res.get("ok"):
        err = res.get("error", {})
        detail = "; ".join(f"{e.get('path')}: {e.get('message')}" for e in err.get("errors", [])[:4])
        raise HardwrightError(f"{err.get('message', 'the design was rejected')}{(' (' + detail + ')') if detail else ''}")
    checks = []
    for r in res["rungs"]:
        status = r["status"] if r["status"] in ("pass", "fail") else "unknown"
        checks.append(
            {
                "id": r["rung"],
                "meaning": BOARD_CHECKS.get(r["rung"], ""),
                "status": status,
                "claim": r.get("label") if status == "pass" else None,
                "detail": r.get("detail", ""),
                "evidence": list(r.get("evidence", [])),
            }
        )
    return {"passed": bool(res["passed"]), "checks": checks, "notice": res["notice"], "design_name": d.get("name", ""), "design": d, "header": res["header"]}


def board_fix_pin(design: Any = None, *, function: str, pin: str, template: str | None = None) -> dict[str, Any]:
    """Change which GPIO the firmware pin table uses for one function (for example wake_btn) and re-check.

    This is the edit that fixes a firmware/netlist disagreement. It does not rewire the netlist: if the netlist is the side
    that is wrong, change the design yourself. Returns the same report as `board_check` plus {"changed": {function, from, to}}."""
    d = _as_design(design, template)
    rows = d.get("firmware_pins")
    if not isinstance(rows, list):
        raise HardwrightError("the design has no firmware_pins table to edit")
    row = next((r for r in rows if isinstance(r, dict) and r.get("function") == function), None)
    if row is None:
        raise HardwrightError(f"the firmware pin table has no function {function!r}; it has: {', '.join(str(r.get('function')) for r in rows)}")
    before, row["pin"] = row.get("pin"), pin
    out = board_check(d)
    out["changed"] = {"function": function, "from": before, "to": pin}
    return out


def board_parts() -> list[dict[str, Any]]:
    """The part library the checks rest on, with each part's facts and whether they are checked against a citation."""
    return _board._parts_summary()


def board_faults() -> list[dict[str, Any]]:
    """The catalogue of known wiring faults the checker is tested against (id, title, which check must catch it)."""
    from siliconsmith.board import faults

    return [{"id": f.id, "title": f.title, "description": f.description, "expected_check": f.expected_rung} for f in faults.FAULTS]


def matter_simulate(
    *,
    power_w: float | None = None,
    generator: str = "rect_fins",
    gen_params: dict[str, int] | None = None,
    spreader: dict[str, float] | None = None,
    stl_path: str | Path | None = None,
) -> dict[str, Any]:
    """Simulate a 2D heat spreader (steady state) on a validated solver and compare it with plain-fin baselines.

    `generator` is "rect_fins" or "radial_spokes"; `gen_params` are its integer knobs (for example n_fins, fin_len);
    `spreader` is the advanced plate/material/cooling setup (keys: n, dx_mm, t_mm, k, h, T_inf, Q, chip, budget_fraction,
    min_feature). `power_w` is shorthand for spreader["Q"]. With `stl_path` the printable part is written there (millimetres).

    Returns {"solved": bool, "peak_c", "material_fraction", "checks": [M1..M5], "verdict", "baselines", "limits", "stl_path"}.
    A geometry rejected before the solve returns solved False and says which check rejected it."""
    try:
        from siliconsmith.matter import serverless as m
        from siliconsmith.matter import limits as mlim
    except ImportError as e:  # numpy and scipy come with the "matter" extra
        raise HardwrightError("the Matter solver needs numpy and scipy: pip install 'hardwright[matter]'") from e
    sp = dict(spreader or {})
    if power_w is not None:
        sp["Q"] = power_w
    params: dict[str, Any] = {"generator": generator, "spreader": sp}
    if gen_params:
        params["gen_params"] = gen_params
    if stl_path is not None:
        params["include_stl"] = True
    try:
        res = m.simulate(params)
    except mlim.InputError as e:
        raise HardwrightError(str(e)) from None
    metrics = res.get("metrics", {})
    solved = isinstance(metrics.get("peak_temp_c"), (int, float))
    out: dict[str, Any] = {
        "solved": solved,
        "generator": res["generator"],
        "gen_params": res["gen_params"],
        "spreader": res["spreader"],
        "peak_c": metrics.get("peak_temp_c"),
        "material_fraction": metrics.get("material_fraction"),
        "checks": [{"id": r["id"], "status": r["status"], "detail": r.get("detail", "")} for r in res["ladder"]],
        "first_failure": res.get("first_failure"),
        "verdict": res.get("verdict"),
        "baselines": res.get("baselines"),
        "limits": res.get("limits"),
        "stl_path": None,
    }
    if stl_path is not None and "stl" in res:
        import base64

        p = Path(stl_path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(base64.b64decode(res["stl"]["base64"]))
        out["stl_path"] = str(p)
        out["stl_bytes"] = res["stl"]["bytes"]
    return out
