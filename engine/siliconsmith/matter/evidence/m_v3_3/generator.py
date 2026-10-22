import numpy as np
from collections import deque

def generate(params, n, chip):
    levels = max(2, min(int(params['levels']), 4))
    trunk_w = max(2, min(int(params['trunk_width']), n))
    width_red_min = max(1, int(params['width_reduction_min']))
    width_red_max = max(width_red_min, int(params['width_reduction_max']))
    seg_len_min = max(2, int(params['segment_length_min']))
    seg_len_max = max(seg_len_min, int(params['segment_length_max']))
    branch_factor_min = max(2, int(params['branch_factor_min']))
    branch_factor_max = max(branch_factor_min, int(params['branch_factor_max']))

    grid = np.zeros((n, n), dtype=bool)
    ci0, ci1, cj0, cj1 = chip
    cx = (ci0 + ci1) // 2
    cy = (cj0 + cj1) // 2

    def add_rect(x0, x1, y0, y1):
        x0 = int(max(0, min(x0, n)))
        x1 = int(max(0, min(x1, n)))
        y0 = int(max(0, min(y0, n)))
        y1 = int(max(0, min(y1, n)))
        if x0 < x1 and y0 < y1:
            grid[x0:x1, y0:y1] = True

    # Central trunk: vertical rectangle covering the chip column
    tx0 = cx - trunk_w // 2
    tx1 = tx0 + trunk_w
    ty0 = 0
    ty1 = n
    add_rect(tx0, tx1, ty0, ty1)

    # Ensure chip is covered
    add_rect(ci0, ci1 + 1, cj0, cj1 + 1)

    # Use average parameters for branching behavior
    width_red = (width_red_min + width_red_max) // 2
    seg_len = (seg_len_min + seg_len_max) // 2
    branch_factor = (branch_factor_min + branch_factor_max) // 2

    def branch(x, y, w, length, lev, direction):
        if lev <= 0 or length <= 0 or w < 2:
            return
        dx, dy = direction
        nx = x + dx * length
        ny = y + dy * length
        if dx != 0:  # horizontal segment
            wy0 = y - w // 2
            wy1 = wy0 + w
            wx0 = min(x, nx)
            wx1 = max(x, nx) + 1
            add_rect(wx0, wx1, wy0, wy1)
            mx = (wx0 + wx1) // 2
            my = wy1 if dy > 0 else wy0
        else:  # vertical segment
            wx0 = x - w // 2
            wx1 = wx0 + w
            wy0 = min(y, ny)
            wy1 = max(y, ny) + 1
            add_rect(wx0, wx1, wy0, wy1)
            mx = wx1 if dx > 0 else wx0
            my = (wy0 + wy1) // 2
        if lev > 1:
            next_w = max(2, w - width_red)
            next_len = max(1, length // 2)
            num_branches = min(branch_factor, 4)  # Limit to 4 directions
            dirs = [(1, 0), (-1, 0), (0, 1), (0, -1)]
            # Continue in same direction
            branch(mx, my, next_w, next_len, lev - 1, direction)
            # Add orthogonal branches up to branch_factor-1
            count = 0
            for d in dirs:
                if count >= branch_factor - 1:
                    break
                if d == direction or d == (-direction[0], -direction[1]):
                    continue
                branch(mx, my, next_w, next_len, lev - 1, d)
                count += 1

    # Start branches from the center of the trunk, mid-height
    start_x = cx
    start_y = cy
    directions = [(1, 0), (0, 1), (-1, 0), (0, -1)]  # right, up, left, down
    for d in directions:
        branch(start_x, start_y, trunk_w, seg_len, levels, d)

    # Ensure connectivity via flood fill from chip
    visited = np.zeros_like(grid, dtype=bool)
    q = deque()
    for i in range(ci0, ci1 + 1):
        for j in range(cj0, cj1 + 1):
            if grid[i, j]:
                q.append((i, j))
                visited[i, j] = True
                break
        if q:
            break
    dirs = [(0,1),(1,0),(0,-1),(-1,0)]
    while q:
        x, y = q.popleft()
        for dx, dy in dirs:
            nx, ny = x + dx, y + dy
            if 0 <= nx < n and 0 <= ny < n and not visited[nx, ny] and grid[nx, ny]:
                visited[nx, ny] = True
                q.append((nx, ny))
    grid &= visited

    # Enforce minimum feature size (no isolated or thin features <2 cells)
    changed = True
    while changed:
        changed = False
        to_remove = []
        for i in range(n):
            for j in range(n):
                if grid[i, j]:
                    neighbors = 0
                    for dx, dy in dirs:
                        ni, nj = i + dx, j + dy
                        if 0 <= ni < n and 0 <= nj < n and grid[ni, nj]:
                            neighbors += 1
                    if neighbors < 2:
                        to_remove.append((i, j))
        for i, j in to_remove:
            grid[i, j] = False
            changed = True

    # Final connectivity enforcement
    visited = np.zeros_like(grid, dtype=bool)
    q = deque()
    start_found = False
    for i in range(ci0, ci1 + 1):
        for j in range(cj0, cj1 + 1):
            if grid[i, j]:
                q.append((i, j))
                visited[i, j] = True
                start_found = True
                break
        if start_found:
            break
    if q:
        while q:
            x, y = q.popleft()
            for dx, dy in dirs:
                nx, ny = x + dx, y + dy
                if 0 <= nx < n and 0 <= ny < n and not visited[nx, ny] and grid[nx, ny]:
                    visited[nx, ny] = True
                    q.append((nx, ny))
        grid &= visited

    # Budget enforcement: remove excess material from edges inward
    material_cells = np.sum(grid)
    if material_cells > 1440:
        excess = material_cells - 1440
        # Prioritize removal: farthest from chip, then edge-adjacent
        removable_scores = []
        for i in range(n):
            for j in range(n):
                if grid[i, j]:
                    d = abs(i - cx) + abs(j - cy)  # Manhattan distance to chip center
                    edge_bonus = 0
                    if i == 0 or i == n-1 or j == 0 or j == n-1:
                        edge_bonus = 1000  # Strong preference for edge cells
                    removable_scores.append((d + edge_bonus, i, j))
        removable_scores.sort(reverse=True)  # Highest score first (farthest/edgiest)
        for _, i, j in removable_scores:
            if excess <= 0:
                break
            # Tentatively remove
            grid[i, j] = False
            # Check if chip region remains connected
            vis = np.zeros_like(grid, dtype=bool)
            qq = deque()
            started = False
            for i0 in range(ci0, ci1 + 1):
                for j0 in range(cj0, cj1 + 1):
                    if grid[i0, j0]:
                        qq.append((i0, j0))
                        vis[i0, j0] = True
                        started = True
                        break
                if started:
                    break
            if qq:
                while qq:
                    x, y = qq.popleft()
                    for dx, dy in dirs:
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < n and 0 <= ny < n and not vis[nx, ny] and grid[nx, ny]:
                            vis[nx, ny] = True
                            qq.append((nx, ny))
                if np.all(vis[ci0:ci1+1, cj0:cj1+1]):  # chip still connected
                    excess -= 1
                else:
                    grid[i, j] = True  # revert if disconnects chip
        # Re-flood to ensure global connectivity (should hold by construction)
        vis = np.zeros_like(grid, dtype=bool)
        qq = deque()
        started = False
        for i0 in range(ci0, ci1 + 1):
            for j0 in range(cj0, cj1 + 1):
                if grid[i0, j0]:
                    qq.append((i0, j0))
                    vis[i0, j0] = True
                    started = True
                    break
            if started:
                break
        if qq:
            while qq:
                x, y = qq.popleft()
                for dx, dy in dirs:
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < n and 0 <= ny < n and not vis[nx, ny] and grid[nx, ny]:
                        vis[nx, ny] = True
                        qq.append((nx, ny))
            grid &= vis

    return grid
