# Matter run report

Problem: 2 W chip (6x6 mm) on a 60 mm square aluminium plate, 2 mm thick, convection h=15 W/m2K both faces, ambient 25 C, material budget 40%.

Baseline (best plain rectangular fins, full budget): 72.82 C peak.

**Result: Beats the full-budget rectangular-fin baseline by 0.26 K (model estimate).**

Best node: **n2.2** `concentric_spoked`: 72.56 C peak using 40.0% material; all rungs M1-M5 passed.
M5 compares against the best plain rectangular-fin plate using no more material than the candidate: 72.82 C, so the candidate is +0.26 K better at equal material.
It does beat the full-budget rectangular-fin baseline (72.82 C).

| node | generator | M1 | M2 | M3 | M4 | M5 | peak C | material | note |
|---|---|---|---|---|---|---|---|---|---|
| n1 | tapered_comb_fins | pass | pass | fail | skipped | skipped | 304.33 | 6.8% | M3: 80 cells belong to features thinner than 2 cells (2 mm) |
| n2 | radial_tapered_fins | pass | pass | pass | pass | fail | 95.72 | 26.7% | M5: candidate peak 95.72 C vs baseline 95.56 C using <= 960 cells (8 fins 4x12): does not  |
| n3 | serpentine_fin | pass | pass | pass | pass | pass | 1385.83 | 1.4% | M5: candidate peak 1385.83 C vs baseline 1876.85 C using <= 49 cells (0 fins 0x0): beats b |
| n2.1 | branching_tree | pass | pass | pass | pass | fail | 73.84 | 39.9% | M5: candidate peak 73.84 C vs baseline 73.24 C using <= 1437 cells (7 fins 4x21): does not |
| n2.2 | concentric_spoked | pass | pass | pass | pass | pass | 72.56 | 40.0% | M5: candidate peak 72.56 C vs baseline 72.82 C using <= 1440 cells (15 fins 4x9): beats ba |
| n3.1 | space_filling_fin | pass | fail | skipped | skipped | skipped | - | 3.0% | M2: material is not all connected to the chip (islands present) |
| n2.2.1 | spiral_tapered_fin | pass | pass | pass | pass | pass | 72.56 | 40.0% | M5: candidate peak 72.56 C vs baseline 72.82 C using <= 1440 cells (15 fins 4x9): beats ba |
| n2.1.1 | radial_branching_tree | pass | pass | pass | pass | fail | 94.94 | 27.4% | M5: candidate peak 94.94 C vs baseline 94.21 C using <= 988 cells (7 fins 4x13): does not  |
| n2.2.2 | adaptive_radial_lattice | pass | pass | fail | skipped | skipped | 75.34 | 40.0% | M3: 261 cells belong to features thinner than 2 cells (2 mm) |
| n2.2.3 | quadtree_tapered_mesh | pass | pass | pass | pass | pass | 1385.83 | 1.4% | M5: candidate peak 1385.83 C vs baseline 1876.85 C using <= 49 cells (0 fins 0x0): beats b |
| n2.2.1.1 | multi_arm_spiral | pass | pass | pass | pass | pass | 72.56 | 40.0% | M5: candidate peak 72.56 C vs baseline 72.82 C using <= 1440 cells (15 fins 4x9): beats ba |
| n2.1.2 | orthogonal_branching_fins | pass | fail | skipped | skipped | skipped | - | 40.0% | M2: material 1441 cells (40.0%) exceeds budget 1440 cells (40%) |
| n2.2.4 | hierarchical_radial_quad | pass | pass | pass | pass | pass | 72.56 | 40.0% | M5: candidate peak 72.56 C vs baseline 72.82 C using <= 1440 cells (15 fins 4x9): beats ba |
| n2.1.3 | tapered_orthogonal_tree | pass | pass | pass | pass | pass | 95.99 | 26.6% | M5: candidate peak 95.99 C vs baseline 96.73 C using <= 957 cells (5 fins 3x26): beats bas |
| n15 | variable_width_hilbert | pass | skipped | skipped | skipped | skipped | - | - | implement: generator never produced a mask: IndexError: too many indices for array: array  |
| n2.2.5 | radial_fin_lattice | pass | pass | pass | pass | pass | 72.56 | 40.0% | M5: candidate peak 72.56 C vs baseline 72.82 C using <= 1440 cells (15 fins 4x9): beats ba |
| n2.2.1.2 | branching_spiral_arms | pass | pass | pass | pass | pass | 72.56 | 40.0% | M5: candidate peak 72.56 C vs baseline 72.82 C using <= 1440 cells (15 fins 4x9): beats ba |
| n2.2.4.1 | hybrid_radial_cartesian | pass | pass | pass | pass | pass | 91.63 | 28.3% | M5: candidate peak 91.63 C vs baseline 92.02 C using <= 1018 cells (7 fins 3x20): beats ba |

Pareto (peak vs material): n2, n2.1, n2.1.1, n2.1.3, n2.2, n2.2.1, n2.2.1.1, n2.2.1.2, n2.2.3, n2.2.4.1, n2.2.5, n3.
Cost $0.1074, 107367 tokens, 219.4 s.

## Honest limits

2D model, steady state, stated h and k (assumptions, not measurements), no airflow CFD, not validated on a printed part. 'Validated' means agreement with an analytic case within pre-set thresholds. 'Second solver agrees' compares our FV solver with our own independent FEM solver, not with experiment.
