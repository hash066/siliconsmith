# Matter run report

Problem: 2 W chip (6x6 mm) on a 60 mm square aluminium plate, 2 mm thick, convection h=15 W/m2K both faces, ambient 25 C, material budget 40%.

Baseline (best plain rectangular fins, full budget): 72.82 C peak.

**Result: Beats the full-budget rectangular-fin baseline by 0.26 K (model estimate).**

Best node: **n3.5** `interleaved_double_spiral`: 72.56 C peak using 40.0% material; all rungs M1-M5 passed.
M5 compares against the best plain rectangular-fin plate using no more material than the candidate: 72.82 C, so the candidate is +0.26 K better at equal material.
It does beat the full-budget rectangular-fin baseline (72.82 C).

| node | generator | M1 | M2 | M3 | M4 | M5 | peak C | material | note |
|---|---|---|---|---|---|---|---|---|---|
| n1 | tapered_orthogonal_fins | pass | pass | pass | pass | fail | 106.93 | 23.6% | M5: candidate peak 106.93 C vs baseline 104.86 C using <= 849 cells (7 fins 3x16): does no |
| n2 | hierarchical_branching | pass | pass | pass | pass | fail | 88.20 | 30.5% | M5: candidate peak 88.20 C vs baseline 87.26 C using <= 1097 cells (15 fins 2x14): does no |
| n3 | radial_spoke_fins | pass | pass | pass | pass | pass | 72.56 | 40.0% | M5: candidate peak 72.56 C vs baseline 72.82 C using <= 1440 cells (15 fins 4x9): beats ba |
| n3.1 | bifurcating_radial_spokes | pass | pass | pass | pass | pass | 72.57 | 40.0% | M5: candidate peak 72.57 C vs baseline 72.82 C using <= 1440 cells (15 fins 4x9): beats ba |
| n3.2 | concentric_radial_web | pass | pass | pass | pass | pass | 72.56 | 40.0% | M5: candidate peak 72.56 C vs baseline 72.82 C using <= 1440 cells (15 fins 4x9): beats ba |
| n6 | archimedean_spiral_fins | pass | pass | fail | skipped | skipped | 94.84 | 27.0% | M3: 43 cells belong to features thinner than 2 cells (2 mm) |
| n3.3 | radial_core_orthogonal_fins | pass | skipped | skipped | skipped | skipped | - | - | implement: generator never produced a mask: TypeError: 'float' object cannot be interprete |
| n2.1 | tapered_tree_with_spreading_rings | pass | pass | pass | pass | pass | 72.57 | 40.0% | M5: candidate peak 72.57 C vs baseline 72.82 C using <= 1440 cells (15 fins 4x9): beats ba |
| n9 | variable_width_space_filling_curve | pass | pass | pass | pass | pass | 132.14 | 17.4% | M5: candidate peak 132.14 C vs baseline 132.92 C using <= 628 cells (5 fins 3x15): beats b |
| n10 | radial_comb_fins | pass | skipped | skipped | skipped | skipped | - | - | implement: generator never produced a mask: rejected: import from 'typing' is not allowed |
| n11 | segmented_concentric_rings | pass | pass | pass | pass | fail | 1876.85 | 1.0% | M5: candidate peak 1876.85 C vs baseline 1876.85 C using <= 36 cells (0 fins 0x0): does no |
| n12 | quadtree_branching | pass | pass | fail | skipped | skipped | 743.47 | 2.6% | M3: 44 cells belong to features thinner than 2 cells (2 mm) |
| n3.2.1 | radial_ladder_mesh | pass | pass | pass | pass | pass | 72.56 | 40.0% | M5: candidate peak 72.56 C vs baseline 72.82 C using <= 1440 cells (15 fins 4x9): beats ba |
| n2.1.1 | quadrant_tree_crosslinked | pass | pass | fail | skipped | skipped | 72.80 | 40.0% | M3: 1 enclosed void(s) (trapped, not printable) |
| n3.4 | tapered_radial_sectors | pass | pass | fail | skipped | skipped | 72.93 | 40.0% | M3: 4 cells belong to features thinner than 2 cells (2 mm) |
| n3.5 | interleaved_double_spiral | pass | pass | pass | pass | pass | 72.56 | 40.0% | M5: candidate peak 72.56 C vs baseline 72.82 C using <= 1440 cells (15 fins 4x9): beats ba |
| n2.1.2 | radial_sector_tree | pass | skipped | skipped | skipped | skipped | - | - | implement: param_space must have 1..8 parameters |
| n3.2.2 | concentric_square_rings | pass | pass | pass | pass | pass | 82.28 | 33.2% | M5: candidate peak 82.28 C vs baseline 82.55 C using <= 1194 cells (11 fins 2x24): beats b |

Pareto (peak vs material): n1, n11, n2, n3.2.2, n3.5, n9.
Cost $0.0937, 96613 tokens, 199.0 s.

## Honest limits

2D model, steady state, stated h and k (assumptions, not measurements), no airflow CFD, not validated on a printed part. 'Validated' means agreement with an analytic case within pre-set thresholds. 'Second solver agrees' compares our FV solver with our own independent FEM solver, not with experiment.
