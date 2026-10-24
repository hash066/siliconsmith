"""A canonical text form of a design's netlist (parts and connections only), so a layout can be found for any design that has
the same netlist. The firmware pin table and the assumptions are NOT part of it: they do not change the board.

The same function exists in TypeScript (web/lib/layout.ts, `canonicalNetlist`); a test checks both produce the same text."""

from __future__ import annotations

import json

from ..netlist import Design


def canonical_netlist(design: Design) -> str:
    inst = sorted([i.ref, i.part, sorted([k, v] for k, v in i.params.items())] for i in design.instances)
    nets = sorted([n.name, sorted(n.pins)] for n in design.nets)
    return json.dumps({"instances": inst, "nets": nets}, separators=(",", ":"), sort_keys=True)
