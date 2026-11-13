# Proof Loop Report — 2026-11-04

> **FIXTURE PROOF — SYNTHETIC DEMO WORKLOAD — NOT CUSTOMER DATA — NOT REAL-CUSTOMER VALIDATION.**
> No authorized real workload was available. This proves that the decision machinery produces honest verdicts on real
> execution paths. It says nothing about savings on any real system. Nothing was deployed; no provider was called.

## 1. What ran

`tests/proof-loop-fixture.proof.ts` (`npm run test:proof-loop`), source commit `2e0f8789685a9bc91620eff2894d54042c771c20`,
2026-11-04T09:29Z, Node 24.18.0. It drives the real HTTP router and handlers (`api/_lib/router.js`, `engine`, `zevir`,
`optimize`, `optimize-search`), the real executors, evaluator, plan search, Pareto and decision code, and the real SQL
migrations 009–020 (with their immutability triggers) on PGlite (Postgres 17 in-process). Only the JWT check is mocked.
The loop runs **twice on two independent databases** in one test.

| Stage | Real path | Result (run 1) |
|---|---|---|
| Observe | `POST /api/optimize/demo` (variant `intelligence`) | 32 LLM traces, 6 ZevIR graphs (agent spans), labelled `SYNTHETIC DEMO — NOT CUSTOMER DATA` |
| Baseline | contract draft → **freeze** → run → `POST …/baseline` | completeness `complete`, 32 traces, quality 0.966667, task success 0.966667; snapshot carries the frozen contract hash |
| Diagnose | `POST …/diagnoses` | 7: agent_workflow, context_amplification, model_overprovisioning, redundant_call ×2, retrieval_redundancy, retry_amplification |
| Plan | `POST …/searches` | 58 plans: 18 calibration-ready, 28 blocked, 9 conflicted, 2 need evidence, 1 pruned; evaluation set 29 requests (coverage 0.966667; 1 excluded `cost_unknown`) |
| Replay | calibrate, then full replay, until done | calibration stopped at `max_calibration_plans = 12`, full replay at `max_full_replay_plans = 5`; **0 provider calls** |
| Verify | `engine_evaluations` under the same frozen contract | **3 VERIFIED, 2 REJECTED** (+1 rejected in calibration) |
| Human review | `POST …/decision {policy: MARGIN_FIRST}` | SELECTED a VERIFIED frontier plan; realized production result `NOT YET MEASURED`; **0 implementations created; nothing deployed** |

## 2. Frozen parameters

- Contract (`DEMO_V2_REQUIREMENTS`, `dataset_version: demo-synthetic-v2`): quality floor 0.95, tolerance 0; task success ≥ 0.95,
  tolerance 0; latency required, p95 regression ≤ 10 %; protected slice required, ≥ 2 cases, no protected regression;
  cost evidence required, coverage ≥ 0.9, improvement required; evidence ≥ 5 samples, ≥ 20 latency samples, outcome coverage ≥ 0.8;
  reliability failure rate ≤ 5 %; required metrics cost, latency, protected, quality, reliability, task_success.
- Search bounds (budget): 64 generated plans, 12 calibration plans, 2 calibration rounds, 10 samples/plan, 180 calibration samples,
  5 full-replay plans, 300 replay samples, evaluation set ≤ 60, provider spend ≤ $1.00 (spent $0), wall clock 30 min. Seed: default.
- Grading: classification against the recorded label per case; protected cases must keep the baseline path.
- Every evaluation row carries the frozen `contract_hash` and the run id (asserted).

## 3. Verdicts (identical in both runs this execution)

| Verdict | Plan | Quality | Task success | Cost Δ | CPSO Δ | Failed required gates |
|---|---|---|---|---|---|---|
| VERIFIED | Validated exact lookup · route_refund + Exact reuse (no expiry) · classify_ticket | 0.9655 | 0.9655 | −59.2 % | −59.2 % | none |
| VERIFIED | Validated exact lookup · classify_ticket + Validated exact lookup · route_refund | 0.9655 | 0.9655 | −59.2 % | −59.2 % | none |
| VERIFIED | Validated exact lookup · classify_ticket + Exact-response cache (TTL 1h) · route_refund | 0.9655 | 0.9655 | −52.3 % | −52.3 % | none |
| **REJECTED** | Exact reuse (no expiry) · classify_ticket + Exact reuse (no expiry) · route_refund | 0.8966 | 0.8966 | **−62.8 %** | −59.9 % | quality_floor, non_inferiority, task_success_floor, task_success_non_regression, transformation_slice:exact_response_reuse:route_refund |
| **REJECTED** | Validated exact lookup · classify_ticket + Exact reuse (no expiry) · route_refund | 0.8966 | 0.8966 | **−62.8 %** | −59.9 % | same five |

The REJECTED plans are the **cheapest** ones: they reuse the first (wrong) answer to a refund request. They are not on the
frontier, cannot be selected, and their savings are never reported. MARGIN_FIRST selected
"Validated exact lookup · route_refund + Exact reuse (no expiry) · classify_ticket" (evaluated CPSO −59.2 % on the
evaluation set; production result explicitly NOT YET MEASURED).

**INCOMPLETE** — the same 32 traces with every recorded outcome removed:
- baseline completeness `incomplete`, task success `null`;
- plan search: evaluation set 0 (excluded `outcome_unknown`, `cost_unknown`), 0 verified, 0 rejected, no recommendation;
- candidate replay (exact reuse): **INCOMPLETE**, failed required gates **none**, missing: minimum_samples, non_inferiority,
  protected_minimum, protected_slice, quality_floor, task_success_floor, task_success_non_regression; candidate quality `null`.

## 4. Defect found by this loop and fixed

Before `1c89dc8`, the candidate-replay path graded unlabelled cases 0: `quality_floor` and `task_success_floor` **failed**,
`minimum_samples` **passed** on cases nobody can judge, and with a contract that does not require protected cases the verdict
was **REJECTED** (reproduced: `expected 'REJECTED' to be 'INCOMPLETE'`). An invented failure is as wrong as an invented pass.
Fix: a classification case without a recorded label is `unknown` (score null) and is excluded from quality, task success,
protected counts and slice regressions. Regression: `tests/unlabelled-evidence-verdict.test.ts`. The plan-search path already
excluded such traces (`outcome_unknown`).

## 5. Reproducibility and limitations

- **Identical across the two runs (asserted):** observed workload, frozen contract, baseline, diagnoses, generated plans,
  evaluation set, replay budget use, human-review outcome, INCOMPLETE path — `invariant_sha256`
  `ac50f86d6516a482bf0ba3a9ffba63bb722a771d56773b42375f392800ca0343` (the same value in every execution today).
- **Plans replayed in both runs get identical verdicts and metrics (asserted).**
- **Known limitation (recorded, not hidden):** *which* plans are calibrated and promoted to full replay can differ between two
  imports of the same workload. Calibration sampling ranks by `sha256(seed, plan_hash, unit)` and plan hashes / units contain
  database-generated ids. In earlier executions today one run verified 4 plans and the other 2, with the same selected plan and
  CPSO. Within one search everything is stored and replayable (`sample_ids`, `sample_hash`). Making promotion content-addressed
  is a plan-search version change (NEXT, not done).
- Synthetic workload, deterministic replay (exact reuse / lookup); no model calls, so no live-provider variance is exercised.
- Agent and retrieval changes are proposed but BLOCKED (the harness cannot replay them), by design.
- PGlite with a reduced platform schema (see `tests/helpers/pg.ts`), not the hosted Supabase stack. The same demo previously
  produced VERIFIED and REJECTED on staging through the deployed API (`12-LAUNCH-STATUS.md`, 2026-11-01); not re-run today (Gate 1 blocked).

## 6. Artifacts and commands

- Artifact: `docs/handoff/artifacts/proof-loop-2026-11-04.json` — SHA-256 `7ea053fd7024ea1ed4155c12169835a4ca73fbaff290f2f017cc5a65269a8605`
  (LF bytes as committed). Contains per-section invariant hashes and per-run bound hashes (contract, baseline snapshot, search,
  evaluation set, frontier, selected plan, replayed plan hashes).
- Section hashes: observe `11f3881c…`, frozen_contract `d2569877…`, baseline `b6002886…`, diagnose `4e835338…`, plan `17377b30…`,
  replay `f7d4560d…`, human_review `628608e2…`, incomplete `6fcf8924…`.
- Reproduce:
  ```
  git checkout cto/release-gates-audit-2026-11-04
  npm ci --no-audit --no-fund
  PROOF_LOOP_OUT=proof-loop.json npm run test:proof-loop      # PowerShell: $env:PROOF_LOOP_OUT='proof-loop.json'; npm run test:proof-loop
  node -e "console.log(require('./proof-loop.json').reproducibility.invariant_sha256)"   # expect ac50f86d…
  ```
