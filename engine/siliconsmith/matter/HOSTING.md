# Hosting Matter

Two entrypoints, both plain JSON in / JSON out (`serverless.py`), plus a framework-free HTTP handler and a FastAPI router (`api.py`).

| Endpoint | What it does | Cost / risk |
|---|---|---|
| `POST /api/matter/simulate` | runs one of our built-in reference generators through the validated solver and the ladder M1..M5 | deterministic, **no LLM**, about 0.4 to 1 s warm; safe to call freely |
| `POST /api/matter/run` | the Nemotron agent loop; agent-written generators execute in Token Factory Sandboxes | real model spend, hard-capped (see below) |

## Security model (read this first)

* **The process that holds secrets never runs agent code.** Generators run via `runners.py`:
  * `SandboxRunner` (use this when hosted): a Token Factory Sandbox microVM from the `siliconsmith-matter:latest` image (Ubuntu 24.04 + python3-numpy, built by `python -m siliconsmith.matter.build_sandbox_image`). Only the worker script and the request JSON are uploaded; the host environment is never sent. The sandbox's default network is OPEN (the SDK has no switch), so the worker is started under `unshare -n` and the run **fails closed** (exit 97) if that cannot be created. Verified: under `unshare -n` a TCP connect fails; the sandbox environment holds no credentials.
  * `local_runner` (development fallback only): subprocess with a scrubbed environment (PATH, LANG only; no HOME, no keys), an empty temporary cwd, rlimits, and a network namespace when the OS allows it. `run_agent` refuses it unless `allow_local_runner=True`.
* The worker re-screens the code (AST: import allow-list `numpy math itertools functools collections`; no `open`, `exec`, `getattr`, dunder attributes, file/process helpers on numpy) where the code runs, strips numpy's file helpers, blocks sockets, and applies per-call and CPU time limits. This screen is best-effort; the boundary is *where* it runs.
* `tests/test_matter_security.py` sends nine malicious payloads (read env, network, write file, numpy file read, `DataSource`, dunder escape, getattr trick, subprocess, numpy-os trick) **directly to the worker** in both runners, with canary secrets in the host environment; none succeeds. With `SS_TEST_SANDBOX=1` the same tests run against real Sandboxes.
* **No prompt-injection path from requests.** `spec` accepts numbers and choices only; unknown fields are rejected. No user-written text ever reaches a model prompt.
* The sandbox generator never receives the API key; `NEBIUS_API_KEY` lives only in the host function's environment (needed by `run_agent` for the model and by the SDK client).

## Limits and errors

Defined in `limits.py` (every field has a range; errors name the field):

* request body at most 16,384 bytes; JSON object only; unknown fields rejected
* grid `n` 30..80 (so at most 6,400 cells), `dx_mm` 0.5..2, `t_mm` 0.2..10, `k` 5..500, `h` 2..500, `T_inf` -20..60, `Q` 0.1..100 W, `chip` 2..12 and under half the grid, `budget_fraction` 0.05..0.9, `min_feature` 1..4
* agent: `budget_usd` 0.01..0.50, `max_seconds` 30..240, `rounds` 1..6, `ideas` 1..4, `samples` 4..16
* the budget is checked before each model call, so one call can overshoot slightly; `max_seconds` stops starting new rounds (it cannot interrupt a call in flight)
* rate limit hook: in-memory sliding window per client key (`simulate` 30/min, `run` 2/hour). **It is per process**, so on serverless it is a courtesy limit, not a global guarantee; a real limit needs a shared store (for example Vercel KV).

Error response (HTTP 422): `{"ok": false, "error": {"field": "spreader.n", "message": "must be between 30 and 80, got 500"}}`. 405 wrong method, 404 unknown path, 429 rate limited.

## `POST /api/matter/simulate`

Request (all fields optional):

```json
{
  "generator": "rect_fins",
  "gen_params": {"spine": 8, "n_fins": 8, "fin_w": 3, "fin_len": 16},
  "spreader": {"Q": 2.0, "budget_fraction": 0.4, "h": 15},
  "include_stl": false
}
```

`generator` is `rect_fins` (params `spine` 6..12, `n_fins` 2..14, `fin_w` 2..4, `fin_len` 4..24) or `radial_spokes` (`n_spokes` 4..16, `spoke_w` 2..4, `ring_r` 4..9, `length` 10..29). `spreader` fields are listed above (`t_mm`, `dx_mm` are millimetres).

Response (real output, mask and field truncated):

```json
{
  "ok": true,
  "generator": "rect_fins",
  "gen_params": {"spine": 8, "n_fins": 8, "fin_w": 3, "fin_len": 16},
  "spreader": {"n": 60, "dx": 0.001, "t": 0.002, "k": 200.0, "h": 15.0, "T_inf": 25.0, "Q": 2.0, "chip": 6, "budget_fraction": 0.4, "min_feature": 2},
  "ladder": [
    {"id": "M1", "status": "pass", "label": "Solver validated against analytic cases", "check": "validation suite (fin analytic, balance, convergence)", "detail": "fin worst error 1.99e-05 (<= 1%), heat balance 3.2e-12, 2x refinement 9.37e-04 (<= 2%)"},
    {"id": "M2", "status": "pass", "label": "Geometry valid and within budget", "check": "mask checks", "detail": "1248 cells (34.7% of plate), connected, within 40% budget"},
    {"id": "M3", "status": "pass", "label": "Printable (feature-size rule)", "check": "morphology + topology", "detail": "min feature 2 cells (2 mm), one piece, no enclosed voids"},
    {"id": "M4", "status": "pass", "label": "Second solver agrees within 3%", "check": "FEM Q1 + 2x refinement", "detail": "FV 56.555 K, FV 2x 56.526 K (0.05%, limit 2%), FEM 56.483 K (0.13%, limit 3%)"},
    {"id": "M5", "status": "fail", "label": null, "check": "equal-material rectangular fins", "detail": "candidate peak 81.55 C vs baseline 80.28 C using <= 1248 cells (13 fins 2x19): does not beat baseline (-1.27 K)"}
  ],
  "first_failure": "M5",
  "metrics": {"peak_temp_c": 81.55, "peak_rise_k": 56.55, "material_cells": 1248, "material_fraction": 0.3467, "heat_balance_rel": 2.1e-13},
  "baselines": {
    "equal_material": {"peak_temp_c": 80.28, "delta_k": -1.27, "cells": 1248, "params": {"spine": 8, "spine_len": 32, "n_fins": 13, "fin_w": 2, "fin_len": 19, "cells": 1244}},
    "full_budget":    {"peak_temp_c": 72.82, "delta_k": -8.73, "cells": 1440, "params": {"spine": 6, "spine_len": 60, "n_fins": 15, "fin_w": 4, "fin_len": 9, "cells": 1440}}
  },
  "verdict": {"label": "Does not beat a rectangular-fin baseline", "delta_equal_material_k": -1.27, "delta_full_budget_k": -8.73, "beats_equal_material": false, "beats_full_budget": false, "note": "2D steady-state model, stated h and k, no airflow CFD, not validated on a printed part."},
  "viewer": {"format": "matter-candidate/1", "n": 60, "dx_mm": 1.0, "thickness_mm": 2.0, "chip": [27, 33, 27, 33],
             "mask": ["0000...", "..."], "field": {"n": 60, "units": "degC", "T_inf": 25.0, "peak": 81.55, "T": [[null, null, "..."]]}},
  "limits": ["2D plate model, steady state, ...", "..."],
  "source": "deterministic simulation, no LLM",
  "timings_ms": 1011
}
```

Notes for the UI:
* `ladder[i].label` is non-null only when that rung **passes**; show the label only then. A failing or skipped rung has `status`, `detail` and `check`. `first_failure` names the first failing rung.
* `verdict` is `null` unless M2 and M3 pass. Always show **both** baselines; `verdict.label` is worded so it cannot oversell (for example "Beats the equal-material baseline by 0.25 K; does NOT beat the full-budget baseline"). Margins are model estimates under stated assumptions.
* With `"include_stl": true` the response also has `stl: {base64, bytes, sha256, units: "mm"}` (about 0.3 MB base64 for a typical plate).

## Viewer artifact: `matter-candidate/1`

The same object is `simulate.viewer` and, per candidate, the `candidate.json` artifact of an agent run (with `node`, `generator`, `title`, `params`, `metrics`, `ladder`, `reason` added). Grid is at most 80 x 80, so no downsampling is needed (a 60 x 60 field is about 25 kB).

* `mask[j]` is row `j` (y = j) as a string of `'1'` (material) / `'0'`; column `i` is x. Origin bottom-left in model space.
* `field.T[j][i]` temperature in degC, `null` where there is no material. `field.chip = [i0, i1, j0, j1]` (half-open cell indices).
* Geometry for Three.js: extrude each material cell by `thickness_mm` over cells of `dx_mm`; colour by `T` between `T_inf` and `field.peak`. The binary STL (millimetres, closed surface checked) is the `stl` artifact (`plate.stl`) or `stl` in the winner object.

## `POST /api/matter/run`

Request:

```json
{
  "spec": {"spreader": {"Q": 2.0, "budget_fraction": 0.4}, "rounds": 3, "ideas": 3, "samples": 12, "seed": 0},
  "budget_usd": 0.30,
  "max_seconds": 200
}
```

Response: `{ok, run_id, events[], artifacts[], candidates[], winner, result, cost_usd, tokens, wall_s, caps, limits}`.

* `events`: the full v2-shaped event stream (`run.started` with `domain:"matter"` and `ladder`, `node.created`, `node.stage` with `stage` in `implement|M1..M5`, `node.scored` with `metrics`, `ladder`, `samples`, `on_pareto`, `artifact.created {kind,path,sha256}`, `llm.call`, `run.completed`). Same stream as `runs/logs/<run_id>.ndjson`.
* `candidates`: one `matter-candidate/1` object per scored node. `winner`: the best candidate plus `stl {base64, bytes, sha256}`.
* `result`: `{verdict, baselines: {equal_material_peak_c, full_budget_peak_c}, all_rungs_passed, best_node_id, pareto, stopped}`. Same honesty rules as `simulate.verdict`.
* `artifact.path` values are server-local paths; a hosted deployment should read `candidates`/`winner` from the response instead.

## Vercel Python function

```python
# api/matter.py
from http.server import BaseHTTPRequestHandler
from siliconsmith.matter.api import handle_request
import json

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(min(int(self.headers.get("content-length") or 0), 20000))
        status, payload = handle_request("POST", self.path, body, self.headers.get("x-forwarded-for", "anon"))
        out = json.dumps(payload).encode()
        self.send_response(status); self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(out))); self.end_headers(); self.wfile.write(out)
```

Mount in the engine API instead with `app.include_router(siliconsmith.matter.api.make_router())`.

## Dependencies and bundle size (measured, Linux x86-64, Python 3.12, as installed)

* `simulate` needs only **numpy and scipy**. Installed: numpy 43 MB + numpy.libs 27 MB + scipy 109 MB + scipy.libs 30 MB = 209 MB on disk; 197 MB of file bytes; **137 MB** after stripping `tests/` and `__pycache__`. Fits 250 MB unzipped.
* `run_agent` additionally needs `openai`, `pydantic` (+ core), `httpx` and its small deps, `contree-sdk` (aiofiles, cattrs): about 17 MB for the model client stack plus the SDK, so roughly 160 MB stripped in total. If the bundle is tight, deploy `simulate` and `run` as two functions.
* The `simulate` import path loads no FastAPI / openai / httpx / pydantic / contree modules (checked); import takes about 0.5 s cold.
* Not measured: Vercel's own packaging overhead, cold-start time on Vercel.

## What is and is not real

Real: the solver validation, the independent FEM check, the ladder, real Sandbox execution of generators (tests above), real Nemotron runs (see `EVALS.md`, `evidence/`).
Not real / unfinished: no 3D viewer in this package (it is the web app's job, from the artifact above); the rate limiter is in-memory; the hosted function has not been deployed or load-tested; the agent's margins over the baselines are small (see README Evidence).
