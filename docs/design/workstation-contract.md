# Workstation design contract

Source of truth for the `/workstation` shell. It follows `docs/WORKSTATION_PLAN.md` sections 3 and 12 and the
`frontend-design-direction` skill (design contract, content states, rendered finish gate). The rendered gate evidence
(screenshots + `docs/design/evidence/workstation-evidence.json`) is checked against this file.

## Design contract

| Field | Decision |
|---|---|
| Purpose | Operate and trust agent-built hardware designs in one place |
| Audience | Hardware/embedded/mechanical engineers, repeat users; scan: status, evidence, next action |
| Tone | Precision bench instrument: graphite, off-white ink, one phosphor signal colour, semantic red/amber; dense but quiet |
| Memorable detail | **The evidence chip**: a small calibration-sticker style tag on every number (tool, version, run, command) that opens the evidence drawer |
| Constraints | Existing Next.js 16 + Tailwind 4 app; tokens in `app/globals.css`; dark-first with light datasheet theme; WCAG AA; reduced-motion respected; the existing routes (`/`, `/how`, `/try`, `/runs/[id]`, `/runs/[id]/report`) keep working |
| First viewport | The workbench itself (canvas + agent), never a marketing hero |
| Honesty rule | A feature appears only when it is real. No mock data, no simulated responses. Unbuilt workbenches show a "not built yet" state with a roadmap label. Silicon shows real replays only |

Primary action: read a run's result and open the evidence behind a number. Hierarchy: top bar (where am I, is it proven, what did it cost) →
canvas (the run) → evidence drawer (why to believe it) → agent (ask about it).

## Target viewports

| Viewport | Layout |
|---|---|
| 1440x900 | Top bar; left rail (Project) 208 px; centre canvas; right Agent panel 340 px; bottom drawer (Events, Evidence, Cost) |
| 768x1024 | Rails collapse into tabs: Canvas, Agent, Project, Drawer. Canvas shows the run as tabs (Tree, Node) |
| 390x844 | Same tabs, one panel at a time; tree becomes the outline list; no horizontal scroll |

Also checked for horizontal overflow at 360, 390, 705, 768, 1024 and 1440 (grid base tracks are `minmax(0,1fr)`, `min-w-0` on grid children).
Below 1024 px the rails collapse into tabs.

## Content states

Every surface defines these. Trigger, visible feedback, safe next action; "Built" says whether the surface can show the state today.

| State | Agent panel | Board checks | Matter viewer | Library | Run canvas |
|---|---|---|---|---|---|
| Loading | streaming skeleton, stop button | per-check spinner, stable matrix | solver progress per candidate | skeleton rows | tree grows from events |
| Empty | suggests 3 starter prompts and templates | "no design yet" + start from template | "no geometry" + template | explains evidence rule | "pick a template" |
| Error | names the failing call, offers retry or smaller task | failed check with the exact fact and part | candidate failed: reason + code error | entry fails reproduce: shows diff | node pruned with reason |
| Partial | shows tool results received, marks missing | passed/failed/unknown separated; unknown never counts as pass | some candidates done, others running | entry with missing artifact flagged | live + replayed mix labelled |
| Success | cites evidence ids; offers export | all required checks green + "author-curated facts" notice | winner + second-solver agreement | reproduce passed with timestamp | best node + bundle link |
| Permission / limit | "daily budget used: replays and Verify still work" | n/a | n/a | n/a | live run capped: replay offered |

### What the shell shows today (Oct 22, hosted workbenches)

| Surface | Shown now | Not built yet (label) |
|---|---|---|
| Agent panel | Streaming text, tool-call cards, evidence citations, confirm-before-action with a cost-estimate slot, model badge. `/api/agent` calls Nemotron on Token Factory with native tools, **read-only**: `library_search`, `library_lookup`, `evidence_get` (a stored manifest and its exact reproduce command, shown and never run, or the evidence behind a run metric), `run_explain_failure`, `board_check` and `matter_simulate` (the free hosted functions). Per-turn token cap and in-memory daily limits (per server instance, and the UI says so). Without `NEBIUS_API_KEY` on the server it stays "Agent endpoint not connected yet" with a disabled composer; the Board and Matter panels do not need it. Answers that say verified, proven or passes without a cited evidence id are flagged | Action tools (start a run, verify, export), shared limits across instances |
| Board: Check your design | Real template picker (3 templates), editable design JSON, optional pin-header edit, `/api/board/check` with rungs B1 to B5 (pass, fail, unknown; a label only on pass), fact ids as chips that open the curated fact with its provenance and "citation checked" flag, the generated C header with Copy, "Explain the failures". States: empty, loading, 400 with field paths and line/column, 413, 429 with countdown, network error, stale-after-edit | A laid-out schematic |
| Board: Recorded run | Check matrix and design chain for a replay of `domain: board`; otherwise "No recorded Board run is installed" | Replays of agent runs are not shipped with the deployment yet |
| Matter: Simulate | Generator and parameter controls from the documented ranges, power and material limit, `/api/matter/simulate`, the plate coloured by the solver's temperatures (coolest cell to peak, legend with numbers), rungs M1 to M5, both baselines, the verdict and the honest limits, STL download. States: empty, loading, local range errors and server 422 field errors, 429, network error | Agent-written generators (they need Sandboxes) |
| Matter: Recorded run | Plate from a shipped STL, Pareto, gallery and matrix for a replay of `domain: matter`; otherwise the empty state | Replays are not shipped yet |
| Library | `/workstation/library`: stored evidence entries (manifest, claims and what is not claimed, tool versions, artifact hashes, the exact `siliconsmith verify-entry <id>` command with Copy, shown and never run) and every instruction that passed L1 to L5 in the recorded runs | L6 (real silicon), running the verifier from the site |
| Templates | `/workstation/templates`: reads `/templates.json` (provisional format), usable only when its run is recorded | The manifest itself |
| Run canvas | Loading, partial, success, error as before | Live-run labelling and cap |
| Evidence drawer | Metric evidence, rung evidence from replays and from live hosted calls, and curated facts with provenance | Tool versions in replays (no stream records them yet; the library manifests do) |

## Evidence chip

A small bordered tag next to a number. It is a button: it opens the evidence drawer for that number. Data only from the replay events:
the scored/timing event that carries the number, the run config (for the command), the rung tool, `run.started.tool_versions` if present.
A missing field is shown as missing ("not recorded in this run's event log"), never guessed.

## Checks for the rendered gate

Viewports above; keyboard-only pass (tab order: top bar, switcher, rail, canvas, agent, drawer); visible focus (`:focus-visible` signal outline);
contrast (token pairs AA); reduced motion (global rule in `globals.css`); long-content check (long mnemonics and workload titles truncate or wrap);
touch targets at least 36 px in the mobile tab bar. States that cannot be exercised without a live endpoint are reported as **untested**, not passed.
