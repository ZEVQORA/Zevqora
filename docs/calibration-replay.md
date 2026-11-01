# Calibration replay and adaptive replay budget

Code: `api/_lib/optimize/calibration.js`, stage in `search-store.js`.
Table: `plan_calibrations` (018).

Calibration is a cheap, bounded replay of a plan on a deterministic sample of
the evaluation set, to decide whether it deserves full-replay budget.
**It is never a verdict.** Outcomes are `PROMISING`, `UNPROMISING`,
`INCOMPLETE`, `FAILED_HARD_GATE`; every row is labelled
`CALIBRATION — NOT VERIFIED` (a database CHECK enforces both). No calibration
writes an `engine_evaluations` row.

## Sample selection (seeded, outcome-blind)

- Units: a whole cache-key group when the plan has a response cache (a cache
  hit is only reproducible with the request that filled it), otherwise a single
  case.
- Units that the plan changes are ordered by `sha256(seed, plan hash, unit)` and
  taken in that order — never by looking at results.
- Protected cases are always included when the contract requires them
  (`protected.require_cases`), up to `max(1, min_cases)`.
- Two unchanged cases check the passthrough path.
- Round r may use `ceil(per_plan_cap × r / rounds)` cases; round 2 extends
  round 1 (same order). The sample hash covers seed, plan hash, round and ids.

## Sound early rejection

The full replay's result on unchanged cases is known exactly (the recorded
baseline); unsampled changed cases are bounded between "all fail" and "all
pass". From these bounds:

- task success floor, task-success non-regression, quality floor and
  non-inferiority: if even the best case is below the limit → certain failure;
- a protected case failing in the sample → certain failure;
- per transformation, the slice it serves: if even all unsampled served cases
  passing cannot reach the slice's baseline − tolerance → certain failure;
- a model outside the contract's allowlist → certain failure.

Only a certain failure produces `FAILED_HARD_GATE` (plan → `CALIBRATION_REJECTED`).
A single regression that the full replay could still absorb is not rejected.

## Outcome and next action (explainable rules)

| Situation | Outcome | Next |
|---|---|---|
| certain hard-gate failure | FAILED_HARD_GATE | stop |
| execution failed / no changed case sampled / cost unknown with no latency gain | INCOMPLETE | stop |
| no cost or p95 improvement on the sample | UNPROMISING | stop (PRUNED; a user may promote it) |
| improvement, projection within 0.02 of a hard limit (or below), rounds left | PROMISING | larger sample |
| improvement, still near a limit after the last round | PROMISING | full replay decides |
| improvement, projection clear of every limit | PROMISING | full replay |

The projection applies the pass rate of the sampled changed cases to the
unsampled ones. With a zero task-success tolerance, any plan that does not
regress lands exactly on the non-regression limit, so it earns the second
round — more evidence before full replay.

## Full replay

Promoted plans (by priority, up to `max_full_replay_plans`) replay the whole
evaluation set through `runPlanExecution` with the composed executor, under
the SAME frozen contract (`evaluateUnderContract`), plus the plan gates
(`evaluation_set_coverage`, `transformation_slice:<kind>:<scope>`). A composed
plan executes in its declared order; a cache in front of a substituted model
stores that model's answers. A plan that cannot execute in full is BLOCKED and
never run.
