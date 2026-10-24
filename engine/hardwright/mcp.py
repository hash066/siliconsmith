"""A Model Context Protocol server (stdio) that gives any coding agent Hardwright's verifiers.

Run `hardwright mcp` and register it with your agent; see `hardwright mcp --help` for the one-line setup of each client.
Newline-delimited JSON-RPC 2.0 over stdin/stdout, the MCP "stdio" transport. Standard library only; the tools call the same
offline, deterministic checks as the Python API. Logs go to stderr, never stdout.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Callable, TextIO

from . import __version__
from . import api

PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")

INSTRUCTIONS = (
    "Hardwright gives you checkers that cannot be argued with. Use board_check before you tell a user that a board or its "
    "firmware pin map is right, and matter_simulate before you claim a heat sink meets a temperature. Report each check's "
    "status as returned: 'unknown' is not a pass, and a passing board_check is netlist-level only, not proof the board works. "
    "Cite the evidence ids a result gives you. If a check fails, say so and fix the design instead of reassuring the user."
)

_DESIGN_PROP = {
    "oneOf": [{"type": "object"}, {"type": "string"}],
    "description": "The design as a JSON object, or its JSON text. Omit it and pass template_id to use a built-in example.",
}

TOOLS: list[dict[str, Any]] = [
    {
        "name": "board_templates",
        "description": "List the built-in example board designs (a clean sensor board and two with known wiring faults).",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "board_get_template",
        "description": "Return one built-in example board design as JSON, ready to edit and check.",
        "inputSchema": {"type": "object", "properties": {"template_id": {"type": "string"}}, "required": ["template_id"], "additionalProperties": False},
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "board_check",
        "description": (
            "Run the five board checks (B1 well-formed, B2 electrical rules, B3 power budget, B4 firmware pins vs netlist and "
            "boot-strapping hazards, B5 bus rules) on a netlist-level design. Free and offline. Each check is pass, fail or "
            "unknown; only pass is a claim. Not proof that the board works."
        ),
        "inputSchema": {"type": "object", "properties": {"design": _DESIGN_PROP, "template_id": {"type": "string"}}, "additionalProperties": False},
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "board_fix_pin",
        "description": "Move the firmware pin for one function (for example wake_btn) to another GPIO and re-check. Use it when B4 says the firmware and netlist disagree or a pin is unsafe.",
        "inputSchema": {
            "type": "object",
            "properties": {"design": _DESIGN_PROP, "template_id": {"type": "string"}, "function": {"type": "string"}, "pin": {"type": "string", "pattern": "^[A-Za-z0-9_]{1,16}$"}},
            "required": ["function", "pin"],
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "board_parts",
        "description": "List the parts the board checks know, with their facts and whether each fact is checked against a citation.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "matter_simulate",
        "description": (
            "Simulate a 2D heat spreader (steady state) on a validated solver, check it on five rungs (M1 solver validated, M2 valid "
            "geometry, M3 printable, M4 second solver agrees, M5 beats baselines) and compare it with plain-fin baselines. Optionally "
            "write the printable STL. Assumptions are stated in the result; this is not CFD and not a measurement."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "power_w": {"type": "number", "minimum": 0.1, "maximum": 100, "description": "Chip power in watts."},
                "generator": {"type": "string", "enum": ["rect_fins", "radial_spokes"]},
                "gen_params": {"type": "object", "description": "Integer knobs of the generator, for example {\"n_fins\": 8, \"fin_len\": 16}."},
                "spreader": {"type": "object", "description": "Advanced setup: n, dx_mm, t_mm, k, h, T_inf, Q, chip, budget_fraction, min_feature."},
                "stl_path": {"type": "string", "description": "Write the printable part here (a relative .stl path inside the working directory)."},
            },
            "additionalProperties": False,
        },
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": True},
    },
]


def _pick_design(args: dict[str, Any]) -> tuple[Any, str | None]:
    tid = args.get("template_id")
    return args.get("design"), (str(tid) if tid is not None else None)


def _safe_stl(path: str) -> str:
    p = Path(path)
    if p.suffix.lower() != ".stl" or p.is_absolute() or ".." in p.parts:
        raise api.HardwrightError("stl_path must be a relative path ending in .stl, inside the working directory")
    return str(p)


def _board_text(rep: dict[str, Any]) -> str:
    lines = [f"Board check{(' of ' + rep['design_name']) if rep.get('design_name') else ''}: {'ALL 5 PASS' if rep['passed'] else 'NOT ALL PASS'}"]
    for c in rep["checks"]:
        mark = {"pass": "PASS", "fail": "FAIL", "unknown": "UNKNOWN"}[c["status"]]
        lines.append(f"- {c['id']} {mark}: {c['claim'] or c['detail']}")
        if c["status"] != "pass" and c["evidence"]:
            lines.append(f"    facts: {', '.join(c['evidence'][:6])}")
    if "changed" in rep:
        ch = rep["changed"]
        lines.insert(1, f"Changed firmware {ch['function']} from {ch['from']} to {ch['to']}.")
    lines.append(rep["notice"])
    return "\n".join(lines)


def _matter_text(rep: dict[str, Any]) -> str:
    if not rep["solved"]:
        rej = rep.get("first_failure") or "a check"
        detail = next((c["detail"] for c in rep["checks"] if c["status"] == "fail"), "")
        return f"Nothing was solved: {rej} rejected this geometry. {detail}".strip()
    v = rep.get("verdict") or {}
    base = rep.get("baselines") or {}
    eq = (base.get("equal_material") or {}).get("delta_k")
    lines = [
        f"Peak temperature {rep['peak_c']:.1f} C using {100 * (rep['material_fraction'] or 0):.0f}% of the plate as material ({rep['generator']}, {rep['gen_params']}).",
        "Checks: " + ", ".join(f"{c['id']} {c['status']}" for c in rep["checks"]) + ".",
    ]
    if eq is not None:
        lines.append(f"Against plain fins with the same material: {abs(eq):.2f} K {'cooler' if eq >= 0 else 'hotter'}.")
    if v.get("label"):
        lines.append(f"Verdict: {v['label']}.")
    if rep.get("stl_path"):
        lines.append(f"Wrote {rep['stl_path']} ({rep.get('stl_bytes', 0)} bytes, millimetres).")
    for s in (rep.get("limits") or [])[:3]:
        lines.append(f"Limit: {s}")
    return "\n".join(lines)


def _call(name: str, args: dict[str, Any]) -> tuple[str, Any]:
    """Returns (text, structured). Raises api.HardwrightError for input the caller should fix."""
    if name == "board_templates":
        ts = api.board_templates()
        return "\n".join(f"- {t['id']}: {t['title']}. {t['description']}" for t in ts), {"templates": ts}
    if name == "board_get_template":
        d = api.board_template(str(args.get("template_id", "")))
        return json.dumps(d, indent=2), {"design": d}
    if name == "board_check":
        d, t = _pick_design(args)
        rep = api.board_check(d, template=t)
        return _board_text(rep), {k: rep[k] for k in ("passed", "checks", "notice", "design_name")}
    if name == "board_fix_pin":
        d, t = _pick_design(args)
        rep = api.board_fix_pin(d, function=str(args.get("function", "")), pin=str(args.get("pin", "")), template=t)
        return _board_text(rep) + "\n\nThe edited design:\n" + json.dumps(rep["design"], indent=2), {k: rep[k] for k in ("passed", "checks", "changed")}
    if name == "board_parts":
        parts = api.board_parts()
        return json.dumps(parts, indent=2), {"parts": parts}
    if name == "matter_simulate":
        stl = args.get("stl_path")
        rep = api.matter_simulate(
            power_w=args.get("power_w"),
            generator=args.get("generator", "rect_fins"),
            gen_params=args.get("gen_params"),
            spreader=args.get("spreader"),
            stl_path=_safe_stl(stl) if isinstance(stl, str) else None,
        )
        slim = {k: rep[k] for k in ("solved", "peak_c", "material_fraction", "checks", "verdict", "stl_path")}
        return _matter_text(rep), slim
    raise KeyError(name)


def handle(msg: dict[str, Any]) -> dict[str, Any] | None:
    """One JSON-RPC message in, the response out (None for a notification)."""
    mid = msg.get("id")
    method = msg.get("method")
    params = msg.get("params") or {}

    def ok(result: Any) -> dict[str, Any]:
        return {"jsonrpc": "2.0", "id": mid, "result": result}

    def err(code: int, message: str) -> dict[str, Any]:
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": message}}

    if mid is None:  # a notification (initialized, cancelled, ...): no reply
        return None
    if method == "initialize":
        asked = params.get("protocolVersion")
        return ok(
            {
                "protocolVersion": asked if asked in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0],
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "hardwright", "title": "Hardwright verifiers", "version": __version__},
                "instructions": INSTRUCTIONS,
            }
        )
    if method == "ping":
        return ok({})
    if method == "tools/list":
        return ok({"tools": TOOLS})
    if method == "tools/call":
        name = params.get("name")
        args = params.get("arguments") or {}
        if not isinstance(args, dict) or name not in {t["name"] for t in TOOLS}:
            return err(-32602, f"unknown tool or bad arguments: {name!r}")
        try:
            text, structured = _call(name, args)
        except api.HardwrightError as e:
            return ok({"content": [{"type": "text", "text": f"Not done: {e}"}], "isError": True})
        except Exception as e:  # a bug must not kill the server or leak a traceback to the model
            print(f"hardwright mcp: {name} failed: {type(e).__name__}: {e}", file=sys.stderr)
            return ok({"content": [{"type": "text", "text": f"The check could not run ({type(e).__name__}). Nothing was concluded."}], "isError": True})
        return ok({"content": [{"type": "text", "text": text}], "structuredContent": structured, "isError": False})
    return err(-32601, f"method not found: {method}")


def serve(stdin: TextIO | None = None, stdout: TextIO | None = None, handler: Callable[[dict[str, Any]], dict[str, Any] | None] = handle) -> None:
    stdin = stdin or sys.stdin
    stdout = stdout or sys.stdout
    for line in stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            stdout.write(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}) + "\n")
            stdout.flush()
            continue
        batch = msg if isinstance(msg, list) else [msg]
        for m in batch:
            if not isinstance(m, dict):
                continue
            out = handler(m)
            if out is not None:
                stdout.write(json.dumps(out, separators=(",", ":")) + "\n")
                stdout.flush()


SETUP = """Register the server with your agent (it starts on demand; nothing runs in the background):

  Claude Code    claude mcp add hardwright -- hardwright mcp
  Codex          codex mcp add hardwright -- hardwright mcp
  Cursor         .cursor/mcp.json  ->  {"mcpServers": {"hardwright": {"command": "hardwright", "args": ["mcp"]}}}
  VS Code        .vscode/mcp.json  ->  {"servers": {"hardwright": {"type": "stdio", "command": "hardwright", "args": ["mcp"]}}}
  Claude Desktop claude_desktop_config.json -> {"mcpServers": {"hardwright": {"command": "hardwright", "args": ["mcp"]}}}

If `hardwright` is not on your PATH, use `python -m hardwright mcp` as the command instead.
"""


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if args and args[0] in ("-h", "--help", "help", "setup"):
        print(SETUP)
        return 0
    serve()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
