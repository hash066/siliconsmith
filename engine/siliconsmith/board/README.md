# Board workbench engine (BoardSmith-lite)

A **netlist-level co-design checker**: deterministic Python that reads a design (part instances, nets,
MCU pin assignments, a firmware pin header) and a curated parts library, and reports which rungs of
the board ladder hold. It uses no LLM; the verifiers must stay deterministic code.

## Honest limits

* Netlist level only. **No** PCB layout, routing, EMC, thermal or fabrication, and no claim that a
  design "will work on a real board".
* Facts are **author-curated** from public datasheets and standards, recalled without re-reading them.
  Every fact carries `{source, section, citation_checked}`. All are `citation_checked: false`: nobody
  has fetched and cross-checked these citations. The UI must say "author-curated, not independently
  verified". Only the document and section name are cited; no page numbers are recorded, and section
  names are the author's recollection, so treat them as pointers to verify.
* Of the 9 library parts, only 2 cite a public datasheet (`esp32`, `bme280`). The other 7 are
  `origin: author_defined`: `ldo33` is a **generic LDO with values chosen for the template**, not a
  datasheet part (the day-1 brief asked for an LDO; no specific product is named), and `res`, `led`,
  `btn`, `load`, `batt`, `usbc` are placeholders. `usbc` cites the USB Type-C Rd rule as a fact.
* The reference design is partial: no Li-ion charger IC exists in the library yet, so the USB-C VBUS net
  ends at the connector.
* Pad numbers of the ESP32 module pin table are from the author's memory and unchecked.

## Layout

| File | Role |
|---|---|
| `parts.py`, `parts/*.json` | Part, Pin, Fact, Provenance schema (pydantic) and the library |
| `netlist.py`, `designs/*.json` | Design model, JSON load/dump, the clean reference design |
| `checks.py` | The ladder; rung B1 is implemented |
| `faults.py` | 8-fault catalogue as data, 3 structural faults, `inject_fault` |
| `run_tests.sh` | Runs the tests in the WSL venv |

Evidence ids look like `part:esp32.gpio12.strapping` and resolve through `parts.resolve_fact`.

## Ladder (labels shown only when the rung passes; unknown never counts as pass)

| Rung | Label | Status |
|---|---|---|
| B1 | Netlist is well formed | implemented |
| B2 | Electrical limits respected (curated facts) | pending |
| B3 | Bus and connector rules satisfied (curated facts) | pending |
| B4 | Firmware matches the netlist | pending |
| B5 | Battery estimate meets target (model, not measured) | pending |

B1 checks: every connected pin exists in its part's pin table; required pins are connected; a pin is on
one net only; no net has two output drivers; MCU assignments name real pins. A failed finding fails the
rung, otherwise an unknown finding (part not in the library, driver direction unknown) makes it unknown.

## Fault detection status

The 8 catalogue faults are **not detected on day 1**: they need rungs that do not exist yet. The tests
only assert that B1 stays silent on them (it does not claim to catch them).

| Fault | Rung that will catch it | Status |
|---|---|---|
| pin_mismatch | B4 | pending |
| strapping_pin_misuse | B4 | pending |
| input_only_output | B4 | pending |
| i2c_pullup_too_large | B3 | pending |
| missing_cc_resistors | B3 | pending |
| regulator_overload | B2 | pending |
| overvoltage_3v3_pin | B2 | pending |
| i2c_address_collision | B3 | pending |

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
