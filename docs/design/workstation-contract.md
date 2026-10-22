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

### What the shell shows today (Oct 22, after the Board, Matter, agent and Library work)

| Surface | Shown now | Not built yet (label) |
|---|---|---|
| Agent panel | Streaming text, tool-call cards, evidence citations, confirm-before-action with a cost-estimate slot, model badge. `/api/agent` calls Nemotron on Token Factory with native tools, read-only tools only (library search, evidence lookup, explain a failed node), a per-turn token cap and in-memory daily limits (counted per server instance, and the UI says so). Without `NEBIUS_API_KEY` on the server it stays "Agent endpoint not connected yet" with a disabled composer. Answers that say verified, proven or passes without citing an evidence id are flagged | Action tools (start a run, verify, export: need a click and a cost estimate, not wired), Nano summaries of project state, shared (cross-instance) limits |
| Board canvas | Check matrix B1..B5 by design (unknown never counts as pass), per-rung evidence in the drawer with the cited fact ids, design chain, connection graph when a `design.json` is shipped with the replay, artifacts with SHA-256, the honest-limits notice. Appears only when a replay with `domain: board` exists; otherwise "not built yet" with a Roadmap label | A laid-out schematic (the graph is a connection graph), reading part facts live (the log carries fact ids only) |
| Matter viewer | Candidate gallery, Pareto of peak temperature against material, extruded plate drawn from the run's STL (shaded for form), figures, M1..M5 matrix. Appears only when a `domain: matter` replay exists; otherwise "not built yet" | A temperature-coloured plate: the event log has no temperature field, so none is shown |
| Library | `/workstation/library`: every instruction that passed L1..L5 in a recorded run, derived from the replays, with evidence chips, the C spec, the RTL text hash (computed in the browser) and every run that proved it | A curated manifest, reproduce status (`verify-entry`), L6 |
| Templates | `/workstation/templates`: reads `/templates.json` (provisional format), lists a template as usable only when its run is recorded, marks others broken; empty state when no manifest is installed | The manifest itself |
| Run canvas | Loading, partial, success, error as before | Live-run labelling and cap |
| Evidence drawer | Metric evidence (tool, version if recorded, run, node, seq, command) and rung evidence (status, claim only if passed, detail, fact ids); artifacts with hashes | Tool versions (no stream records them yet) |

## Evidence chip

A small bordered tag next to a number. It is a button: it opens the evidence drawer for that number. Data only from the replay events:
the scored/timing event that carries the number, the run config (for the command), the rung tool, `run.started.tool_versions` if present.
A missing field is shown as missing ("not recorded in this run's event log"), never guessed.

## Checks for the rendered gate

Viewports above; keyboard-only pass (tab order: top bar, switcher, rail, canvas, agent, drawer); visible focus (`:focus-visible` signal outline);
contrast (token pairs AA); reduced motion (global rule in `globals.css`); long-content check (long mnemonics and workload titles truncate or wrap);
touch targets at least 36 px in the mobile tab bar. States that cannot be exercised without a live endpoint are reported as **untested**, not passed.
