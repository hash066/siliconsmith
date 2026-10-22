"""The heat-spreader problem, its geometry rules (M2, M3) and the rectangular-fin baseline (M5)."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from functools import lru_cache

import numpy as np
from scipy.ndimage import binary_erosion, binary_dilation, label

from .solver import Result, Source, connected_to_source, solve


@dataclass(frozen=True)
class Spreader:
    """Stated inputs of the template. All of these are assumptions, not measurements."""

    n: int = 60  # grid cells per side
    dx: float = 1e-3  # m (so the plate is 60 x 60 mm)
    t: float = 2e-3  # m plate thickness
    k: float = 200.0  # W/(m K), aluminium alloy (stated, not measured)
    h: float = 15.0  # W/(m^2 K) both faces, stated (natural convection + radiation, lumped)
    T_inf: float = 25.0  # degC
    Q: float = 2.0  # W chip power
    chip: int = 6  # chip footprint, cells per side (centred)
    budget_fraction: float = 0.40  # max fraction of the plate area that may be material
    min_feature: int = 2  # printability rule, cells (2 mm)

    @property
    def chip_cells(self) -> tuple[int, int, int, int]:
        a = (self.n - self.chip) // 2
        return (a, a + self.chip, a, a + self.chip)  # i0, i1, j0, j1

    @property
    def source(self) -> Source:
        i0, i1, j0, j1 = self.chip_cells
        return Source(i0, i1, j0, j1, self.Q)

    @property
    def budget_cells(self) -> int:
        return int(self.budget_fraction * self.n * self.n)

    def as_dict(self) -> dict:
        return asdict(self)


def force_chip(mask: np.ndarray, sp: Spreader) -> np.ndarray:
    """The chip footprint is always material (it is part of the plate)."""
    m = np.array(mask, dtype=bool, copy=True)
    i0, i1, j0, j1 = sp.chip_cells
    m[j0:j1, i0:i1] = True
    return m


def solve_mask(mask: np.ndarray, sp: Spreader, refine: int = 1) -> Result:
    """Primary (finite-volume) solve; `refine` upsamples the SAME geometry by nearest neighbour."""
    m = np.asarray(mask, dtype=bool)
    src = sp.source
    if refine > 1:
        m = np.kron(m, np.ones((refine, refine), bool))
        src = Source(src.i0 * refine, src.i1 * refine, src.j0 * refine, src.j1 * refine, src.Q)
    return solve(m, sp.dx / refine, sp.k, sp.t, sp.h, sp.T_inf, src)


# ------------------------------------------------------------------ M2 / M3


def check_valid(mask, sp: Spreader) -> tuple[bool, str]:
    """M2: right shape and dtype, material within budget, all of it connected to the source."""
    if not isinstance(mask, np.ndarray) or mask.dtype != bool:
        return False, "generator must return a boolean numpy array"
    if mask.shape != (sp.n, sp.n):
        return False, f"mask shape {mask.shape} != {(sp.n, sp.n)}"
    m = force_chip(mask, sp)
    cells = int(m.sum())
    if cells > sp.budget_cells:
        return False, f"material {cells} cells ({cells / sp.n**2:.1%}) exceeds budget {sp.budget_cells} cells ({sp.budget_fraction:.0%})"
    if not connected_to_source(m, sp.source):
        return False, "material is not all connected to the chip (islands present)"
    return True, f"{cells} cells ({cells / sp.n**2:.1%} of plate), connected, within {sp.budget_fraction:.0%} budget"


def _opened(m: np.ndarray, k: int) -> np.ndarray:
    """Morphological opening with a k x k square: every cell covered by some k x k block of material."""
    se = np.ones((k, k), bool)
    return binary_dilation(binary_erosion(m, se, border_value=0), se)


def check_printable(mask: np.ndarray, sp: Spreader) -> tuple[bool, str]:
    """M3: minimum feature size, no isolated islands, no enclosed voids."""
    m = force_chip(mask, sp)
    k = sp.min_feature
    lost = int((m & ~_opened(m, k)).sum())
    if lost:
        return False, f"{lost} cells belong to features thinner than {k} cells ({k * sp.dx * 1e3:.0f} mm)"
    _, ncomp = label(m)
    if ncomp != 1:
        return False, f"{ncomp} separate material pieces (isolated islands)"
    void_lab, nvoid = label(~m)
    border = set(np.unique(np.concatenate([void_lab[0], void_lab[-1], void_lab[:, 0], void_lab[:, -1]])))
    enclosed = [i for i in range(1, nvoid + 1) if i not in border]
    if enclosed:
        return False, f"{len(enclosed)} enclosed void(s) (trapped, not printable)"
    return True, f"min feature {k} cells ({k * sp.dx * 1e3:.0f} mm), one piece, no enclosed voids"


# ------------------------------------------------------------------ baseline


def rect_fin_mask(sp: Spreader, spine: int, n_fins: int, fin_w: int, fin_len: int, spine_len: int | None = None) -> np.ndarray:
    """Horizontal spine through the chip (width `spine`, length `spine_len`, default full plate), n_fins plain
    rectangular fins up and down, evenly spread along the spine."""
    n = sp.n
    L = n if spine_len is None else min(spine_len, n)
    x0 = (n - L) // 2
    m = np.zeros((n, n), bool)
    c0 = (n - spine) // 2
    m[c0 : c0 + spine, x0 : x0 + L] = True
    if n_fins > 0 and fin_len > 0 and L >= fin_w:
        pos = x0 + np.linspace(0, L - fin_w, n_fins).round().astype(int)
        for p in pos:
            m[max(c0 - fin_len, 0) : c0, p : p + fin_w] = True
            m[c0 + spine : min(c0 + spine + fin_len, n), p : p + fin_w] = True
    return force_chip(m, sp)


@lru_cache(maxsize=256)
def _baseline_cached(sp: Spreader, cells: int) -> tuple[float, dict]:
    best: tuple[float, dict] | None = None
    for spine_len in (sp.n, 44, 32, 22, 14):
        for spine in (6, 8):
            for fin_w in (2, 3, 4):
                for n_fins in range(2, 16):
                    if n_fins * fin_w > spine_len + fin_w:
                        continue
                    free = cells - spine * spine_len
                    if free < 0:
                        continue
                    max_len = (sp.n - spine) // 2
                    length = min(free // (2 * n_fins * fin_w), max_len)
                    if length < 1:
                        continue
                    m = rect_fin_mask(sp, spine, n_fins, fin_w, length, spine_len)
                    if int(m.sum()) > cells or not check_valid(m, sp)[0] or not check_printable(m, sp)[0]:
                        continue
                    peak = solve_mask(m, sp).peak
                    if best is None or peak < best[0]:
                        best = (peak, dict(spine=spine, spine_len=spine_len, n_fins=n_fins, fin_w=fin_w,
                                           fin_len=int(length), cells=int(m.sum())))
    if best is None:
        # not even a short spine fits in this much material: baseline is the chip pad alone
        m = force_chip(np.zeros((sp.n, sp.n), bool), sp)
        best = (solve_mask(m, sp).peak, dict(spine=0, spine_len=0, n_fins=0, fin_w=0, fin_len=0, cells=int(m.sum())))
    return best


def isothermal_bound(sp: Spreader, cells: int) -> float:
    """Lower bound on the peak temperature (degC) for `cells` of material: if every cell sat at one temperature
    the plate would lose 2 h A dT = Q. Real plates are hotter (heat must be conducted), so no geometry can beat it."""
    return sp.T_inf + sp.Q / (2.0 * sp.h * cells * sp.dx * sp.dx)


def baseline(sp: Spreader, cells: int) -> tuple[float, dict]:
    """Best plain-rectangular-fin plate using no more than `cells` material cells (a swept baseline,
    not a single hand-picked one). Returns (peak temperature in degC, parameters)."""
    return _baseline_cached(sp, int(cells))
