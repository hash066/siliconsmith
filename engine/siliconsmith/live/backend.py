"""The Sandbox backend for a live run: Token Factory Sandboxes, bounded by the run's deadline.

Everything model-written (Verilog, C) runs only inside the Sandbox. The Sandbox run gets exactly two things from the
host: a shell command and the files we pass (the job JSON and sandbox_worker.py). It never receives the host's
environment, key or any other file, and each run is disposable (no checkpoint images pile up in the project).
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from .. import ladder
from ..hwgen import normalize_c_ref
from ..backends import ContreeBackend, EvalJob, EvalResult, StageCb, parse_worker_lines, raise_for_outcome
from ..worker import OUTCOME_TAG, STAGE_TAG
from .limits import Deadline

WORKER_FILE = "/tmp/ss_live_worker.py"
SHELL = ("export PATH=/opt/oss-cad-suite/bin:$PATH SS_ROOT=/work PYTHONPATH=/work/engine PYTHONDONTWRITEBYTECODE=1; "
         "cd /work/engine && python3 " + WORKER_FILE)
MIN_OP_SECONDS = 45  # an evaluation needs about this long; do not start one with less time left


class SandboxCapReached(Exception):
    pass


class LiveBackend(ContreeBackend):
    name = "contree"

    def __init__(self, deadline: Deadline, bus=None, base_image: str = "siliconsmith-base:latest"):
        super().__init__(base_image)
        self.deadline, self.bus = deadline, bus
        self.sandbox_runs = 0
        self._worker_src = Path(__file__).with_name("sandbox_worker.py").read_bytes()

    def _live_run(self, image_ref: str, command: str, files: dict):
        remaining = self.deadline.remaining()
        if remaining < MIN_OP_SECONDS:
            raise SandboxCapReached(f"only {max(remaining, 0):.0f} s of the {self.deadline.max_seconds:.0f} s cap "
                                    "were left, not enough to start a Sandbox run")
        img = self.sdk.images.use(image_ref)
        self.sandbox_runs += 1
        handle = img.run(shell=command, files={**files, WORKER_FILE: self._worker_src}, timeout=int(remaining - 3),
                         disposable=True, truncate_output_at=4 * 1024 * 1024)
        for attempt in range(5):  # the status endpoint answers a transient 500 now and then; the run continues
            try:
                return handle.wait()
            except Exception as e:  # noqa: BLE001
                if attempt == 4 or "500" not in str(e) or self.deadline.remaining() < 15:
                    raise
                time.sleep(3)

    def check_spec(self, name: str, c_ref: str, spec_rtl: str, vectors: int = 200_000) -> tuple[bool, str, str]:
        """(ok, message, log): does the golden spec lint and agree with the C reference? Runs in a Sandbox."""
        # normalised here, not in the Sandbox: the image's engine may be older than this host's (it is baked at build time)
        job = json.dumps({"name": name, "c_ref": normalize_c_ref(c_ref), "spec_rtl": spec_rtl, "vectors": vectors}).encode()
        res = self._live_run(self.base_image, f"{SHELL} spec /tmp/ss_spec.json", {"/tmp/ss_spec.json": job})
        for line in (res.stdout or "").splitlines():
            if line.startswith(OUTCOME_TAG):
                o = json.loads(line[len(OUTCOME_TAG):])
                if o.get("ok"):
                    return True, f"{o['vectors']:,} vectors", ""
                return False, o.get("message", "spec failed"), o.get("log", "")
        return False, "the Sandbox spec check ended without a result", (res.stdout or "")[-1500:]

    def viz(self, name: str, rtl: str, c_ref: str) -> dict | None:
        """The instruction as the tools see it (word-level netlist, gate counts, a few simulated operand pairs). One short Sandbox run;
        None if it could not run (out of time or the tools said no): the views are then simply absent, nothing else changes."""
        job = json.dumps({"name": name, "rtl": rtl, "c_ref": normalize_c_ref(c_ref)}).encode()
        try:
            res = self._live_run(self.base_image, f"{SHELL} viz /tmp/ss_viz.json", {"/tmp/ss_viz.json": job})
        except Exception:  # noqa: BLE001 - SandboxCapReached, a transport error: the views are optional
            return None
        for line in (res.stdout or "").splitlines():
            if line.startswith("SS_VIZ "):
                try:
                    return json.loads(line[len("SS_VIZ "):])
                except ValueError:
                    return None
        return None

    def evaluate(self, job: EvalJob, on_stage: StageCb, work: Path) -> EvalResult:
        t_op = self.bus.elapsed_ms() if self.bus else 0
        on_stage("lint", "running", "starting the Sandbox run", None)  # the worker's first rung
        try:
            res = self._live_run(job.parent_image, f"{SHELL} eval /tmp/ss_job.json",
                                 {"/tmp/ss_job.json": job.to_json().encode()})
        except SandboxCapReached as e:
            raise ladder.Prune("e2e", f"wall-time cap: {e}") from e
        lines = (res.stdout or "").splitlines()
        dts: dict[tuple, float | None] = {}  # stage lines carry `dt` (seconds since the worker started)
        for ln in lines:
            if ln.startswith(STAGE_TAG):
                ev = json.loads(ln[len(STAGE_TAG):])
                dts[(ev["stage"], ev["status"])] = ev.get("dt")

        def staged(stage, status, detail, arts):
            dt = dts.get((stage, status))
            if self.bus is not None and dt is not None:
                self.bus.stage_clock = t_op + int(dt * 1000)
            on_stage(stage, status, detail, arts)

        try:
            outcome = parse_worker_lines(lines, staged)
        except ladder.StageFailure:
            if self.deadline.remaining() < 5:
                raise ladder.Prune("e2e", f"wall-time cap: the Sandbox run was stopped at "
                                          f"{self.deadline.max_seconds:.0f} s") from None
            raise
        finally:
            if self.bus is not None:
                self.bus.stage_clock = None
        return EvalResult(raise_for_outcome(outcome), str(res.uuid))
