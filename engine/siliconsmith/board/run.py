"""Run the Board agent end to end and write the v2 event log plus artifacts.

    python -m siliconsmith.board.run propose  [--run-id ID] [--budget USD] [--env-file PATH]
    python -m siliconsmith.board.run repair --fault pin_mismatch [...]

`propose` asks Nemotron (Ultra architects, Super repairs) for a design from the template brief. `repair` injects a named
fault into the clean reference design and asks the model to repair it; the injected design is judged first and is not
model output. Event log: runs/logs/<run_id>.ndjson. Artifacts (netlist, header, BOM, design JSON) are written only for a
design that passed every implemented rung, under runs/board/<run_id>/. The CLI prints no secrets; `--env-file` only
loads key=value lines into this process, like the engine's own .env.local loader.
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any

from . import faults
from .agent import LADDER_EVENT, AgentResult, Brief, propose_design, repair_design
from .export import bom, kicad_netlist
from .netlist import dump_design
from .parts import Part, load_library

TEMPLATE_ID = "battery_env_sensor"
TEMPLATE_TITLE = "Battery environmental sensor"
TEMPLATE_TEXT = (
    "Battery environmental sensor: an ESP32 module, an I2C temperature/humidity/pressure sensor, a single Li-ion cell "
    "and a USB-C connector, 48 h battery target. Use the library parts only. Power: the cell connector feeds the "
    "3.3 V LDO; the 3.3 V rail powers the module and the sensor. The USB-C connector is a sink: it must present the sink pull-downs on both CC pins, "
    "and its VBUS feeds the Li-ion charger part (mcp73831), whose battery pin joins the cell's positive net and whose "
    "PROG pin needs a 2 kohm resistor to ground. "
    "Functions the firmware pin table must declare (use these exact names): i2c_sda, i2c_scl (bus to the sensor, "
    "with pull-ups), wake_btn (a push button to ground, input) and status_led (an LED through a series resistor, "
    "output). The module enable pin needs a pull-up. Choose GPIOs that avoid flash pins, strapping pins and input-only "
    "pins used as outputs. Give the sensor a unique I2C address and tie every required pin."
)


def template_brief() -> Brief:
    return Brief(TEMPLATE_TITLE, TEMPLATE_TEXT, assumptions=dict(faults.reference_design().assumptions))


def load_env_file(path: Path) -> None:
    """Load KEY=VALUE lines into os.environ (existing variables win). Values are never printed."""
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def build_artifacts(result: AgentResult, library: dict[str, Part]) -> list[dict[str, str]]:
    """Design JSON, KiCad netlist, firmware header and BOM of a PASSING final attempt, with the SHA-256 of each text
    (UTF-8, LF line endings). Empty for a failed run. Pure: nothing is written."""
    final = result.final
    if not result.passed or final is None:
        return []
    files = {
        "design": ("design.json", dump_design(final.design)),
        "kicad-netlist": ("netlist.net", kicad_netlist(final.design, library)),
        "firmware-header": ("pins.h", final.header),
        "bom": ("bom.json", json.dumps(bom(final.design, library), indent=2) + "\n"),
    }
    return [{"kind": kind, "path": name, "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(), "content": text}
            for kind, (name, text) in files.items()]


def write_artifacts(result: AgentResult, library: dict[str, Part], out_dir: Path, bus: Any) -> list[dict[str, str]]:
    """Write the artifacts of a PASSING final attempt to out_dir and emit artifact.created for each."""
    made = []
    for art in build_artifacts(result, library):
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / art["path"]).write_text(art["content"], encoding="utf-8", newline="\n")
        bus.emit("artifact.created", kind=art["kind"], path=art["path"], sha256=art["sha256"],
                 node_id=result.final.node_id)
        made.append({k: art[k] for k in ("kind", "path", "sha256")})
    return made


def emit_started(bus: Any, brief: Brief, *, fault_id: str | None = None, max_repairs: int = 2) -> None:
    bus.emit("run.started", domain="board", ladder=LADDER_EVENT,
             workload={"id": TEMPLATE_ID, "title": brief.name + (f" (injected fault: {fault_id})" if fault_id else ""),
                       "lang": "c"},
             config={"area_budget_pct": 0, "beam": 1, "k_root": 1, "k_child": 1, "max_depth": max_repairs + 1,
                     "max_concurrency": 1},
             backend="local")


def emit_finished(bus: Any, result: AgentResult, llm: Any, t0: float) -> None:
    if result.passed:
        bus.emit("run.completed", best_node_id=result.final.node_id, pareto=[result.final.node_id],
                 totals={"nodes": len(result.attempts), "sandboxes": 0, "cost_usd": round(result.cost_usd, 6),
                         "tokens": getattr(llm, "tokens", 0), "wall_s": round(time.monotonic() - t0, 1)},
                 report={})
    else:
        bus.emit("run.failed", error=result.error or "ladder did not pass")


def run_board(llm: Any, bus: Any, brief: Brief, library: dict[str, Part], *, mode: str = "propose",
              fault_id: str | None = None, out_dir: Path, max_repairs: int = 2) -> AgentResult:
    t0 = time.monotonic()
    emit_started(bus, brief, fault_id=fault_id, max_repairs=max_repairs)
    try:
        if mode == "repair":
            if not fault_id:
                raise ValueError("repair mode needs a fault id")
            broken = faults.inject_fault(faults.reference_design(), fault_id)
            result = repair_design(llm, broken, brief, library, max_repairs=max_repairs, bus=bus,
                                   first_note=f"reference design with injected fault '{fault_id}' (not model output)")
        else:
            result = propose_design(llm, brief, library, max_repairs=max_repairs, bus=bus)
    except Exception as e:
        bus.emit("run.failed", error=f"{type(e).__name__}: {e}"[:500])
        if hasattr(bus, "close"):
            bus.close()
        raise
    # every judged design is kept, failing ones too, so a failed run can be read afterwards (not artifacts of a pass)
    attempts_dir = out_dir / "attempts"
    attempts_dir.mkdir(parents=True, exist_ok=True)
    for att in result.attempts:
        (attempts_dir / f"{att.node_id}.json").write_text(dump_design(att.design), encoding="utf-8", newline="\n")
    write_artifacts(result, library, out_dir, bus)
    emit_finished(bus, result, llm, t0)
    if hasattr(bus, "close"):
        bus.close()
    return result


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="siliconsmith.board.run")
    ap.add_argument("mode", choices=["propose", "repair"])
    ap.add_argument("--fault", choices=[f.id for f in faults.FAULTS + faults.STRUCTURAL_FAULTS])
    ap.add_argument("--run-id")
    ap.add_argument("--budget", type=float, default=0.30, help="USD cap for this run (default 0.30)")
    ap.add_argument("--env-file", type=Path, help="file with NEBIUS_API_KEY etc.; loaded into this process only")
    ap.add_argument("--max-repairs", type=int, default=2)
    args = ap.parse_args(argv)
    if args.env_file:
        load_env_file(args.env_file)

    from .. import paths
    from ..config import settings
    from ..events import EventBus
    from ..llm import Nemotron

    run_id = args.run_id or f"board-{args.mode}-{(args.fault or 'template')}-{time.strftime('%Y%m%d-%H%M%S')}"
    bus = EventBus(run_id, paths.RUN_LOGS / f"{run_id}.ndjson")
    llm = Nemotron(dataclasses.replace(settings(), run_budget_usd=args.budget), bus)
    out_dir = paths.ROOT / "runs" / "board" / run_id
    result = run_board(llm, bus, template_brief(), load_library(), mode=args.mode, fault_id=args.fault,
                       out_dir=out_dir, max_repairs=args.max_repairs)
    print(f"run_id={run_id} passed={result.passed} attempts={len(result.attempts)} cost_usd={result.cost_usd:.4f}")
    if result.final:
        print("ladder: " + " ".join(f"{r.rung}={r.status}" for r in result.final.results))
    if result.error:
        print(f"error: {result.error}")
    return 0 if result.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
