"""Matter solver validation tests. Thresholds come from matter/thresholds.py (pre-registered)."""

import numpy as np
import pytest

pytest.importorskip("scipy")

from siliconsmith.matter import thresholds as th  # noqa: E402
from siliconsmith.matter import validate as v  # noqa: E402
from siliconsmith.matter.solver import Source, solve  # noqa: E402


def test_fin_vs_analytic():
    for f in v.fin_errors():
        print(f"\nFIN dx={f['dx']:.1e} tip_err={f['tip_err']:.3e} lastcell_err={f['lastcell_err']:.3e} "
              f"profile_err={f['profile_err']:.3e} q_err={f['q_err']:.3e} (q_ana={f['q_ana']:.5f} W, q_num={f['q_num']:.5f} W)")
        assert f["tip_err"] <= th.FIN_ANALYTIC_REL
        assert f["q_err"] <= th.FIN_ANALYTIC_REL
        assert f["profile_err"] <= th.FIN_ANALYTIC_REL


def test_heat_balance_random_masks():
    rows = v.random_balance()
    worst = max(r["balance"] for r in rows)
    print(f"\nBALANCE worst relative error over {len(rows)} random cases: {worst:.3e}")
    assert worst < 1e-9
    assert max(r["residual"] for r in rows) < 1e-9


def test_grid_convergence():
    c = v.grid_convergence()
    print(f"\nCONVERGENCE peaks={c['peaks']} successive={c['successive_rel']} order={c['observed_order']} "
          f"base_vs_2x={c['base_vs_2x']:.3e}")
    d = c["successive_rel"]
    assert all(d[i] > d[i + 1] for i in range(len(d) - 1)), "error must shrink with refinement"
    assert c["base_vs_2x"] <= th.GRID_REFINEMENT_REL


def test_symmetry_and_connectivity():
    s = v.symmetry_error()
    c = v.connectivity_checks()
    print(f"\nSANITY symmetry={s:.3e} {c}")
    assert s < 1e-9
    assert c["island_detected"] and c["connected_detected"]
    assert c["island_dT"] < 1e-9
    assert c["heat_scaling"] < 1e-9
    assert c["min_rise"] > -1e-9


def test_input_validation():
    m = np.ones((5, 5), bool)
    with pytest.raises(ValueError):
        solve(m, 1e-3, 100, 1e-3, 0.0, 25.0, Source(1, 2, 1, 2, 1.0))  # singular: no h, no fixed edge
    with pytest.raises(ValueError):
        solve(np.zeros((5, 5), bool), 1e-3, 100, 1e-3, 10.0, 25.0)
    m2 = m.copy()
    m2[1, 1] = False
    with pytest.raises(ValueError):
        solve(m2, 1e-3, 100, 1e-3, 10.0, 25.0, Source(1, 2, 1, 2, 1.0))
