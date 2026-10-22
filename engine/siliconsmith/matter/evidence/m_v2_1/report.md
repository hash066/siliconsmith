# Matter run report

Problem: 2 W chip (6x6 mm) on a 60 mm square aluminium plate, 2 mm thick, convection h=15 W/m2K both faces, ambient 25 C, material budget 40%.

Baseline (best plain rectangular fins, full budget): 72.82 C peak.

Best node: **n1.1.1** `adaptive_fin_array`: 76.24 C peak using 37.1% material; all rungs M1-M5 passed.
M5 compares against the best plain rectangular-fin plate using no more material than the candidate: 76.72 C, so the candidate is +0.48 K better at equal material.
It does NOT beat the full-budget rectangular-fin baseline (72.82 C).

| node | generator | M1 | M2 | M3 | M4 | M5 | peak C | material | note |
|---|---|---|---|---|---|---|---|---|---|
| n1 | tapered_cross | pass | pass | pass | pass | fail | 118.55 | 20.2% | M5: candidate peak 118.55 C vs baseline 118.46 C using <= 726 cells (7 fins 3x13): does no |
| n2 | radial_spokes | pass | pass | fail | skipped | skipped | 489.97 | 4.0% | M3: 96 cells belong to features thinner than 2 cells (2 mm) |
| n3 | branching_tree | pass | pass | pass | pass | fail | 316.66 | 6.5% | M5: candidate peak 316.66 C vs baseline 313.00 C using <= 233 cells (4 fins 3x5): does not |
| n4 | tapered_spine_fins | pass | skipped | skipped | skipped | skipped | - | - | implement: generator never produced a mask: TypeError: slice indices must be integers or N |
| n3.1 | quad_branching | pass | pass | pass | pass | fail | 250.13 | 8.4% | M5: candidate peak 250.13 C vs baseline 248.04 C using <= 301 cells (7 fins 3x4): does not |
| n1.1 | multi_arm_cross | pass | pass | pass | pass | fail | 81.20 | 33.8% | M5: candidate peak 81.20 C vs baseline 81.04 C using <= 1217 cells (8 fins 4x16): does not |
| n1.1.1 | adaptive_fin_array | pass | pass | pass | pass | pass | 76.24 | 37.1% | M5: candidate peak 76.24 C vs baseline 76.72 C using <= 1334 cells (15 fins 2x19): beats b |
| n3.1.1 | hierarchical_quad_tree | pass | pass | pass | pass | fail | 316.58 | 6.4% | M5: candidate peak 316.58 C vs baseline 315.76 C using <= 231 cells (3 fins 3x3): does not |
| n9 | space_filling_serpentine | pass | fail | skipped | skipped | skipped | - | 40.8% | M2: material 1468 cells (40.8%) exceeds budget 1440 cells (40%) |
| n1.1.1.1 | concentric_ring_spreader | pass | pass | pass | pass | fail | 85.31 | 31.9% | M5: candidate peak 85.31 C vs baseline 84.53 C using <= 1150 cells (11 fins 4x10): does no |
| n1.1.1.2 | bridged_fin_array | pass | skipped | skipped | skipped | skipped | - | - | implement: param_space must have 1..8 parameters |
| n1.1.2 | starburst_tapered | pass | fail | skipped | skipped | skipped | - | 40.8% | M2: material 1467 cells (40.8%) exceeds budget 1440 cells (40%) |

Pareto (peak vs material): n1, n1.1, n1.1.1, n1.1.1.1, n3.1, n3.1.1.
Cost $0.0858, 63006 tokens, 133.3 s.

## Honest limits

2D model, steady state, stated h and k (assumptions, not measurements), no airflow CFD, not validated on a printed part. 'Validated' means agreement with an analytic case within pre-set thresholds. 'Second solver agrees' compares our FV solver with our own independent FEM solver, not with experiment.
