import numpy as np
import math

def generate(params, n, chip):
    # Clamp and cast parameters to integers within specified ranges
    n_rings = max(3, min(int(params['n_rings']), 8))
    ring_w = max(2, min(int(params['ring_w']), 4))
    spoke_w = max(2, min(int(params['spoke_w']), 3))
    spoke_spacing = max(3, min(int(params['spoke_spacing']), 6))
    hub_r = max(3, min(int(params['hub_r']), 6))
    
    # Initialize design array
    design = np.zeros((n, n), dtype=bool)
    
    # Chip region (inclusive indices)
    i0, i1, j0, j1 = chip
    design[i0:i1+1, j0:j1+1+j1] = True
    
    # Center of the chip
    ci = (i0 + i1) // 2
    cj = (j0 + j1) // 2
    
    # Fill hub: a solid square of size (2*hub_r+1) centered at chip center
    hub_size = 2 * hub_r + 1
    hub_i0 = ci - hub_r
    hub_i1 = ci + hub_r
    hub_j0 = cj - hub_r
    hub_j1 = cj + hub_r
    if hub_i0 >= 0 and hub_i1 < n and hub_j0 >= 0 and hub_j1 < n:
        design[hub_i0:hub_i1+1, hub_j0:hub_j1+1] = True
    
    # Generate concentric rings and radial spokes
    for r_idx in range(n_rings):
        # Radius of this ring: starts just outside hub, spaced evenly
        radius = hub_r + 1 + (r_idx + 1) * 4  # 4 cells gap between rings
        
        # Draw the ring: a thick circular band
        for di in range(-ring_w, ring_w + 1):
            for dj in range(-ring_w, ring_w + 1):
                if di*di + dj*dj <= ring_w*ring_w:
                    i = ci + int(round(radius)) + di
                    j = cj + dj
                    if 0 <= i < n and 0 <= j < n:
                        design[i, j] = True
        
        # Add radial spokes at this ring's radius
        num_spokes = max(4, 360 // spoke_spacing)  # at least 4 spokes
        for k in range(num_spokes):
            angle = 2 * math.pi * k / num_spokes
            dx = int(round(radius * math.cos(angle)))
            dy = int(round(radius * math.sin(angle)))
            
            # Skip if no movement
            if dx == 0 and dy == 0:
                continue
            
            steps = max(abs(dx), abs(dy))
            for s in range(steps + 1):
                t = s / steps if steps > 0 else 0
                i = ci + int(round(t * dx))
                j = cj + int(round(t * dy))
                if 0 <= i < n and 0 <= j < n:
                    # Draw a square cross-section spoke
                    for di in range(-spoke_w//2, spoke_w//2 + 1):
                        for dj in range(-spoke_w//2, spoke_w//2 + 1):
                            ni, nj = i + di, j + dj
                            if 0 <= ni < n and 0 <= nj < n:
                                design[ni, nj] = True
    
    # Ensure all material is 4-connected to the chip via flood fill from chip
    chip_mask = np.zeros((n, n), dtype=bool)
    chip_mask[i0:i1+1, j0:j1+1] = True
    visited = chip_mask.copy()
    frontier = [(i, j) for i in range(i0, i1+1) for j in range(j0, j1+1)]
    
    while frontier:
        i, j = frontier.pop(0)
        for di, dj in [(-1,0),(1,0),(0,-1),(0,1)]:
            ni, nj = i + di, j + dj
            if 0 <= ni < n and 0 <= nj < n and not visited[ni, nj] and design[ni, nj]:
                visited[ni, nj] = True
                frontier.append((ni, nj))
    
    # Keep only material connected to chip
    design &= visited
    
    # Enforce minimum feature size: 2x2 blocks only (opening operation)
    # A cell remains only if it is part of a 2x2 block of material
    kept = np.zeros_like(design)
    for i in range(n-1):
        for j in range(n-1):
            if design[i, j] and design[i+1, j] and design[i, j+1] and design[i+1, j+1]:
                kept[i, j] = True
                kept[i+1, j] = True
                kept[i, j+1] = True
                kept[i+1, j+1] = True
    design = kept
    
    # Remove enclosed voids (holes) by flood-filling from background
    # Any False cell not connected to the edge (and thus enclosed) becomes True
    background = np.zeros((n, n), dtype=bool)
    background[0, :] = True
    background[-1, :] = True
    background[:, 0] = True
    background[:, -1] = True
    # Flood fill from edges through air (False)
    visited_bg = np.zeros((n, n), dtype=bool)
    stack = []
    for i in range(n):
        for j in range(n):
            if background[i, j] and not design[i, j] and not visited_bg[i, j]:
                stack.append((i, j))
                visited_bg[i, j] = True
                while stack:
                    ci, cj = stack.pop()
                    for di, dj in [(-1,0),(1,0),(0,-1),(0,1)]:
                        ni, nj = ci + di, cj + dj
                        if 0 <= ni < n and 0 <= nj < n and not design[ni, nj] and not visited_bg[ni, nj]:
                            visited_bg[ni, nj] = True
                            stack.append((ni, nj))
    # Enclosed voids: False cells not visited by background flood fill
    enclosed = (~design) & (~visited_bg)
    design |= enclosed  # Fill holes by setting them to material
    
    # Final connectivity enforcement (should be redundant but safe)
    visited = chip_mask.copy()
    frontier = [(i, j) for i in range(i0, i1+1) for j in range(j0, j1+1)]
    
    while frontier:
        i, j = frontier.pop(0)
        for di, dj in [(-1,0),(1,0),(0,-1),(0,1)]:
            ni, nj = i + di, j + dj
            if 0 <= ni < n and 0 <= nj < n and not visited[ni, nj] and design[ni, nj]:
                visited[ni, nj] = True
                frontier.append((ni, nj))
    
    design &= visited
    
    # Enforce material budget: at most 1440 cells
    max_cells = 1440
    if design.sum() > max_cells:
        # Priority: closer to chip has higher priority (we keep closest cells)
        dist_from_chip = np.full((n, n), np.inf)
        queue = []
        for i in range(i0, i1+1):
            for j in range(j0, j1+1):
                dist_from_chip[i, j] = 0
                queue.append((i, j))
        
        head = 0
        while head < len(queue):
            i, j = queue[head]
            head += 1
            for di, dj in [(-1,0),(1,0),(0,-1),(0,1)]:
                ni, nj = i + di, j + dj
                if 0 <= ni < n and 0 <= nj < n and dist_from_chip[ni, nj] == np.inf:
                    dist_from_chip[ni, nj] = dist_from_chip[i, j] + 1
                    queue.append((ni, nj))
        
        # Get indices sorted by distance (ascending: closest first)
        flat_indices = np.argsort(dist_from_chip, axis=None)
        keep_flat = flat_indices[:max_cells]
        new_design = np.zeros_like(design)
        new_design.flat[keep_flat] = True
        design = new_design
        
        # Re-ensure connectivity after clipping
        visited = chip_mask.copy()
        frontier = [(i, j) for i in range(i0, i1+1) for j in range(j0, j1+1)]
        
        while frontier:
            i, j = frontier.pop(0)
            for di, dj in [(-1,0),(1,0),(0,-1),(0,1)]:
                ni, nj = i + di, j + dj
                if 0 <= ni < n and 0 <= nj < n and not visited[ni, nj] and design[ni, nj]:
                    visited[ni, nj] = True
                    frontier.append((ni, nj))
        
        design &= visited
    
    return design
