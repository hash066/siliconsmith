"""Steady-state 2D finite-volume heat solver for a thin plate.

Model (per unit plate area, plate thickness t, through-thickness convection
from BOTH faces):

    -div(k t grad T) + 2 h (T - T_inf) = q          on the material mask

Discretisation: regular square grid, cell size dx, unknowns at cell centres.
Material mask m(x, y) is boolean; k is zero outside the material, and the face
conductance between two cells uses the harmonic mean of their k, so a face
between material and void carries no heat (adiabatic). The outer boundary is
adiabatic except for optional fixed-temperature edges, where the boundary
temperature is imposed at the cell face (half-cell conductance 2 k t).

Units: metres, watts, kelvin / degC (differences only), W/(m K), W/(m^2 K).
Arrays are indexed [j, i] with i along x (columns) and j along y (rows).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import spsolve

EDGES = ("left", "right", "bottom", "top")


@dataclass(frozen=True)
class Source:
    """Rectangular heat-source patch in cell indices (half-open), total power Q."""

    i0: int
    i1: int
    j0: int
    j1: int
    Q: float  # watts, spread uniformly over the patch cells

    def cells(self) -> int:
        return (self.i1 - self.i0) * (self.j1 - self.j0)


@dataclass(frozen=True)
class Result:
    T: np.ndarray  # (ny, nx) temperature, NaN where there is no material
    peak: float  # maximum temperature
    peak_cell: tuple[int, int]  # (j, i)
    Q_in: float  # watts injected by the source
    Q_conv: float  # watts lost by convection (both faces)
    Q_fixed: float  # watts leaving through fixed-temperature edges (negative = entering)
    balance_rel: float  # |Q_in - Q_conv - Q_fixed| / max(|Q_in|, |Q_conv|, |Q_fixed|)
    solve_residual_rel: float  # ||A T - b|| / ||b|| of the linear solve


def solve(
    mask: np.ndarray,
    dx: float,
    k: float,
    t: float,
    h: float,
    T_inf: float,
    source: Source | None = None,
    fixed_edges: tuple[str, ...] = (),
    T_fixed: float = 0.0,
) -> Result:
    mask = np.asarray(mask, dtype=bool)
    if mask.ndim != 2:
        raise ValueError("mask must be 2D")
    if not mask.any():
        raise ValueError("mask has no material")
    if not (dx > 0 and k > 0 and t > 0 and h >= 0):
        raise ValueError("dx, k, t must be > 0 and h >= 0")
    for e in fixed_edges:
        if e not in EDGES:
            raise ValueError(f"unknown fixed edge {e!r}")
    ny, nx = mask.shape

    if source is not None:
        if not (0 <= source.i0 < source.i1 <= nx and 0 <= source.j0 < source.j1 <= ny):
            raise ValueError("source patch outside the grid")
        if not mask[source.j0 : source.j1, source.i0 : source.i1].all():
            raise ValueError("every source cell must be material")

    # Per-cell conductivity (zero outside the material).
    kc = np.where(mask, k, 0.0)

    # Cell numbering over material cells only.
    idx = -np.ones((ny, nx), dtype=np.int64)
    idx[mask] = np.arange(int(mask.sum()))
    n = int(mask.sum())

    def harmonic(a: np.ndarray, b: np.ndarray) -> np.ndarray:
        s = a + b
        return np.where(s > 0, 2.0 * a * b / np.where(s > 0, s, 1.0), 0.0)

    # Face conductances (square cells: k t dy/dx = k t).
    gx = harmonic(kc[:, :-1], kc[:, 1:]) * t  # between (j,i) and (j,i+1)
    gy = harmonic(kc[:-1, :], kc[1:, :]) * t  # between (j,i) and (j+1,i)

    rows, cols, vals = [], [], []
    diag = np.zeros(n)

    def add_pairs(g: np.ndarray, a: np.ndarray, b: np.ndarray) -> None:
        on = g > 0
        ia, ib, gv = a[on], b[on], g[on]
        np.add.at(diag, ia, gv)
        np.add.at(diag, ib, gv)
        rows.extend([ia, ib])
        cols.extend([ib, ia])
        vals.extend([-gv, -gv])

    add_pairs(gx, idx[:, :-1], idx[:, 1:])
    add_pairs(gy, idx[:-1, :], idx[1:, :])

    # Convection from both faces: 2 h dx^2 per cell.
    gconv = 2.0 * h * dx * dx
    diag += gconv

    # Fixed-temperature edges: face-imposed T, half-cell conductance 2 k t.
    bc_g = np.zeros(n)
    edge_cells = {
        "left": idx[:, 0],
        "right": idx[:, -1],
        "bottom": idx[0, :],
        "top": idx[-1, :],
    }
    for e in set(fixed_edges):
        c = edge_cells[e]
        c = c[c >= 0]
        np.add.at(bc_g, c, 2.0 * k * t)
    diag += bc_g

    if h == 0:
        # Without convection every connected piece of material needs a fixed edge,
        # otherwise its temperature is undetermined (singular matrix).
        from scipy.ndimage import label

        lab, ncomp = label(mask)
        sunk = np.unique(lab[idx >= 0][bc_g[idx[idx >= 0]] > 0]) if bc_g.any() else np.array([], int)
        if len(sunk) < ncomp:
            raise ValueError("singular problem: h = 0 and a material region has no fixed-temperature edge")

    b = gconv * T_inf + bc_g * T_fixed
    Q_in = 0.0
    if source is not None:
        qc = source.Q / source.cells()
        sc = idx[source.j0 : source.j1, source.i0 : source.i1].ravel()
        np.add.at(b, sc, qc)
        Q_in = float(source.Q)

    rows.append(np.arange(n))
    cols.append(np.arange(n))
    vals.append(diag)
    A = coo_matrix(
        (np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(n, n)
    ).tocsc()

    x = spsolve(A, b)
    bn = np.linalg.norm(b)
    solve_res = float(np.linalg.norm(A @ x - b) / bn) if bn > 0 else 0.0

    T = np.full((ny, nx), np.nan)
    T[mask] = x

    Q_conv = float(np.sum(gconv * (x - T_inf)))
    Q_fixed = float(np.sum(bc_g * (x - T_fixed)))
    scale = max(abs(Q_in), abs(Q_conv), abs(Q_fixed))
    balance = abs(Q_in - Q_conv - Q_fixed) / scale if scale > 0 else 0.0

    jj, ii = np.unravel_index(int(np.nanargmax(T)), T.shape)
    return Result(
        T=T,
        peak=float(np.nanmax(T)),
        peak_cell=(int(jj), int(ii)),
        Q_in=Q_in,
        Q_conv=Q_conv,
        Q_fixed=Q_fixed,
        balance_rel=float(balance),
        solve_residual_rel=solve_res,
    )


def connected_to_source(mask: np.ndarray, source: Source) -> bool:
    """True if all material is 4-connected to the source patch."""
    from scipy.ndimage import label

    lab, _ = label(np.asarray(mask, dtype=bool))
    ids = np.unique(lab[source.j0 : source.j1, source.i0 : source.i1])
    ids = ids[ids > 0]
    return len(ids) == 1 and bool(np.all((lab > 0) == (lab == ids[0])))
