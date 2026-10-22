# Hosting the Board workbench

Board is hostable as plain Python functions. Nothing here is deployed; the Vercel wiring below is untested on Vercel
(the handler is tested over a local HTTP server, the router with FastAPI's test client, the functions directly).

## Entry points

| Python | What it does | LLM? |
|---|---|---|
| `serverless.check(design_json, header=None)` | validates, then runs B1 to B5 | **no**, deterministic, safe to call freely |
| `serverless.explain_failure(result)` | reads a `check()` result: rule, problems, hints, evidence with provenance | no |
| `serverless.run_agent(brief, budget_usd, max_seconds, design=, fault_id=)` | Ultra architects, Super repairs (up to 2 repairs), the ladder judges | yes, Nemotron on Nebius Token Factory |
| `serverless.handle_request(method, path, body, headers, client_ip)` | the whole HTTP contract below; returns `(status, headers, json_text)` | only for `/run` |
| `api.router` | FastAPI router with the same routes (delegates to `handle_request`) | |
| `vercel_handler.handler` | `BaseHTTPRequestHandler` subclass for a Vercel Python function | |

## Requirements

* Python >= 3.11.
* **Check-only deployment** (`/check`, `/explain`, templates, schema, parts, faults): `pydantic>=2.6`. Nothing else is
  imported (`openai` is imported only inside `run_agent`).
* **With the agent** (`/run`): add `openai>=1.40` and set `NEBIUS_API_KEY` (optional: `TOKEN_FACTORY_BASE_URL`,
  `SS_MODEL_ULTRA`, `SS_MODEL_SUPER`). The engine's `siliconsmith.llm` and `siliconsmith.config` are used read-only.
* FastAPI router only: `fastapi`. The Vercel handler and `handle_request` need no web framework.
* Package data: the JSON files in `board/parts/`, `board/designs/` and `board/templates/` plus `board/design.schema.json`
  must ship with the package (add them to `package-data` in `engine/pyproject.toml`; not done here).
* Bundle size, measured in the dev venv (not on Vercel): pydantic + pydantic-core + annotated-types about 12 MB;
  openai and its dependencies about 40 MB; all far below the 250 MB function limit.

## Limits (all enforced in code, `limits.py`)

| Limit | Value |
|---|---|
| request body | 64,000 bytes, checked before parsing (413) |
| C header text | 8,000 bytes |
| brief text | 1,500 characters |
| instances / nets / pins per net / assignments | 100 / 200 / 200 / 100 |
| any string in a design | 80 characters |
| params per instance | 16 |
| `assumptions` keys | `i2c_mode` (`standard`\|`fast`), `i2c_cb_pf` 1 to 1000, `battery_capacity_mah` 10 to 100000, `battery_usable_fraction` 0.05 to 1, `target_hours` 1 to 100000, `active_s` 0.01 to 86400, `period_s` 0.01 to 604800; anything else is rejected |
| agent budget | default **$0.05**, hard maximum $0.25 per run |
| agent wall time | default **120 s**, range 5 to 300 s |

The spend cap is checked before each model call, so a run can exceed it by at most one call (a typical call costs
$0.002 to $0.006). The wall-time cap refuses new calls after the deadline and bounds the network wait of the current one.

### Rate limits (in memory, best effort)

`serverless.CHECK_LIMITER`, `RUN_LIMITER`, `GLOBAL_RUN_LIMITER` are `limits.RateLimiter` instances keyed by
`client_ip`. **They are in-process memory**: they reset on restart and a serverless platform may run several instances
that do not share them. Use them as a guard, not a guarantee; the hard backstops are the per-run cap and the provider-side
budget. Env: `BOARD_CHECKS_PER_MIN` (120), `BOARD_RUNS_PER_HOUR` (5 per visitor), `BOARD_USD_PER_HOUR` (0.30 per visitor),
`BOARD_RUNS_PER_DAY` (200 total), `BOARD_USD_PER_DAY` (3.00 total), `BOARD_CORS_ORIGIN` (unset = no CORS header).
Over the limit: `429` with a `Retry-After` header. Behind a proxy pass the proxy-reported address (it can be spoofed).

## Endpoints

Every response is JSON with `Cache-Control: no-store`. Errors have the shape
`{"ok": false, "error": {"code", "message", "errors": [{"path", "message"}]}}`.

### `GET /api/board/templates`, `GET /api/board/templates/{id}`
Three real files: `clean_sensor`, `fault_gpio12_vs_gpio14`, `fault_strapping_pin`. The list gives
`{id, title, description, expect}` where `expect` is the status per rung the checker gives today. The single template adds
`design` (the editable design) and `header` (the C pin header our generator writes for it).

### `GET /api/board/schema`
JSON Schema of a design, plus `x-limits`, `x-assumptions` (accepted keys and ranges) and `x-rungs`. Same file as
`board/design.schema.json`.

### `GET /api/board/parts`, `GET /api/board/faults`
Parts library summary (pins with direction, capabilities, required; facts with `citation_checked`) for an editor, and
the 8-fault catalogue `{id, title, description, expected_rung}` for "inject a fault" buttons.

### `POST /api/board/check`
Request: `{"design": <object or JSON text>, "header": "<optional C text>"}`. Without `header`, the header is generated from
the design's `firmware_pins`; with it, rung B4 judges **that text** (parsed) against the netlist.

Response (abridged, a design with the USB-C CC resistors removed; real output):

```json
{
  "ok": true,
  "passed": false,
  "ladder": [{"id": "B1", "label": "Netlist is well formed", "tool": "board.checks.run_b1"}, "..."],
  "rungs": [
    {"rung": "B1", "status": "pass", "label": "Netlist is well formed", "detail": "pins exist: ...", "evidence": ["part:batt.bat_p", "..."], "findings": ["..."]},
    {"rung": "B3", "status": "fail", "label": null,
     "detail": "J1.CC1 has no 5100 ohm pull-down to ground (sink Rd); J1.CC2 has no 5100 ohm pull-down to ground (sink Rd)",
     "evidence": ["part:usbc.sink_rd_ohm"], "findings": ["..."]}
  ],
  "labels": ["Netlist is well formed", "Electrical limits respected (curated facts)", "Firmware matches the netlist", "Battery estimate meets target (model, not measured)"],
  "evidence": {"part:usbc.sink_rd_ohm": {"id": "part:usbc.sink_rd_ohm", "part": "usbc", "origin": "author_defined",
    "text": "A sink presents a 5.1 kOhm pull-down (Rd) from each of CC1 and CC2 to ground.",
    "source": "USB Type-C Cable and Connector Specification (USB-IF)", "section": "Sink CC termination (Rd)",
    "citation_checked": false, "url": null}},
  "header": "/* Generated by ... */ ...",
  "notice": "Netlist-level check only: ..."
}
```

* `status` is `pass`, `fail` or `unknown`. **Show a rung's label only when its status is `pass`**: `label` is `null`
  otherwise and `labels` lists the passed claims only. `unknown` (missing data, part not in the library, a rung not run
  because B1 failed) is never a pass.
* Each rung lists the fact ids it used in `evidence`; `evidence` at the top level resolves each id to its text and
  provenance. For `citation_checked: false` the UI must say "author-curated, not independently verified".
* Problems: `400` (`bad_json` with line and column, `bad_design` with field paths, `bad_assumptions`, `bad_header`,
  `bad_request`), `413` (`too_large`, `limits_exceeded`), `429` (`rate_limited`).

Malformed input example (real output):
`{"ok": false, "error": {"code": "bad_json", "message": "design is not valid JSON: Expecting value at line 2 column 14", "errors": [{"path": "", "message": "line 2, column 14: Expecting value"}]}, "status": 400}`

### `POST /api/board/explain`
Request: same as `/check`. Response: `{"check": {"passed", "labels"}, "ok": true, "all_passed": false, "failing": [...]}` where each failing
rung has `claim_if_passed`, `meaning` (a failure vs an undecided rung), `rule`, `problems: [{check, detail, hint}]` and `evidence`
(resolved facts). `serverless.explain_failure(result)` takes a `check()` result directly.

### `POST /api/board/run`
Request (all fields optional):

```json
{"brief": {"text": "optional free-text brief", "assumptions": {"target_hours": 72}},
 "design": {"...a visitor's design to repair..."},
 "fault_id": "pin_mismatch",
 "budget_usd": 0.05, "max_seconds": 120}
```

`design` and `fault_id` are mutually exclusive: with `design` the agent repairs the visitor's design (it is judged first and
only sent to the model if it fails), with `fault_id` it repairs the reference design with that fault injected, with neither
it designs from the brief (default: the battery environmental sensor template). Response (real run, `fault_id: pin_mismatch`,
events and artifact contents omitted here):

```json
{"ok": true, "run_id": "board-20261022-121722-f4701b", "passed": true, "error": null,
 "attempts": [
   {"node_id": "n1",   "passed": false, "rungs": {"B1": "pass", "B2": "pass", "B3": "pass", "B4": "fail", "B5": "pass"}},
   {"node_id": "n1.1", "passed": true,  "rungs": {"B1": "pass", "B2": "pass", "B3": "pass", "B4": "pass", "B5": "pass"}}],
 "final": {"node_id": "n1.1", "design": {"...": "..."}, "header": "...", "rungs": ["..."], "labels": ["..."]},
 "events": ["... 37 events, contract v2, see below ..."],
 "artifacts": [{"kind": "design", "path": "design.json", "sha256": "c708f227...", "content": "..."},
               {"kind": "kicad-netlist", "path": "netlist.net", "sha256": "..."}, {"kind": "firmware-header", "path": "pins.h"}, {"kind": "bom", "path": "bom.json"}],
 "cost": {"total_usd": 0.005117, "tokens_in": 8919, "tokens_out": 2712,
          "per_model": {"nemotron-super": {"calls": 2, "tokens_in": 8919, "tokens_out": 2712, "cost_usd": 0.005117}},
          "budget_usd": 0.05, "max_seconds": 120.0, "elapsed_s": 13.2, "cap_note": "..."}}
```

* `passed` is true only when B1 to B5 all passed on the final design. A failed run still returns `ok: true` with
  `passed: false`, `error`, the last design in `final`, the events and the cost; `artifacts` is empty for it. The agent
  never decides: the deterministic ladder does.
* `events` is the complete v2 stream (`run.started` with `domain: "board"` and `ladder`, `node.created` before anything that
  names a node, `llm.call` with tokens and USD, `node.stage` per rung with `evidence` and `label` (label only on pass),
  `node.scored {metrics, ladder}`, `node.pruned`, `node.expanded`, `artifact.created {kind, path, sha256, node_id}`,
  `run.completed` or `run.failed`). Rung status `unknown` is reported `skipped` in `node.stage` and `node.scored.ladder`.
* `artifacts[].sha256` is the SHA-256 of `content` encoded as UTF-8.
* Errors: `400` (`bad_budget`, `bad_time_cap`, `bad_fault`, `bad_request`, and the input errors above), `429`,
  `502` (`agent_error`), `503` (`model_unavailable`: no key or no SDK). The response carries the same error shape.
* A `/run` call can take up to `max_seconds` (default 120). Set the Vercel function `maxDuration` accordingly; plan limits
  apply and are not verified here.

## Wiring

FastAPI (the existing engine API, without editing it):

```python
from siliconsmith.board.api import router
app.include_router(router)
```

Vercel Python function (one file for all routes; `vercel.json` rewrites `/api/board/(.*)` to it, `maxDuration` set for the
run route; add `pydantic` and, for `/run`, `openai` to `requirements.txt`, and make `siliconsmith` importable):

```python
# api/board.py
from siliconsmith.board.vercel_handler import handler  # noqa: F401
```

Any other host: call `serverless.handle_request(method, path, body_bytes, headers, client_ip)` and return the triple.

## Honesty notes for the UI

* Netlist-level only: no layout, routing or fabrication; never claim a board "will work".
* Facts are author-curated; `esp32`, `bme280` and `mcp73831` citations were checked against the datasheets (see README),
  author-defined parts and the USB-C Rd fact were not. The battery figure is a model, not a measurement.
* Agent pass rates are in the README, with every live batch and its failures.
