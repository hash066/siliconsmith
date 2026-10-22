# Matter run report

Problem: 2 W chip (6x6 mm) on a 60 mm square aluminium plate, 2 mm thick, convection h=15 W/m2K both faces, ambient 25 C, material budget 40%.

Baseline (best plain rectangular fins, full budget): 72.82 C peak.

Best node: **n3.2** `ring_spoke_hybrid`: 73.99 C peak using 38.8% material; all rungs M1-M5 passed.
M5 compares against the best plain rectangular-fin plate using no more material than the candidate: 74.70 C, so the candidate is +0.71 K better at equal material.
It does NOT beat the full-budget rectangular-fin baseline (72.82 C).

| node | generator | M1 | M2 | M3 | M4 | M5 | peak C | material | note |
|---|---|---|---|---|---|---|---|---|---|
| n1 | radial_fins | pass | pass | pass | pass | pass | 208.63 | 10.2% | M5: candidate peak 208.63 C vs baseline 1876.85 C using <= 366 cells (0 fins 0x0): beats b |
| n2 | branching_tree | pass | pass | pass | pass | pass | 329.88 | 6.2% | M5: candidate peak 329.88 C vs baseline 1876.85 C using <= 223 cells (0 fins 0x0): beats b |
| n3 | concentric_rings | pass | pass | pass | pass | pass | 79.01 | 35.2% | M5: candidate peak 79.01 C vs baseline 79.72 C using <= 1267 cells (13 fins 3x7): beats ba |
| n1.1 | spiral_arms | pass | fail | skipped | skipped | skipped | - | 3.1% | M2: material is not all connected to the chip (islands present) |
| n2.1 | branching_radial_tree | pass | pass | fail | skipped | skipped | 615.39 | 3.1% | M3: 16 cells belong to features thinner than 2 cells (2 mm) |
| n3.1 | serpentine_fins | pass | pass | pass | pass | fail | 81.31 | 36.0% | M5: candidate peak 81.31 C vs baseline 78.77 C using <= 1295 cells (13 fins 2x11): does no |
| n1.2 | tapered_radial_fins | pass | pass | pass | pass | pass | 420.17 | 4.7% | M5: candidate peak 420.17 C vs baseline 1876.85 C using <= 169 cells (0 fins 0x0): beats b |
| n2.2 | hierarchical_branching_tree | pass | pass | pass | pass | fail | 182.03 | 12.8% | M5: candidate peak 182.03 C vs baseline 173.63 C using <= 461 cells (5 fins 2x5): does not |
| n3.2 | ring_spoke_hybrid | pass | pass | pass | pass | pass | 73.99 | 38.8% | M5: candidate peak 73.99 C vs baseline 74.70 C using <= 1397 cells (14 fins 4x6): beats ba |

Pareto (peak vs material): n1, n1.2, n2, n2.2, n3, n3.2.
Cost $0.0531, 47593 tokens, 103.7 s.

## Honest limits

2D model, steady state, stated h and k (assumptions, not measurements), no airflow CFD, not validated on a printed part. 'Validated' means agreement with an analytic case within pre-set thresholds. 'Second solver agrees' compares our FV solver with our own independent FEM solver, not with experiment.
