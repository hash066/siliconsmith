"""Pre-registered acceptance thresholds for the Matter solver.

Fixed on 2026-10-22 BEFORE any solver result existed. They are never edited
after seeing results: if a check fails, the measured error is reported as is.
"Validated" means exactly "agrees with an analytic case within these
thresholds", nothing more.
"""

# Relative error of tip temperature rise and total fin heat flow vs the
# analytic straight-fin solution.
FIN_ANALYTIC_REL = 0.01

# Relative change of the key outputs when the grid is refined 2x.
GRID_REFINEMENT_REL = 0.02

# Independently written second solver vs the primary one (used from Oct 23).
SECOND_SOLVER_REL = 0.03
