"""Turn a few plain words about the board ("40x30mm, USB-C on the left edge, keep the antenna corner clear") into placement options.

Deliberately small and honest: it recognises a board size and which edge the USB-C and battery connectors sit on, says what it
understood, and lists everything else as IGNORED with the reason. It never silently drops a request."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

MAX_CHARS = 300
MIN_MM, MAX_MM = 25.0, 120.0
EDGES = ("left", "right", "bottom")

_SIZE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:mm)?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(?:mm)?", re.I)
_EDGE = re.compile(r"\b(left|right|bottom|top)\b")
_PARTS = (("usbc", re.compile(r"\busb(?:[- ]?c)?\b", re.I)), ("batt", re.compile(r"\b(?:battery|batt|jst)\b", re.I)))


@dataclass
class Constraints:
    width: float | None = None
    height: float | None = None
    connector_edges: dict[str, str] = field(default_factory=dict)  # part id -> "left" | "right" | "bottom"
    understood: list[str] = field(default_factory=list)
    ignored: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"width": self.width, "height": self.height, "connector_edges": dict(self.connector_edges), "understood": list(self.understood), "ignored": list(self.ignored)}


def parse_constraints(text: str | None) -> Constraints:
    c = Constraints()
    if not text or not text.strip():
        return c
    text = text.strip()[:MAX_CHARS]
    for clause in (s.strip() for s in re.split(r"[.;,\n]+", text)):
        if not clause:
            continue
        low = clause.lower()
        used = False
        m = _SIZE.search(clause)
        if m:
            w, h = float(m.group(1)), float(m.group(2))
            if MIN_MM <= w <= MAX_MM and MIN_MM <= h <= MAX_MM:
                c.width, c.height = w, h
                c.understood.append(f"Board size {w:g} × {h:g} mm")
            else:
                c.ignored.append(f"{clause}: a board side must be between {MIN_MM:g} and {MAX_MM:g} mm")
            used = True
        for part, rx in _PARTS:
            if rx.search(clause):
                e = _EDGE.search(low)
                name = "USB-C connector" if part == "usbc" else "Battery connector"
                if e and e.group(1) in EDGES:
                    c.connector_edges[part] = e.group(1)
                    c.understood.append(f"{name} on the {e.group(1)} edge")
                elif e:
                    c.ignored.append(f"{clause}: connectors can sit on the left, right or bottom edge; the top edge is the antenna's")
                else:
                    c.ignored.append(f"{clause}: no edge named (say left, right or bottom)")
                used = True
        if not used:
            if "antenna" in low:
                c.understood.append("Antenna: its end always hangs over the top edge with nothing placed under it")
            elif "pour" in low or "ground plane" in low or "gnd" in low:
                c.ignored.append(f"{clause}: ground pours are always on both layers")
            else:
                c.ignored.append(f"{clause}: not something the layout understands yet")
    return c
