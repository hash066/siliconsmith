"""`hardwright`: run the checks from a terminal, a script or CI.

    hardwright board templates
    hardwright board check design.json            # exit 0 if all five pass, 1 if not, 2 on bad input
    hardwright board check --template fault_gpio12_vs_gpio14
    hardwright board fix-pin --template fault_gpio12_vs_gpio14 wake_btn GPIO14
    hardwright matter simulate --power 5 --stl heat-sink.stl
    hardwright mcp                                 # start the MCP server (see `hardwright mcp --help`)
Add --json to any command for machine-readable output.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from . import __version__, api
from .mcp import SETUP, _board_text, _matter_text, serve


def _emit(obj: Any, text: str, as_json: bool) -> None:
    print(json.dumps(obj, indent=2) if as_json else text)


def build() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="hardwright", description="Verifiers a hardware agent cannot argue with.")
    ap.add_argument("--version", action="version", version=f"hardwright {__version__}")
    sub = ap.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("board", help="check a board design against its firmware and part facts").add_subparsers(dest="sub", required=True)
    p = b.add_parser("templates", help="list the built-in example designs")
    p.add_argument("--json", action="store_true")
    p = b.add_parser("template", help="print one example design as JSON")
    p.add_argument("id")
    p = b.add_parser("check", help="run checks B1 to B5 (exit 0 only if all pass)")
    p.add_argument("design", nargs="?", help="path to a design .json file, or '-' for stdin")
    p.add_argument("--template", help="check a built-in example instead")
    p.add_argument("--json", action="store_true")
    p = b.add_parser("fix-pin", help="move the firmware pin for a function and re-check")
    p.add_argument("function")
    p.add_argument("pin")
    p.add_argument("design", nargs="?")
    p.add_argument("--template")
    p.add_argument("--json", action="store_true")
    p = b.add_parser("parts", help="list the parts and facts the checks know")
    p.add_argument("--json", action="store_true")

    m = sub.add_parser("matter", help="simulate a 2D heat spreader").add_subparsers(dest="sub", required=True)
    p = m.add_parser("simulate", help="solve one spreader and compare it with plain-fin baselines")
    p.add_argument("--power", type=float, help="chip power in watts")
    p.add_argument("--generator", default="rect_fins", choices=["rect_fins", "radial_spokes"])
    p.add_argument("--param", action="append", default=[], metavar="NAME=INT", help="generator knob, repeatable (for example n_fins=8)")
    p.add_argument("--set", action="append", default=[], metavar="NAME=NUM", help="spreader setup, repeatable (for example h=60)")
    p.add_argument("--stl", help="write the printable STL here")
    p.add_argument("--json", action="store_true")

    mc = sub.add_parser("mcp", help="start the MCP server on stdio")
    mc.add_argument("--setup", action="store_true", help="print how to register it with your agent and exit")
    return ap


def _kv(items: list[str], conv: type) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for it in items:
        k, sep, v = it.partition("=")
        if not sep or not k:
            raise api.HardwrightError(f"expected NAME=VALUE, got {it!r}")
        try:
            out[k] = conv(v)
        except ValueError:
            raise api.HardwrightError(f"{k} must be a {conv.__name__}, got {v!r}") from None
    return out


def _design_arg(path: str | None) -> Any:
    if path == "-":
        return sys.stdin.read()
    return path


def main(argv: list[str] | None = None) -> int:
    a = build().parse_args(argv)
    try:
        if a.cmd == "mcp":
            if a.setup:
                print(SETUP)
                return 0
            serve()
            return 0
        if a.cmd == "board":
            if a.sub == "templates":
                ts = api.board_templates()
                _emit(ts, "\n".join(f"{t['id']:<28} {t['title']}" for t in ts), a.json)
                return 0
            if a.sub == "template":
                print(json.dumps(api.board_template(a.id), indent=2))
                return 0
            if a.sub == "parts":
                parts = api.board_parts()
                _emit(parts, "\n".join(f"{p.get('id', p.get('name', '?'))}" for p in parts), a.json)
                return 0
            if a.sub == "check":
                rep = api.board_check(_design_arg(a.design), template=a.template)
                _emit({k: rep[k] for k in ("passed", "checks", "notice")}, _board_text(rep), a.json)
                return 0 if rep["passed"] else 1
            if a.sub == "fix-pin":
                rep = api.board_fix_pin(_design_arg(a.design), function=a.function, pin=a.pin, template=a.template)
                _emit({k: rep[k] for k in ("passed", "checks", "changed", "design")}, _board_text(rep), a.json)
                return 0 if rep["passed"] else 1
        if a.cmd == "matter" and a.sub == "simulate":
            rep = api.matter_simulate(power_w=a.power, generator=a.generator, gen_params=_kv(a.param, int) or None, spreader=_kv(a.set, float) or None, stl_path=a.stl)
            _emit({k: rep[k] for k in ("solved", "peak_c", "material_fraction", "checks", "verdict", "baselines", "stl_path")}, _matter_text(rep), a.json)
            return 0 if rep["solved"] else 1
    except api.HardwrightError as e:
        print(f"hardwright: {e}", file=sys.stderr)
        return 2
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
