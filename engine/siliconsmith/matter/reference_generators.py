"""Hand-written reference generators (NOT model output). Used by tests and as the agent's starting examples.

Each entry: name, source, param_space {name: [lo, hi]} (ints if both bounds are ints).
"""

RECT_FINS = dict(
    name="rect_fins",
    param_space={"spine": [6, 12], "n_fins": [2, 14], "fin_w": [2, 4], "fin_len": [4, 24]},
    source='''
import numpy as np

def generate(params, n, chip):
    spine, n_fins, fin_w, fin_len = (int(params[k]) for k in ("spine", "n_fins", "fin_w", "fin_len"))
    m = np.zeros((n, n), dtype=bool)
    c0 = (n - spine) // 2
    m[c0:c0 + spine, :] = True
    for p in np.linspace(0, n - fin_w, n_fins).round().astype(int):
        m[max(c0 - fin_len, 0):c0, p:p + fin_w] = True
        m[c0 + spine:min(c0 + spine + fin_len, n), p:p + fin_w] = True
    return m
''',
)

RADIAL_SPOKES = dict(
    name="radial_spokes",
    param_space={"n_spokes": [4, 16], "spoke_w": [2, 4], "ring_r": [4, 9], "length": [10, 29]},
    source='''
import numpy as np

def generate(params, n, chip):
    n_sp, w, ring_r, length = (int(params[k]) for k in ("n_spokes", "spoke_w", "ring_r", "length"))
    yy, xx = np.mgrid[0:n, 0:n]
    cx = cy = (n - 1) / 2.0
    dx, dy = xx - cx, yy - cy
    r = np.hypot(dx, dy)
    m = r <= ring_r
    ang = np.arctan2(dy, dx)
    for s in range(n_sp):
        th = 2 * np.pi * s / n_sp
        along = dx * np.cos(th) + dy * np.sin(th)
        across = -dx * np.sin(th) + dy * np.cos(th)
        m |= (along >= 0) & (along <= length) & (np.abs(across) <= w / 2.0)
    return m
''',
)

BROKEN_NET = dict(  # used by tests: must be rejected by the screen
    name="broken_net",
    param_space={"a": [1, 2]},
    source="import socket\ndef generate(params, n, chip):\n    return None\n",
)
