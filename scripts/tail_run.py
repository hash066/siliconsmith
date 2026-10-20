"""Pretty-print a run's event log: python scripts/tail_run.py runs/logs/<run_id>.ndjson"""
import json
import sys

for ln in open(sys.argv[1], encoding="utf-8"):
    e = json.loads(ln)
    t, ts = e["type"], f'{e["t"] / 1000:6.1f}s'
    if t == "llm.call":
        print(f'{ts} llm {e["model"]:<15} {e["role"]:<10} in={e["tokens_in"]:<6} out={e["tokens_out"]:<6} '
              f'${e["cost_usd"]:.4f} {e["latency_ms"] / 1000:5.1f}s node={e["node_id"]}')
    elif t == "node.created":
        p = e.get("proposal") or {}
        print(f'{ts} NODE {e["node_id"]}: {p.get("mnemonic", "root")} — {p.get("title", "")}')
    elif t == "node.stage":
        print(f'{ts}   {e["node_id"]:<6} {e["stage"]:<9} {e["status"]:<7} a{e["attempt"]} {e.get("detail", "")[:120]}')
    elif t == "log":
        print(f'{ts} log: {e["msg"][:400]}')
    elif t in ("node.scored", "node.pruned", "run.baseline", "run.completed", "run.failed"):
        print(ts, t, {k: v for k, v in e.items() if k not in ("v", "seq", "t", "run_id", "type", "hotspots")})
