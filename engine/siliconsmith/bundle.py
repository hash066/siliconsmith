"""The deliverable: a self-contained bundle (and later a PR) with everything a team needs to adopt
the new instructions.

    <out>/rtl/ss_pcpi.v, rtl/ss_insn_<name>.v   drop-in hardware (PicoRV32 PCPI slot + pure units)
    <out>/include/ss_intrinsics.h               C intrinsics (+ C reference fallback off-target)
    <out>/src/<patched files>                   the workload rewritten to use them
    <out>/REPORT.md                             speedup, area, proofs, Nemotron usage, provenance
    <out>/run.ndjson                            the full event log (replayable in the run console)
"""

from __future__ import annotations

import json
import shutil
from collections import defaultdict
from pathlib import Path

from . import hwgen, ladder
from .tools.workload import Workload

RUNG = [  # (stage, ladder label) in the order the report lists them
    ("lint", "L1 Builds (Verilator -Wall lint)"),
    ("unit", "L2 Matches the C reference"),
    ("prove", "L3 Formally proven equivalent to an independent spec"),
    ("e2e", "L4 Bit-identical program output"),
    ("bench", "Benchmark"),
    ("synth", "L5 Area (Gowin synthesis)"),
]


def _events(path: Path) -> list[dict]:
    return [json.loads(ln) for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]


def _passes(events: list[dict], node_id: str) -> dict[str, str]:
    """Last passing detail per stage for a node (i.e. the attempt that survived)."""
    out: dict[str, str] = {}
    for e in events:
        if e["type"] == "node.stage" and e.get("node_id") == node_id and e.get("status") == "pass":
            out[e["stage"]] = e.get("detail", "")
    return out


def _cost(events: list[dict]) -> dict[str, dict]:
    agg: dict[str, dict] = defaultdict(lambda: {"calls": 0, "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0})
    for e in events:
        if e["type"] == "llm.call":
            a = agg[e["model"]]
            a["calls"] += 1
            a["tokens_in"] += e.get("tokens_in", 0)
            a["tokens_out"] += e.get("tokens_out", 0)
            a["cost_usd"] += e.get("cost_usd", 0.0)
    return dict(agg)


def render_report(wl: Workload, base: ladder.Measured, best, events: list[dict]) -> str:
    chain = []
    n = best
    while n is not None and n.id != "root":
        chain.append(n)
        n = n.parent
    chain.reverse()
    src = wl.manifest.get("source", {})
    lines = [f"# SiliconSmith report: {wl.title}", ""]
    if not chain:
        lines += ["**No custom instruction beat the baseline within the area budget.** "
                  "Every candidate and the reason it was rejected is in `run.ndjson`.", ""]
    else:
        m = best.measured
        lines += [
            f"**{base.cycles / m.cycles:.2f}x faster** ({base.cycles:,} → {m.cycles:,} cycles in the measured region) "
            f"for **{best.area_delta:+.1f}% LUT-equivalent area** on PicoRV32 (rv32im, fast multiplier).",
            "",
            "Speedup is in clock cycles on the same core; clock-frequency impact is reported separately "
            "when an FPGA place-and-route result is available.",
            "",
            "## New instructions",
            "",
            "| Mnemonic | What it does | Encoding | Why |",
            "|---|---|---|---|",
        ]
        for ins in best.isa:
            lines.append(f"| `{ins.mnemonic}` | {ins.title} | custom-0, funct7={ins.funct7} "
                         f"(`.insn r 0x0B, 0, {ins.funct7}, rd, rs1, rs2`) | {ins.rationale} |")
        lines += ["", "## Verification", ""]
        for node in chain:
            mn = node.isa[-1].mnemonic
            p = _passes(events, node.id)
            what = {"area": "area polish", "software": "software polish"}.get(getattr(node, "kind", ""), "new instruction")
            lines += [f"### `{mn}`: {what} (node {node.id})", ""]
            if "implement" in p and what != "new instruction":
                lines.append(f"- {p['implement']}")
            for stage, label in RUNG:
                if stage in p:
                    lines.append(f"- ✅ **{label}**: {p[stage]}")
            skipped = [e for e in events if e["type"] == "node.stage" and e.get("node_id") == node.id
                       and e.get("status") == "skipped"]
            for e in skipped[-1:]:
                lines.append(f"- ↪ **{e['stage']}**: {e.get('detail', '')}")
            lines.append("")
    lines += ["## How to adopt it", "",
              "1. Add `rtl/*.v` to your design and connect `ss_pcpi` to the core's PCPI port "
              "(PicoRV32: `ENABLE_PCPI=1`). Each `ss_insn_*` unit is a pure combinational module "
              "(`rs1`, `rs2` → `rd`), so it ports to other cores' custom-instruction interfaces too.",
              "2. Put `include/ss_intrinsics.h` on your firmware include path. Off-target builds "
              "fall back to the C reference, so host tests keep working.",
              "3. Replace the original sources with `src/`. The output was verified bit-identical "
              "to the original program.", ""]
    cost = _cost(events)
    if cost:
        total = sum(c["cost_usd"] for c in cost.values())
        lines += ["## Nemotron on Nebius Token Factory", "",
                  "| Model | Calls | Tokens in | Tokens out | Cost |", "|---|---|---|---|---|"]
        for model, c in sorted(cost.items()):
            lines.append(f"| {model} | {c['calls']} | {c['tokens_in']:,} | {c['tokens_out']:,} | ${c['cost_usd']:.3f} |")
        lines += [f"| **Total** | | | | **${total:.3f}** |", ""]
    pruned = [e for e in events if e["type"] == "node.pruned"]
    if pruned:
        lines += ["## Candidates the search rejected", ""]
        created = {e["node_id"]: e for e in events if e["type"] == "node.created"}
        for e in pruned:
            mn = ((created.get(e["node_id"]) or {}).get("proposal") or {}).get("mnemonic", "?")
            lines.append(f"- `{mn}` ({e['node_id']}): {e['reason']}")
        lines.append("")
    if src:
        lines += ["## Provenance", "",
                  f"Workload: `{src.get('symbol', wl.hot_symbol)}` from {src.get('repo', '')} "
                  f"(`{src.get('path', '')}`, commit {src.get('commit', '?')}, {src.get('license', '')}).", ""]
    return "\n".join(lines)


def write_bundle(out: Path, wl: Workload, base: ladder.Measured, best, events_path: Path) -> Path:
    shutil.rmtree(out, ignore_errors=True)
    (out / "include").mkdir(parents=True)
    hwgen.write_config(hwgen.CpuConfig(list(best.isa)), out / "rtl")
    shutil.move(str(out / "rtl" / "ss_intrinsics.h"), out / "include" / "ss_intrinsics.h")
    for name, text in best.patch.items():
        dst = out / "src" / name
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(text, encoding="utf-8", newline="\n")
    shutil.copy(events_path, out / "run.ndjson")
    (out / "REPORT.md").write_text(render_report(wl, base, best, _events(events_path)),
                                   encoding="utf-8", newline="\n")
    return out
