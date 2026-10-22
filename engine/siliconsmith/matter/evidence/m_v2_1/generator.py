import numpy as np
import math

def generate(params, n, chip):
    hub_size_i = max(2, min(int(round(float(params['hub_size']))), n))
    n_fins_per_quad_i = max(1, min(int(round(float(params['n_fins_per_quad']))), 8))
    fin_len_i = max(0, min(int(round(float(params['fin_len']))), n))
    base_w_i = max(2, min(int(round(float(params['base_w']))), n))
    tip_w_i = max(2, min(int(round(float(params['tip_w']))), n))
    curvature_val = float(params['curvature'])
    density_bias_val = float(params['density_bias'])

    grid = np.zeros((n, n), dtype=bool)
    i0, i1, j0, j1 = chip
    ci = (i0 + i1) // 2
    cj = (j0 + j1) // 2

    hs = hub_size_i
    hsi = hs // 2
    ci0 = ci - hsi
    ci1 = ci + hsi + (hs % 2)
    cj0 = cj - hsi
    cj1 = cj + hsi + (hs % 2)
    ci0 = max(0, ci0)
    ci1 = min(n, ci1)
    cj0 = max(0, cj0)
    cj1 = min(n, cj1)
    grid[ci0:ci1, cj0:cj1] = True

    def add_fin_set(di, dj):
        if n_fins_per_quad_i == 0 or fin_len_i <= 0:
            return
        total_gap = 2 * (n_fins_per_quad_i - 1)
        available = hub_size_i - total_gap
        if available < 2 * n_fins_per_quad_i:
            w = 2
        else:
            w = available // n_fins_per_quad_i
        w = max(2, w)
        start_offset = -(hub_size_i // 2) + (w // 2)
        for k in range(n_fins_per_quad_i):
            offset = start_offset + k * (w + 2)
            if di != 0:
                fixed_j = cj + offset
                bias_factor = 1.0 + (density_bias_val / 100.0) * (1.0 - abs(offset) / (hub_size_i / 2)) if hub_size_i > 0 else 1.0
                effective_n_fins = max(1, int(round(n_fins_per_quad_i * bias_factor)))
                if k >= effective_n_fins:
                    continue
                for s in range(fin_len_i):
                    t = s / (fin_len_i - 1) if fin_len_i > 1 else 0.5
                    width = base_w_i + (tip_w_i - base_w_i) * t
                    wi = max(2, int(round(width)))
                    half_w = wi // 2
                    i = ci + di * (s + 1)
                    if 0 <= i < n:
                        j_start = fixed_j - half_w
                        j_end = fixed_j + half_w + (wi % 2)
                        j_start = max(0, j_start)
                        j_end = min(n, j_end)
                        if j_start < j_end:
                            grid[i, j_start:j_end] = True
                            if curvature_val > 0:
                                curve_offset = int(round(curvature_val * t * (1 - t) * 4))
                                j_start_curve = max(0, j_start - curve_offset)
                                j_end_curve = min(n, j_end + curve_offset)
                                if j_start_curve < j_end_curve:
                                    grid[i, j_start_curve:j_end_curve] = True
            else:
                fixed_i = ci + offset
                bias_factor = 1.0 + (density_bias_val / 100.0) * (1.0 - abs(offset) / (hub_size_i / 2)) if hub_size_i > 0 else 1.0
                effective_n_fins = max(1, int(round(n_fins_per_quad_i * bias_factor)))
                if k >= effective_n_fins:
                    continue
                for s in range(fin_len_i):
                    t = s / (fin_len_i - 1) if fin_len_i > 1 else 0.5
                    width = base_w_i + (tip_w_i - base_w_i) * t
                    wi = max(2, int(round(width)))
                    half_w = wi // 2
                    j = cj + dj * (s + 1)
                    if 0 <= j < n:
                        i_start = fixed_i - half_w
                        i_end = fixed_i + half_w + (wi % 2)
                        i_start = max(0, i_start)
                        i_end = min(n, i_end)
                        if i_start < i_end:
                            grid[i_start:i_end, j] = True
                            if curvature_val > 0:
                                curve_offset = int(round(curvature_val * t * (1 - t) * 4))
                                i_start_curve = max(0, i_start - curve_offset)
                                i_end_curve = min(n, i_end + curve_offset)
                                if i_start_curve < i_end_curve:
                                    grid[i_start_curve:i_end_curve, j] = True

    add_fin_set(-1, 0)
    add_fin_set(1, 0)
    add_fin_set(0, -1)
    add_fin_set(0, 1)

    return grid
