# Devpost form: every field, ready to paste

Hackathon: Nebius x NVIDIA Global AI Hackathon. Project: Hardwright (submission "Warrant" in Devpost's URL; rename the project title to Hardwright if it still says Warrant).

Before you submit, three things only you can do:

1. **The GitHub repo is still PRIVATE** (checked `gh repo view`: `PRIVATE`, Apache-2.0). The form's "Try it out" link and the words "open source" below are only true once it is public. Make it public (or tell me to), or judges will see a 404.
2. **Pinch (the pet) lives on the unpushed branch `claude/pet-companion-3029c5`.** The text calls it an experimental prototype. Merge and push that branch (or drop the Pinch lines and image 13) before submitting.
3. **Tick the two age/employee boxes yourself**, and pick the dropdown answers marked `YOU PICK` below.

---

## Page 1: Elevator pitch (200 characters max)

```
A prompt-first workstation where Nemotron agents design chips, boards and heat sinks and checkers prove every claim. Open source: pip package, CLI, MCP server and a pet.
```

(Character count is checked at the bottom of this file.)

## Page 2: Project story ("About the project", paste as Markdown)

```markdown
## Inspiration

Ask an AI assistant about hardware and it answers with total confidence, and it is often wrong. A button wired to a pin that sets the boot mode. A heat sink that cannot reach its target. A "faster" CPU instruction nobody proved. We read an engineer's forum thread about a brand-new ESP32 stuck in a boot loop, where the advice came down to one rule: strapping pins must be in a known state at boot. A model can wire a button onto one of those pins and the code still compiles. A wrong answer in hardware costs a dead board or a lost week, so we wanted an agent that **cannot claim what a checker has not returned**.

## What it does

**Hardwright** is a prompt-first workstation for hardware makers. You type what you want in plain words; the agent works in a chat on the left and a live preview shows the result on the right. Three workbenches:

- **Matter** ("a heat sink for a 5 W chip"). A validated finite-volume thermal solver, cross-checked by an independent finite-element solver, gives a 3D part coloured by temperature and a printable STL, compared against plain fins of the same material. It reports a loss as plainly as a win.
- **Board** ("a battery ESP32 sensor board with a BME280 and USB-C charging; check it against its firmware"). The agent drafts a netlist, five deterministic checks (B1 to B5) judge it, and it becomes a real routed 2-layer KiCad board. If the firmware says the wake button is on GPIO12 but the board wires GPIO14, the exact pads light up on the board. You can also paste your own netlist: KiCad 7 and Freerouting run inside a Nebius Token Factory Sandbox and place, route and check it (KiCad design-rule check: 0 errors), with Gerbers, BOM and pick-and-place exported.
- **Silicon** ("make this loop faster"). Nemotron proposes a custom RISC-V instruction for a real kernel (TinyMaix), writes the Verilog and the software that uses it, and Token Factory Sandboxes prove it: lint, a million test vectors, a Yosys formal proof for every possible input, whole-program output match, cycles and area. A live run on the public site measured **3.32x fewer cycles for +4.8% area**; the best recorded run reached 3.86x. You can also type your own operand pair and watch hardware and the C reference agree, down to the internal signals.

Around them: projects with their own chat, a **Workflow** of connected steps with real status, a list of **who verified what**, one-click export, demo credits metered from real token usage, and **The Bench**, five short games where you guess first and then the real verifiers decide.

### Open source: package, CLI, MCP server and a pet

Hardwright is open source (Apache-2.0), not just a website:

- **`pip install hardwright`**, a Python package with the same checkers the app uses.
- **A CLI**: `hardwright board check --template fault_gpio12_vs_gpio14` prints the five checks and names the failing pin, offline, no key needed.
- **An MCP server**: `claude mcp add hardwright -- hardwright mcp` lets Claude Code, Cursor, Codex or any MCP editor call the same checkers and get evidence ids back instead of guesses.
- **Pinch, an experimental desktop pet** (a prototype, original character): a small always-on-top window that watches your coding agent through Claude Code hooks, reacts when tests fail or pass, and can call the Hardwright checker over MCP. It has Watch, Suggest and Auto modes, a nudge cap and a spend cap, a stop button with a global hotkey, an action allowlist and secret redaction, and it only says "tests passed" if a run returned that.

## How we built it

- **Agents.** Nemotron 3 Ultra (architect and diagnosis), Super (engineer: Verilog, C, repairs, the independent reference) and Nano (triage), all through the Nebius Token Factory OpenAI-compatible endpoint with **native tool calling**. The chat agent performs real actions in the app (open a workbench, set parameters, run a check, move a pin) and reports the real cost of each turn ($0.003 to $0.02). Model choice is routed by difficulty.
- **Proof.** Everything a model writes runs in **Token Factory Sandboxes**: the live Silicon proof, and the routing of every generated board in a custom image (KiCad 7, a JRE and Freerouting) we built inside Sandboxes. The full Silicon search runs each candidate from its parent's checkpoint image.
- **Evidence rule, enforced in code.** UI claims carry evidence ids, and an agent answer is post-checked for invented commands or claimed runs that did not happen. Unknown and failing checks never count as a pass.
- **Stack.** Next.js and React on Vercel, a Python (FastAPI) engine for the checkers, KiCad, Freerouting, Verilator, Yosys and PicoRV32, a Python package with a CLI and MCP server, and a Tauri 2 shell plus a Node daemon for the pet.

## Challenges

KiCad 7 has no `kicad-cli pcb drc` and its session importer only works inside the GUI; Freerouting needs a full JRE and a display; Sandboxes start with an empty `HOME`, which makes KiCad refuse to run. Thinking tokens count against `max_tokens`, so some Verilog answers were cut off mid-object until we retried without thinking. A tool that needed a whole 2 KB design as an argument made Ultra emit invalid JSON; a tool with tiny arguments fixed it for good. We found a live-bundle bug only by running the real thing in production. All of it is written up in `docs/feedback.md`.

## Accomplishments we are proud of

A visitor with no account can run a real, formally proven CPU instruction in about two minutes, route a real PCB, and watch the agent refuse to over-claim. Across the recorded Silicon searches the verifier ladder rejected 63 of 93 candidate CPUs, and the board fault catalogue caught 8 of 8 injected wiring faults. A real pull request on TinyMaix was opened from the Silicon result.

## What we learned

Agents get better when the truth is not their job. The most useful design decision was making checkers the only source of "passed", then giving models small, typed tools. Small arguments beat big ones. Cheap models (Nano) are good triage; the expensive one (Ultra) earns its cost on the first idea and on diagnosis.

## What is verified, and what is not claimed

Verified: lint, one million vectors, a formal proof over all inputs, whole-program output and area (Silicon); KiCad 7 DRC, autorouter completion, five netlist checks and a catalogue of injected faults (Board); two independent solvers and equal-material baselines (Matter). Not claimed: that a board works (it is netlist level, not fabricated or electrically tested), CFD accuracy (2D steady state), clock speed in live runs, or FPGA and silicon results. Matter gains over plain fins are small and the app shows losses. Pinch is a prototype that has not been run against a live Claude Code session yet.

## What's next

Schematic export to `.kicad_sch`, more parts in the library (each needs a cross-checked pad map), boards with more than two layers, the Silicon proofs behind the same MCP server, and finishing Pinch.
```

## Page 2: Built with (25 tags max; type each and press enter)

```
nvidia-nemotron, nemotron-3-ultra, nemotron-3-super, nemotron-3-nano, nebius-token-factory, token-factory-sandboxes, nebius, python, fastapi, typescript, next.js, react, vercel, kicad, freerouting, verilator, yosys, picorv32, risc-v, model-context-protocol, mcp, cli, tauri, node.js, openai-api
```

(25 tags.)

## Page 2: "Try it out" links (use "add another link" for each)

1. App, no sign-up, $0.50 of demo credit: https://siliconsmith.vercel.app
2. Use it from your agent (MCP and CLI): https://siliconsmith.vercel.app/connect
3. Source code (Apache-2.0): https://github.com/hash066/siliconsmith  **(needs the repo public)**
4. A real pull request the Silicon engine opened: https://github.com/hash066/TinyMaix/pull/1
5. Feedback on Token Factory, Sandboxes and Nemotron: https://github.com/hash066/siliconsmith/blob/main/docs/feedback.md **(only after the repo is public and that file is on the default branch)**

## Page 2: Image gallery (15 images, in this order)

Files are in `E:\Winter\tools\demo\devpost\final\`, 3:2, under 5 MB each, captioned on top.

| # | File | What it shows |
|---|---|---|
| 1 | `01-hardwright.jpg` | Landing hero: describe hardware, get it designed, checked and proven |
| 2 | `02-the-problem.jpg` | Landing: models state hardware facts with confidence |
| 3 | `03-three-workbenches.jpg` | Landing: Matter, Board, Silicon in one workstation |
| 4 | `04-explore-a-board.jpg` | Landing: explore a real routed board, part by part |
| 5 | `05-chatbot-vs-checker.jpg` | Landing: a chatbot answer next to a verified answer |
| 6 | `06-the-bench-games.jpg` | Landing: The Bench, five short games |
| 7 | `07-matter.jpg` | App: Matter thermal result |
| 8 | `08-board.jpg` | App: routed board, 5 of 5 checks |
| 9 | `09-catches-the-mistake.jpg` | App: GPIO12 vs GPIO14 caught, pads highlighted |
| 10 | `10-silicon.jpg` | App: Silicon, a proven instruction (see note below) |
| 11 | `11-mcp-server.jpg` | /connect: the MCP server install |
| 12 | `12-cli.jpg` | The CLI, real output |
| 13 | `13-pinch-pet.jpg` | Pinch, the desktop pet (prototype) |
| 14 | `14-built-on-nebius.jpg` | Landing: architecture on Nebius |
| 15 | `15-how-it-works.jpg` | Landing: five steps, no trust required |

## Page 2: Demo video URL

Upload `E:\Winter\tools\demo\out4\hardwright_demo_v4.mp4` (1:52, well under the 3-minute limit) to YouTube or Vimeo as **Public or Unlisted, no password**, then paste the link. I can't upload it for you.

---

## Page 3: Nemotron and Nebius questions

**Which model(s) did you use, and why did you choose that size/variant?**

```
All three Nemotron 3 sizes, routed by difficulty through the Nebius Token Factory OpenAI-compatible endpoint: Nemotron 3 Ultra (550B-A55B) as the architect and for diagnosing hard failures, Nemotron 3 Super (120B-A12B) as the engineer that writes Verilog, C, repairs and the independent reference, and as the default chat agent, and Nemotron 3 Nano (30B-A3B) for cheap triage of raw tool logs. Ultra earns its latency on the first idea and on diagnosis; Super is fast and cheap enough to run dozens of times per search; Nano answers in about a second. Measured medians: Nano triage 1.0 s, Super implement 18 s, Super repair 42 s, Ultra architect 46 s.
```

**Quality rating (1 to 10): YOU PICK. Suggested: 8.** Answer text:

```
8. What worked: Ultra proposed the right first idea unprompted on a real kernel (a 4-lane int8 dot product on TinyMaix), native tool calling was reliable for Super and Ultra (the chat agent opens workbenches, sets parameters, runs checks and moves pins), and instruction-following on our evidence rule was good. What fell short: Super's Verilog was usually lint-clean but often wrong in corner cases (several candidates were rejected by a formal counterexample or random-vector mismatch before repair), thinking tokens counted against max_tokens so answers were sometimes cut off mid-JSON, and replies occasionally contained raw control characters inside strings. That is why every claim is checked by deterministic tools rather than trusted.
```

**Did you fine-tune, prompt-engineer, or use Nemotron out of the box?**

```
Out of the box: no fine-tuning. We prompt-engineered roles (architect, engineer, triage, chat agent), used native tool calling with small typed tools (a tool taking a pin name beat one taking a 2 KB design), strict JSON with a lenient parser, a retry without thinking mode when an answer was truncated, and a post-check that rejects agent answers claiming runs or commands that did not happen.
```

**How did Nemotron's performance compare to other models you've used?**

```
We ran a small head-to-head on the same Token Factory endpoint (script engine/scripts/bench_models.py, write-up docs/MODEL_COMPARISON.md): 8 models, same prompts, temperature 0.2, graders fixed in advance (we fixed two grader bugs after run 1 and re-ran once; both runs are reported). Tool use with our real board checker, the thing the product depends on, was a tie: every model called the checker, caught the GPIO12/GPIO14 fault and never claimed the board was ready for fab; Nemotron Super and Ultra were 100% on all tool-use trials. On closed-book ESP32 and hardware facts (15 questions x 2) Nemotron was not the best: DeepSeek-V4.1-Flash and Kimi-K2.6 100%, gpt-oss-120b 93%, GLM-5.3-Flash 87%, Nemotron Ultra 83%, Super 73%, Qwen3-235B 67%, Nano 63%. That is exactly why Hardwright takes facts from deterministic checkers instead of model memory. Nemotron's edge was speed and token economy: Ultra answered in a median 0.9 s with 47 output tokens per call versus 200 to 650 for the reasoning-heavy models, and three sizes on one endpoint let us route Ultra to design, Super to implement and Nano to triage. Small sample, one task family; not a general ranking.
```

**Which Nebius platform capabilities were most valuable, and how did you leverage them?**

```
Token Factory inference (one OpenAI-compatible endpoint for Ultra, Super and Nano, called from Vercel Python functions with native tool calling; no self-managed GPU instances) and Token Factory Sandboxes, which were the real enabler. Every model-written artifact runs in a Sandbox: the live Silicon proof (Verilator, Yosys, RISC-V GCC; lint, a million vectors, a formal proof, whole program, cycles, area) in about two minutes, and PCB routing in about 107 s using a custom image (KiCad 7, a JRE and Freerouting) that we built inside Sandboxes in 74 s with no local Docker. Checkpoint images per operation map exactly onto a search tree: in the full Silicon search each candidate starts from its parent's image (21 runs, up to 8 concurrent, asserted from the event log). Each instance reported 4 vCPU and 3.9 GB RAM. We stream stage results to the browser through a rewrite proxy with a heartbeat line.
```

**How likely are you to recommend running Nemotron on Nebius (1 to 10)? YOU PICK. Suggested: 8.**

```
8. One endpoint for all three Nemotron sizes made role-based routing a few lines of code, prices are low enough that a design search costs under a dollar, and Sandboxes with checkpoint images are a genuinely good fit for agents that search over states. It is not a 10 because Sandboxes activation was our biggest blocker (every permission read False with no message saying the project was not enabled), and a few errors (a bare ForbiddenError when NEBIUS_PROJECT_ID was missing) did not name the fix.
```

**Experience running Nemotron inference on Nebius vs previous environments (1 to 10)? YOU PICK. Suggested: 8.**

```
8. Inference was simple (OpenAI-compatible, native tool calling, clear price list) and Sandboxes removed the need for any local Docker or GPU box: we built our toolchain image inside Sandboxes and ran every proof there. Compared with running verifiers locally or on a VM we manage, the per-run isolation and checkpoint images are a clear improvement. Points lost for the activation path, occasional transient HTTP 500s on the status endpoint while a healthy run was going (we now retry), and reasoning tokens counting against max_tokens.
```

**What additional features or improvements would have made it more effective?**

```
1) Say it in the error when a project is not enabled for Sandboxes, with the fix and contact, or a self-serve request button; list what each get_token_info permission gates. 2) A documented one-command "build this directory" path in the SDK (the contree CLI was not installed with it). 3) Retry 5xx inside wait() instead of raising. 4) Image-level environment variables, so PATH does not have to be re-exported on every run. 5) Client-side validation of truncate_output_at (we passed 16 MiB and got a 400). 6) A visible finish_reason of length and a separate budget for reasoning versus answer tokens. 7) A JSON-schema constrained mode that works with thinking models. 8) A usage endpoint returning spend per project per day, for hard daily caps on a public demo. 9) Consistent model ID casing and prefixes. 10) Name the missing setting in ForbiddenError (it was NEBIUS_PROJECT_ID). Details with numbers are in docs/feedback.md.
```

**What do you most hope to see from the Nemotron team next?**

```
Reliable structured output together with reasoning (schema-constrained JSON that works with thinking), a controllable reasoning budget separate from the answer, lower tail latency on Ultra (our slowest single call took 658 s), a code-and-hardware-tuned variant that writes lint-clean Verilog and formal-friendly RTL more often, small tool-calling-tuned models for cheap agent loops, and published evals on hardware design tasks so builders can pick a size with evidence.
```

**Did you use Tavily in your project?**

```
No. Hardwright makes no runtime call to the Tavily API.
```
Select **No** in the dropdown.

**Builders & Brews, IRL Events City:** `YOU PICK`. I do not know if you attended one of the 20 city events. If you did not, choose the "not attending" or "N/A" option if the dropdown has one; do not pick a city you were not at.

**Age of majority and not an employee of the Promotion Entities:** tick these yourself; they are your declarations.

**Which AI tools have you leveraged while working on this project?**

```
NVIDIA Nemotron 3 Ultra, Super and Nano through Nebius Token Factory (inside the product, as its agents); Nebius Token Factory Sandboxes (to run and prove model-written hardware and to route boards); Claude Code (Anthropic's coding agent) as our AI pair programmer for building the app, engine, package, tests and docs; Verilator, Yosys and KiCad driven by those agents as deterministic tools.
```

**Describe the level of learning:** `YOU PICK` (the dropdown options are not shown to me). If it has a top option such as "Significant" or "Very high", it fits: a new platform (Sandboxes), formal verification in the loop, KiCad automation, MCP servers, and agent tool design were all new.

**Did you gain AI value that you can use in your career?** `YES`. Suggested text if it asks for words:

```
Yes. Designing agents around deterministic verifiers (the model proposes, a checker decides), tool design for models (small typed arguments), routing across model sizes by cost and difficulty, running untrusted model-written code in sandboxes, and shipping the same capability as an app, a package, a CLI and an MCP server are skills I will use directly.
```

**Upload a file (35 MB max):** `E:\Winter\tools\demo\devpost\hardwright-submission.zip` (this file, `feedback.md`, `EVALUATION.md`, `devpost.md` and the 14 to 15 gallery images). Built by the script in the session; check it before uploading.

---

Pitch length check: see the end of this message (computed when the file was written).
