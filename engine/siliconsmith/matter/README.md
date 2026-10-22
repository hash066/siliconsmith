# Matter engine (MatterCompiler-lite): 2D heat solver

Scope: a thin plate of thickness `t` with a rectangular heat source, material mask `m(x, y)`, convection to ambient from both faces.
The physics is ours (this solver), not the model's. Agent-written geometry generators will run on top of it later.

## Model

Steady state, per unit plate area:

    -div(k t grad T) + 2 h (T - T_inf) = q

Finite volume on a regular square grid (cell size `dx`), unknowns at cell centres, SciPy sparse direct solve.
`k` is zero outside the material, so face conductance uses the harmonic mean and a material/void face is adiabatic.
The outer boundary is adiabatic except optional fixed-temperature edges (`left|right|bottom|top`), imposed at the face.
The source is a cell-index rectangle with total power `Q` spread evenly over its cells; every source cell must be material.

Units: m, W, K (differences), `k` in W/(m K), `h` in W/(m^2 K). Arrays are `[j, i]` (row = y, column = x).

## API

`solve(mask, dx, k, t, h, T_inf, source, fixed_edges, T_fixed) -> Result` with `T` (NaN off-material), `peak`, `Q_in`,
`Q_conv`, `Q_fixed` (negative = heat entering through a fixed edge), `balance_rel`, `solve_residual_rel`.
`connected_to_source(mask, source)` checks that all material is 4-connected to the source.

## Validation

`thresholds.py` was committed before any result existed and is never edited after seeing results.
"Validated" means only: agrees with an analytic case within those thresholds.
Run `python -m siliconsmith.matter.validate --write` to regenerate `VALIDATION.md` (measured numbers); tests are in `engine/tests/test_matter_solver.py`.

## Honest limits

* 2D plate model: no through-thickness gradients, no fins in the third dimension.
* Steady state only; no transients.
* `h` and `k` are stated inputs, not measured; convection is a constant coefficient, no airflow CFD, no radiation.
* Not validated on a printed part. Only the analytic straight fin and a grid-convergence study have been checked.
* Not yet done: analytic radial case, independently written second solver (3% threshold reserved), generators, agent loop, viewer.
* Grid convergence order of the peak temperature is not clean (observed 1.1 then 4.1 between successive levels); only the 2x-difference threshold is claimed.
