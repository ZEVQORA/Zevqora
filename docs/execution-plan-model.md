# ExecutionPlan model

Code: `api/_lib/optimize/transformations.js`, `search.js`, `search-store.js`.
Table: `execution_plans` (018). One row per plan of one plan search.

An **execution plan** is a set of 1–3 canonical transformations, in a
deterministic composition order, proposed for one Optimization Run under its
frozen Evaluation Contract and baseline snapshot.

## Fields

| Field | Meaning |
|---|---|
| `id` | `deterministicUuid(search id, plan_hash)` |
| `workspace_id`, `product_id`, `search_id`, `run_id` | tenancy and lineage (composite FKs) |
| `contract_id`, `contract_hash`, `baseline_snapshot_id` | the frozen contract and baseline the plan is judged against |
| `plan_version`, `plan_hash` | `execution_plan_v1`; sha256 of {schema, contract hash, baseline snapshot hash, sorted transformation hashes} |
| `name` | composition labels in order (`Validated exact lookup · classify_ticket + …`) |
| `source_diagnosis_ids` | the diagnoses that produced its transformations |
| `pass_instances` | ordered transformations: kind, layer, scope, pass@version, settings, config, executable status and reason, affected requests/nodes, risk, complexity, required evidence, expected effects, falsifier, rollback, materializer hints, metadata |
| `status` | see the state machine |
| `executable_status` | `EXECUTABLE`, `NOT_EXECUTABLE` (could run, not here/now) or `NEEDS_IMPLEMENTATION` (no executor) |
| `estimated_effects` | first-order estimates, labelled ESTIMATED (search priority only) |
| `observed_calibration_effects` | latest calibration round, labelled `CALIBRATION — NOT VERIFIED` |
| `verified_effects` | plan metrics on the evaluation set, only when the verdict is VERIFIED |
| `required_evidence`, `missing_evidence` | union over the transformations |
| `risk_class`, `implementation_complexity`, `rollback_complexity` | see plan-composition.md |
| `compatibility_result`, `conflict_reasons` | compatible, conflicts, dependencies, composition order, affected nodes, shared fields, risk escalation |
| `replay_budget`, `replay_state` | calibration rounds and sample sizes, why the budget changed, metrics, rejection reason, budget notes |
| `verdict`, `evaluation_id` | the `engine_evaluations` verdict of the full replay |
| `dominance_state`, `frontier_state` | dominated by / dominates / reason; FRONTIER, DOMINATED or INCOMPARABLE |
| `materializer_hints`, `rollback` | what to change to ship it, and how to undo it (reverse order) |
| `explanation` | why it was generated (computed further at read time) |
| `engine_plan_id` | the `engine_plans` row (`strategy = 'execution_plan'`) its executions use |

Every identity is deterministic from decision-relevant data. Executable status
is not part of the hash (it depends on the deployment, e.g. platform compute).

## State machine

```
PROPOSED ──estimate──► CALIBRATION_READY ──► CALIBRATING ──┬─► CALIBRATION_REJECTED   (sound hard-gate failure)
   │                         ▲                │            ├─► PRUNED                 (no improvement on the sample)
   │                         └── larger sample┘            ├─► INCOMPLETE             (missing evidence)
   │                                                       └─► FULL_REPLAY_READY ──► REPLAYING ──► REJECTED | INCOMPLETE | VERIFIED
   ├─► BLOCKED          (any transformation not executable — a plan is never partly run)
   ├─► NEEDS_EVIDENCE   (required evidence missing)
   ├─► CONFLICTED       (incompatible composition; reason recorded)
   └─► PRUNED           (changes no request / redundant / dominated by an output-equivalent plan)

VERIFIED ──frontier──► PARETO_FRONTIER ──policy──► SELECTED
```

`CONFLICTED` and `PRUNED` are additions to the requested states, so that
"never resolved silently" and "pruned before replay" are visible states rather
than missing rows.

Database rules (018): a non-executable plan can only be PROPOSED, BLOCKED,
NEEDS_EVIDENCE, CONFLICTED or PRUNED; VERIFIED / PARETO_FRONTIER / SELECTED
require `verdict = 'VERIFIED'` and an evaluation; a frontier state requires a
VERIFIED verdict; CONFLICTED requires an incompatible result.

## Execution

An executable plan is materialized once per run as an `engine_plans` row
(`strategy = 'execution_plan'`, `candidate_config.composition` = the pass
instances). Calibration and full replay call the existing `runPlanExecution`
with the composed executor (`composed.js`); executions are ordinary
`engine_executions` (with `stage`, `execution_plan_id`, `search_id`) and
verdicts are ordinary `engine_evaluations`. The engine's own execute route
refuses `execution_plan` rows (`PLAN_REQUIRES_PLAN_SEARCH`).
