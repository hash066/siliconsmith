# Feedback on Nebius Token Factory, Sandboxes and NVIDIA Nemotron

From building SiliconSmith (Oct 20 to 30 2026): an agent that invents and proves custom RISC-V instructions,
with Nemotron 3 Ultra, Super and Nano called through Token Factory. Everything below is something we hit
or measured; the numbers come from our own run logs (`web/public/replays/`).

## Token Factory Sandboxes: the activation path was our biggest blocker

* **What happened.** Our API key authenticated and `get_token_info()` (contree-sdk 0.3.6) worked, but every
  permission it listed was `False`. Nothing in the SDK, the error text or the docs tells you that this means
  "Sandboxes is not enabled for your project". We inferred it by elimination, and the route to fix it
  (emailing contree@nebius.com with the project ID) is not something the SDK or error points to. We could not create or run an instance, so our Sandboxes backend is written and tested against the
  protocol locally but has not run a search.
* **Ask.** Say it in the error: if an operation is refused because the project is not enabled, return a message
  that names the fix and the contact. A short "self-serve request access" button in the console would be better.
  For a hackathon whose featured tool is Sandboxes, activation could be on by default for participants' projects.
* **`get_token_info()` output.** It prints permissions and limits (50 concurrent instances, 3600 s per run, 12 GB per
  layer) but not what each permission gates. A line per permission would help.
* **Image workflow.** We expected to build from a Dockerfile with the `contree` CLI, but the `contree` CLI was not
  installed alongside the SDK, and the alternative (build elsewhere, import from a registry) needs a registry and a local Docker
  disk. A documented one-command "build this directory" path in the SDK would remove a day of setup.
* **Design we liked.** Checkpoint images per operation map exactly onto a search tree: a child starts from its
  parent's image and its result is the next checkpoint. That is why we chose Sandboxes for the architecture,
  and it is a genuinely good fit for agents that search over states.

### What we hit once Sandboxes was enabled (first real search: `r_w1_contree3`)

* **Importing a base image.** `images.oci("docker.io/library/ubuntu:24.04", tag="ubuntu:24.04")` failed with a 500 on the
  tag lookup, while `images.import_from(...)` with a plain tag worked. Using `ubuntu:24.04` directly with `images.use`
  gives a 404 until it has been imported, which the docs do not say up front.
* **Transient 500s while waiting.** `get_operation_status` answered HTTP 500 repeatedly while a long run was healthy. The SDK's
  `wait()` raises instead of retrying, so a naive agent loop dies mid-run. We now retry 5xx. Retrying inside the SDK would
  be better.
* **`truncate_output_at`** must be under 10 MiB. We passed 16 MiB and got a 400 on instance creation; the SDK did not
  validate it client-side.
* **Environment.** A non-disposable run builds an image from a shell command, but nothing like a Dockerfile `ENV`
  carries over, so every later run has to re-export `PATH`. Our first search failed because of this (verilator not
  found in all 6 candidates). A way to set image-level environment would remove that trap.
* **Build speed and sizing.** Building our toolchain image (Ubuntu + OSS CAD Suite) inside Sandboxes took 171 s with no
  local Docker, which was great. Each instance reported 4 vCPU and 3.9 GB RAM.
* **Result.** One search: 21 sandbox runs, up to 8 concurrent, every child started from its parent's checkpoint image
  (we assert this from the event log), 19 minutes, $0.44 of Nemotron spend.

## Nemotron through Token Factory: model behaviour we measured

* **Thinking mode and the token cap.** With `chat_template_kwargs: {enable_thinking: true}` the reasoning tokens
  count against `max_tokens`. When an RTL answer needed room, the visible JSON was cut off mid-object
  ("unterminated JSON object"). In one run (`r_w2_final`) 3 of the 6 first-round candidates were lost this way
  before they reached verification, and the automatic retry kept thinking and was cut off again. Our fix: retry
  without thinking. Useful platform behaviour would be a `finish_reason` of `length` that is easy to see, and a
  separate budget for reasoning versus answer.
* **Invalid JSON.** Besides truncation, replies sometimes contain raw control characters inside strings
  (multi-line Verilog), which strict JSON parsers reject. A JSON-schema constrained mode (`response_format` with
  a schema) that works with thinking models would remove our parsing and retry code.
* **Latency.** Medians across three W1/W2 runs: Nano triage 1.0 s; Super implement 18 s, polish 22 s, repair
  42 s; Ultra architect 46 s. The slowest single Ultra call took 658 s; long tails like this, plus many sequential
  calls, are why a run takes 15 to 30 minutes. A documented latency expectation (or a streaming default) would
  help planning.
* **Cost.** Cheap enough to search: a full run is $0.20 to $0.56 (about 215k to 540k tokens). Per-run split for
  `r_w1_final`: Ultra $0.234 (6 calls), Super $0.330 (71 calls), Nano $0.001 (18 calls). The price list was easy to
  find; we did not find a usage endpoint that returns spend per project per day, which our public demo needs for a hard
  daily cap (we keep our own ledger).
* **Model IDs.** The three IDs we use differ in casing and prefix style
  (`nvidia/Nemotron-3-Ultra-550b-a55b`, `nvidia/nemotron-3-super-120b-a12b`,
  `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`). A `GET /models` listing helped; consistent naming would prevent typos.
* **Quality.** Nemotron Ultra proposed the right first idea unprompted (a 4-lane int8 dot product) on a real
  TinyMaix kernel. Super's Verilog was usually lint-clean but often wrong in corner cases, which is why the
  formal check matters: of the instructions the agent wrote, several were rejected by a SAT counterexample or a
  mismatch on random vectors and then repaired.

## Hardwright era (Oct 22 to 24): hosting, Sandboxes in a web product, and Nemotron in an agent

* **Sandboxes work well as a backend for a public web function, once activated.** A Vercel Python function starts a Sandbox, streams the stages and returns a verified
  result in about two minutes (live Silicon), and the same pattern routes a PCB (about 107 s). Streaming NDJSON through a rewrite proxy works for 2 to 3 minutes if the
  server sends a heartbeat line every few seconds.
* **`ForbiddenError` with no hint.** A Sandbox run from the web host failed with `ForbiddenError: You do not have permission to perform this action` while the same code and
  key worked locally. The cause was a missing `NEBIUS_PROJECT_ID` in the host's environment (the SDK reads it itself). The error does not say which setting is absent; naming it
  would have saved an hour.
* **A pasted key with a trailing newline** produced `Illegal header value b'Bearer v1...'` from the Sandbox SDK and `APIConnectionError` from the OpenAI client. Trimming the
  value on read fixes both; the SDK could trim it for you.
* **Sandboxes start with `HOME` empty.** KiCad aborts ("Environment variable HOME is empty"); setting `HOME` in the command fixes it. A note in the Sandbox docs would help.
* **Building an image inside a Sandbox is fast.** `images.use(base).run(shell=..., disposable=False)` then `tag_as` installed KiCad, a JRE and Xvfb in 74 s (the mirrors are near).
  This is the best workflow we found: no local Docker. Passing files into a run and reading base64 results back through stdout (about 1 MB) worked without trouble.
* **Transient 500s on the status endpoint** while a run is going: retry `wait()` a few times; the run continues.
* **Token Factory.** Native tool calling works for Super and Ultra; Nano needed `enable_thinking=false`. Thinking tokens count toward `max_tokens`, so a small cap truncated answers
  until we retried without thinking. Models sometimes put a raw newline inside a JSON string (code in a field); a lenient JSON parse handles it.
* **Agent behaviour.** Given a tool that needs a whole 2 KB design as an argument, Ultra sometimes sent invalid JSON and ran out of its per-turn token cap; a tool with tiny
  arguments (`board_fix_pin(function, pin)`) fixed the failure for good. Design tools for models: small arguments beat big ones.
* **Cost.** A chat turn with tool calls cost $0.003 to $0.02; a live Silicon run $0.04 to $0.07 in model tokens (Sandbox compute is billed separately).

## Where the platform made the product possible

* One OpenAI-compatible endpoint for all three Nemotron sizes made role-based routing (Ultra to design, Super to
  implement, Nano to triage) a few lines of code.
* Prices low enough that a design search costs less than a dollar, which is what makes a "search many CPUs"
  product reasonable to run publicly.
