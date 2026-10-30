"""Re-grade the stored closed-book answers with the corrected graders; prints first-grading vs corrected rates (no new model calls)."""
import json
import re
import sys
from pathlib import Path

src = Path(__file__).with_name("bench_models.py").read_text(encoding="utf-8")
head = src.split("# ---------------------------------------------------------------- tool use")[0]
head = head.split("# ---------------------------------------------------------------- closed-book")[1]
head = head.split("\n", 1)[1]
ns = {"re": re}
exec(head, ns)
QA = {q[0]: q[2] for q in ns["QA"]}
d = json.loads((Path(__file__).resolve().parents[1] / "runs" / "model_bench.json").read_text(encoding="utf-8"))
sys.stdout.reconfigure(encoding="utf-8")
print("| Model | Facts, first grading | Facts, corrected graders |")
print("|---|---|---|")
for m, rs in d.items():
    qa = [r for r in rs if r["kind"] == "qa"]
    a = sum(r["ok"] for r in qa)
    b = sum(bool(QA[r["id"]](r.get("ans", ""))) for r in qa)
    print(f"| {m.split('/')[-1]} | {100 * a / len(qa):.0f}% | {100 * b / len(qa):.0f}% |")
