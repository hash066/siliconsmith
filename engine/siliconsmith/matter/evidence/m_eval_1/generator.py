import numpy as np
import math

def generate(params, n, chip):
    cross_w = max(2, int(round(params['cross_w'])))
    arm_len = int(round(params['arm_len']))
    fin_w = max(2, int(round(params['fin_w'])))
    fin_len = int(round(params['fin_len']))
    n_fins = int(round(params['n_fins']))
    fin_gap = int(round(params['fin_gap']))
    
    grid = np.zeros((n, n), dtype=bool)
    i0, i1, j0, j1 = chip
    ci = (i0 + i1) // 2
    cj = (j0 + j1) // 2
    
    # Horizontal arm: centered on chip's row span, extend left/right
    h_row_start = (i0 + i1 - cross_w) // 2
    h_row_end = h_row_start + cross_w
    h_col_start = max(0, ci - arm_len)
    h_col_end = min(n, ci + arm_len + 1)
    grid[h_row_start:h_row_end, h_col_start:h_col_end] = True
    
    # Vertical arm: centered on chip's col span, extend up/down
    v_col_start = (j0 + j1 - cross_w) // 2
    v_col_end = v_col_start + cross_w
    v_row_start = max(0, cj - arm_len)
    v_row_end = min(n, cj + arm_len + 1)
    grid[v_row_start:v_row_end, v_col_start:v_col_end] = True
    
    # Function to add symmetric fins on a given spine
    def add_fins(spine_mask, is_horizontal):
        nonlocal grid
        if is_horizontal:
            # For horizontal spine, iterate over its columns
            cols = np.where(np.any(spine_mask, axis=0))[0]
            if len(cols) == 0:
                return
            min_col, max_col = cols[0], cols[-1]
            available_length = max_col - min_col + 1
            total_gaps = n_fins - 1
            if total_gaps < 0:
                total_gaps = 0
            gap_space = fin_gap * total_gaps
            usable_length = available_length - gap_space
            if usable_length <= 0:
                fin_len_actual = 0
            else:
                fin_len_actual = min(fin_len, usable_length // max(1, n_fins))
            if fin_len_actual < 1:
                return
            start_pos = min_col + (available_length - (n_fins * fin_len_actual + total_gaps * fin_gap)) // 2
            for k in range(n_fins):
                fin_start = start_pos + k * (fin_len_actual + fin_gap)
                fin_end = fin_start + fin_len_actual
                if fin_end > n:
                    break
                if is_horizontal:
                    # Vertical fin: extend in y-direction (rows)
                    fin_row_start = max(0, h_row_start - fin_w)
                    fin_row_end = min(n, h_row_end + fin_w)
                    grid[fin_row_start:fin_row_end, fin_start:fin_end] = True
                else:
                    # Horizontal fin: extend in x-direction (cols)
                    fin_col_start = max(0, v_col_start - fin_w)
                    fin_col_end = min(n, v_col_end + fin_w)
                    grid[fin_start:fin_end, fin_col_start:fin_col_end] = True
        else:
            # For vertical spine, iterate over its rows
            rows = np.where(np.any(spine_mask, axis=1))[0]
            if len(rows) == 0:
                return
            min_row, max_row = rows[0], rows[-1]
            available_length = max_row - min_row + 1
            total_gaps = n_fins - 1
            if total_gaps < 0:
                total_gaps = 0
            gap_space = fin_gap * total_gaps
            usable_length = available_length - gap_space
            if usable_length <= 0:
                fin_len_actual = 0
            else:
                fin_len_actual = min(fin_len, usable_length // max(1, n_fins))
            if fin_len_actual < 1:
                return
            start_pos = min_row + (available_length - (n_fins * fin_len_actual + total_gaps * fin_gap)) // 2
            for k in range(n_fins):
                fin_start = start_pos + k * (fin_len_actual + fin_gap)
                fin_end = fin_start + fin_len_actual
                if fin_end > n:
                    break
                if not is_horizontal:
                    # Horizontal fin: extend in x-direction (cols)
                    fin_col_start = max(0, v_col_start - fin_w)
                    fin_col_end = min(n, v_col_end + fin_w)
                    grid[fin_start:fin_end, fin_col_start:fin_col_end] = True
                else:
                    # Vertical fin: extend in y-direction (rows)
                    fin_row_start = max(0, h_row_start - fin_w)
                    fin_row_end = min(n, h_row_end + fin_w)
                    grid[fin_row_start:fin_row_end, fin_start:fin_end] = True
    
    # Add fins to horizontal arm
    h_spine = grid[h_row_start:h_row_end, h_col_start:h_col_end].copy()
    add_fins(h_spine, is_horizontal=True)
    
    # Add fins to vertical arm
    v_spine = grid[v_row_start:v_row_end, v_col_start:v_col_end].copy()
    add_fins(v_spine, is_horizontal=False)
    
    # Ensure chip region is material
    grid[i0:i1+1, j0:j1+1] = True
    
    # Enforce connectivity: grow from chip using 4-connectivity
    visited = np.zeros_like(grid, dtype=bool)
    stack = []
    # Start from chip center
    si, sj = (i0 + i1) // 2, (j0 + j1) // 2
    if 0 <= si < n and 0 <= sj < n:
        stack.append((si, sj))
        visited[si, sj] = True
    
    while stack:
        i, j = stack.pop()
        for di, dj in [(1,0), (-1,0), (0,1), (0,-1)]:
            ni, nj = i + di, j + dj
            if 0 <= ni < n and 0 <= nj < n and not visited[ni, nj] and grid[ni, nj]:
                visited[ni, nj] = True
                stack.append((ni, nj))
    
    # Only keep material that is connected to chip
    grid &= visited
    
    # Enforce minimum 2-cell width by dilation then erosion (to remove thin features)
    # But since we construct with min width 2, this may not be needed, but safe
    # However, to avoid breaking connectivity, we skip aggressive ops and rely on construction
    # Instead, we ensure during construction that all added parts are at least 2 cells wide
    # which we did by setting cross_w, fin_w >=2 and using slices
    
    # Final safety: ensure chip is still there (should be, as we set it and it's connected)
    return grid
