"""Where a candidate CPU gets verified.

    local       in-process (fast dev loop)
    subprocess  the sandbox worker protocol run as a local process (tests the exact remote path)
    contree     a Token Factory Sandbox branch: each child starts from its parent's checkpoint
                image, and its own result image becomes the next checkpoint

All three return the same EvalResult and raise ladder.StageFailure / ladder.Prune the same way,
so the search never knows which one it is talking to.
"""

from __future__ import annotations

import json
import time
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Protocol

from . import hwgen, ladder, paths
from .tools.workload import Workload
from .worker import OUTCOME_TAG, STAGE_TAG, measured_from_dict, measured_to_dict

StageCb = Callable[[str, str, str, "dict | None"], None]


@dataclass
class EvalJob:
    """One candidate to verify.

    mode="instruction": CPU = parent_isa + ins (a new instruction), must speed up.
    mode="area":        CPU = parent_isa + ins (a smaller re-implementation), must not slow down,
                        must shrink vs `parent`, and is re-proven against the same spec.
    mode="software":    CPU = parent_isa (unchanged hardware), new patch, must speed up; ins is None.
    """

    node_id: str
    attempt: int
    workload: str
    parent_image: str
    base: ladder.Measured
    parent: ladder.Measured
    parent_isa: list[hwgen.Instruction]
    ins: hwgen.Instruction | None
    spec_rtl: str
    patch: dict[str, str]
    area_budget_pct: float
    vectors: int
    mode: str = "instruction"

    def to_json(self) -> str:
        return json.dumps({
            "node_id": self.node_id, "attempt": self.attempt, "workload": self.workload,
            "parent_image": self.parent_image, "mode": self.mode,
            "base": measured_to_dict(self.base), "parent": measured_to_dict(self.parent),
            "parent_isa": [asdict(i) for i in self.parent_isa],
            "ins": asdict(self.ins) if self.ins else None,
            "spec_rtl": self.spec_rtl, "patch": self.patch,
            "area_budget_pct": self.area_budget_pct, "vectors": self.vectors,
        })

    @classmethod
    def from_json(cls, text: str) -> "EvalJob":
        d = json.loads(text)
        return cls(
            node_id=d["node_id"], attempt=d.get("attempt", 0), workload=d["workload"],
            parent_image=d.get("parent_image", ""), mode=d.get("mode", "instruction"),
            base=measured_from_dict(d["base"]), parent=measured_from_dict(d["parent"]),
            parent_isa=[hwgen.Instruction(**i) for i in d["parent_isa"]],
            ins=hwgen.Instruction(**d["ins"]) if d.get("ins") else None,
            spec_rtl=d.get("spec_rtl", ""), patch=d["patch"],
            area_budget_pct=d["area_budget_pct"], vectors=d["vectors"],
        )


def evaluate_job(job: EvalJob, on_stage: StageCb, work: Path) -> ladder.Measured:
    """The single place a job is turned into ladder calls (used in-process and by the sandbox worker)."""
    wl = Workload.load(job.workload)
    if job.mode == "software":
        return ladder.evaluate_software(wl, job.base, job.parent, job.parent_isa, job.patch, work, on_stage)
    if job.ins is None:
        raise ValueError(f"mode {job.mode!r} needs an instruction")
    return ladder.evaluate(
        wl, job.base, job.parent, job.parent_isa, job.ins, job.spec_rtl, job.patch, work,
        on_stage=on_stage, area_budget_pct=job.area_budget_pct, vectors=job.vectors,
        require_gain=job.mode != "area", shrink_vs=job.parent.area if job.mode == "area" else None)


@dataclass
class EvalResult:
    measured: ladder.Measured
    image: str


class Backend(Protocol):
    name: str

    def baseline(self, wl: Workload, work: Path) -> tuple[ladder.Measured, str]: ...

    def evaluate(self, job: EvalJob, on_stage: StageCb, work: Path) -> EvalResult: ...


# ---------------------------------------------------------------- worker protocol

def parse_worker_lines(lines, on_stage: StageCb | None) -> dict:
    """Consume worker stdout lines, forwarding stage events; return the outcome object."""
    outcome: dict | None = None
    tail: list[str] = []
    for raw in lines:
        line = raw.rstrip("\n")
        if line.startswith(STAGE_TAG):
            ev = json.loads(line[len(STAGE_TAG):])
            if on_stage:
                on_stage(ev["stage"], ev["status"], ev.get("detail") or "", ev.get("artifacts"))
        elif line.startswith(OUTCOME_TAG):
            outcome = json.loads(line[len(OUTCOME_TAG):])
        else:
            tail = (tail + [line])[-40:]
    if outcome is None:
        raise ladder.StageFailure("e2e", "sandbox worker ended without an outcome", "\n".join(tail))
    return outcome


def raise_for_outcome(outcome: dict) -> ladder.Measured:
    if outcome.get("ok"):
        return measured_from_dict(outcome["measured"])
    kind, stage, msg = outcome.get("kind"), outcome.get("stage", "e2e"), outcome.get("message", "")
    if kind == "prune":
        raise ladder.Prune(stage, msg)
    raise ladder.StageFailure(stage, msg, outcome.get("log", ""), outcome.get("artifacts") or {})


# ---------------------------------------------------------------- backends

class LocalBackend:
    name = "local"

    def baseline(self, wl: Workload, work: Path) -> tuple[ladder.Measured, str]:
        return ladder.measure(wl, hwgen.CpuConfig(), {}, work), "local:root"

    def evaluate(self, job: EvalJob, on_stage: StageCb, work: Path) -> EvalResult:
        return EvalResult(evaluate_job(job, on_stage, work), f"local:{job.node_id}")


class SubprocessBackend:
    """Runs the exact sandbox worker protocol locally (streams stage events live)."""

    name = "subprocess"

    def _run(self, args: list[str], on_stage: StageCb | None) -> dict:
        p = subprocess.Popen([sys.executable, "-m", "siliconsmith.worker", *args], cwd=paths.ROOT / "engine",
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace")
        assert p.stdout is not None
        try:
            return parse_worker_lines(p.stdout, on_stage)
        finally:
            p.wait()

    def baseline(self, wl: Workload, work: Path) -> tuple[ladder.Measured, str]:
        return raise_for_outcome(self._run(["baseline", wl.id], None)), "subprocess:root"

    def evaluate(self, job: EvalJob, on_stage: StageCb, work: Path) -> EvalResult:
        work.mkdir(parents=True, exist_ok=True)
        jf = work / "job.json"
        jf.write_text(job.to_json(), encoding="utf-8")
        return EvalResult(raise_for_outcome(self._run(["eval", str(jf)], on_stage)), f"subprocess:{job.node_id}")


class ContreeBackend:
    """Token Factory Sandboxes. Every evaluation is a non-disposable run started from the parent's
    checkpoint image, so the child inherits the parent's build caches and becomes a checkpoint itself."""

    name = "contree"
    WORKER = ("export PATH=/opt/oss-cad-suite/bin:$PATH SS_ROOT=/work PYTHONPATH=/work/engine PYTHONDONTWRITEBYTECODE=1; "
              "cd /work/engine && python3 -m siliconsmith.worker")

    def __init__(self, base_image: str = "siliconsmith-base:latest", timeout_s: int = 3600):
        from contree_sdk import ContreeSync  # optional dependency

        self.sdk = ContreeSync()
        self.base_image = base_image
        self.timeout_s = timeout_s

    def _run(self, image_ref: str, shell: str, files: dict | None = None):
        img = self.sdk.images.use(image_ref)
        handle = img.run(shell=shell, files=files, timeout=self.timeout_s, disposable=False,
                         truncate_output_at=8 * 1024 * 1024)
        for attempt in range(40):  # the status endpoint answers a transient 500 now and then; the run continues
            try:
                return handle.wait()
            except Exception as e:  # noqa: BLE001
                if attempt == 39 or "500" not in str(e):
                    raise
                time.sleep(10)

    def baseline(self, wl: Workload, work: Path) -> tuple[ladder.Measured, str]:
        res = self._run(self.base_image, f"{self.WORKER} baseline {wl.id}")
        m = raise_for_outcome(parse_worker_lines((res.stdout or "").splitlines(), None))
        return m, str(res.uuid)

    def evaluate(self, job: EvalJob, on_stage: StageCb, work: Path) -> EvalResult:
        res = self._run(job.parent_image, f"{self.WORKER} eval /tmp/ss_job.json",
                        files={"/tmp/ss_job.json": job.to_json().encode()})
        outcome = parse_worker_lines((res.stdout or "").splitlines(), on_stage)
        return EvalResult(raise_for_outcome(outcome), str(res.uuid))


def make_backend(name: str) -> Backend:
    if name == "local":
        return LocalBackend()
    if name == "subprocess":
        return SubprocessBackend()
    if name == "contree":
        return ContreeBackend()
    raise ValueError(f"unknown backend {name!r} (local | subprocess | contree)")
