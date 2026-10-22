"""Second solver, generator sandbox limits, ladder rungs, STL export."""

import sys

import numpy as np
import pytest

pytest.importorskip("scipy")

from siliconsmith.matter import export, generators, ladder, reference_generators as ref  # noqa: E402
from siliconsmith.matter import thresholds as th  # noqa: E402
from siliconsmith.matter import validate as v  # noqa: E402
from siliconsmith.matter.fem import solve_fem  # noqa: E402
from siliconsmith.matter.problem import (Spreader, check_printable, check_valid, force_chip,  # noqa: E402
                                         rect_fin_mask, solve_mask)

SP = Spreader()


def test_second_solver_matches_analytic_fin_and_primary():
    # fin of the validation suite as a plate with a source: FEM vs FV peak on the same 2D problem
    p = v.CONV
    n, dx = 40, 1e-3
    m = np.ones((n, n), bool)
    src = (16, 24, 16, 24)
    from siliconsmith.matter.solver import Source, solve
    fv = solve(m, dx, p["k"], p["t"], p["h"], p["T_inf"], Source(*src, p["Q"]))
    fe = solve_fem(m, dx, p["k"], p["t"], p["h"], p["T_inf"], src, p["Q"])
    err = abs(fe.peak - fv.peak) / (fv.peak - p["T_inf"])
    print(f"\nFEM vs FV plate peak: FV {fv.peak:.4f}, FEM {fe.peak:.4f}, rel err of rise {err:.3e}, cg iters {fe.cg_iters}")
    assert err <= th.SECOND_SOLVER_REL
    assert fe.balance_rel < 1e-8


def test_second_solver_uniform_plate_exact():
    # no gradients: uniform source over the whole plate, T - T_inf = q/(2h) exactly
    n, dx, h, k, t, Q = 10, 1e-3, 20.0, 100.0, 1e-3, 3.0
    fe = solve_fem(np.ones((n, n), bool), dx, k, t, h, 25.0, (0, n, 0, n), Q)
    expect = Q / (2 * h * (n * dx) ** 2)
    assert abs((fe.peak - 25.0) - expect) / expect < 1e-8


def test_screen_rejects_unsafe_code():
    for bad in ("import os\ndef generate(p,n,c): pass", "import socket\ndef generate(p,n,c): pass",
                "def generate(p,n,c):\n    return open('x')", "def generate(p,n,c):\n    return ().__class__",
                "import numpy as np\ndef generate(p,n,c):\n    return np.load('x')", "x = 1"):
        with pytest.raises(generators.GeneratorRejected):
            generators.screen_source(bad)


def test_generator_runs_and_limits_hold():
    ok = generators.run_generator(ref.RECT_FINS["source"], [{"spine": 8, "n_fins": 8, "fin_w": 3, "fin_len": 20}],
                                  SP.n, SP.chip_cells)
    assert ok[0].ok and ok[0].mask.shape == (SP.n, SP.n) and ok[0].mask.dtype == bool
    m = force_chip(ok[0].mask, SP)
    assert np.array_equal(m, force_chip(rect_fin_mask(SP, 8, 8, 3, 20), SP))

    loop = "def generate(params, n, chip):\n    while True:\n        pass\n"
    r = generators.run_generator(loop, [{}], SP.n, SP.chip_cells, timeout_s=20, per_call_s=1.0)
    assert not r[0].ok and "Timeout" in r[0].error

    wrong = "import numpy as np\ndef generate(params, n, chip):\n    return np.ones((3, 3))\n"
    assert not generators.run_generator(wrong, [{}], SP.n, SP.chip_cells)[0].ok

    boom = "def generate(params, n, chip):\n    raise ValueError('bad')\n"
    assert "bad" in generators.run_generator(boom, [{}], SP.n, SP.chip_cells)[0].error

    rejected = generators.run_generator(ref.BROKEN_NET["source"], [{}], SP.n, SP.chip_cells)
    assert not rejected[0].ok and "rejected" in rejected[0].error

    if sys.platform != "win32":
        hog = "import numpy as np\ndef generate(params, n, chip):\n    a = np.ones(4 * 10**9)\n    return a > 0\n"
        r = generators.run_generator(hog, [{}], SP.n, SP.chip_cells, mem_mb=512)
        assert not r[0].ok, "memory cap must stop a 32 GB allocation"


def test_ladder_rungs():
    assert ladder.m1_solver_validated().status == "pass"
    m = rect_fin_mask(SP, 8, 8, 3, 20)
    assert ladder.m2_valid(m, SP).status == "pass"
    assert ladder.m3_printable(m, SP).status == "pass"
    r4 = ladder.m4_second_solver(m, SP)
    print("\nM4:", r4.detail)
    assert r4.status == "pass"
    # M2 failures: over budget, island, wrong type
    assert ladder.m2_valid(np.ones((SP.n, SP.n), bool), SP).status == "fail"
    isl = rect_fin_mask(SP, 8, 4, 3, 10)
    isl[0:3, 0:3] = True
    ok, why = check_valid(isl, SP)
    assert not ok and "islands" in why
    # M3 failures: thin feature, enclosed void
    thin = rect_fin_mask(SP, 8, 4, 3, 10)
    thin[3, 3:20] = True  # 1-cell-wide bridge
    assert not check_printable(thin, SP)[0]
    hole = rect_fin_mask(SP, 12, 4, 3, 10)
    hole[27:29, 5:7] = False  # 2x2 void fully inside the spine... touching nothing of the border
    hole = force_chip(hole, SP)
    ok, why = check_printable(hole, SP)
    assert not ok and "enclosed" in why
    # M5: a plain fin plate cannot beat its own equal-material baseline
    assert ladder.m5_baseline(m, SP).status == "fail"
    assert ladder.m5_baseline(np.zeros((SP.n, SP.n), bool), SP).status == "fail"


def test_stl_is_closed_and_volume_matches():
    m = rect_fin_mask(SP, 8, 6, 3, 15)
    data = export.mask_to_stl(m, SP)
    st = export.stl_stats(data)
    expect = float(m.sum()) * (SP.dx * 1e3) ** 2 * SP.t * 1e3
    print(f"\nSTL {st}, expected volume {expect:.1f} mm3")
    assert st["unmatched_edges"] == 0
    assert abs(st["volume_mm3"] - expect) / expect < 1e-6
