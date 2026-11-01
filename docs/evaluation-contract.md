# Evaluation Contract

The success criteria a team freezes **before** an optimization result is known.
Code: `api/_lib/optimize/contract.js`. Table: `evaluation_contracts` (017).

## Lifecycle

```
draft ──freeze──▶ frozen ──(next version frozen)──▶ superseded
```

- A product has at most one draft and one frozen contract (partial unique indexes).
- A draft can be edited freely; every save recomputes the hash.
- Freezing is atomic (`evaluation_contract_freeze`): the previous frozen contract
  becomes `superseded` (with `superseded_by`) and the draft becomes `frozen`, in one
  transaction. The caller passes the hash it computed from the stored draft; a
  draft changed in between fails with `CONTRACT_HASH_MISMATCH`.
- A frozen or superseded contract **never changes**. A database trigger refuses any
  update except `frozen → superseded`, and refuses deletes (except when the row
  goes away with its product/workspace by FK cascade). A change is a new version.
- An Optimization Run binds one **frozen** contract by id and hash (trigger
  `optimization_runs_bind_contract`); a run can never switch contract.

## Fields (all decision-relevant)

| Field | Meaning | Gate it drives |
|---|---|---|
| `quality_floor` (0.5–1) | minimum candidate quality | `quality_floor` (existing) |
| `quality_tolerance` | allowed quality drop vs baseline | `non_inferiority` (existing) |
| `min_task_success_rate` | minimum share of replayed cases passing all graders | `task_success_floor` |
| `task_success_tolerance` | allowed task-success drop vs baseline | `task_success_non_regression` |
| `latency.require`, `max_p95_ms`, `max_regression_pct` | absolute p95 budget and/or p95 regression vs baseline | `latency_p95`, `latency_p95_regression`, `latency_regression` (existing, mean) |
| `protected.require_cases`, `min_cases` | protected coverage | `protected_slice` (existing), `protected_minimum` |
| `cost.require_evidence`, `min_coverage` | share of cases with known cost on each side | `cost_coverage` |
| `cost.require_improvement`, `min_improvement_pct` | candidate must cost less | `cost_improvement` (existing) |
| `evidence.min_samples` | minimum evaluated cases | `minimum_samples` (existing) |
| `evidence.min_latency_samples` | below this a latency figure is flagged LOW EVIDENCE | flag only |
| `evidence.min_outcome_coverage` | share of requests with a known outcome needed for CPSO | baseline CPSO availability |
| `required_metrics` | `cost, latency, quality, task_success, reliability, protected` | turns the related gates on |
| `reliability.max_failure_rate`, `max_retry_rate` | replay failure ceiling | `reliability_failure_rate` |
| `allowed_providers`, `allowed_models` | candidate restrictions | `model_allowlist`; ModelProviderPass applicability |
| `policy.no_protected_regression`, `require_data_boundary` | security/policy requirements | recorded; protected failures already reject |
| `dataset_version` | workload/dataset version the contract applies to | identity |

Unknown keys are refused, so a typo can never silently drop a gate. A latency
requirement needs at least one of `max_p95_ms` / `max_regression_pct`; requiring
`task_success` needs `min_task_success_rate`.

## Hash

`contract_hash = sha256(canonical JSON {schema: "contract_v1", product_id, requirements})`
over the fully normalized requirements (lists sorted). Version numbers and
timestamps are not decisions, so identical contracts hash identically; changing
any field above changes the hash (tested for every field).

## Relationship to the project floor (014)

`engine_products.evaluation_requirements` remains a floor. A first draft is seeded
from it, and at evaluation time the gate config is
`enforceRequirements(contractGateConfig(contract), project_floor)` — the stricter
of the two wins. A replay request cannot carry gate thresholds at all.
