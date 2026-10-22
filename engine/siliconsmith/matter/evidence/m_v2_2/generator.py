import numpy as np
import math

def generate(params, n, chip):
    i0, i1, j0, j1 = map(int, chip)
    scw = max(2, int(params['spine_center_width']))
    sew = max(2, int(params['spine_end_width']))
    shl = int(params['spine_half_length'])
    fbw = max(2, int(params['fin_base_width']))
    ftw = max(2, int(params['fin_tip_width']))
    fl = int(params['fin_length'])
    nfa = int(params['n_fins_per_arm'])
    fs = max(2, int(params['fin_spacing']))

    grid = np.zeros((n, n), dtype=bool)
    chip_w = i1 - i0 + 1
    chip_h = j1 - j0 + 1
    grid[i0:i1+1, j0:j1+1] = True

    cx = (i0 + i1) // 2
    cy = (j0 + j1) // 2

    half_scw = scw // 2
    half_sew = sew // 2

    # Horizontal spine (y constant = cy)
    y_sp = cy
    y_start_sp = y_sp - half_scw
    y_end_sp = y_sp + half_scw - 1
    if 0 <= y_start_sp < n and 0 <= y_end_sp < n:
        # Left segment
        xl = cx - shl
        xr = cx - 1
        if xl < 0: xl = 0
        if xr >= xl and 0 <= xr < n:
            grid[xl:xr+1, y_start_sp:y_end_sp+1] = True
        # Right segment
        xl = cx + 1
        xr = cx + shl
        if xr >= n: xr = n - 1
        if xl <= xr and 0 <= xl < n:
            grid[xl:xr+1, y_start_sp:y_end_sp+1] = True
        # Center overlap already covered by chip

    # Vertical spine (x constant = cx)
    x_sp = cx
    x_start_sp = x_sp - half_scw
    x_end_sp = x_sp + half_scw - 1
    if 0 <= x_start_sp < n and 0 <= x_end_sp < n:
        # Down segment
        yl = cy + 1
        yr = cy + shl
        if yr >= n: yr = n - 1
        if yl <= yr and 0 <= yl < n:
            grid[x_start_sp:x_end_sp+1, yl:yr+1] = True
        # Up segment
        yl = cy - shl
        yr = cy - 1
        if yl < 0: yl = 0
        if yl <= yr and 0 <= yr < n:
            grid[x_start_sp:x_end_sp+1, yl:yr+1] = True

    # Tapered spine ends: left, right, up, down
    # Left end
    yc_left = cy
    y_start_le = yc_left - half_sew
    y_end_le = yc_left + half_sew - 1
    if 0 <= y_start_le < n and 0 <= y_end_le < n:
        xl = i0 - 1
        xr = xl + shl - 1
        if xl < 0: xl = 0
        if xr >= xl and 0 <= xr < n:
            grid[xl:xr+1, y_start_le:y_end_le+1] = True
    # Right end
    yc_right = cy
    y_start_re = yc_right - half_sew
    y_end_re = yc_right + half_sew - 1
    if 0 <= y_start_re < n and 0 <= y_end_re < n:
        xl = i1 + 1
        xr = xl + shl - 1
        if xr >= n: xr = n - 1
        if xl <= xr and 0 <= xl < n:
            grid[xl:xr+1, y_start_re:y_end_re+1] = True
    # Up end
    xc_up = cx
    x_start_ue = xc_up - half_sew
    x_end_ue = xc_up + half_sew - 1
    if 0 <= x_start_ue < n and 0 <= x_end_ue < n:
        yl = j0 - 1
        yr = yl + shl - 1
        if yl < 0: yl = 0
        if yr >= yl and 0 <= yr < n:
            grid[x_start_ue:x_end_ue+1, yl:yr+1] = True
    # Down end
    xc_down = cx
    x_start_de = xc_down - half_sew
    x_end_de = xc_down + half_sew - 1
    if 0 <= x_start_de < n and 0 <= x_end_de < n:
        yl = j1 + 1
        yr = yl + shl - 1
        if yr >= n: yr = n - 1
        if yl <= yr and 0 <= yl < n:
            grid[x_start_de:x_end_de+1, yl:yr+1] = True

    # Fins on each arm
    directions = [(-1, 0), (1, 0), (0, -1), (0, 1)]  # left, right, up, down
    for dx, dy in directions:
        if dx != 0:  # horizontal arm (left/right)
            if dx == -1:  # left
                base_i = i0 - 1
                base_j0 = j0
                base_j1 = j1
                spine_edge_i = i0
            else:  # right
                base_i = i1 + 1
                base_j0 = j0
                base_j1 = j1
                spine_edge_i = i1
            available_j = base_j1 - base_j0 + 1
            if available_j < 2:
                continue
            max_fins_by_space = (available_j + fs) // (fbw + fs)
            actual_n_fins = min(nfa, max_fins_by_space)
            if actual_n_fins < 1:
                continue
            total_fin_width = actual_n_fins * fbw
            total_space_width = (actual_n_fins - 1) * fs
            used_width = total_fin_width + total_space_width
            start_j = base_j0 + (available_j - used_width) // 2
            for k in range(actual_n_fins):
                fj0 = start_j + k * (fbw + fs)
                fj1 = fj0 + fbw - 1
                if fj0 < 0 or fj1 >= n:
                    continue
                length = fl
                if length < 1:
                    continue
                for step in range(length):
                    t = step / (length - 1) if length > 1 else 0
                    width = fbw - t * (fbw - ftw)
                    width = max(2, int(round(width)))
                    if width % 2 == 1:
                        width += 1
                    half_w = width // 2
                    fjc = (fj0 + fj1) // 2
                    fj_start = fjc - half_w
                    fj_end = fj_start + width - 1
                    if fj_start < 0 or fj_end >= n:
                        continue
                    if dx == -1:  # left
                        fi = base_i - (step + 1)
                    else:  # right
                        fi = base_i + (step + 1)
                    if 0 <= fi < n:
                        grid[fi, fj_start:fj_end+1] = True
        else:  # vertical arm (up/down)
            if dy == -1:  # up
                base_j = j0 - 1
                base_i0 = i0
                base_i1 = i1
                spine_edge_j = j0
            else:  # down
                base_j = j1 + 1
                base_i0 = i0
                base_i1 = i1
                spine_edge_j = j1
            available_i = base_i1 - base_i0 + 1
            if available_i < 2:
                continue
            max_fins_by_space = (available_i + fs) // (fbw + fs)
            actual_n_fins = min(nfa, max_fins_by_space)
            if actual_n_fins < 1:
                continue
            total_fin_width = actual_n_fins * fbw
            total_space_width = (actual_n_fins - 1) * fs
            used_width = total_fin_width + total_space_width
            start_i = base_i0 + (available_i - used_width) // 2
            for k in range(actual_n_fins):
                fi0 = start_i + k * (fbw + fs)
                fi1 = fi0 + fbw - 1
                if fi0 < 0 or fi1 >= n:
                    continue
                length = fl
                if length < 1:
                    continue
                for step in range(length):
                    t = step / (length - 1) if length > 1 else 0
                    width = fbw - t * (fbw - ftw)
                    width = max(2, int(round(width)))
                    if width % 2 == 1:
                        width += 1
                    half_w = width // 2
                    fic = (fi0 + fi1) // 2
                    fi_start = fic - half_w
                    fi_end = fi_start + width - 1
                    if fi_start < 0 or fi_end >= n:
                        continue
                    if dy == -1:  # up
                        fj = base_j - (step + 1)
                    else:  # down
                        fj = base_j + (step + 1)
                    if 0 <= fj < n:
                        grid[fi_start:fi_end+1, fj] = True

    return grid
