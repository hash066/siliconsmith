"""Hardwright: verifiers a hardware agent cannot argue with.

A small, dependency-light library of deterministic checks for hardware work (a board netlist against its firmware and its
part facts; a 2D heat spreader on a validated solver), plus a command-line tool and an MCP server so any coding agent can use
them. Nothing here calls a model or the network.

    import hardwright as hw
    hw.board_check(template="fault_gpio12_vs_gpio14")["passed"]    # False: the firmware uses a boot-strapping pin
    hw.matter_simulate(power_w=5, stl_path="heat-sink.stl")["peak_c"]

    $ hardwright board check design.json
    $ hardwright mcp                     # stdio MCP server for Claude Code, Cursor, Codex, VS Code
"""

from .api import (
    BOARD_CHECKS,
    HardwrightError,
    board_check,
    board_faults,
    board_fix_pin,
    board_parts,
    board_template,
    board_templates,
    matter_simulate,
)

__version__ = "0.1.0"

__all__ = [
    "BOARD_CHECKS",
    "HardwrightError",
    "__version__",
    "board_check",
    "board_faults",
    "board_fix_pin",
    "board_parts",
    "board_template",
    "board_templates",
    "matter_simulate",
]
