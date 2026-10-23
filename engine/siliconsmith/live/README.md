# Live Silicon (`siliconsmith.live`)

A bounded, **single-candidate** run of the Silicon pipeline that a visitor can start from the app and watch. It is the
recorded 20-minute search cut down to one branch, with every model-written Verilog or C file executed **only inside a
Token Factory Sandbox**.

```
Ultra   proposes 2 instructions for the hot loop; we develop the one it ranks best (est. speedup, area estimate inside the budget)
Super   writes RTL + C reference + the kernel rewrite, and (separately) the golden spec from the C reference alone
Sandbox lints the spec and checks it against the C reference            (run 1)
Sandbox lint -> 1,000,000 unit vectors -> whole-program output -> bench -> formal proof -> area   (run 2)
        up to 2 repairs (Nano triages, Super repairs), exactly as the full Search does
```

Not in a live run, on purpose: polish rounds, a second branch, and **Fmax place-and-route** (the toolchain is not in the
hosted function). The result is therefore a **cycle speedup and an area figure; wall-clock time is not measured**, and every
surface says so (`run.baseline.fmax_mhz` and `node.scored.fmax_mhz` are `null`, `node.scored.ladder.L6` is `skipped`, the
bundle's `REPORT.md` and `run.completed.report.wall_clock` state it).

The workload baseline (cycles, output hash, area, hotspots, disassembly) is **not re-measured**: it is read from
`baselines/<id>.json`, measured once in a real Sandbox with the tool versions recorded
(`python -m siliconsmith.live baseline w1`).

## Python API

```python
from siliconsmith.live import run_live, LiveError
stream = run_live("w1", budget_usd=0.15, max_seconds=240, note="prefer a packed multiply")  # raises LiveError on bad input
for event in stream:      # dicts: v2 events, then one final {"type": "bundle", ...}
    ...
```

Hard caps: default **$0.15 and 240 s**, maximum **$0.30 and 280 s** (`LiveError` above that). The spend cap is checked before
every model call (so total spend can exceed it by at most one call); the wall-clock cap stops new model calls and new Sandbox
runs, and bounds the wait of the one in flight. If the run has not finished `max_seconds + 10 s` after it started, the stream
ends with `run.failed` (`wall-time cap`). Model cost is tokens only; Sandbox compute is not included in `cost_usd`.

CLI (needs the key in `.env.local`, never printed): `python -m siliconsmith.live run w1 --out events.ndjson`.

## HTTP contract

Served by the hosted Python API (`siliconsmith-api`, FastAPI `app.py`, written by `web/scripts/package-api-host.mjs`);
the site proxies `/api/silicon/*` to it. `vercel.json` sets `maxDuration: 300`.

`GET /api/silicon/status` -> `{ok, configured, workloads, caps:{budget_usd, max_seconds}, max_note_chars, limits_scope, scope}`.

`POST /api/silicon/run`, body `{"workload": "w1" | "w2", "note"?: string (<= 280 chars)}` and nothing else (the caps are set by
the server; unknown fields are refused). Response `200`, `Content-Type: application/x-ndjson`, `Cache-Control: no-store`,
**one JSON event per line**, flushed as it happens. Errors before the stream starts are JSON
`{"ok": false, "error": {"code", "message"}}`:

| status | code | when |
|---|---|---|
| 400 | `bad_json`, `bad_request` | body is not a JSON object |
| 413 | `body_too_large` | body over 4,000 bytes |
| 422 | `bad_workload`, `note_too_long`, `bad_note`, `bad_request` | whitelist / length / unknown field |
| 429 | `rate_limited` (+ `Retry-After`) | per-visitor / shared / concurrent limit |
| 503 | `not_configured` | `NEBIUS_API_KEY` is not set in the API project's environment |
| 503 | `no_baseline` | the cached baseline file is missing |

Rate limits are **in memory**: per server instance, reset on a cold start, not shared between instances (best effort; the
hard backstops are the per-run caps and the provider-side budget). Env knobs: `SS_LIVE_RUNS_PER_IP_HOUR` (4),
`SS_LIVE_USD_PER_IP_HOUR` (0.60), `SS_LIVE_RUNS_PER_DAY` (150), `SS_LIVE_USD_PER_DAY` (12), `SS_LIVE_MAX_ACTIVE` (3),
`SS_LIVE_BUDGET_USD`, `SS_LIVE_MAX_SECONDS` (clamped to the hard maxima).

### Events

Envelope and types are [docs/contracts/events.md](../../../docs/contracts/events.md) v2 (`v: 1`, `seq` from 0, `t` ms since
start). In order:

1. `run.started` (`domain: "silicon"`, `ladder` L1..L6, `tool_versions` from the baseline file, plus `live: true`, `caps`)
2. `run.baseline` (cached: `cached: true`, `measured_at`; `fmax_mhz: null`; hotspots carry both `symbol` and `function`)
3. `node.created` root, then `log` (what Ultra saw, what it also proposed), `node.created` `n1`, `node.expanded`
4. `sandbox.op` started; `llm.call`s (architect, implement/spec; repairs and triage if needed); `node.stage` `implement`
5. `node.stage` per rung in the engine's order `lint, unit, e2e, bench, prove, synth` (the Sandbox returns when the whole
   ladder has finished, so these arrive together; their `t` is the offset at which each really happened inside the run)
6. `node.scored` (verified) **or** `node.pruned` with the real reason; `sandbox.op` succeeded/failed
7. `run.completed` (`best_node_id` is `root` and `pareto` empty when nothing verified; `report.verdict`)
8. `bundle` (last line)

A crash or cap ends the stream with `run.failed {error}` instead of 7 and 8.

### Result states (`run.completed.report.verdict`, `bundle.verdict`, `bundle.headline`)

| verdict | meaning |
|---|---|
| `verified_faster` | passed lint, 1M unit vectors, bit-identical program output, a cycle speedup, the formal proof and the area budget |
| `no_speedup` | output was correct but cycles did not drop (pruned at `bench`); the proof and area were not run for it |
| `over_budget` | proven and faster, but over the +5% area budget (a hard rule) |
| `failed` | a rung failed after up to 2 repairs; `headline` carries the real reason and failing stage |
| `stopped` | the time or spend cap ran out before a verified result (`report.stopped_by`: `time` or `budget`) |
| `error` | Sandbox/network failure; says nothing about the design |

### `bundle` event

```json
{"v":1,"seq":31,"t":89500,"run_id":"live-20261023-185400-ab12cd","type":"bundle","verdict":"verified_faster",
 "headline":"Verified: dot4.i8 makes the program 2.69× faster in cycles (860,730 → 320,542) for +4.8% area. ...",
 "files":[{"name":"rtl/ss_insn_dot4_i8.v","content":"module ...","sha256":"<64 hex>"},
          {"name":"rtl/ss_pcpi.v"}, {"name":"proof/ss_spec_dot4_i8.v"}, {"name":"include/ss_intrinsics.h"},
          {"name":"src/tm_dot.h"}, {"name":"REPORT.md"}],
 "totals":{"cost_usd":0.0462,"tokens":22955,"wall_s":89.3},"scope":"Live run: one candidate instruction, ..."}
```

`content` is UTF-8 text with LF endings and `sha256` is the digest of exactly those bytes. Only a `verified_faster` bundle
contains design files; every other verdict ships `REPORT.md` alone (it shows the unverified candidate and says it must not
be used).

### Example stream (abridged, real run on w1)

```
{"type":"run.started","domain":"silicon","live":true,"caps":{"budget_usd":0.15,"max_seconds":240.0},...}
{"type":"run.baseline","cycles":860730,"luts":2567,"fmax_mhz":null,"output_hash":"c729ebe8","cached":true,...}
{"type":"node.created","node_id":"n1","parent_id":"root","proposal":{"mnemonic":"dot4.i8",...}}
{"type":"sandbox.op","node_id":"n1","op_id":"op-1","status":"started"}
{"type":"llm.call","model":"nemotron-ultra","role":"architect","cost_usd":0.0121,...}
{"type":"node.stage","node_id":"n1","stage":"implement","status":"pass","artifacts":{"rtl":"...","patch_diff":"..."}}
{"type":"node.stage","node_id":"n1","stage":"unit","status":"pass","detail":"1,000,485 vectors · 0 mismatches vs C reference ..."}
{"type":"node.stage","node_id":"n1","stage":"bench","status":"pass","detail":"320,542 cycles · 2.69x"}
{"type":"node.stage","node_id":"n1","stage":"prove","status":"pass","detail":"formally equivalent to spec for all 2^64 inputs"}
{"type":"node.scored","node_id":"n1","cycles":320542,"speedup":2.6853,"area_delta_pct":4.84,"fmax_mhz":null,...}
{"type":"run.completed","best_node_id":"n1","totals":{"nodes":1,"sandboxes":2,"cost_usd":0.0462,...},"report":{"verdict":"verified_faster",...}}
{"type":"bundle","verdict":"verified_faster","files":[...],...}
```

## Isolation and secrets

* The host never executes model output: `LiveSearch` has no local backend and the only execution path is
  `LiveBackend` -> `sandbox_worker.py` inside the Sandbox. A test patches `subprocess` and `os.system` to fail and runs a
  malicious "implementation" (`$system("env")`) through the pipeline.
* The Sandbox run receives a shell string plus exactly two files (the job JSON and `sandbox_worker.py`). The host's environment is
  never forwarded (no `env` argument), runs are `disposable`, and the key lives only in the host process.
* The visitor `note` is flattened to plain text (<= 280 chars), appended to the **architect prompt only**, inside
  `<visitor_note>` delimiters with an instruction to ignore any instruction in it. The model is never shown a secret, and every
  emitted event is scrubbed of the key's value as a backstop. The note cannot change caps, workload or format.

## Operating notes

* Needs `NEBIUS_API_KEY` in the API project's environment (it is also what the Sandbox SDK authenticates with) and the image
  `siliconsmith-base:latest` in that project. The image bakes the engine at build time, so a worker-side change needs an image
  rebuild; the host normalises what it sends so an older image still works.
* Live stage lines appear when the Sandbox run returns (the SDK has no output streaming); `lint running` is emitted
  immediately before the run starts so the UI is not silent.
