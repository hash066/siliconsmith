"""CLI:  python -m siliconsmith.live run w1 [--budget 0.15] [--seconds 240] [--note TEXT] [--out events.ndjson]
        python -m siliconsmith.live baseline w1          # regenerate baselines/w1.json from a real Sandbox run
Prints one progress line per event (never the key) and writes the full NDJSON stream when --out is given."""

from __future__ import annotations

import argparse
import json
import sys

from .limits import DEFAULT_BUDGET_USD, DEFAULT_SECONDS, LiveError


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="siliconsmith.live")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("workload")
    r.add_argument("--budget", type=float, default=DEFAULT_BUDGET_USD)
    r.add_argument("--seconds", type=float, default=DEFAULT_SECONDS)
    r.add_argument("--note", default=None)
    r.add_argument("--out", default=None)
    b = sub.add_parser("baseline")
    b.add_argument("workload")
    a = ap.parse_args(argv)
    if a.cmd == "baseline":
        from .baseline import generate
        print("wrote", generate(a.workload))
        return 0
    from . import run_live
    try:
        stream = run_live(a.workload, a.budget, a.seconds, note=a.note)
    except LiveError as e:
        print(f"error {e.code}: {e.message}", file=sys.stderr)
        return 2
    fh = open(a.out, "w", encoding="utf-8", newline="\n") if a.out else None
    last = {}
    for ev in stream:
        if fh:
            fh.write(json.dumps(ev, separators=(",", ":")) + "\n")
            fh.flush()
        t = ev["type"]
        extra = ev.get("stage") or ev.get("model") or ev.get("status") or ""
        detail = ev.get("detail") or ev.get("reason") or ev.get("msg") or ev.get("error") or ""
        print(f"{ev['t']/1000:7.1f}s  {t:15s} {ev.get('node_id', ''):6s} {extra} {str(detail)[:110]}", flush=True)
        last = ev
    if last.get("type") == "bundle":
        print("\n" + last["headline"])
        print("totals:", last["totals"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
