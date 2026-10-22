# Matter run report

Problem: 2 W chip (6x6 mm) on a 60 mm square aluminium plate, 2 mm thick, convection h=15 W/m2K both faces, ambient 25 C, material budget 40%.

Baseline (best plain rectangular fins, full budget): 72.82 C peak.

Best node: **n8** `concentric_squares`: 75.81 C peak using 37.4% material; all rungs M1-M5 passed.
M5 compares against the best plain rectangular-fin plate using no more material than the candidate: 76.51 C, so the candidate is +0.69 K better at equal material.
It does NOT beat the full-budget rectangular-fin baseline (72.82 C).

| node | generator | M1 | M2 | M3 | M4 | M5 | peak C | material | note |
|---|---|---|---|---|---|---|---|---|---|
| n1 | radial_spokes | pass | pass | fail | skipped | skipped | 244.72 | 8.5% | M3: 80 cells belong to features thinner than 2 cells (2 mm) |
| n2 | branching_tree | pass | pass | pass | pass | fail | 1876.85 | 1.0% | M5: candidate peak 1876.85 C vs baseline 1876.85 C using <= 36 cells (0 fins 0x0): does no |
| n3 | serpentine_fin | pass | pass | pass | pass | pass | 425.04 | 4.7% | M5: candidate peak 425.04 C vs baseline 1876.85 C using <= 168 cells (0 fins 0x0): beats b |
| n2.1 | h_tree | pass | pass | pass | pass | pass | 565.94 | 3.5% | M5: candidate peak 565.94 C vs baseline 1876.85 C using <= 125 cells (0 fins 0x0): beats b |
| n5 | two_level_comb | pass | pass | fail | skipped | skipped | 319.68 | 8.6% | M3: 229 cells belong to features thinner than 2 cells (2 mm) |
| n1.1 | radial_tree | pass | pass | fail | skipped | skipped | 111.16 | 22.4% | M3: 12 cells belong to features thinner than 2 cells (2 mm) |
| n7 | cross_fins | pass | pass | pass | pass | fail | 75.40 | 40.0% | M5: candidate peak 75.40 C vs baseline 72.82 C using <= 1440 cells (15 fins 4x9): does not |
| n8 | concentric_squares | pass | pass | pass | pass | pass | 75.81 | 37.4% | M5: candidate peak 75.81 C vs baseline 76.51 C using <= 1345 cells (13 fins 4x6): beats ba |
| n2.1.1 | hierarchical_cross | pass | pass | pass | pass | pass | 182.10 | 11.9% | M5: candidate peak 182.10 C vs baseline 184.93 C using <= 429 cells (11 fins 3x1): beats b |

Pareto (peak vs material): n2, n2.1, n2.1.1, n3, n7, n8.
Cost $0.0572, 42818 tokens, 105.7 s.

## Honest limits

2D model, steady state, stated h and k (assumptions, not measurements), no airflow CFD, not validated on a printed part. 'Validated' means agreement with an analytic case within pre-set thresholds. 'Second solver agrees' compares our FV solver with our own independent FEM solver, not with experiment.
