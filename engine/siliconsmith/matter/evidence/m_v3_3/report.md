# Matter run report

Problem: 2 W chip (6x6 mm) on a 60 mm square aluminium plate, 2 mm thick, convection h=15 W/m2K both faces, ambient 25 C, material budget 40%.

Baseline (best plain rectangular fins, full budget): 72.82 C peak.

**Result: Beats the full-budget rectangular-fin baseline by 0.22 K (model estimate).**

Best node: **n2.1.4** `adaptive_quadtree`: 72.60 C peak using 40.0% material; all rungs M1-M5 passed.
M5 compares against the best plain rectangular-fin plate using no more material than the candidate: 72.82 C, so the candidate is +0.22 K better at equal material.
It does beat the full-budget rectangular-fin baseline (72.82 C).

| node | generator | M1 | M2 | M3 | M4 | M5 | peak C | material | note |
|---|---|---|---|---|---|---|---|---|---|
| n1 | orthogonal_cross_fins | pass | pass | pass | pass | fail | 170.18 | 13.0% | M5: candidate peak 170.18 C vs baseline 168.40 C using <= 468 cells (7 fins 3x8): does not |
| n2 | branching_tree | pass | pass | pass | pass | fail | 314.28 | 6.6% | M5: candidate peak 314.28 C vs baseline 308.32 C using <= 236 cells (5 fins 3x2): does not |
| n3 | concentric_rings | pass | pass | fail | skipped | skipped | 79.75 | 35.5% | M3: 364 cells belong to features thinner than 2 cells (2 mm) |
| n3.1 | tapered_radial_fins | pass | pass | fail | skipped | skipped | 101.45 | 24.6% | M3: 36 cells belong to features thinner than 2 cells (2 mm) |
| n2.1 | hierarchical_quadtree | pass | pass | pass | pass | pass | 72.62 | 40.0% | M5: candidate peak 72.62 C vs baseline 72.82 C using <= 1440 cells (15 fins 4x9): beats ba |
| n1.1 | serpentine_spiral | pass | pass | pass | pass | fail | 216.86 | 9.8% | M5: candidate peak 216.86 C vs baseline 214.79 C using <= 354 cells (9 fins 3x3): does not |
| n2.1.1 | radial_quadtree | pass | pass | pass | pass | fail | 73.77 | 40.0% | M5: candidate peak 73.77 C vs baseline 72.82 C using <= 1440 cells (15 fins 4x9): does not |
| n2.1.2 | tapered_hilbert_curve | pass | pass | pass | pass | fail | 83.37 | 35.9% | M5: candidate peak 83.37 C vs baseline 78.32 C using <= 1293 cells (8 fins 4x17): does not |
| n3.2 | hybrid_radial_orthogonal | pass | pass | pass | pass | pass | 90.37 | 28.8% | M5: candidate peak 90.37 C vs baseline 90.75 C using <= 1038 cells (15 fins 2x13): beats b |
| n2.1.2.1 | adaptive_hilbert_fill | pass | pass | pass | pass | fail | 73.22 | 40.0% | M5: candidate peak 73.22 C vs baseline 72.82 C using <= 1440 cells (15 fins 4x9): does not |
| n3.3 | flux_matched_radial_web | pass | pass | pass | pass | pass | 1385.83 | 1.4% | M5: candidate peak 1385.83 C vs baseline 1876.85 C using <= 49 cells (0 fins 0x0): beats b |
| n2.1.3 | dendritic_quadtree_mesh | pass | skipped | skipped | skipped | skipped | - | - | implement: param_space must have 1..8 parameters |
| n2.1.4 | adaptive_quadtree | pass | pass | pass | pass | pass | 72.60 | 40.0% | M5: candidate peak 72.60 C vs baseline 72.82 C using <= 1440 cells (15 fins 4x9): beats ba |
| n2.1.1.1 | radial_spoke_web | pass | skipped | skipped | skipped | skipped | - | - | implement: param_space must have 1..8 parameters |
| n3.2.1 | graded_orthogonal_mesh | pass | pass | pass | pass | fail | 509.20 | 3.8% | M5: candidate peak 509.20 C vs baseline 508.70 C using <= 138 cells (3 fins 3x3): does not |
| n2.1.5 | murray_tree | pass | pass | pass | pass | fail | 77.05 | 36.7% | M5: candidate peak 77.05 C vs baseline 76.78 C using <= 1320 cells (11 fins 4x12): does no |
| n3.2.2 | radial_to_cartesian | pass | pass | pass | pass | pass | 95.49 | 26.7% | M5: candidate peak 95.49 C vs baseline 95.56 C using <= 961 cells (8 fins 4x12): beats bas |
| n3.2.1.1 | variable_density_lattice | pass | pass | pass | pass | fail | 118.52 | 20.5% | M5: candidate peak 118.52 C vs baseline 116.84 C using <= 737 cells (10 fins 2x14): does n |

Pareto (peak vs material): n1, n1.1, n2, n2.1.2, n2.1.4, n2.1.5, n3.2, n3.2.1, n3.2.1.1, n3.2.2, n3.3.
Cost $0.0900, 101274 tokens, 247.2 s.

## Honest limits

2D model, steady state, stated h and k (assumptions, not measurements), no airflow CFD, not validated on a printed part. 'Validated' means agreement with an analytic case within pre-set thresholds. 'Second solver agrees' compares our FV solver with our own independent FEM solver, not with experiment.
