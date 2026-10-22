import numpy as np
import math

def generate(params, n, chip):
    # Cast parameters to integers
    n_rings = int(params['n_rings'])
    ring_w = int(params['ring_w'])
    spoke_w = int(params['spoke_w'])
    ring_gap = int(params['ring_gap'])
    start_r = int(params['start_r'])
    
    # Initialize grid
    mask = np.zeros((n, n), dtype=bool)
    
    # Chip coordinates
    i0, i1, j0, j1 = chip
    
    # Helper function to add a filled rectangle
    def add_rect(r_start, r_end, c_start, c_end):
        if r_start < 0 or r_end > n or c_start < 0 or c_end > n:
            return False
        if r_start >= r_end or c_start >= c_end:
            return False
        mask[r_start:r_end, c_start:c_end] = True
        return True
    
    # Always include the chip
    if not add_rect(i0, i1+1, j0, j1+1):
        return mask  # Should not happen with valid chip
    
    # Calculate center of the chip
    ci = (i0 + i1) // 2
    cj = (j0 + j1) // 2
    
    # Generate rings and spokes
    for k in range(n_rings):
        # Current ring's inner radius (Manhattan distance from chip center)
        r_inner = start_r + k * (ring_w + ring_gap)
        r_outer = r_inner + ring_w
        
        # Skip if ring is too large to fit
        max_dist = max(ci, n-1-ci, cj, n-1-cj)
        if r_inner > max_dist:
            break
        
        # Top and bottom horizontal strips of the ring
        top_r = ci - r_outer
        bottom_r = ci + r_outer + 1
        left_c = cj - r_inner
        right_c = cj + r_inner + 1
        if top_r >= 0 and bottom_r <= n and left_c >= 0 and right_c <= n:
            mask[top_r:bottom_r, left_c:right_c] = True
        
        top_r = ci - r_inner
        bottom_r = ci + r_inner + 1
        left_c = cj - r_outer
        right_c = cj + r_outer + 1
        if top_r >= 0 and bottom_r <= n and left_c >= 0 and right_c <= n:
            mask[top_r:bottom_r, left_c:right_c] = True
        
        # Left and right vertical strips of the ring
        top_r = ci - r_outer
        bottom_r = ci + r_outer + 1
        left_c = cj - r_inner
        right_c = cj - r_inner + ring_w
        if top_r >= 0 and bottom_r <= n and left_c >= 0 and right_c <= n:
            mask[top_r:bottom_r, left_c:right_c] = True
        
        left_c = cj + r_inner
        right_c = cj + r_inner + ring_w
        if top_r >= 0 and bottom_r <= n and left_c >= 0 and right_c <= n:
            mask[top_r:bottom_r, left_c:right_c] = True
        
        # Add spokes only if not the innermost ring (k > 0)
        if k > 0:
            half_spoke = spoke_w // 2
            
            # North spoke: from inner ring to outer ring above the chip
            spoke_r_start = ci - r_outer
            spoke_r_end = ci - r_inner + 1
            spoke_c_start = cj - half_spoke
            spoke_c_end = cj + half_spoke + (spoke_w % 2)
            if spoke_r_start >= 0 and spoke_r_end <= n and spoke_c_start >= 0 and spoke_c_end <= n:
                mask[spoke_r_start:spoke_r_end, spoke_c_start:spoke_c_end] = True
            
            # South spoke
            spoke_r_start = ci + r_inner
            spoke_r_end = ci + r_outer + 1
            spoke_c_start = cj - half_spoke
            spoke_c_end = cj + half_spoke + (spoke_w % 2)
            if spoke_r_start >= 0 and spoke_r_end <= n and spoke_c_start >= 0 and spoke_c_end <= n:
                mask[spoke_r_start:spoke_r_end, spoke_c_start:spoke_c_end] = True
            
            # West spoke
            spoke_r_start = ci - half_spoke
            spoke_r_end = ci + half_spoke + (spoke_w % 2)
            spoke_c_start = cj - r_outer
            spoke_c_end = cj - r_inner + 1
            if spoke_r_start >= 0 and spoke_r_end <= n and spoke_c_start >= 0 and spoke_c_end <= n:
                mask[spoke_r_start:spoke_r_end, spoke_c_start:spoke_c_end] = True
            
            # East spoke
            spoke_c_start = cj + r_inner
            spoke_c_end = cj + r_outer + 1
            if spoke_r_start >= 0 and spoke_r_end <= n and spoke_c_start >= 0 and spoke_c_end <= n:
                mask[spoke_r_start:spoke_r_end, spoke_c_start:spoke_c_end] = True
    
    return mask
