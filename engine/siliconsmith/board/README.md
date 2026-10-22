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

Evals (plan section 10; thresholds fixed in `evals.py`, never edited after seeing results), one live batch,
`runs/evals/board-live-20261022-114123.json`, a fresh budget-capped client per session, no re-runs cherry-picked:

| Eval | Target | Result |
|---|---|---|
| Fault detection, 8 faults, clean design | 8/8, 0 false positives | **PASS** 8/8, 0 false positives (deterministic) |
| Agent: template to design passing B1 to B5, 5 runs, pass@3 | >= 80% | **FAIL**: 3/5 = 60% (runs 3 and 5 hit the repair limit) |
| Agent: repair each of the 8 faults, pass@3 | >= 75% | **PASS** at the threshold: 6/8 = 75% (`missing_cc_resistors` and `regulator_overload` not repaired) |
| Cost per session | mean < $0.05 | **PASS**: mean $0.0045, total $0.059 over 13 sessions |

The agent-design eval failed its target and is reported as failed. The prompt was tuned on runs 1 to 6 before this batch
(on the same template), so the 60% is not a held-out estimate either way; 5 runs is a small sample.

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
