# Hardwright: brand, landing, app (plan for the redesign)

Oct 23 2026. Deadline Oct 30 10:00 PT; submit by Oct 29. Supersedes the UI parts of `WORKSTATION_PLAN.md`; the engines and honesty rules stay.

## 0. Decisions

* **Umbrella product name: Hardwright** ("hardware" + "wright", a maker, as in shipwright). It is ONE constant (`web/lib/brand.ts`) so it can be renamed in minutes. **SiliconSmith is only the Silicon workbench's engine name**, shown as "Silicon (SiliconSmith engine)" where relevant. The other workbenches are **Board** and **Matter**.
* Tagline: **"Agents that design hardware, and prove it."** Sub: "Chips, boards and physical parts, checked by verifiers the model cannot argue with."
* **No Library tab in the product.** The evidence library (`evidence/`, `siliconsmith verify-entry`) stays in the repo, README, Devpost and `docs/feedback.md` as "a personal library of verified instructions we built", for the judges. The app only uses it as the evidence behind claims (evidence chips), never as a page.
* Credits: the app shows a **credit balance** (demo credits). Hosted pool cap **$25** (was the old turn-count caps); per-visitor allowance e.g. $0.50; every agent message shows its real cost. Labelled "demo credits".
* Honesty rules unchanged: Nemotron only inside the product; no invented numbers, testimonials, user counts or logos; every figure on the landing page comes from real data computed at build time (`web/lib/facts.ts`); games run on real data or the real hosted endpoints; roadmap items are labelled.

## 1. Reference analysis (https://socratic-dev-final.vercel.app/, studied top to bottom; screenshots in `E:\Winter\siliconsmith\runs\ref\*.png`)

Page height ~14,300 px at 1440 wide. Sections in order, with what we copy as a PATTERN (layout, interaction, rhythm) and fill with OUR content:

| # | Reference section | Pattern | Hardwright version |
|---|---|---|---|
| nav | fixed glass bar: logo, links, theme toggle, mode pill, orange "Launch App" | glass blur, 82 px high | logo + Workbenches / How it works / The Bench / Proof / Stack, theme toggle, **Launch App** |
| rail | fixed right-edge vertical pill of 11 icons, active one highlighted with a coloured bar; click scrolls | scroll-spy dot navigator | same, one icon per section |
| hero | 5-line chunky headline, last keywords in a warm-to-blue gradient; 3 floating glass cards (code, a question bubble, a graph) at different depths; 3 stats; "Scroll to explore" | big display type, floating cards, parallax | "Design hardware. Prove it." with cards: a Verilog snippet with a green "proven" chip, a Board check result (B4 fail: GPIO12 vs GPIO14), a heat-plate thumbnail; 3 REAL stats |
| problem | headline with a red keyword, 4 stat tiles with counters animating 0 to N, a pull quote | counter-up on view | "Models state hardware facts with confidence." 4 tiles from REAL runs (candidates rejected by the ladder, first-draft board failures, small-gain honesty) |
| solution | "Meet X", 3 pills, a two-pane glass window (chat left, code right) with a Learning/Building toggle | split demo window with a mode toggle | chat left, evidence/result right, toggle **Unverified chat / Verified agent** showing the same question answered both ways |
| see it in action | titled demo card with Play and Reset buttons; messages appear one by one | scripted playback | Play replays a REAL recorded agent session (tool calls, results, cost) |
| before / after | two-sided card with a draggable divider and arrow keys | comparison slider | "Chatbot answer" vs "Verified answer" on the same board question, real recorded outputs |
| features | 9 numbered cards (01 to 09) with icon, title, text, "Learn more" | 3x3 grid | 9 real capabilities |
| codebase intelligence | animated pipeline diagram + 3 stats | node-and-edge animation | Intent, Agent proposes, Ladder, Evidence, Artifacts (RTL, netlist, STL); counters from real data |
| **the Dojo** | five compact mini-games on the page (Parsons, Code Surgery, ELI5, Mental Compiler, Big O): mode cards, one active with live preview, "check answer", "reset", "enter the full dojo" | **playable games teach the product** | **The Bench**: five games on real data (section 4) |
| how it works | 5 numbered steps | vertical steps | 5 steps |
| system architecture | "Not just a stack. A X in layers." 4 layer cards linked by a vertical line, chips of technologies | layered diagram | Interface (Next.js on Vercel), Agents (Nemotron Ultra/Super/Nano on Token Factory), Verifiers (Verilator, Yosys + SymbiYosys, SciPy FV and FEM, deterministic checkers), Isolation (Token Factory Sandboxes) |
| CTA / footer | gradient CTA band; footer columns, status line | | "Open the workstation" CTA; real links only (repo, PR, docs) |

Reference visual language to match: warm near-black ground (`#0F0E0D`, surfaces `#1C1917`/`#292524`, borders `#44403C`), glass cards with 1px translucent borders and blur, a faint grid + noise overlay (opacity .04), rounded 16 to 24 px cards, chunky display type with tight tracking, gradient on 1 to 3 keywords, small-caps mono labels (`LAYER 01`, `PREVIEW`), pill chips, generous spacing, easing `cubic-bezier(.16,1,.3,1)`.

**Our palette (same feel, our own colours):** ground `#0E0D0C`, surface `#1A1816`, elevated `#26231F`, border `#3A3631`; **ember** `#FF7A3D` (primary, CTA, Matter), **steel** `#5B8DEF` (Silicon), **pcb** `#3FB68B` (Board), **ok** `#7BD88F`, **warn** `#F2C14E`, **bad** `#FF6B5E`. Headline gradient: ember to steel. Fonts: **Unbounded** (display), **Space Grotesk** (body), **JetBrains Mono** (code), via `next/font/google`. Light theme must still work.

## 2. Landing page (route `/`)

Build every section above. Requirements: scroll-spy right rail; reveal-on-scroll and counter-up animations (respect `prefers-reduced-motion`); nothing overflows at 360, 390, 705, 768, 1024, 1440; no walls of text (max about 2 short lines under a heading, details live inside interactions); "Launch App" goes to `/app`. All numbers from `web/lib/facts.ts` (computed from `web/public/replays/*.ndjson`, `evidence/index.json` and recorded sessions). Real recorded agent sessions live in `web/public/recorded/*.json` (captured from the live agent, never typed by hand).

## 3. App (route `/app`)

* **First visit: modal tour**, 5 steps like the reference ("Step 1 of 5", Skip tour, Back/Next, progress dots, dim and blur backdrop, spotlight on the element being explained): 1 Welcome (what Hardwright is), 2 Workbench sidebar (Matter, Silicon, Board), 3 The canvas and the **workflow bar** (Brief, Propose, Verify, Evidence, Export), 4 The **Agent** (ask it to run things), 5 **Credits** and evidence chips. Remembered in `localStorage` (guarded); a "Tour" button replays it.
* **Left sidebar (icon rail with labels on hover and expanded state):** Matter, Silicon, Board, divider, Runs/History, Settings, Tour. No Library.
* **Top bar:** project name, workbench breadcrumb, model selector (Auto, Ultra, Super, Nano), **credit balance pill** (remaining of allowance, click for the breakdown and the $25 pool state), theme, share/export.
* **Layout:** three resizable panes (drag handles, collapse, persisted sizes): left = workbench inputs/workflow, centre = canvas, right = Agent. At < 1024 px the panes become tabs. "Adjustable" is a requirement.
* **Workflow bar** on every workbench: Brief, Propose, Verify, Evidence, Export, each step showing real status from the last run.
* **Agent (Cursor-like):** streaming chat, model badge, tool-call cards (collapsible, with arguments and result), **Apply** buttons, suggested prompts per workbench, cost per message, stop button, context chips (current design/run). It **performs actions in the app** through tools: set Matter parameters and run the simulation, edit the Board design (change a pin or a value) and re-check, load a template, open a recorded Silicon run and explain a node, run a bounded Board agent loop (propose, check, repair) and a bounded Matter parameter search. Actions that spend credits ask for a click and show the estimated cost.
* **Credits:** server-side accounting of real model cost per turn; per-visitor allowance; global pool cap **$25** hard stop; honest labels ("demo credits", "limits are per server instance" until a durable store exists). When credits are out: the free tools (Board check, Matter simulate, replays) keep working.
* Each workbench shows its honest-limits note in a collapsible "Scope and limits" row (not walls of text).

## 4. The Bench: five playable games on the landing page (real data only)

1. **Pick the instruction (Silicon):** shows the real hot loop of the TinyMaix kernel and the real candidates the agent proposed in run `r_w1_contree3`; the player picks one, then sees its real measured outcome (verified and speedup, pruned and why).
2. **Spot the mismatch (Board):** firmware pin header on the left, netlist on the right (real template `fault_gpio12_vs_gpio14`); click the wrong line; the real hosted checker confirms and shows B4.
3. **Shape the spreader (Matter):** sliders for fins and length; runs the real hosted solver; shows peak temperature against the two real baselines, with the result colour-coded.
4. **Hot-loop hunt (Silicon):** click the line that holds most cycles, scored against the real profile of the workload.
5. **Fix the rung (Board):** the pull-up resistor is too large for fast-mode I2C; choose a value; the real B3 check passes or fails with the real rise-time numbers.

Each game: mode cards like the reference (label, PREVIEW/LIVE chip), a compact live preview, Check and Reset buttons, instant explanation, "Open in the app" handoff to the matching workbench with state prefilled.

## 5. Sessions and file ownership (no two writers on a file set)

| Session | Owns | Delivers |
|---|---|---|
| landing | `web/app/page.tsx`, `web/components/marketing/**` (except `bench/`), `web/lib/facts.ts`, `web/public/recorded/**` | brand tokens use, all landing sections, scroll rail, animations, real facts |
| bench | `web/components/marketing/bench/**` | the five games with tests |
| app | `web/app/app/**`, `web/components/app/**` | shell, sidebar, tour, resizable panes, workflow bars, workbench canvases (reusing existing run/board/matter components) |
| agent | `web/app/api/agent/**`, `web/lib/agent*`, `web/lib/credits*`, `web/components/agent/**` | agent v2 with UI actions, credits, $25 pool, evals |
| me | `web/lib/brand.ts`, `web/app/brand.css`, `web/app/layout.tsx` (fonts), deploys, merges | tokens first, integration |

Shared files (`package.json`, lockfile, `globals.css`, `next.config.ts`) are touched only by me; ask in your report if you need a dependency.

## 6. Quality gates

`tsc`, `vitest`, `next build` green; rendered gate at 360/390/705/768/1024/1440 with screenshots; no horizontal overflow; keyboard and focus; reduced motion; content states for every interactive part (loading, empty, error, partial, limit); no invented data; tests that fail if a landing figure is not derived from real data.
