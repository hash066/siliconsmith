import numpy as np
import math

def generate(params, n, chip):
    i0, i1, j0, j1 = chip
    ci = (i0 + i1) // 2
    cj = (j0 + j1) // 2

    n_rings = int(round(params['n_rings']))
    ring_w_base = int(round(params['ring_w']))
    spoke_w_base = int(round(params['spoke_w']))
    hub_r = int(round(params['hub_r']))
    max_r = int(round(params['max_r']))
    ring_taper = float(params['ring_taper'])
    spoke_taper = float(params['spoke_taper'])

    # Enforce constraints on parameters
    n_rings = max(1, n_rings)
    ring_w_base = max(2, ring_w_base)
    spoke_w_base = max(2, spoke_w_base)
    hub_r = max(0, hub_r)
    max_r = max(hub_r + 1, max_r)
    ring_taper = max(0.0, ring_taper)
    spoke_taper = max(0.0, spoke_taper)

    mat = np.zeros((n, n), dtype=bool)

    # Fill hub
    for i in range(n):
        for j in range(n):
            if (i - ci)**2 + (j - cj)**2 <= hub_r**2:
                mat[i, j] = True

    if n_rings > 0:
        dr = (max_r - hub_r) / n_rings
        for k in range(n_rings):
            r_inner = hub_r + k * dr
            r_outer = r_inner + dr
            ring_w = ring_w_base - ring_taper * k
            if ring_w < 2:
                ring_w = 2
            ring_w = int(round(ring_w))
            if ring_w % 2 == 1:
                ring_w += 1
            half_w = ring_w // 2

            for i in range(n):
                for j in range(n):
                    dx = i - ci
                    dy = j - cj
                    dist = math.sqrt(dx*dx + dy*dy)
                    if r_inner <= dist <= r_outer:
                        mat[i, j] = True

    # Add 4 spokes: up, down, left, right
    for dx, dy in [(1,0), (-1,0), (0,1), (0,-1)]:
        steps = max_r - hub_r
        if steps <= 0:
            continue
        for s in range(steps + 1):
            r = hub_r + s * dr if n_rings > 0 else hub_r + s
            spoke_w = spoke_w_base - spoke_taper * s
            if spoke_w < 2:
                spoke_w = 2
            spoke_w = int(round(spoke_w))
            if spoke_w % 2 == 1:
                spoke_w += 1
            half_w = spoke_w // 2

            if dx != 0:
                i = ci + dx * s
                j_min = cj - half_w
                j_max = cj + half_w
                for j in range(j_min, j_max):
                    if 0 <= i < n and 0 <= j < n:
                        mat[i, j] = True
            else:
                j = cj + dy * s
                i_min = ci - half_w
                i_max = ci + half_w
                for i in range(i_min, i_max):
                    if 0 <= i < n and 0 <= j < n:
                        mat[i, j] = True

    # Enforce connectivity: ensure all material is 4-connected to chip
    visited = np.zeros((n, n), dtype=bool)
    queue = []
    chip_filled = False
    for i in range(i0, i1+1):
        for j in range(j0, j1+1):
            if mat[i, j]:
                queue.append((i, j))
                visited[i, j] = True
                chip_filled = True
    if not chip_filled:
        for i in range(i0, i1+1):
            for j in range(j0, j1+1):
                mat[i, j] = True
                queue.append((i, j))
                visited[i, j] = True

    while queue:
        i, j = queue.pop(0)
        for ni, nj in [(i+1,j), (i-1,j), (i,j+1), (i,j-1)]:
            if 0 <= ni < n and 0 <= nj < n:
                if mat[ni, nj] and not visited[ni, nj]:
                    visited[ni, nj] = True
                    queue.append((ni, nj))

    # Remove any material not connected to chip
    for i in range(n):
        for j in range(n):
            if mat[i, j] and not visited[i, j]:
                mat[i, j] = False

    # Enforce minimum feature size: 2 cells wide
    # Erode then dilate with 2x2 kernel to remove features <2 cells
    def erode(mask):
        eroded = np.zeros_like(mask)
        for i in range(1, n-1):
            for j in range(1, n-1):
                if mask[i, j]:
                    if (mask[i-1, j] and mask[i+1, j] and mask[i, j-1] and mask[i, j+1]):
                        eroded[i, j] = True
        return eroded

    def dilate(mask):
        dilated = np.zeros_like(mask)
        for i in range(n):
            for j in range(n):
                if mask[i, j]:
                    for di in [-1,0,1]:
                        for dj in [-1,0,1]:
                            ni, nj = i+di, j+dj
                            if 0 <= ni < n and 0 <= nj < n:
                                dilated[ni, nj] = True
        return dilated

    temp = erode(mat)
    temp = erode(temp)
    mat = dilate(temp)
    mat = dilate(mat)

    # Final pass: ensure chip is still covered
    for i in range(i0, i1+1):
        for j in range(j0, j1+1):
            mat[i, j] = True

    # Enforce material budget: at most 1440 cells
    if np.sum(mat) > 1440:
        # Scale down by clearing outer material preferentially
        flat_idx = np.argsort(((np.arange(n)[:,None]-ci)**2 + (np.arange(n)[None,:]-cj)**2).flatten())[::-1]
        flat_mat = mat.flatten()
        excess = np.sum(mat) - 1440
        for idx in flat_idx:
            if excess <= 0:
                break
            if flat_mat[idx]:
                flat_mat[idx] = False
                excess -= 1
        mat = flat_mat.reshape((n, n))

    return mat
