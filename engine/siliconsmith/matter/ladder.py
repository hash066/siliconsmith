"""Verification ladder M1..M5 for Matter (labels exactly as in docs/WORKSTATION_PLAN.md section 7).

Each rung is a deterministic check returning a RungResult. A label is shown only on pass.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import thresholds as th
from . import validate
from .fem import solve_fem
from .problem import Spreader, baseline, check_printable, check_valid, force_chip, solve_mask

RUNGS = [
    ("M1", "Solver validated against analytic cases", "validation suite (fin analytic, balance, convergence)"),
    ("M2", "Geometry valid and within budget", "mask checks"),
    ("M3", "Printable (feature-size rule)", "morphology + topology"),
    ("M4", "Second solver agrees within 3%", "FEM Q1 + 2x refinement"),
    ("M5", "Beats baseline", "equal-material rectangular fins"),
]
LADDER_EVENT = [{"id": i, "label": label, "tool": tool} for i, label, tool in RUNGS]


@dataclass
class RungResult:
    status: str  # pass | fail | skipped
    detail: str
    data: dict = field(default_factory=dict)


def m1_solver_validated() -> RungResult:
    """Run the pre-registered validation suite against the thresholds."""
    fin = validate.fin_errors()
    worst_fin = max(max(f["tip_err"], f["q_err"], f["profile_err"]) for f in fin)
    bal = max(r["balance"] for r in validate.random_balance())
    conv = validate.grid_convergence()
    ok = (worst_fin <= th.FIN_ANALYTIC_REL and bal < 1e-9 and conv["base_vs_2x"] <= th.GRID_REFINEMENT_REL
          and all(a > b for a, b in zip(conv["successive_rel"], conv["successive_rel"][1:])))
    detail = (f"fin worst error {worst_fin:.2e} (<= {th.FIN_ANALYTIC_REL:.0%}), heat balance {bal:.1e}, "
              f"2x refinement {conv['base_vs_2x']:.2e} (<= {th.GRID_REFINEMENT_REL:.0%})")
    return RungResult("pass" if ok else "fail", detail,
                      dict(fin_worst=worst_fin, balance_worst=bal, refine_2x=conv["base_vs_2x"]))


def m2_valid(mask, sp: Spreader) -> RungResult:
    ok, msg = check_valid(mask, sp)
    return RungResult("pass" if ok else "fail", msg)


def m3_printable(mask, sp: Spreader) -> RungResult:
    ok, msg = check_printable(mask, sp)
    return RungResult("pass" if ok else "fail", msg)


def m4_second_solver(mask, sp: Spreader) -> RungResult:
    """Winner re-solved by the independent FEM solver and at 2x resolution, on the peak temperature rise."""
    m = force_chip(mask, sp)
    fv1 = solve_mask(m, sp)
    fv2 = solve_mask(m, sp, refine=2)
    fe = solve_fem(m, sp.dx, sp.k, sp.t, sp.h, sp.T_inf, sp.chip_cells, sp.Q)
    r1, r2, rf = fv1.peak - sp.T_inf, fv2.peak - sp.T_inf, fe.peak - sp.T_inf
    e_ref = abs(r2 - r1) / r2
    e_fem = abs(rf - r1) / r1
    ok = e_ref <= th.GRID_REFINEMENT_REL and e_fem <= th.SECOND_SOLVER_REL
    detail = (f"FV {r1:.3f} K, FV 2x {r2:.3f} K ({e_ref:.2%}, limit {th.GRID_REFINEMENT_REL:.0%}), "
              f"FEM {rf:.3f} K ({e_fem:.2%}, limit {th.SECOND_SOLVER_REL:.0%})")
    return RungResult("pass" if ok else "fail", detail,
                      dict(fv_rise=r1, fv2x_rise=r2, fem_rise=rf, refine_err=e_ref, fem_err=e_fem,
                           balance=max(fv1.balance_rel, fv2.balance_rel, fe.balance_rel)))


def m5_baseline(mask, sp: Spreader) -> RungResult:
    """Beats the best plain rectangular-fin plate that uses no more material than the candidate."""
    m = force_chip(mask, sp)
    cells = int(m.sum())
    peak = solve_mask(m, sp).peak
    bpeak, bparams = baseline(sp, cells)
    delta = bpeak - peak
    detail = (f"candidate peak {peak:.2f} C vs baseline {bpeak:.2f} C using <= {cells} cells "
              f"({bparams['n_fins']} fins {bparams['fin_w']}x{bparams['fin_len']}): "
              + (f"beats baseline by {delta:.2f} K" if delta > 0 else f"does not beat baseline ({delta:.2f} K)"))
    return RungResult("pass" if delta > 0 else "fail", detail,
                      dict(peak=peak, baseline_peak=bpeak, delta_k=delta, baseline=bparams))


def verdict(peak: float, equal_material_peak: float | None, full_budget_peak: float) -> dict:
    """Honest one-line result, with BOTH baselines. Margins are model outputs under stated assumptions."""
    d_eq = None if equal_material_peak is None else equal_material_peak - peak
    d_full = full_budget_peak - peak
    if d_full > 0:
        label = f"Beats the full-budget rectangular-fin baseline by {d_full:.2f} K (model estimate)"
    elif d_eq is not None and d_eq > 0:
        label = (f"Beats the equal-material rectangular-fin baseline by {d_eq:.2f} K; does NOT beat the full-budget "
                 f"baseline ({-d_full:.2f} K hotter)")
    else:
        label = "Does not beat a rectangular-fin baseline"
    return dict(label=label, delta_equal_material_k=d_eq, delta_full_budget_k=d_full,
                beats_equal_material=bool(d_eq is not None and d_eq > 0), beats_full_budget=bool(d_full > 0),
                note="2D steady-state model, stated h and k, no airflow CFD, not validated on a printed part.")
