# Plan search

Code: `api/_lib/optimize/search.js` (generation), `search-store.js`
(persistence, stages), `replay-model.js` (shared cache/lookup semantics).
Table: `plan_searches` (018).

## Inputs and identity

A search belongs to one Optimization Run: its frozen contract, its baseline
snapshot (re-verified: `EVIDENCE_CHANGED` otherwise) and its diagnoses.
`search_hash` = sha256 of {search version, contract hash, snapshot hash, sorted
diagnosis hashes, pass ids@versions, bounds, seed}. Starting the same search
again returns the existing one (`unique(run_id, search_hash)`), so plans are
never duplicated, including under concurrent starts.

## Evaluation set W

The frozen set every plan is judged on: final attempts with a recorded output,
a gradable expectation, known cost and known latency. Exclusions are listed
with reasons (`cost_unknown`, `outcome_unknown`, …). Above
`max_evaluation_set`, a seeded, outcome-blind selection keeps protected cases
first. Coverage = eligible / final requests and is a required plan gate
(`evaluation_set_coverage`). Requests a plan does not change run the unchanged
path: their recorded baseline result (`baseline_passthrough`). That is what
makes CPSO, p95 and task success comparable between plans.

## Generation (bounded, deterministic)

1. Rank diagnoses (severity, confidence, hash); keep `max_diagnoses`.
2. Every pass proposes transformations for each kept diagnosis (≤ `max_proposals_per_pass`).
3. Canonicalize and merge; keep `max_transformations` (executable first).
4. Single-transformation plans.
5. Pairs among composable transformations (executable, or blocked only by the environment, with evidence).
6. Triples only where all three pairs are compatible.
7. Conflicts become CONFLICTED plans with reasons.
8. Dedupe by plan hash.
9. First-order estimates.
10. Sound pruning (below).

Generation stops at `max_generated_plans`; the number of compositions not
generated is reported (`truncation_note`). No Cartesian product beyond triples.

## First-order estimates (prioritisation only)

`servingSimulation` decides, request by request in time order and in
composition order, which path would serve each evaluation case — the same
rules the replay uses. From it: known cost (recorded costs; list prices for
substituted calls), cost change, provider calls removed, input tokens sent,
provider concentration (HHI) and an upper bound on replay spend. Each estimate
has `source`, `method`, `coverage`, `confidence`, `assumptions` and the label
ESTIMATED. Latency, CPSO, task success and retry amplification are **not
estimated**: they stay `null` / UNKNOWN until a replay.

## Sound pruning before replay

- A plan that changes no evaluation request → PRUNED.
- A composition where one transformation would serve no request → PRUNED (redundant).
- A plan is dominated before replay **only** when another plan serves every
  request the same way (same path and same answer source on every case: so
  quality, task success, cost and latency are identical) with lower or equal
  risk and complexity and strictly lower on one. Plans with different answers
  are never pruned against each other.

## Priority

Calibration order: largest estimated known saving first (unknown last), then
lower risk, lower complexity, hash.

## Bounds

| Bound | Default | Hard max |
|---|---|---|
| max_diagnoses | 8 | 12 |
| max_proposals_per_pass | 3 | 3 |
| max_transformations | 24 | 32 |
| max_transformations_per_plan | 3 | 3 |
| max_generated_plans | 64 | 96 |
| max_calibration_plans | 12 | 16 |
| max_calibration_samples_per_plan | 10 | 16 |
| max_calibration_samples_total | 180 | 300 |
| calibration_rounds | 2 | 2 |
| max_full_replay_plans | 5 | 8 |
| max_evaluation_set | 60 | 100 |
| max_replay_samples_total | 300 | 600 |
| max_provider_spend_usd | 1.00 | 5.00 |
| max_wall_clock_ms | 30 min | 60 min |

Unknown bound keys and out-of-range values are refused (422).

## Stages, budgets and resumability

- `POST …/calibrate`, `POST …/replay`: bounded synchronous slices (≤ 25 s of
  work per call), persisted state, `continuation: true` until `done`.
- One stage at a time per search: an expiring database lease
  (`plan_search_lock`, 120 s) → `STAGE_IN_PROGRESS` for a concurrent call.
- Executions are idempotent on their execution key (plan, config, sample
  scope, baseline evidence): a refresh or retry reuses the execution instead of
  paying again. A RUNNING execution older than 15 minutes is marked failed and
  re-run.
- Budgets: calibration plans / samples and full-replay plans stop that stage
  and are reported (`SEARCH_BUDGET_EXHAUSTED`, with the plans not evaluated);
  replay samples and wall clock end the search (`budget_exhausted`, frontier
  over what was verified, labelled partial); provider spend skips paid plans
  that do not fit (listed in `spend_skipped`) while free deterministic plans
  continue. Spend becomes unmeasurable if a provider call has no known cost;
  then no further paid replay runs.
- Cancel: terminal; the database refuses any later status change.
