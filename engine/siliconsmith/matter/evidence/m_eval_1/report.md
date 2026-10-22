# Matter run report

Problem: 2 W chip (6x6 mm) on a 60 mm square aluminium plate, 2 mm thick, convection h=15 W/m2K both faces, ambient 25 C, material budget 40%.

Baseline (best plain rectangular fins, full budget): 72.82 C peak.

Best node: **n7** `cross_fins`: 134.67 C peak using 17.1% material; all rungs M1-M5 passed.
M5 compares against the best plain rectangular-fin plate using no more material than the candidate: 135.53 C, so the candidate is +0.86 K better at equal material.
It does NOT beat the full-budget rectangular-fin baseline (72.82 C).

| node | generator | M1 | M2 | M3 | M4 | M5 | peak C | material | note |
|---|---|---|---|---|---|---|---|---|---|
| n1 | radial_fins | pass | pass | fail | skipped | skipped | 111.63 | 22.0% | M3: 4 cells belong to features thinner than 2 cells (2 mm) |
| n2 | branching_tree | pass | pass | pass | pass | fail | 135.86 | 17.3% | M5: candidate peak 135.86 C vs baseline 134.13 C using <= 624 cells (6 fins 2x1): does not |
| n3 | concentric_rings | pass | pass | pass | pass | pass | 1385.83 | 1.4% | M5: candidate peak 1385.83 C vs baseline 1876.85 C using <= 49 cells (0 fins 0x0): beats b |
| n1.1 | tapered_radial_fins | pass | pass | pass | pass | pass | 151.02 | 14.9% | M5: candidate peak 151.02 C vs baseline 152.07 C using <= 537 cells (7 fins 4x1): beats ba |
| n2.1 | branching_tree_v2 | pass | pass | pass | pass | pass | 237.57 | 8.8% | M5: candidate peak 237.57 C vs baseline 1876.85 C using <= 316 cells (0 fins 0x0): beats b |
| n3.1 | concentric_rings_with_spokes | pass | pass | pass | pass | pass | 419.97 | 4.7% | M5: candidate peak 419.97 C vs baseline 1876.85 C using <= 169 cells (0 fins 0x0): beats b |
| n7 | cross_fins | pass | pass | pass | pass | pass | 134.67 | 17.1% | M5: candidate peak 134.67 C vs baseline 135.53 C using <= 617 cells (4 fins 2x1): beats ba |
| n8 | spiral_arms | pass | pass | pass | pass | fail | 168.42 | 13.8% | M5: candidate peak 168.42 C vs baseline 162.17 C using <= 497 cells (4 fins 2x1): does not |
| n2.1.1 | branching_fins | pass | pass | pass | pass | pass | 167.38 | 13.1% | M5: candidate peak 167.38 C vs baseline 170.96 C using <= 471 cells (9 fins 3x2): beats ba |

Pareto (peak vs material): n1.1, n2.1, n2.1.1, n3, n3.1, n7.
Cost $0.0564, 40291 tokens, 86.8 s.

## Honest limits

2D model, steady state, stated h and k (assumptions, not measurements), no airflow CFD, not validated on a printed part. 'Validated' means agreement with an analytic case within pre-set thresholds. 'Second solver agrees' compares our FV solver with our own independent FEM solver, not with experiment.
