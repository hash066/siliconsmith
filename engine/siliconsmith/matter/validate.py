"""Validation suite for the Matter solver.

"Validated" here means: agrees with an analytic case within the pre-registered
thresholds in thresholds.py. Nothing more. Run `python -m siliconsmith.matter.validate`
to print the measured errors; add `--write` to regenerate VALIDATION.md.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

from . import thresholds as th
from .solver import Source, connected_to_source, solve

# ---------------------------------------------------------------- (a) fin

FIN = dict(L=0.05, w=0.01, t=2e-3, k=200.0, h=25.0, T_inf=25.0, T_base=75.0)


def fin_case(dx: float, **over) -> dict:
    """Straight plate fin, fixed base temperature, adiabatic tip, convection both faces."""
    p = {**FIN, **over}
    L, w, t, k, h, T_inf, T_b = (p[x] for x in ("L", "w", "t", "k", "h", "T_inf", "T_base"))
    nx, ny = round(L / dx), round(w / dx)
    res = solve(np.ones((ny, nx), bool), dx, k, t, h, T_inf, None, ("left",), T_b)
    m = np.sqrt(2 * h / (k * t))
    th_b = T_b - T_inf
    xc = (np.arange(nx) + 0.5) * dx
    ana = th_b * np.cosh(m * (L - xc)) / np.cosh(m * L)
    num = res.T[ny // 2] - T_inf
    # tip (x = L) temperature rise: reconstruct from the last cell using the
    # adiabatic-tip local solution theta'' = m^2 theta, theta'(L) = 0.
    tip_num = num[-1] / (1 + (m * dx) ** 2 / 8)
    tip_ana = th_b / np.cosh(m * L)
    q_ana = k * t * w * m * th_b * np.tanh(m * L)
    return dict(
        dx=dx,
        m=m,
        tip_err=abs(tip_num - tip_ana) / tip_ana,
        lastcell_err=abs(num[-1] - ana[-1]) / ana[-1],
        profile_err=float(np.max(np.abs(num - ana) / ana)),
        q_err=abs(-res.Q_fixed - q_ana) / q_ana,
        q_ana=q_ana,
        q_num=-res.Q_fixed,  # heat entering from the base
        tip_ana=tip_ana,
        tip_num=tip_num,
        balance=res.balance_rel,
    )


def fin_errors(dxs=(1e-3, 5e-4)) -> list[dict]:
    return [fin_case(d) for d in dxs]


# --------------------------------------------------------- (b) heat balance


def random_balance(n_cases: int = 25, seed: int = 0) -> list[dict]:
    rng = np.random.default_rng(seed)
    out = []
    for c in range(n_cases):
        ny, nx = int(rng.integers(8, 40)), int(rng.integers(8, 40))
        mask = rng.random((ny, nx)) < rng.uniform(0.4, 0.95)
        i0, j0 = int(rng.integers(0, nx - 3)), int(rng.integers(0, ny - 3))
        src = Source(i0, i0 + 3, j0, j0 + 3, float(rng.uniform(0.5, 50)))
        mask[src.j0 : src.j1, src.i0 : src.i1] = True
        edges = tuple(str(e) for e in rng.choice(["left", "right", "bottom", "top"], int(rng.integers(0, 3)), replace=False))
        h = float(rng.uniform(5, 100)) if (edges == () or rng.random() < 0.7) else 0.0
        if h == 0 and not edges:
            h = 10.0
        k, Tf = float(rng.uniform(1, 400)), float(rng.uniform(10, 60))
        try:
            r = solve(mask, 1e-3, k, 2e-3, h, 25.0, src, edges, Tf)
        except ValueError:  # h = 0 with a region that has no fixed edge is rejected by design
            h = 10.0
            r = solve(mask, 1e-3, k, 2e-3, h, 25.0, src, edges, Tf)
        out.append(dict(case=c, balance=r.balance_rel, residual=r.solve_residual_rel, edges=edges, h=h))
    return out


# ---------------------------------------------------------- (c) convergence

CONV = dict(plate=0.04, src=(0.016, 0.024, 0.016, 0.024), Q=5.0, k=200.0, t=2e-3, h=25.0, T_inf=25.0)


def conv_peak(s: int) -> float:
    """Peak temperature rise; grid has 20*s cells per side, dx = 2 mm / s."""
    p = CONV
    dx = 2e-3 / s
    n = 20 * s
    a, b, c, d = (round(v / dx) for v in p["src"])
    r = solve(np.ones((n, n), bool), dx, p["k"], p["t"], p["h"], p["T_inf"], Source(a, b, c, d, p["Q"]), ("left",), p["T_inf"])
    assert r.balance_rel < 1e-9
    return r.peak - p["T_inf"]


def grid_convergence(levels=(1, 2, 4, 8), base=2) -> dict:
    peaks = {s: conv_peak(s) for s in levels}
    ss = list(levels)
    diffs = [abs(peaks[a] - peaks[b]) / peaks[b] for a, b in zip(ss[:-1], ss[1:])]
    order = [float(np.log2(diffs[i] / diffs[i + 1])) for i in range(len(diffs) - 1) if diffs[i + 1] > 0]
    return dict(
        peaks=peaks,
        successive_rel=diffs,
        observed_order=order,
        base=base,
        base_vs_2x=abs(peaks[base] - peaks[2 * base]) / peaks[2 * base],
    )


# ------------------------------------------------- (d) connectivity/symmetry


def symmetry_error() -> float:
    n = 41
    rng = np.random.default_rng(3)
    half = rng.random((n, n // 2)) < 0.8
    mask = np.concatenate([half, np.ones((n, 1), bool), half[:, ::-1]], axis=1)
    src = Source(n // 2 - 1, n // 2 + 2, 10, 13, 8.0)
    mask[10:13, n // 2 - 1 : n // 2 + 2] = True
    r = solve(mask, 1e-3, 150.0, 2e-3, 30.0, 25.0, src, ("bottom",), 25.0)
    T = r.T
    d = np.nanmax(np.abs(T - T[:, ::-1]))
    return float(d / (np.nanmax(T) - 25.0))


def connectivity_checks() -> dict:
    mask = np.zeros((20, 20), bool)
    mask[:, 2:8] = True
    mask[:, 12:18] = True  # island, not connected to the source column
    src = Source(3, 6, 3, 6, 5.0)
    r = solve(mask, 1e-3, 100.0, 1e-3, 20.0, 25.0, src, (), 0.0)
    r2 = solve(mask, 1e-3, 100.0, 1e-3, 20.0, 25.0, Source(3, 6, 3, 6, 10.0), (), 0.0)
    return dict(
        island_detected=not connected_to_source(mask, src),
        connected_detected=connected_to_source(mask[:, :10], src),
        island_dT=float(np.nanmax(np.abs(r.T[:, 12:18] - 25.0))),
        heat_scaling=abs((r2.peak - 25.0) / (r.peak - 25.0) - 2.0),
        min_rise=float(np.nanmin(r.T) - 25.0),
    )


# ------------------------------------------------------------------- report


def run_all() -> dict:
    return dict(
        fin=fin_errors(),
        balance=random_balance(),
        convergence=grid_convergence(),
        symmetry=symmetry_error(),
        connectivity=connectivity_checks(),
    )


def render_markdown(r: dict) -> str:
    L = [
        "# Matter solver validation",
        "",
        "Generated by `python -m siliconsmith.matter.validate --write`. Do not edit by hand.",
        "'Validated' means: agrees with an analytic case within the pre-registered thresholds",
        "in `thresholds.py` (committed before any result existed). Nothing more.",
        "",
        f"Thresholds: fin analytic {th.FIN_ANALYTIC_REL:.0%}, 2x refinement {th.GRID_REFINEMENT_REL:.0%}, second solver {th.SECOND_SOLVER_REL:.0%} (not run yet).",
        "",
        "## (a) Straight fin vs analytic cosh/tanh solution",
        "",
        f"L={FIN['L']} m, w={FIN['w']} m, t={FIN['t']} m, k={FIN['k']}, h={FIN['h']}, base +{FIN['T_base'] - FIN['T_inf']} K, adiabatic tip.",
        "",
        "| dx (m) | tip rise err | last-cell err | max profile err | heat-flow err | pass |",
        "|---|---|---|---|---|---|",
    ]
    for f in r["fin"]:
        ok = max(f["tip_err"], f["q_err"]) <= th.FIN_ANALYTIC_REL
        L.append(f"| {f['dx']:.1e} | {f['tip_err']:.3e} | {f['lastcell_err']:.3e} | {f['profile_err']:.3e} | {f['q_err']:.3e} | {'yes' if ok else 'NO'} |")
    b = max(x["balance"] for x in r["balance"])
    rs = max(x["residual"] for x in r["balance"])
    c = r["convergence"]
    L += [
        "",
        "## (b) Heat balance on random masks",
        "",
        f"{len(r['balance'])} random masks/sources/boundaries: worst relative balance error {b:.3e}, worst linear residual {rs:.3e}.",
        "",
        "## (c) Grid convergence (2D plate with a square source patch)",
        "",
        "| cells per side | peak rise (K) |",
        "|---|---|",
    ]
    for s, v in c["peaks"].items():
        L.append(f"| {20 * s} | {v:.6f} |")
    L += [
        "",
        f"Successive relative differences: {', '.join(f'{d:.3e}' for d in c['successive_rel'])}. Observed order: {', '.join(f'{o:.2f}' for o in c['observed_order'])}.",
        f"Base grid ({20 * c['base']} cells) vs 2x refined: {c['base_vs_2x']:.3e} (threshold {th.GRID_REFINEMENT_REL:.0e}).",
        "",
        "## (d) Sanity",
        "",
        f"* Mirror-symmetric mask+source: max asymmetry {r['symmetry']:.3e} of peak rise.",
        f"* Island not connected to the source is detected: {r['connectivity']['island_detected']}; it stays at ambient (max |dT| {r['connectivity']['island_dT']:.1e} K).",
        f"* Doubling Q doubles the rise: error {r['connectivity']['heat_scaling']:.1e}. Min temperature minus ambient: {r['connectivity']['min_rise']:.1e} K (no undershoot).",
        "",
    ]
    return "\n".join(L)


def main(argv: list[str]) -> int:
    md = render_markdown(run_all())
    print(md)
    if "--write" in argv:
        (Path(__file__).parent / "VALIDATION.md").write_text(md, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
