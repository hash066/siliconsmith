# Matter run report

Problem: 2 W chip (6x6 mm) on a 60 mm square aluminium plate, 2 mm thick, convection h=15 W/m2K both faces, ambient 25 C, material budget 40%.

Baseline (best plain rectangular fins, full budget): 72.82 C peak.

Best node: **n3** `spiral_fin`: 72.57 C peak using 40.0% material; all rungs M1-M5 passed.
M5 compares against the best plain rectangular-fin plate using no more material than the candidate: 72.82 C, so the candidate is +0.25 K better at equal material.
It does beat the full-budget rectangular-fin baseline (72.82 C).

| node | generator | M1 | M2 | M3 | M4 | M5 | peak C | material | note |
|---|---|---|---|---|---|---|---|---|---|
| n1 | quad_branching | pass | pass | pass | pass | fail | 167.54 | 13.1% | M5: candidate peak 167.54 C vs baseline 167.52 C using <= 472 cells (9 fins 3x4): does not |
| n2 | radial_spokes | pass | pass | fail | skipped | skipped | 99.80 | 25.3% | M3: 14 cells belong to features thinner than 2 cells (2 mm) |
| n3 | spiral_fin | pass | pass | pass | pass | pass | 72.57 | 40.0% | M5: candidate peak 72.57 C vs baseline 72.82 C using <= 1440 cells (15 fins 4x9): beats ba |
| n1.1 | fractal_tree | pass | pass | pass | pass | pass | 79.36 | 35.0% | M5: candidate peak 79.36 C vs baseline 79.90 C using <= 1261 cells (7 fins 4x19): beats ba |
| n2.1 | concentric_radial | pass | pass | fail | skipped | skipped | 86.12 | 31.2% | M3: 36 cells belong to features thinner than 2 cells (2 mm) |
| n3.1 | serpentine_fins | pass | fail | skipped | skipped | skipped | - | 100.0% | M2: material 3600 cells (100.0%) exceeds budget 1440 cells (40%) |
| n2.1.1 | tapered_radial_fins | pass | pass | fail | skipped | skipped | 80.69 | 34.2% | M3: 148 cells belong to features thinner than 2 cells (2 mm) |
| n1.1.1 | ladder_tree | pass | pass | pass | pass | fail | 211.57 | 10.2% | M5: candidate peak 211.57 C vs baseline 208.96 C using <= 366 cells (3 fins 3x13): does no |
| n3.2 | finned_spiral | pass | pass | pass | pass | pass | 72.57 | 40.0% | M5: candidate peak 72.57 C vs baseline 72.82 C using <= 1440 cells (15 fins 4x9): beats ba |
| n3.3 | tapered_spiral | pass | pass | pass | pass | pass | 72.57 | 40.0% | M5: candidate peak 72.57 C vs baseline 72.82 C using <= 1440 cells (15 fins 4x9): beats ba |
| n3.4 | dual_spiral | pass | fail | skipped | skipped | skipped | - | 100.0% | M2: material 3600 cells (100.0%) exceeds budget 1440 cells (40%) |
| n2.1.1.1 | radial_hybrid | pass | pass | fail | skipped | skipped | 76.38 | 37.1% | M3: 40 cells belong to features thinner than 2 cells (2 mm) |

Pareto (peak vs material): n1, n1.1, n1.1.1, n3, n3.2, n3.3.
Cost $0.0655, 69869 tokens, 110.6 s.

## Honest limits

2D model, steady state, stated h and k (assumptions, not measurements), no airflow CFD, not validated on a printed part. 'Validated' means agreement with an analytic case within pre-set thresholds. 'Second solver agrees' compares our FV solver with our own independent FEM solver, not with experiment.
