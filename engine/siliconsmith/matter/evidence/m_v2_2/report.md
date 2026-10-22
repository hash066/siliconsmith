# Matter run report

Problem: 2 W chip (6x6 mm) on a 60 mm square aluminium plate, 2 mm thick, convection h=15 W/m2K both faces, ambient 25 C, material budget 40%.

Baseline (best plain rectangular fins, full budget): 72.82 C peak.

Best node: **n1.1** `tapered_cross_fins`: 100.13 C peak using 25.1% material; all rungs M1-M5 passed.
M5 compares against the best plain rectangular-fin plate using no more material than the candidate: 100.24 C, so the candidate is +0.11 K better at equal material.
It does NOT beat the full-budget rectangular-fin baseline (72.82 C).

| node | generator | M1 | M2 | M3 | M4 | M5 | peak C | material | note |
|---|---|---|---|---|---|---|---|---|---|
| n1 | tapered_cardinal_fins | pass | pass | fail | skipped | skipped | 1155.60 | 1.6% | M3: 10 cells belong to features thinner than 2 cells (2 mm) |
| n2 | staggered_tapered_fins | pass | pass | pass | pass | fail | 230.01 | 9.1% | M5: candidate peak 230.01 C vs baseline 229.14 C using <= 329 cells (4 fins 3x9): does not |
| n3 | radial_spiral | pass | pass | pass | pass | fail | 1876.85 | 1.0% | M5: candidate peak 1876.85 C vs baseline 1876.85 C using <= 36 cells (0 fins 0x0): does no |
| n1.1 | tapered_cross_fins | pass | pass | pass | pass | pass | 100.13 | 25.1% | M5: candidate peak 100.13 C vs baseline 100.24 C using <= 904 cells (9 fins 3x12): beats b |
| n2.1 | quadrant_binary_tree | pass | pass | pass | pass | pass | 168.33 | 13.0% | M5: candidate peak 168.33 C vs baseline 168.40 C using <= 469 cells (7 fins 3x8): beats ba |
| n2.2 | spine_branching_fins | pass | skipped | skipped | skipped | skipped | - | - | implement: generator never produced a mask: rejected: generator source too long (15110 > 1 |
| n1.1.1 | multi_level_cross_fins | pass | skipped | skipped | skipped | skipped | - | - | implement: param_space must have 1..8 parameters |
| n2.1.1 | annular_radial_fins | pass | pass | fail | skipped | skipped | 97.82 | 25.9% | M3: 4 cells belong to features thinner than 2 cells (2 mm) |
| n2.3 | space_filling_serpentine | pass | fail | skipped | skipped | skipped | - | 5.1% | M2: material is not all connected to the chip (islands present) |
| n2.1.1.1 | fixed_annular_radial_fins | pass | pass | fail | skipped | skipped | 85.22 | 31.4% | M3: 4 cells belong to features thinner than 2 cells (2 mm) |
| n1.1.2 | eight_arm_tapered_fins | pass | skipped | skipped | skipped | skipped | - | - | implement: param_space must have 1..8 parameters |
| n2.1.2 | branching_radial_fins | pass | skipped | skipped | skipped | skipped | - | - | implement: param_space must have 1..8 parameters |

Pareto (peak vs material): n1.1, n2, n2.1, n3.
Cost $0.0750, 57454 tokens, 131.4 s.

## Honest limits

2D model, steady state, stated h and k (assumptions, not measurements), no airflow CFD, not validated on a printed part. 'Validated' means agreement with an analytic case within pre-set thresholds. 'Second solver agrees' compares our FV solver with our own independent FEM solver, not with experiment.
