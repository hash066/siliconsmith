"""Second, independently written solver: bilinear (Q1) finite elements.

Deliberately shares no code with solver.py. Differences that matter for M4:
  * discretisation: nodal unknowns at pixel corners, each material pixel is a
    bilinear square element (the primary solver is cell-centred finite volume);
  * convection uses the consistent mass matrix (not a lumped diagonal);
  * linear solve is incomplete-LU preconditioned conjugate gradients (the
    primary solver is a sparse direct solve).

Same model: -div(k t grad T) + 2 h (T - T_inf) = q, adiabatic outer boundary,
no fixed-temperature edges (the heat spreader problem is convection only).
Elements that touch only at a corner share one node, so conduction through a
single corner is possible here but not in the 4-connected primary solver; the
printability rule (minimum feature size 2 cells) excludes such geometry.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import LinearOperator, cg, spilu


@dataclass(frozen=True)
class FemResult:
    T_nodes: np.ndarray  # (ny+1, nx+1), NaN at nodes touching no material element
    peak: float
    Q_in: float
    Q_conv: float
    balance_rel: float
    cg_iters: int


# Unit-square Q1 element matrices (node order: (0,0), (1,0), (1,1), (0,1)).
_K = (1.0 / 6.0) * np.array(
    [[4, -1, -2, -1], [-1, 4, -1, -2], [-2, -1, 4, -1], [-1, -2, -1, 4]], dtype=float
)
_M = (1.0 / 36.0) * np.array(
    [[4, 2, 1, 2], [2, 4, 2, 1], [1, 2, 4, 2], [2, 1, 2, 4]], dtype=float
)


def solve_fem(
    mask: np.ndarray,
    dx: float,
    k: float,
    t: float,
    h: float,
    T_inf: float,
    source_cells: "tuple[int, int, int, int] | np.ndarray",
    Q: float,
    tol: float = 1e-11,
) -> FemResult:
    mask = np.asarray(mask, dtype=bool)
    ny, nx = mask.shape
    if isinstance(source_cells, np.ndarray):
        sm = source_cells.astype(bool)  # arbitrary source footprint (mask)
    else:
        i0, i1, j0, j1 = source_cells
        sm = np.zeros_like(mask)
        sm[j0:j1, i0:i1] = True
    if not sm.any() or not mask[sm].all():
        raise ValueError("every source cell must be material")
    if h <= 0:
        raise ValueError("fem solver needs h > 0 (convection only)")

    jj, ii = np.nonzero(mask)
    nid = lambda j, i: j * (nx + 1) + i  # noqa: E731
    nodes = np.stack([nid(jj, ii), nid(jj, ii + 1), nid(jj + 1, ii + 1), nid(jj + 1, ii)], axis=1)

    # K_e = k t * K (size independent for a square); convective mass 2 h dx^2 * M.
    Ke = k * t * _K + 2.0 * h * dx * dx * _M
    r = np.repeat(nodes, 4, axis=1).ravel()
    c = np.tile(nodes, (1, 4)).ravel()
    v = np.tile(Ke.ravel(), len(nodes))
    N = (ny + 1) * (nx + 1)
    A = coo_matrix((v, (r, c)), shape=(N, N)).tocsr()

    # Right-hand side: convective load 2 h T_inf * (element area / 4 per node) + source.
    b = np.zeros(N)
    np.add.at(b, nodes.ravel(), 2.0 * h * T_inf * dx * dx / 4.0)
    ncell = int(sm.sum())
    sj, si = np.nonzero(sm)
    snodes = np.stack([nid(sj, si), nid(sj, si + 1), nid(sj + 1, si + 1), nid(sj + 1, si)], axis=-1).reshape(-1, 4)
    np.add.at(b, snodes.ravel(), Q / ncell / 4.0)

    used = np.zeros(N, bool)
    used[nodes.ravel()] = True
    keep = np.nonzero(used)[0]
    Au = A[keep][:, keep].tocsc()
    bu = b[keep]

    ilu = spilu(Au, drop_tol=1e-5, fill_factor=20)
    M = LinearOperator(Au.shape, ilu.solve)
    its = [0]

    def cb(_):
        its[0] += 1

    x, info = cg(Au, bu, rtol=tol, atol=0.0, M=M, maxiter=5000, callback=cb)
    if info != 0:
        raise RuntimeError(f"cg did not converge (info={info})")

    T = np.full(N, np.nan)
    T[keep] = x
    T = T.reshape(ny + 1, nx + 1)

    # Convective loss = 2 h * integral (T - T_inf) dA ; with Q1 the integral is exact:
    # each element contributes (dx^2/4) * sum of its nodal values.
    Tn = np.nan_to_num(T, nan=0.0)
    elem_sum = Tn[jj, ii] + Tn[jj, ii + 1] + Tn[jj + 1, ii + 1] + Tn[jj + 1, ii]
    Q_conv = float(2.0 * h * (dx * dx / 4.0) * np.sum(elem_sum - 4.0 * T_inf))
    bal = abs(Q - Q_conv) / max(abs(Q), abs(Q_conv)) if max(abs(Q), abs(Q_conv)) > 0 else 0.0
    return FemResult(T_nodes=T, peak=float(np.nanmax(T)), Q_in=float(Q), Q_conv=Q_conv,
                     balance_rel=float(bal), cg_iters=its[0])
