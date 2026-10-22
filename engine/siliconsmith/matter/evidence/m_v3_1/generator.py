import numpy as np
import math

def generate(params, n, chip):
    i0, i1, j0, j1 = chip
    cx = (i0 + i1 - 1) / 2.0
    cy = (j0 + j1 - 1) / 2.0
    g = np.zeros((n, n), dtype=bool)

    core_r = float(params['core_r'])
    n_turns = float(params['n_turns'])
    start_w = float(params['start_w'])
    end_w = float(params['end_w'])
    bridge_spacing = float(params['bridge_spacing'])
    bridge_w = float(params['bridge_w'])
    arm_spacing = float(params['arm_spacing'])
    max_r = float(params['max_r'])

    # Chip region: always material
    for i in range(i0, i1 + 1):
        for j in range(j0, j1 + 1):
            if 0 <= i < n and 0 <= j < n:
                g[i, j] = True

    # Helper: check if point is inside any existing material (for overlap avoidance)
    def can_place(x, y, w):
        r = math.ceil(w / 2)
        for di in range(-r, r + 1):
            for dj in range(-r, r + 1):
                ci = int(round(x + di))
                cj = int(round(y + dj))
                if 0 <= ci < n and 0 <= cj < n and g[ci, cj]:
                    return True
        return False

    # Generate Archimedean spiral points
    spiral_points = []
    total_angle = n_turns * 2 * math.pi
    steps = 200  # sufficient resolution
    for s in range(steps + 1):
        t = s / steps
        r = (max_r - core_r) * t + core_r
        theta = t * total_angle
        x = cx + r * math.cos(theta)
        y = cy + r * math.sin(theta)
        spiral_points.append((x, y, r))

    # Materialize spiral with linearly varying width
    for idx, (x, y, r) in enumerate(spiral_points):
        t = idx / len(spiral_points) if len(spiral_points) > 0 else 0
        w = start_w + (end_w - start_w) * t
        r_width = math.ceil(w / 2)
        for dx in range(-r_width, r_width + 1):
            for dy in range(-r_width, r_width + 1):
                ix = int(round(x + dx))
                iy = int(round(y + dy))
                if 0 <= ix < n and 0 <= iy < n:
                    g[ix, iy] = True

    # Add radial bridges from spiral to chip at regular angular intervals
    num_bridges = max(1, int(2 * math.pi * max_r / bridge_spacing))
    for b in range(num_bridges):
        angle = b * 2 * math.pi / num_bridges
        dx = math.cos(angle)
        dy = math.sin(angle)
        # Start from chip center
        start_x, start_y = cx, cy
        end_x = cx + dx * max_r
        end_y = cy + dy * max_r
        steps_bridge = int(max_r) + 1
        for s in range(steps_bridge + 1):
            t = s / steps_bridge if steps_bridge > 0 else 0
            x = start_x + (end_x - start_x) * t
            y = start_y + (end_y - start_y) * t
            r_half = math.ceil(bridge_w / 2)
            for dxb in range(-r_half, r_half + 1):
                for dyb in range(-r_half, r_half + 1):
                    ix = int(round(x + dxb))
                    iy = int(round(y + dyb))
                    if 0 <= ix < n and 0 <= iy < n:
                        g[ix, iy] = True

    # Ensure minimum width >= 2 via morphological opening (erosion then dilation) with 2 iterations
    def erode(mask):
        out = np.zeros_like(mask, dtype=bool)
        for i in range(n):
            for j in range(n):
                if mask[i, j]:
                    keep = True
                    for di in (-1, 0, 1):
                        for dj in (-1, 0, 1):
                            ni, nj = i + di, j + dj
                            if not (0 <= ni < n and 0 <= nj < n) or not mask[ni, nj]:
                                keep = False
                                break
                        if not keep:
                            break
                    if keep:
                        out[i, j] = True
        return out

    def dilate(mask):
        out = np.zeros_like(mask, dtype=bool)
        for i in range(n):
            for j in range(n):
                if mask[i, j]:
                    for di in (-1, 0, 1):
                        for dj in (-1, 0, 1):
                            ni, nj = i + di, j + dj
                            if 0 <= ni < n and 0 <= nj < n:
                                out[ni, nj] = True
        return out

    for _ in range(2):
        g = erode(g)
    for _ in range(2):
        g = dilate(g)

    # Flood-fill from chip to enforce 4-connectivity
    visit = np.zeros((n, n), dtype=bool)
    queue = []
    for i in range(i0, i1 + 1):
        for j in range(j0, j1 + 1):
            if 0 <= i < n and 0 <= j < n:
                visit[i, j] = True
                queue.append((i, j))
    while queue:
        i, j = queue.pop(0)
        for di, dj in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ni, nj = i + di, j + dj
            if 0 <= ni < n and 0 <= nj < n and not visit[ni, nj] and g[ni, nj]:
                visit[ni, nj] = True
                queue.append((ni, nj))
    g &= visit

    # Enforce material budget: clip excess cells farthest from chip center
    if g.sum() > 1440:
        coords = np.argwhere(g)
        if len(coords) > 0:
            dists = (coords[:, 0] - cx) ** 2 + (coords[:, 1] - cy) ** 2
            idx_sorted = np.argsort(dists)  # ascending: closest first
            keep_idx = idx_sorted[:1440]
            g[:] = False
            for idx in keep_idx:
                i, j = coords[idx]
                g[i, j] = True

    return g
