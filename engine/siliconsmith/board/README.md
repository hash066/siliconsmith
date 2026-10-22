# Board workbench engine (BoardSmith-lite)

A **netlist-level co-design checker**: deterministic Python that reads a design (part instances, nets,
MCU pin assignments, a firmware pin header) and a curated parts library, and reports which rungs of
the board ladder hold. It uses no LLM; the verifiers must stay deterministic code.

## Honest limits

* Netlist level only. **No** PCB layout, routing, EMC, thermal or fabrication, and no claim that a
  design "will work on a real board".
* Facts are **author-curated** from public documents. Every fact carries `{source, section, citation_checked, url}`.
  `esp32` and `bme280` facts are `citation_checked: true`: on 2026-10-22 the author read the full PDFs
  (ESP32-WROOM-32 Datasheet v3.8 from documentation.espressif.com; BME280 data sheet rev 1.6, BST-BME280-DS002-15,
  from a SparkFun-hosted copy, not Bosch's own site) and matched pin tables, ratings, addresses and strapping pins.
  "Checked" means one reader matched them to that document; it is still author-curated, not independently
  reviewed. Everything else is unchecked and the UI must say "author-curated, not independently verified".
  Only document and section names are cited; no page numbers are recorded.
* The USB-C sink Rd (5.1 kOhm on CC1 and CC2) fact is **unchecked**: the USB-IF specification itself was not read.
* Of the 11 library records, only 3 parts cite a public datasheet (`esp32`, `bme280`, `mcp73831`; `std_i2c` is a rules record from a TI app note). The other 7 parts are
  `origin: author_defined`: `ldo33` is a **generic LDO with values chosen for the template**, not a
  datasheet part (the day-1 brief asked for an LDO; no specific product is named), and `res`, `led`,
  `btn`, `load`, `batt`, `usbc` are placeholders. `usbc` cites the USB Type-C Rd rule as a fact.
* The reference design now includes a charger (`mcp73831`, datasheet read in full); the charge-current resistor value is not
  modelled and the charger's own battery drain with USB absent is not in the B5 model.

## Layout

| File | Role |
|---|---|
| `parts.py`, `parts/*.json` | Part, Pin, Fact, Provenance schema (pydantic) and the library |
| `netlist.py`, `designs/*.json` | Design model, JSON load/dump, the clean reference design |
| `checks.py` | The ladder: rungs B1 to B5 are implemented (`run_b1` .. `run_b5`, `run_ladder`) |
| `serverless.py`, `limits.py`, `api.py`, `vercel_handler.py` | Hostable entry points (`check`, `explain_failure`, `run_agent`, `handle_request`), input limits and in-memory rate limiter, FastAPI router, Vercel handler; contract in `HOSTING.md` |
| `templates.py`, `templates/*.json`, `design.schema.json` | Three ready designs (clean, GPIO12-vs-GPIO14, strapping pin) and the design JSON Schema |
| `agent.py` | Agent loop: Nemotron (via `llm.Nemotron.json`) proposes or repairs a design; the ladder judges; failures are fed back; user assumptions are enforced |
| `export.py` | Firmware pin header (C), BOM, KiCad `.net` netlist; no footprints, no layout |
| `faults.py` | 8-fault catalogue as data, 3 structural faults, `inject_fault` |
| `run_tests.sh` | Runs the tests in the WSL venv |

Evidence ids look like `part:esp32.gpio12.strapping` and resolve through `parts.resolve_fact`.

## Ladder (labels shown only when the rung passes; unknown never counts as pass)

| Rung | Label | Status |
|---|---|---|
| B1 | Netlist is well formed | implemented |
| B2 | Electrical limits respected (curated facts) | implemented |
| B3 | Bus and connector rules satisfied (curated facts) | implemented |
| B4 | Firmware matches the netlist | implemented |
| B5 | Battery estimate meets target (model, not measured) | implemented |

B2 checks (net voltage = what the net's `power_out` pins declare; passives are not traced): supply pins within
absolute-max and recommended range; signal pins within domain + 0.3 V; regulator rail current = sum of load budgets
vs the regulator's `iout_max_ma`, arithmetic shown. A load's budget is its instance `peak_ma`, else the part's
peak fact, else the datasheet's stated supply requirement (the ESP32 module's 0.5 A supply, an upper bound, not a
measured peak). The charger input against the USB 5 V net is the same supply-pin check (charger `VDD`: 3.75 to 6 V, absolute max 7 V).

B3 checks: I2C pull-ups (parallel Rp per bus line, rise time 0.8473 x Rp x Cb against the mode limit, Rp above
(VCC - 0.4 V) / 3 mA); I2C addresses from each sensor's SDO strap, duplicates on one bus fail, a floating strap is
unknown; USB-C sink CC pins each need a resistor within 5% of 5.1 kOhm to a ground net (the 5% is the author's
tolerance; the USB-IF tolerance was not read). Bus capacitance and mode are **design assumptions** in
`Design.assumptions` (`i2c_mode`, `i2c_cb_pf`; the reference design assumes standard mode and 100 pF, not measured);
without them the rise-time check is unknown. The I2C limits come from TI app note SLVA689A (read in full, it quotes
the I2C spec; the spec itself was not read).

B4 checks: for every function the firmware header and the netlist agree on pin and use; the MCU pin is wired to the
assigned net; no input-only pin is driven; no flash pin and no strapping pin is used (conservative: any use of a
strapping pin fails, the level at reset is not analysed); no pin serves two functions. The `pin_mismatch` demo fault is
flagged twice, for the mismatch and because GPIO12 is a strapping pin.

B5 model: two states per period. Active window `active_s` is charged at the stated Wi-Fi transmit figure (typical, 50%
transmit duty basis in the datasheet, so not a peak) plus the sensor's measurement current plus regulator quiescent; the rest
at the stated deep-sleep and sleep currents. A linear regulator passes load current through. Average current, life =
capacity x usable fraction / average, and the arithmetic is shown in the result. Inputs that are not part facts are
**design assumptions** (`battery_capacity_mah`, `battery_usable_fraction`, `target_hours`, `active_s`, `period_s`); the
reference design assumes 2000 mAh, 0.8, 48 h, 5 s every 600 s. The LDO quiescent current (50 uA) is an author-chosen
generic value. The ESP32 deep-sleep figure is the chip's from the series datasheet, not a module measurement. Missing
assumptions or a load with only a peak current make B5 unknown. It is a model; nothing is measured.

B1 checks: every connected pin exists in its part's pin table; required pins are connected; a pin is on
one net only; no net has two output drivers; MCU assignments name real pins. A failed finding fails the
rung, otherwise an unknown finding (part not in the library, driver direction unknown) makes it unknown.

## Agent loop, events and runs

`agent.propose_design` / `agent.repair_design`: Nemotron **Ultra architects** the design from the brief, **Super repairs**
it (up to 2 repairs) from the structured check failures (rung, detail, evidence ids). The model writes a per-pin
`connections` draft (`"REF.PIN": "NET"`, so a pin cannot be on two nets) that code converts to a Design; **the ladder, not
the model, decides**: a run passes only when B1 to B5 all return `pass`. The user's brief assumptions replace anything the
model writes. `run.py` is the CLI and event writer (`python -m siliconsmith.board.run propose|repair --fault ID`).

Events follow the additive v2 shape (`docs/contracts/events.md` on the web branch): `run.started` with `domain: "board"` and
`ladder: [{id,label,tool}]`; `node.stage.stage` is `implement` or a rung id, with extra `evidence` (fact ids) and `label`
(only on pass); `node.scored` carries `metrics` and `ladder {B1: pass|fail|skipped}` (unknown, including "not run", is
reported `skipped`, never pass) and **omits the silicon numeric fields** (cycles, luts, ...) rather than inventing them;
`artifact.created {kind, path, sha256, node_id}` for design JSON, KiCad netlist, firmware header and BOM, written
**only for a passing design**; every judged design is kept in `runs/board/<run_id>/attempts/`. `node.created.proposal`
uses silicon's required fields with honest placeholders (`semantics_c` empty, operands `-`). Logs: `runs/logs/<run_id>.ndjson`
(the `runs/` directory is git-ignored, so logs are evidence on disk, not in the commit).

Cost control: each session has a USD cap (`--budget`, default 0.30) enforced by `Nemotron`; the first live iterations
(prompt and format fixes: missing `name`, a net-per-resistor misreading, resistor values) are recorded in the real-run list
below, failures included.

## Real runs and eval results (live Nemotron on Nebius Token Factory, 2026-10-22)

Run logs (`runs/logs/<id>.ndjson`, git-ignored; copies in the shared notes folder `board/`):

| Run id | What | Result |
|---|---|---|
| board-propose-template-1 .. -5 | template to design while the prompt and draft format were being fixed (missing `name`, resistor modelled as bridging two nets, resistor values omitted, strapping pins) | all failed the ladder or the JSON parse; these are the iteration history, not evals |
| board-propose-template-6 | template to design, Ultra architect + Super repairs | **passed B1 to B5** in 3 judged designs, $0.0093, artifacts with SHA-256 in the log |
| board-repair-pin_mismatch-1 | injected GPIO12-vs-GPIO14 firmware/netlist mismatch: B4 flags it, Super repairs, rerun passes B1 to B5 | **passed** in 2 judged designs, $0.0020 |

Evals (plan section 10; thresholds fixed in `evals.py`, never edited), each batch = 5 template sessions + 8 repair
sessions, a fresh budget-capped client per session. Three live batches were run; between them I fixed failure causes
found in the logs (see below), so batches 2 and 3 are **not independent of tuning on these exact tasks**. All three are
reported:

| Batch | Fault detection | Agent: template to design (>= 80%) | Agent: repair 8 faults (>= 75%) | Cost mean (< $0.05) |
|---|---|---|---|---|
| 1 `board-live-20261022-114123` | PASS 8/8, 0 FP | **FAIL** 3/5 = 60% | PASS 6/8 = 75% | PASS $0.0045 |
| 2 `board-live-20261022-115924` (after format, hint and charger changes) | PASS | PASS 5/5 = 100% | **FAIL** 5/8 = 62.5% | PASS $0.0053 |
| 3 `board-live-20261022-120244` (after B2 feedback change) | PASS | PASS 4/5 = 80% (at threshold) | PASS 6/8 = 75% (at threshold) | PASS $0.0052 |
| 4 `board-live-20261022-122016` (final, after the hosting work; no prompt change since batch 3) | PASS | PASS 4/5 = 80% (at threshold) | PASS 6/8 = 75% (at threshold) | PASS $0.0051 (total $0.066 over 13 sessions) |

Batches 3 and 4 are the same code and gave the same counts (the unreliable repairs were the same two). Read them as "at the threshold, with run-to-run variance of a size that moved the repair result between 62.5% and 75%
in one afternoon". `regulator_overload` (the model edits the load number instead of removing it) and
`i2c_address_collision` failed in both of the last two batches and remain unreliable; six repairs are reliable. 5 and 8 sessions are small samples.

Fixes made after batch 1, all in the model-facing layer or in check feedback (the checks' pass/fail logic was not loosened):
a per-pin `connections` draft format, a net named like a pin means "wired to that pin", safe-GPIO lists and load-parameter
notes in the library brief, B5 accepting `params.sleep_ma` on a load, B2 feedback naming the headroom and the nets that
have a source, a clearer SDO-strap message.

### Improving the two weak repairs: held-out protocol (2026-10-22, afternoon)

Protocol: (1) wrote 6 NEW held-out scenarios (`heldout.py`: 3 regulator-overload and 3 I2C-collision variants with different
refs, load values, strap choices and pull-up values); (2) recorded the BEFORE score without reading any held-out failure log;
(3) diagnosed only on the old catalogue faults, then changed only the model-facing layer; (4) measured AFTER on both sets.
No check was loosened; the suggested values are verified by tests to satisfy the unchanged checks. 3 sessions per scenario,
fresh budget-capped client each, same code path (`python -m siliconsmith.board.evals heldout --trials 3`).

What changed: B2 overload feedback now gives a concrete fitting value strictly below the headroom (or says to remove the
load); B3 collision feedback names the free address and the existing net to put the strap in (or says to remove the device
when both addresses are taken); the floating-strap message forbids pin-named nets and names the real nets; two prompt rules
(numeric limits must be satisfied strictly; never name a net after a pin).

| Set | Before | After | Cost before / after |
|---|---|---|---|
| Held-out, 18 sessions | 11/18 (collision 3/9, overload 8/9) | **18/18** (collision 9/9, overload 9/9) | $0.0626 / $0.0397 |
| Old 8 catalogue faults, 3 trials each (24) | 19/24 (the weak two 1/6) | **23/24** (the weak two 6/6; one `overvoltage_3v3_pin` miss) | $0.0683 / $0.0610 |
| Template-to-design, A/B of the two prompt sentences, 10 sessions per arm, interleaved | 5/10 | 9/10 | $0.102 / $0.086 |
| Standard live batch 5 (`board-live-20261022-155112`), after the change | | fault detection PASS; template-to-design **FAIL 3/5 = 60%**; repair PASS 8/8; cost PASS ($0.0050 mean) | |

Caveats, stated plainly: the held-out scenarios share fault families and parts with the tuned ones, and the hints were
written from the old-set failure messages, so a large part of the gain is the hints doing what they were designed to do;
18 sessions per set is small. The template-to-design rate is noisy: 3/5 in batch 5 versus 9/10 with the same prompt in the
A/B, and 4/5, 4/5, 5/5, 3/5 earlier. Do not read any single batch of 5 as the true rate. The target of 80% is met in
three of five batches and missed in two; that variance is the honest picture.

## Fault detection status

A fault is detected only by its own rung. Faults whose rung does not exist yet are pending; the tests assert that
implemented rungs stay silent on faults they do not own.

| Fault | Rung that will catch it | Status |
|---|---|---|
| pin_mismatch | B4 | detected |
| strapping_pin_misuse | B4 | detected |
| input_only_output | B4 | detected |
| i2c_pullup_too_large | B3 | detected |
| missing_cc_resistors | B3 | detected |
| regulator_overload | B2 | detected |
| overvoltage_3v3_pin | B2 | detected |
| i2c_address_collision | B3 | detected |

Three structural faults (outside the 8) exercise B1 and are detected: `floating_required_pin`,
`two_output_drivers`, `nonexistent_pin`. The clean reference design passes B1 with no false positives.

## Run the tests

From the repository root, inside the WSL distro (the venv's editable install points at the main
checkout, so set `PYTHONPATH` to this checkout's `engine`):

```bash
PYTHONPATH=$PWD/engine /opt/ss-venv/bin/python -m pytest -q engine/tests/test_board_*.py
```

For a non-editable install, add `board/parts/*.json` and `board/designs/*.json` to `package-data`
in `engine/pyproject.toml` (not done here; that file is outside this package).
