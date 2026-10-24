"""Make the routed board in a Token Factory Sandbox, for designs the app has no stored board for (KiCad cannot run on Vercel).

The host places the parts (pure Python, deterministic), ships the job and the pipeline to a Sandbox started from the
`siliconsmith-kicad` image (KiCad 7, Java, Xvfb, Freerouting; see build_sandbox_image.py), and builds the summary the web app reads
from what comes back. Nothing model-written runs here: the only input is a netlist the parts library validated."""

from __future__ import annotations

import base64
import json
import time
from pathlib import Path
from typing import Any, Callable

from ...live.backend import LiveBackend, SandboxCapReached  # noqa: F401  (SandboxCapReached re-exported)
from ...live.limits import Deadline
from ..netlist import Design
from ..parts import Part
from . import place as P
from .generate import summary_for

HERE = Path(__file__).parent
IMAGE = "siliconsmith-kicad:latest"
DIR = "/tmp/layout"

DOWNLOADS = [
    ("gerbers-and-drill.zip", "application/zip", "Gerber and drill files: what a board maker needs"),
    ("routed.kicad_pcb", "application/octet-stream", "The routed board, opens in KiCad 7"),
    ("positions.csv", "text/csv", "Pick-and-place positions"),
    ("bom.csv", "text/csv", "Parts list including the bypass capacitors the layout added"),
    ("all-layers.svg", "image/svg+xml", "The whole board as a picture"),
    ("drc.txt", "text/plain", "KiCad design-rule check report"),
]


class LayoutSandboxError(RuntimeError):
    """The Sandbox run ended without a board (the tools said no, or time ran out). The message says why."""


class LayoutBackend(LiveBackend):
    """A LiveBackend that runs the layout image instead of the Silicon one."""

    def __init__(self, deadline: Deadline, base_image: str = IMAGE):
        super().__init__(deadline, None, base_image=base_image)

    def run_layout(self, files: dict[str, bytes]) -> str:
        # HOME is empty in a Sandbox and KiCad will not start without one
        res = self._live_run(self.base_image, f"export HOME=/tmp/home && mkdir -p $HOME && cd {DIR} && python3 sandbox_worker.py", files)
        return res.stdout or ""


def generate_in_sandbox(
    design: Design,
    library: dict[str, Part],
    *,
    check: dict[str, Any] | None = None,
    deadline: Deadline | None = None,
    backend: Any = None,
    progress: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    """Returns {summary, board, downloads, seconds}. Raises P.LayoutError (cannot place) or LayoutSandboxError."""
    say = progress or (lambda _m: None)
    t0 = time.monotonic()
    say("Placing the parts")
    job = P.build_and_place(design, library)
    files = {
        f"{DIR}/job.json": json.dumps(P.to_json(job)).encode(),
        f"{DIR}/pcb_build.py": (HERE / "pcb_build.py").read_bytes(),
        f"{DIR}/runner.py": (HERE / "runner.py").read_bytes(),
        f"{DIR}/sandbox_worker.py": (HERE / "sandbox_worker.py").read_bytes(),
    }
    be = backend or LayoutBackend(deadline or Deadline(280))
    say("Routing and checking the board in a Sandbox (about one to two minutes)")
    try:
        out = be.run_layout(files)
    except SandboxCapReached as e:
        raise LayoutSandboxError(f"not enough time left to start the Sandbox: {e}") from None
    except Exception as e:  # noqa: BLE001 - a transport error, permission error and so on
        raise LayoutSandboxError(f"the Sandbox could not run the layout ({type(e).__name__})") from None
    payload = None
    for line in out.splitlines():
        if line.startswith("SS_LAYOUT_ERROR "):
            raise LayoutSandboxError(json.loads(line[len("SS_LAYOUT_ERROR "):]).get("message", "the layout failed"))
        if line.startswith("SS_LAYOUT "):
            payload = json.loads(line[len("SS_LAYOUT "):])
    if payload is None:
        raise LayoutSandboxError("the Sandbox run ended without a board" + (f": {out.strip()[-300:]}" if out.strip() else ""))
    summary = summary_for(design, library, job, payload["rr"], check, time.monotonic() - t0)
    board = json.loads(base64.b64decode(payload["files"]["board.json"]))
    downloads = [{"name": n, "mime": m, "note": note, "base64": payload["files"][n]} for n, m, note in DOWNLOADS if n in payload["files"]]
    return {"summary": summary, "board": board, "downloads": downloads, "seconds": round(time.monotonic() - t0, 1)}
