"""Build evidence/<id>/ entries from real passing runs (run in the WSL distro; reads /var/tmp/ss-runs and runs/logs).

    /opt/ss-venv/bin/python scripts/build_library.py

An entry is created only if the node's formal proof log in the run's work directory says SUCCESS. Nothing is written for
a node that did not pass. The manifest records the source run, node, metrics, tool versions and SHA-256 of every artifact.
"""
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "engine"))
from siliconsmith import library, paths  # noqa: E402

RUNS = Path("/var/tmp/ss-runs")
LOGS = ROOT / "runs" / "logs"

# (entry id, run id, node id, short rationale shown in the library)
ENTRIES = [
    ("dot4-tinymaix", "r_w1_final", "n1.1"),
    ("xor-rotl12-chacha20", "r_w2_final3", "n2"),
    ("xor-rotl8-chacha20", "r_w2_final3", "n2.4.1"),
]


def events(run: str) -> list[dict]:
    return [json.loads(ln) for ln in (LOGS / f"{run}.ndjson").read_text(encoding="utf-8").splitlines()]


def proof_dir(run: str, node: str) -> Path:
    base = RUNS / run / node
    for a in sorted(base.glob("a*"), key=lambda p: int(p.name[1:]), reverse=True):
        log = a / "prove" / "prove.log"
        if log.exists() and "SUCCESS!" in log.read_text(errors="replace"):
            return a / "prove"
    raise SystemExit(f"{run}/{node}: no passing formal proof log found; refusing to create an entry")


def build(entry_id: str, run: str, node: str) -> dict:
    ev = events(run)
    created = {e["node_id"]: e for e in ev if e["type"] == "node.created"}
    scored = {e["node_id"]: e for e in ev if e["type"] == "node.scored"}
    timing = {e["node_id"]: e for e in ev if e["type"] == "node.timing"}
    if node not in scored or not scored[node]["feasible"]:
        raise SystemExit(f"{run}/{node} was not scored feasible")
    sc = scored[node]
    if sc["ladder"].get("L3") != "pass":
        raise SystemExit(f"{run}/{node}: ladder L3 is not pass")
    prop = created[node]["proposal"]
    pd = proof_dir(run, node)
    gate, gold = (pd / "gate.v").read_text(), (pd / "gold.v").read_text()
    name = re.search(r"module\s+ss_insn_(\w+)", gate).group(1)
    # the C reference the unit test used: the implement artifact of this node, or of the node it polishes
    c_ref = None
    for n in (node, created[node]["parent_id"]):
        for e in ev:
            if e["type"] == "node.stage" and e["node_id"] == n and e["stage"] == "implement" and \
                    e["status"] == "pass" and (e.get("artifacts") or {}).get("c_ref"):
                c_ref = e["artifacts"]["c_ref"]
    if not c_ref:
        raise SystemExit(f"{run}/{node}: no C reference found in the event log")
    iset = created[node]["instruction_set"]
    funct7 = iset.index(prop["mnemonic"])
    proof_log = (pd / "prove.log").read_text(errors="replace").splitlines()
    tail = "\n".join(proof_log[-40:])

    out = library.ROOT / entry_id
    out.mkdir(parents=True, exist_ok=True)
    files = {"rtl.v": gate, "spec.v": gold, "c_ref.c": c_ref.rstrip() + "\n", "proof.log": tail + "\n"}
    for fn, txt in files.items():
        (out / fn).write_text(txt, encoding="utf-8", newline="\n")
    start = next(e for e in ev if e["type"] == "run.started")
    t = timing.get(node)
    manifest = {
        "schema": library.SCHEMA,
        "id": entry_id,
        "title": prop["title"],
        "rationale": prop["rationale"],
        "instruction": {"name": name, "mnemonic": prop["mnemonic"], "funct7": funct7,
                        "encoding": f".insn r 0x0B, 0, {funct7}, rd, rs1, rs2", "cpu_carries": iset},
        "kind": prop.get("kind", "instruction"),
        "source": {"run_id": run, "node_id": node, "workload": start["workload"]["id"],
                   "backend": start["backend"], "created": time.strftime("%Y-%m-%d")},
        "metrics": {"cycles": sc["cycles"], "speedup": sc["speedup"], "area_delta_pct": sc["area_delta_pct"],
                    "luts": sc["luts"], "ffs": sc["ffs"],
                    "fmax_mhz": t["fmax_mhz"] if t else None, "wall_speedup": t["wall_speedup"] if t else None,
                    "note": "system-level numbers for the CPU that carries these instructions on this workload"},
        "ladder": {k: v for k, v in sc["ladder"].items()},
        "claims": ["Matches the C reference on the stored random-vector test",
                   "Formally proven equivalent to the stored spec for all 2^64 inputs (Yosys SAT miter)"],
        "not_claimed": ["verified on silicon", "equivalence to anything other than the stored spec",
                        "that the spec itself is the intended behaviour beyond its validation against the C reference"],
        "tools": library.tool_versions(),
        "reproduce": f"siliconsmith verify-entry {entry_id}",
        "artifacts": [{"path": fn, "sha256": library.sha256(out / fn), "bytes": (out / fn).stat().st_size}
                      for fn in files],
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8", newline="\n")
    return manifest


if __name__ == "__main__":
    for eid, run, node in ENTRIES:
        m = build(eid, run, node)
        print(f"built {eid}: {m['instruction']['mnemonic']} from {run}/{node}, {m['metrics']['speedup']}x, "
              f"{m['metrics']['area_delta_pct']}% area")
    index = [{k: json.loads((library.ROOT / e / 'manifest.json').read_text())[k] for k in
              ("id", "title", "instruction", "kind", "source", "metrics", "ladder", "claims", "not_claimed", "reproduce", "tools")}
             for e, _, _ in ENTRIES]
    (library.ROOT / "index.json").write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8", newline="\n")
    print("wrote", library.ROOT / "index.json")
