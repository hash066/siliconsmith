"""Evidence library: instructions the agent invented and the ladder proved, each with a manifest and artifacts.

    siliconsmith library list
    siliconsmith verify-entry <id> [--vectors N]

`verify-entry` re-runs lint, the random-vector unit test and the formal equivalence proof from the stored artifacts.
No LLM is involved, so anyone can reproduce an entry for free. An entry is only ever created from a passing run.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

from . import hwgen, paths
from .tools import verify
from .tools.build import ToolError

ROOT = paths.ROOT / "evidence"
SCHEMA = 1


@dataclass
class Entry:
    id: str
    dir: Path
    manifest: dict

    def read(self, name: str) -> str:
        return (self.dir / name).read_text(encoding="utf-8")

    def instruction(self) -> hwgen.Instruction:
        m = self.manifest
        return hwgen.Instruction(name=m["instruction"]["name"], mnemonic=m["instruction"]["mnemonic"],
                                 funct7=m["instruction"]["funct7"], rtl=self.read("rtl.v"),
                                 c_ref=self.read("c_ref.c"), title=m.get("title", ""), rationale=m.get("rationale", ""))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tool_versions() -> dict[str, str]:
    """Versions of the tools that produce the verdicts, as installed now."""
    out: dict[str, str] = {}
    for key, cmd in (("verilator", ["verilator", "--version"]), ("yosys", ["yosys", "-V"]),
                     ("gcc", ["gcc", "--version"])):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
            out[key] = (r.stdout or r.stderr).splitlines()[0].strip()
        except (OSError, subprocess.SubprocessError, IndexError):
            out[key] = "unavailable"
    return out


def load_entry(entry_id: str, root: Path = ROOT) -> Entry:
    d = root / entry_id
    mf = d / "manifest.json"
    if not mf.exists():
        raise ToolError("library", f"no library entry {entry_id!r} (looked in {root})")
    return Entry(entry_id, d, json.loads(mf.read_text(encoding="utf-8")))


def list_entries(root: Path = ROOT) -> list[Entry]:
    if not root.exists():
        return []
    return [load_entry(p.name, root) for p in sorted(root.iterdir()) if (p / "manifest.json").exists()]


def check_integrity(entry: Entry) -> list[dict]:
    """Every stored artifact must still match the SHA-256 recorded in the manifest."""
    rows = []
    for a in entry.manifest["artifacts"]:
        p = entry.dir / a["path"]
        got = sha256(p) if p.exists() else None
        rows.append({"path": a["path"], "expected": a["sha256"], "actual": got, "ok": got == a["sha256"]})
    return rows


def verify_entry(entry: Entry, vectors: int = 1_000_000, work: Path | None = None) -> dict:
    """Re-run the ladder rungs that need no model: integrity, lint, unit vectors vs the C reference, formal proof."""
    own = work is None
    work = work or Path(tempfile.mkdtemp(prefix=f"verify_{entry.id}_"))
    ins = entry.instruction()
    spec = entry.read("spec.v")
    res: dict = {"id": entry.id, "mnemonic": ins.mnemonic, "tools": tool_versions(), "rungs": []}

    def rung(name: str, label: str, fn) -> bool:
        t0 = time.monotonic()
        try:
            detail = fn()
            res["rungs"].append({"rung": name, "label": label, "status": "pass", "detail": detail,
                                 "seconds": round(time.monotonic() - t0, 1)})
            return True
        except ToolError as e:
            res["rungs"].append({"rung": name, "label": label, "status": "fail", "detail": e.message[:300],
                                 "seconds": round(time.monotonic() - t0, 1)})
            return False

    def integrity() -> str:
        bad = [r["path"] for r in check_integrity(entry) if not r["ok"]]
        if bad:
            raise ToolError("integrity", "artifacts changed since the manifest was written: " + ", ".join(bad))
        return f"{len(entry.manifest['artifacts'])} artifacts match their SHA-256"

    def lint() -> str:
        r = verify.lint_unit(ins, work / "lint")
        return f"Verilator -Wall: {len(r.warnings)} warnings, 0 errors"

    def unit() -> str:
        r = verify.unit_test(ins, work / "unit", n_random=vectors)
        return f"{r.vectors:,} vectors, 0 mismatches against the C reference"

    def prove() -> str:
        r = verify.prove_equiv(ins, spec, work / "prove")
        return f"{r.method}, {r.seconds:.0f}s"

    ok = rung("integrity", "Artifacts match the manifest", integrity)
    ok = rung("L1", "Builds", lint) and ok
    ok = rung("L2", f"Matches C reference ({vectors:,} vectors)", unit) and ok
    ok = rung("L3", "Formally proven equivalent to spec", prove) and ok
    res["reproduced"] = ok
    if own:
        shutil.rmtree(work, ignore_errors=True)
    return res
