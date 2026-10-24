"""Hostable entry points for the Board workbench: pure functions that take and return JSON-able values.

    check(design_json, header=None)          deterministic B1 to B5, NO LLM, no network, safe to call freely
    explain_failure(result)                  plain-language reading of a check() result, with evidence and hints
    run_agent(brief, budget_usd, max_seconds)   Nemotron propose/repair loop, hard-capped on spend and wall time
    handle_request(method, path, body, ...)  the HTTP contract (see HOSTING.md) usable from any Python host

Import weight: everything except `run_agent` needs only pydantic. `run_agent` imports the engine's Nemotron client
(openai SDK) lazily, so a check-only deployment never loads it.
"""

from __future__ import annotations

import json
import os
import secrets
import threading
import time
from typing import Any

from . import faults as faults_mod
from .agent import LADDER_EVENT, Brief, propose_design, repair_design
from .checks import IMPLEMENTED_RUNGS, RUNG_LABELS, CheckResult, run_ladder
from .export import firmware_header
from .limits import (MAX_BODY_BYTES, InputError, RateLimiter, check_assumptions, check_brief_text, check_header,
                     parse_body, parse_design)
from .parts import Part, describe_fact, load_library
from .run import TEMPLATE_TEXT, TEMPLATE_TITLE, build_artifacts, emit_finished, emit_started, template_brief
from .templates import design_schema, list_templates, load_template

DEFAULT_BUDGET_USD = 0.05
HARD_MAX_BUDGET_USD = 0.25
DEFAULT_MAX_SECONDS = 120.0
HARD_MAX_SECONDS = 300.0
MAX_REPAIRS = 2

NOTICE = ("Netlist-level check only: no layout, routing or fabrication, and no claim that a board will work. Part facts "
          "are author-curated; a fact with citation_checked=false was not cross-checked against its source document. "
          "The battery figure is a model, not a measurement.")

RULES = {
    "B1": "A netlist must be well formed before anything else can be judged: pins exist, required pins are connected, "
          "no pin is on two nets and no net has two output drivers.",
    "B2": "Each pin must see a voltage within the limits of its part, and a regulator must not be asked for more current "
          "than its limit.",
    "B3": "Buses and connectors must follow their rules: I2C pull-ups give a legal rise time, device addresses do not "
          "collide, and a USB-C sink presents its CC pull-downs.",
    "B4": "The firmware pin header must say exactly what the netlist wires, and must not drive an input-only pin or use "
          "flash or strapping pins.",
    "B5": "The battery life estimate from the stated currents and duty cycle must meet the target.",
}
HINTS = {
    "pins exist": "Compare the pin name with the part's pin table (GET /api/board/parts) and correct the spelling.",
    "required pins connected": "Add the pin to the net it belongs on; a required pin cannot be left floating.",
    "one net per pin": "A pin sits on exactly one net. List it once, in the net it should be on.",
    "single driver per net": "Two outputs must not share a net. Remove one driver or separate the nets.",
    "MCU assignments exist": "Use a pin name that exists on the MCU part.",
    "supply voltages": "Move the supply pin to a net whose source is inside the pin's voltage range.",
    "signal pin domains": "Do not connect a 3.3 V domain pin to a higher voltage net.",
    "regulator current": "Remove or reduce a load on that rail, or choose a regulator with a higher limit.",
    "I2C pull-ups": "Choose pull-up values between the minimum for the low-level drive and the maximum for the rise time "
                    "at the stated bus capacitance, or change the bus mode assumption.",
    "I2C addresses": "Tie the sensor's SDO to ground (low address) or to its VDDIO net (high address) so addresses differ.",
    "USB-C CC pull-downs": "Add 5.1 kohm from each of CC1 and CC2 to ground.",
    "firmware matches netlist": "Make the header and the netlist declare the same pin and use for every function.",
    "assigned pins wired": "Wire the MCU pin to the net named in the assignment.",
    "pin hazards": "Move the function to a GPIO that is not a flash pin, not a strapping pin and, for outputs, not input-only.",
    "firmware header parses": "The header must contain lines like '#define SS_PIN_NAME 21  /* bidir */'.",
    "battery model": "State every battery assumption, or shorten the active time / lengthen the period / use a larger cell.",
}

_LIB: dict[str, Part] | None = None


def library() -> dict[str, Part]:
    global _LIB
    if _LIB is None:
        _LIB = load_library()
    return _LIB


# ----------------------------------------------------------------------------------------------------- check / explain

def _result_header(design, header: str | None) -> str:
    if header is not None:
        return header
    try:
        return firmware_header(design)
    except ValueError as e:
        return f"/* header could not be generated: {e} */\n"


def _evidence_table(results: list[CheckResult]) -> dict[str, Any]:
    lib = library()
    ids = list(dict.fromkeys(e for r in results for e in r.evidence))
    return {i: describe_fact(lib, i) for i in ids}


def check(design_json: str | bytes | dict, header: str | None = None) -> dict[str, Any]:
    """Run B1 to B5 on a design. Never raises for bad input: returns {"ok": False, "error": {...}}.
    `labels` holds the claim of each rung that PASSED and nothing else; unknown is never a pass."""
    try:
        design = parse_design(design_json)
        header = check_header(header)
    except InputError as e:
        return {"ok": False, "error": e.to_dict(), "status": e.status}
    header = _result_header(design, header)
    results = run_ladder(design, library(), header)
    return {
        "ok": True,
        "passed": [r.rung for r in results] == list(IMPLEMENTED_RUNGS) and all(r.status == "pass" for r in results),
        "ladder": LADDER_EVENT,
        "rungs": [r.model_dump() for r in results],
        "labels": [r.label for r in results if r.status == "pass" and r.label],
        "evidence": _evidence_table(results),
        "header": header,
        "notice": NOTICE,
    }


def explain_failure(result: dict[str, Any] | list) -> dict[str, Any]:
    """Plain-language reading of a `check()` result (or just its `rungs` list): for every rung that did not pass,
    the rule behind it, each problem found, a hint, and the evidence facts with their provenance."""
    rungs = result.get("rungs") if isinstance(result, dict) else result
    if not isinstance(rungs, list) or not all(isinstance(r, dict) and "rung" in r and "status" in r for r in rungs):
        return {"ok": False, "error": {"code": "bad_result", "message": "expected a check() result with a rungs list",
                                       "errors": []}}
    lib = library()
    out = []
    for r in rungs:
        if r["status"] == "pass":
            continue
        findings = [f for f in r.get("findings", []) if f.get("status") != "pass"]
        out.append({
            "rung": r["rung"], "status": r["status"],
            "claim_if_passed": RUNG_LABELS.get(r["rung"]),
            "meaning": ("This rung failed: the claim does not hold." if r["status"] == "fail"
                        else "This rung could not be decided (unknown), so it makes no claim; unknown is never a pass."),
            "rule": RULES.get(r["rung"], ""),
            "problems": [{"check": f.get("check"), "detail": f.get("detail"), "hint": HINTS.get(f.get("check", ""), "")}
                         for f in findings] or [{"check": None, "detail": r.get("detail", ""), "hint": ""}],
            "evidence": [d for d in (describe_fact(lib, e) for e in r.get("evidence", [])) if d],
        })
    return {"ok": True, "all_passed": not out, "failing": out}


# ------------------------------------------------------------------------------------------------------- run_agent

class MemBus:
    """In-memory stand-in for events.EventBus: the same envelope, kept in a list instead of a file."""

    def __init__(self, run_id: str):
        self.run_id, self.events = run_id, []
        self._seq, self._t0, self._lock = 0, time.monotonic(), threading.Lock()

    def emit(self, type_: str, **fields: Any) -> dict:
        with self._lock:
            ev = {"v": 1, "seq": self._seq, "t": int((time.monotonic() - self._t0) * 1000), "run_id": self.run_id,
                  "type": type_, **fields}
            self._seq += 1
            self.events.append(ev)
        return ev

    def close(self) -> None:  # EventBus has close(); nothing to flush here
        pass


def _cap_wall_time(llm: Any, deadline: float) -> None:
    """Make every model call refuse to start after `deadline` and bound its network wait by the time left."""
    if not hasattr(llm, "chat"):
        return
    inner = llm.chat

    def chat(*a: Any, **k: Any):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("wall-time cap reached")
        if hasattr(getattr(llm, "client", None), "with_options"):
            llm.client = llm.client.with_options(timeout=max(remaining, 1.0), max_retries=0)
        return inner(*a, **k)

    llm.chat = chat


def _cost(events: list[dict], budget: float, elapsed: float, max_seconds: float) -> dict[str, Any]:
    per: dict[str, dict[str, Any]] = {}
    for e in events:
        if e["type"] == "llm.call":
            m = per.setdefault(e["model"], {"calls": 0, "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0})
            m["calls"] += 1
            m["tokens_in"] += e["tokens_in"]
            m["tokens_out"] += e["tokens_out"]
            m["cost_usd"] = round(m["cost_usd"] + e["cost_usd"], 6)
    return {"total_usd": round(sum(m["cost_usd"] for m in per.values()), 6),
            "tokens_in": sum(m["tokens_in"] for m in per.values()),
            "tokens_out": sum(m["tokens_out"] for m in per.values()),
            "per_model": per, "budget_usd": budget, "max_seconds": max_seconds, "elapsed_s": round(elapsed, 1),
            "cap_note": "The spend cap is checked before each model call, so total spend can exceed it by at most one "
                        "call; the wall-time cap stops new calls and bounds the wait of the current one."}


def _error(code: str, message: str, status: int = 400, errors: list | None = None) -> dict[str, Any]:
    return {"ok": False, "error": {"code": code, "message": message, "errors": errors or []}, "status": status}


def cap_error(budget_usd: Any, max_seconds: Any) -> dict[str, Any] | None:
    """An error response when the requested caps are not acceptable (validated before any rate-limit accounting)."""
    if not isinstance(budget_usd, (int, float)) or isinstance(budget_usd, bool) or not (0 < budget_usd <= HARD_MAX_BUDGET_USD):
        return _error("bad_budget", f"budget_usd must be above 0 and at most {HARD_MAX_BUDGET_USD}")
    if not isinstance(max_seconds, (int, float)) or isinstance(max_seconds, bool) or not (5 <= max_seconds <= HARD_MAX_SECONDS):
        return _error("bad_time_cap", f"max_seconds must be from 5 to {HARD_MAX_SECONDS:g}")
    return None


def run_agent(brief: dict[str, Any] | None = None, budget_usd: float = DEFAULT_BUDGET_USD,
              max_seconds: float = DEFAULT_MAX_SECONDS, *, design: str | dict | None = None,
              fault_id: str | None = None, llm: Any = None, max_repairs: int = MAX_REPAIRS) -> dict[str, Any]:
    """Nemotron designs (Ultra) and repairs (Super) a board; the deterministic ladder judges every design.

    `brief` = {"text": free text (optional, default the sensor template), "assumptions": {...} (optional, ranges in
    limits.py)}. Pass `design` (JSON) to repair a visitor's own design, or `fault_id` to repair the reference design
    with that fault injected. Hard caps: `budget_usd` (default 0.05, at most 0.25) and `max_seconds` (default 120, at
    most 300). Returns the run id, the full v2 event list, artifacts (with content and SHA-256) for a passing design,
    per-model tokens and USD, and the verdict. `llm` is for tests (a stand-in with .json); production builds Nemotron.
    """
    bad = cap_error(budget_usd, max_seconds)
    if bad:
        return bad
    if fault_id is not None and design is not None:
        return _error("bad_request", "give either fault_id or design, not both")
    try:
        brief = brief or {}
        if not isinstance(brief, dict):
            raise InputError("bad_brief", "brief must be an object")
        text = check_brief_text(brief.get("text"))
        assumptions = dict(template_brief().assumptions)
        extra = brief.get("assumptions") or {}
        if not isinstance(extra, dict):
            raise InputError("bad_assumptions", "assumptions must be an object")
        assumptions.update(extra)
        check_assumptions(assumptions)
        start_design = parse_design(design) if design is not None else None
    except InputError as e:
        return {"ok": False, "error": e.to_dict(), "status": e.status}
    if fault_id is not None and fault_id not in {f.id for f in faults_mod.FAULTS + faults_mod.STRUCTURAL_FAULTS}:
        return _error("bad_fault", f"unknown fault_id {fault_id!r}")

    lib = library()
    run_id = "board-" + time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3)
    bus = MemBus(run_id)
    t0 = time.monotonic()
    if llm is None:
        try:
            import dataclasses

            from ..config import settings
            from ..llm import LLMError, Nemotron
            llm = Nemotron(dataclasses.replace(settings(), run_budget_usd=float(budget_usd)), bus)
        except Exception as e:  # missing key, missing SDK
            return _error("model_unavailable", f"{type(e).__name__}: {e}"[:300], status=503)
    if hasattr(llm, "bus") and llm.bus is None:
        llm.bus = bus  # so llm.call events (tokens, USD) land in this run's event list
    _cap_wall_time(llm, t0 + float(max_seconds))

    the_brief = Brief(TEMPLATE_TITLE if text is None else "Custom brief", text or TEMPLATE_TEXT, assumptions=assumptions)
    emit_started(bus, the_brief, fault_id=fault_id, max_repairs=max_repairs)
    try:
        if start_design is not None:
            result = repair_design(llm, start_design, the_brief, lib, max_repairs=max_repairs, bus=bus,
                                   first_note="design supplied by the visitor (not model output)")
        elif fault_id is not None:
            result = repair_design(llm, faults_mod.inject_fault(faults_mod.reference_design(), fault_id), the_brief, lib,
                                   max_repairs=max_repairs, bus=bus,
                                   first_note=f"reference design with injected fault '{fault_id}' (not model output)")
        else:
            result = propose_design(llm, the_brief, lib, max_repairs=max_repairs, bus=bus)
    except Exception as e:
        bus.emit("run.failed", error=f"{type(e).__name__}: {e}"[:500])
        return {"ok": False, "run_id": run_id, "error": {"code": "agent_error", "message": f"{type(e).__name__}: {e}"[:300],
                "errors": []}, "events": bus.events, "cost": _cost(bus.events, budget_usd, time.monotonic() - t0, max_seconds),
                "status": 502}
    artifacts = build_artifacts(result, lib)
    for a in artifacts:
        bus.emit("artifact.created", kind=a["kind"], path=a["path"], sha256=a["sha256"], node_id=result.final.node_id)
    emit_finished(bus, result, llm, t0)
    elapsed = time.monotonic() - t0
    last = result.final
    return {
        "ok": True, "run_id": run_id, "passed": result.passed, "error": result.error,
        "attempts": [{"node_id": a.node_id, "passed": a.passed, "rungs": {r.rung: r.status for r in a.results}}
                     for a in result.attempts],
        "final": None if last is None else {
            "node_id": last.node_id, "design": json.loads(last.design.model_dump_json()), "header": last.header,
            "rungs": [r.model_dump() for r in last.results],
            "labels": [r.label for r in last.results if r.status == "pass" and r.label]},
        "events": bus.events, "artifacts": artifacts, "cost": _cost(bus.events, float(budget_usd), elapsed, max_seconds),
        "notice": NOTICE,
    }


# -------------------------------------------------------------------------------------------------------- HTTP layer

def _env_num(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


CHECK_LIMITER = RateLimiter(int(_env_num("BOARD_CHECKS_PER_MIN", 120)), 60)
RUN_LIMITER = RateLimiter(int(_env_num("BOARD_RUNS_PER_HOUR", 5)), 3600, _env_num("BOARD_USD_PER_HOUR", 0.30))
GLOBAL_RUN_LIMITER = RateLimiter(int(_env_num("BOARD_RUNS_PER_DAY", 200)), 86400, _env_num("BOARD_USD_PER_DAY", 3.0))
CORS_ORIGIN = os.environ.get("BOARD_CORS_ORIGIN", "")

PREFIX = "/api/board"


def _json(status: int, payload: Any, extra: dict[str, str] | None = None) -> tuple[int, dict[str, str], str]:
    headers = {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}
    if CORS_ORIGIN:
        headers["Access-Control-Allow-Origin"] = CORS_ORIGIN
    headers.update(extra or {})
    return status, headers, json.dumps(payload)


def _parts_summary() -> list[dict[str, Any]]:
    out = []
    for p in library().values():
        out.append({"id": p.id, "name": p.name, "kind": p.kind, "origin": p.origin, "package": p.package,
                    "description": p.description, "pin_table_checked": p.pin_table_provenance.citation_checked,
                    "sources": sorted({u for u in [p.pin_table_provenance.url, *(f.provenance.url for f in p.facts)] if u}),
                    "pins": [{"name": x.name, "number": x.number, "direction": x.direction,
                              "capabilities": x.capabilities, "required": x.required} for x in p.pins],
                    "facts": [{"id": f"part:{p.id}.{f.key}", "text": f.text, "value": f.value, "unit": f.unit,
                               "citation_checked": f.provenance.citation_checked} for f in p.facts]})
    return out


def handle_request(method: str, path: str, body: bytes | str | None = None, headers: dict[str, str] | None = None,
                   client_ip: str | None = None) -> tuple[int, dict[str, str], str]:
    """The whole HTTP contract as a function: (status, response headers, JSON text). See HOSTING.md.
    `client_ip` keys the rate limits; behind a proxy pass the proxy-reported address (it can be spoofed)."""
    method = method.upper()
    path = path.split("?", 1)[0].rstrip("/") or "/"
    key = client_ip or "anon"
    if method == "OPTIONS":
        return 204, {"Access-Control-Allow-Origin": CORS_ORIGIN or "", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                     "Access-Control-Allow-Headers": "Content-Type"}, ""
    if not path.startswith(PREFIX):
        return _json(404, {"ok": False, "error": {"code": "not_found", "message": "unknown path", "errors": []}})
    route = path[len(PREFIX):] or "/"
    try:
        if method == "GET":
            if route == "/templates":
                return _json(200, {"ok": True, "templates": list_templates()})
            if route.startswith("/templates/"):
                try:
                    return _json(200, {"ok": True, **load_template(route.split("/", 2)[2])})
                except KeyError:
                    return _json(404, {"ok": False, "error": {"code": "not_found", "message": "unknown template", "errors": []}})
            if route == "/schema":
                return _json(200, design_schema())
            if route == "/parts":
                return _json(200, {"ok": True, "parts": _parts_summary(), "notice": NOTICE})
            if route == "/faults":
                return _json(200, {"ok": True, "faults": [
                    {"id": f.id, "title": f.title, "description": f.description, "expected_rung": f.expected_rung}
                    for f in faults_mod.FAULTS]})
            return _json(404, {"ok": False, "error": {"code": "not_found", "message": "unknown path", "errors": []}})
        if method != "POST":
            return _json(405, {"ok": False, "error": {"code": "method_not_allowed", "message": method, "errors": []}})
        if isinstance(body, (bytes, str)) and len(body) > MAX_BODY_BYTES:
            raise InputError("too_large", f"request body is larger than {MAX_BODY_BYTES} bytes", status=413)
        data = parse_body(body)
        if route in ("/check", "/explain"):
            ok, retry = CHECK_LIMITER.allow(key)
            if not ok:
                return _json(429, {"ok": False, "error": {"code": "rate_limited", "message": "too many checks, slow down",
                             "errors": []}}, {"Retry-After": str(int(retry) + 1)})
            if "design" not in data:
                raise InputError("bad_request", "body needs a 'design' (object or JSON text)",
                                 [{"path": "design", "message": "required"}])
            res = check(data["design"], data.get("header"))
            if route == "/check":
                return _json(200 if res["ok"] else res.get("status", 400), res)
            if not res["ok"]:
                return _json(res.get("status", 400), res)
            return _json(200, {"check": {k: res[k] for k in ("passed", "labels")}, **explain_failure(res)})
        if route == "/run":
            budget = data.get("budget_usd", DEFAULT_BUDGET_USD)
            bad = cap_error(budget, data.get("max_seconds", DEFAULT_MAX_SECONDS))
            if bad:
                return _json(bad.pop("status"), bad)
            ok, retry = RUN_LIMITER.allow(key, est_usd=float(budget) if isinstance(budget, (int, float)) else 0.0)
            if ok:
                ok, retry = GLOBAL_RUN_LIMITER.allow("*", est_usd=float(budget) if isinstance(budget, (int, float)) else 0.0)
            if not ok:
                return _json(429, {"ok": False, "error": {"code": "rate_limited", "message": "run budget for this period is "
                             "used up; try again later", "errors": []}}, {"Retry-After": str(int(retry) + 1)})
            res = run_agent(data.get("brief"), budget, data.get("max_seconds", DEFAULT_MAX_SECONDS),
                            design=data.get("design"), fault_id=data.get("fault_id"))
            spent = res.get("cost", {}).get("total_usd", 0.0)
            RUN_LIMITER.record(key, spent)
            GLOBAL_RUN_LIMITER.record("*", spent)
            status = res.pop("status", 200) if not res.get("ok") else 200
            return _json(status, res)
        return _json(404, {"ok": False, "error": {"code": "not_found", "message": "unknown path", "errors": []}})
    except InputError as e:
        return _json(e.status, {"ok": False, "error": e.to_dict()})
