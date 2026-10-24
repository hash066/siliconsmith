# Hardwright

**Verifiers a hardware agent cannot argue with.**

AI coding agents state hardware facts with total confidence and are often wrong: a pin that selects the boot mode, a
heat sink that cannot reach its target, a "faster" instruction that was never proven. `hardwright` is a small library,
command-line tool and [MCP](https://modelcontextprotocol.io) server that gives any agent (Claude Code, Cursor, Codex,
VS Code) deterministic checks it must pass before it can say a design is right.

* **Offline and free.** No model, no network, no API key. The same input gives the same answer.
* **Honest by construction.** Every check is `pass`, `fail` or `unknown`. Only `pass` carries a claim, and `unknown` is
  never counted as a pass. Results cite the part facts they rest on and say which facts were not checked against a source.
* **Small.** One `pip install`, standard library plus `pydantic` (and `numpy`/`scipy` for the heat solver).

```
pip install "hardwright[matter] @ git+https://github.com/hash066/siliconsmith#subdirectory=engine"
```

## What is in it

| Area | What it does | Checks |
|---|---|---|
| **Board** | A netlist-level design is checked against its own firmware pin table and author-curated part facts (ESP32, BME280, LDO, USB-C, battery). | B1 well formed, B2 electrical rules, B3 bus and connector rules, B4 firmware pins match the netlist and no boot-strapping hazard, B5 battery estimate |
| **Matter** | A 2D steady-state heat spreader is solved with a finite-volume solver, cross-checked by an independent FEM solver, and compared with plain-fin baselines. Writes a printable STL. | M1 solver validated on analytic cases, M2 valid geometry, M3 printable, M4 second solver agrees, M5 beats baselines |

It is netlist-level and 2D by design. It does **not** prove a board works, does no layout or routing, and the heat model is
not CFD and not a measurement. The limits are returned with every result.

## Python

```python
import hardwright as hw

report = hw.board_check(template="fault_gpio12_vs_gpio14")
report["passed"]                                   # False
[c["id"] for c in report["checks"] if c["status"] == "fail"]    # ['B4']

fixed = hw.board_fix_pin(template="fault_gpio12_vs_gpio14", function="wake_btn", pin="GPIO14")
fixed["passed"]                                    # True

part = hw.matter_simulate(power_w=5, gen_params={"n_fins": 8}, stl_path="heat-sink.stl")
part["peak_c"], part["verdict"]
```

Bad input raises `hardwright.HardwrightError` with a message that says what to change.

## Command line

```
hardwright board templates
hardwright board check design.json           # exit 0 if all five pass, 1 if not, 2 on bad input (use it in CI)
hardwright board check --template fault_gpio12_vs_gpio14 --json
hardwright board fix-pin --template fault_gpio12_vs_gpio14 wake_btn GPIO14
hardwright matter simulate --power 5 --param n_fins=8 --stl heat-sink.stl
```

## Use it from your coding agent (MCP)

```
claude mcp add hardwright -- hardwright mcp         # Claude Code
codex mcp add hardwright -- hardwright mcp          # Codex
```

Cursor (`.cursor/mcp.json`):

```json
{ "mcpServers": { "hardwright": { "command": "hardwright", "args": ["mcp"] } } }
```

If `hardwright` is not on your PATH use `python -m hardwright mcp`. `hardwright mcp --setup` prints every client's line.

Tools: `board_templates`, `board_get_template`, `board_check`, `board_fix_pin`, `board_parts`, `matter_simulate`. The server's
instructions tell the agent to report each status as returned, to treat `unknown` as not-a-pass, and to fix a failing design
instead of reassuring the user.

## How the checks stay honest

* Part facts live in `siliconsmith/board/parts/*.json`, each with a `citation_checked` flag. A fact that was not checked against its
  datasheet is reported as such.
* The board checker is tested against a catalogue of 8 injected wiring faults (`hardwright board faults` via the API:
  `hw.board_faults()`); each must be caught by a named check.
* The heat solver's thresholds are fixed before it is run on a candidate, and it is validated on analytic cases (M1).
* Every result carries `notice` / `limits` text saying what it does not show.

## The hosted workstation

The same engine runs behind <https://siliconsmith.vercel.app> as **Hardwright**, a workstation with a Nebius-hosted
Nemotron agent: describe a part, a board or a loop in plain words and get a checked result. The agent there can only
claim what these verifiers return. This package is the part you can use without any account.

## SiliconSmith (the Silicon workbench)

The repository also contains **SiliconSmith**, the engine behind Hardwright's Silicon workbench: an agent that invents,
implements and *proves* custom RISC-V instructions for a hot loop (lint, a million random vectors, a Yosys SAT miter proof,
whole-program output equality, cycle count and area), with every candidate verified in a Token Factory Sandbox. See the repository
README and `siliconsmith --help`.

## Development

```
pip install -e ".[matter,dev]"
pytest tests/test_hardwright_pkg.py
```

Apache-2.0.
