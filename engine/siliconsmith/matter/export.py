"""Artifacts: STL (extruded mask), results JSON, markdown report. All writes return (path, sha256)."""

from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path

import numpy as np

from .problem import Spreader


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def mask_to_stl(mask: np.ndarray, sp: Spreader) -> bytes:
    """Binary STL (millimetres) of the mask extruded to the plate thickness. Top/bottom faces per cell,
    side walls wherever material meets void or the plate edge. Triangles wound outward (right-hand rule)."""
    m = np.asarray(mask, dtype=bool)
    ny, nx = m.shape
    d = sp.dx * 1e3
    z1 = sp.t * 1e3
    tris: list[tuple] = []

    def quad(a, b, c, e):  # counter-clockwise a,b,c,e seen from outside
        tris.append((a, b, c))
        tris.append((a, c, e))

    for j, i in zip(*np.nonzero(m)):
        x0, x1, y0, y1 = i * d, (i + 1) * d, j * d, (j + 1) * d
        quad((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))  # top (+z)
        quad((x0, y0, 0), (x0, y1, 0), (x1, y1, 0), (x1, y0, 0))  # bottom (-z)
        if j == 0 or not m[j - 1, i]:  # -y wall
            quad((x0, y0, 0), (x1, y0, 0), (x1, y0, z1), (x0, y0, z1))
        if j == ny - 1 or not m[j + 1, i]:  # +y wall
            quad((x1, y1, 0), (x0, y1, 0), (x0, y1, z1), (x1, y1, z1))
        if i == 0 or not m[j, i - 1]:  # -x wall
            quad((x0, y1, 0), (x0, y0, 0), (x0, y0, z1), (x0, y1, z1))
        if i == nx - 1 or not m[j, i + 1]:  # +x wall
            quad((x1, y0, 0), (x1, y1, 0), (x1, y1, z1), (x1, y0, z1))

    out = bytearray(b"SiliconSmith Matter STL (mm)".ljust(80, b"\0"))
    out += struct.pack("<I", len(tris))
    for a, b, c in tris:
        u = np.subtract(b, a)
        v = np.subtract(c, a)
        nrm = np.cross(u, v)
        ln = np.linalg.norm(nrm)
        nrm = nrm / ln if ln else nrm
        out += struct.pack("<12fH", *nrm, *a, *b, *c, 0)
    return bytes(out)


def stl_stats(data: bytes) -> dict:
    """Parse our own STL back: triangle count and a closed-surface check (every edge used by an even count)."""
    n = struct.unpack("<I", data[80:84])[0]
    edges: dict = {}
    vol = 0.0
    for i in range(n):
        rec = struct.unpack("<12fH", data[84 + 50 * i : 84 + 50 * (i + 1)])
        p = [tuple(round(x, 4) for x in rec[3 + 3 * k : 6 + 3 * k]) for k in range(3)]
        for a, b in ((p[0], p[1]), (p[1], p[2]), (p[2], p[0])):
            edges[(a, b)] = edges.get((a, b), 0) + 1
        vol += np.dot(p[0], np.cross(p[1], p[2])) / 6.0
    unmatched = sum(1 for (a, b), c in edges.items() if edges.get((b, a), 0) != c)
    return dict(triangles=n, unmatched_edges=unmatched, volume_mm3=float(vol))


def write_artifact(path: Path, data: bytes | str) -> tuple[str, str]:
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, str):
        path.write_text(data, encoding="utf-8", newline="\n")
    else:
        path.write_bytes(data)
    return str(path), sha256_of(path)


def write_results_json(path: Path, payload: dict) -> tuple[str, str]:
    return write_artifact(path, json.dumps(payload, indent=2, default=lambda o: o.item() if hasattr(o, "item") else str(o)))
