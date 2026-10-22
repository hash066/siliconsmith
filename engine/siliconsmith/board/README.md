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
* Of the 9 library parts, only 2 cite a public datasheet (`esp32`, `bme280`). The other 7 are
  `origin: author_defined`: `ldo33` is a **generic LDO with values chosen for the template**, not a
  datasheet part (the day-1 brief asked for an LDO; no specific product is named), and `res`, `led`,
  `btn`, `load`, `batt`, `usbc` are placeholders. `usbc` cites the USB Type-C Rd rule as a fact.
* The reference design is partial: no Li-ion charger IC exists in the library yet, so the USB-C VBUS net
  ends at the connector.

## Layout

| File | Role |
|---|---|
| `parts.py`, `parts/*.json` | Part, Pin, Fact, Provenance schema (pydantic) and the library |
| `netlist.py`, `designs/*.json` | Design model, JSON load/dump, the clean reference design |
| `checks.py` | The ladder: rungs B1 to B5 are implemented (`run_b1` .. `run_b5`, `run_ladder`) |
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
measured peak). The charger-input-vs-USB check needs a charger part and is not implemented.

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
