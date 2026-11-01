# vNext Part 2B — Optimization Intelligence Engine: audit and plan

Branch `nero/vnext-part2b`, from `nero/vnext-part2a` @ `ef63cec` (Part 2A's six local
commits `9ae2625 36cce52 db2ff8c b35c946 81e5977 ef63cec` verified present). Baseline
before any edit: typecheck, lint, build and `verify:release` green; 25 files / 273
tests pass. Not pushed, not deployed; migrations 016/017/018 not applied to production.

## 1. What exists (audit)

| Area | Today (Part 1 + 2A) | What Part 2B does with it |
|---|---|---|
| Evidence | `engine_traces` window (≤ 5000) + ZevIR graph set via `zevir_product_graph_set` (ids, kinds, timing; no attributes) | Same window. A v2 graph-set read adds node attributes that are already content-free (digests, document ids, tool names) so agent and retrieval structure can be diagnosed. |
| Contract | Frozen, hashed, immutable (`evaluation_contracts`) | Unchanged. Every stage (estimate, calibration, full replay, bad-day) is judged against the run's frozen contract. |
| Baseline | `performance_snapshots` + evidence-drift check (`EVIDENCE_CHANGED`) | Unchanged; every search stage re-verifies it. |
| Diagnoses | 5 families, `diag_v0.1`, hashed | +2 structural families (`agent_workflow`, `retrieval_redundancy`) that only fire on Agent/ToolCall/Retrieval nodes. The 5 existing families and their hashes are untouched. |
| Passes | 4 passes → `engine_plans` candidates (Part 2A route) | Kept as-is for the Part 2A route. +4 passes. Every pass also emits **canonical transformations** for plan search. |
| Execution | `run-plan.js` → `executor.js` (`exact_reuse`, `model_substitution`) | Same function. A composed-plan executor is passed in for `execution_plan` rows; per case it delegates to the existing sample executors. The engine execute route refuses `execution_plan` rows. |
| Verdict | `evaluateUnderContract` (existing evaluator + appended contract gates) | Same function. Plan gates (evaluation-set coverage, per-transformation slice non-regression) are appended: stricter only. |
| UI | `/app/optimize`, 6 steps | Evolves to 9 steps: contract, baseline, diagnoses, plan search, calibration, full replay, Pareto frontier, selected plan, report. Part 2A candidates of older runs still render. |

## 2. Decisions

1. **ExecutionPlan is a first-class row** (`execution_plans`) owned by a **plan search**
   (`plan_searches`) inside an Optimization Run. A plan is a set of canonical
   transformations in a deterministic composition order; `plan_hash` is computed from
   decision-relevant data only (contract hash, baseline snapshot hash, canonical
   transformations), so proposal order never changes it.
2. **No second execution or verdict system.** An executable plan is materialized as one
   `engine_plans` row (`strategy = 'execution_plan'`); calibration, full replay and the
   executions they create are ordinary `engine_executions` (with `stage`) and verdicts
   are ordinary `engine_evaluations`. Calibration results never become evaluations.
3. **One evaluation set per search.** Plans are compared on the same frozen,
   deterministic evaluation set W (final attempts with recorded output, a gradable
   expectation and known cost; exclusions are listed; coverage is a required gate).
   Cases a plan does not change run the unchanged path: the recorded baseline result
   (`baseline_passthrough`, labelled). That is what makes CPSO, p95 and task success
   comparable across plans.
4. **Composition is replayed in order with state.** A cache in front of a smaller model
   stores what the smaller model returned in this replay, not the baseline's answer.
   A plan with any non-executable transformation is BLOCKED; it is never partly run.
5. **Executable transformations today:** exact-response reuse (with or without TTL),
   exact validated lookup (deterministic replacement), model substitution (platform
   compute only). Everything else is proposed with full metadata and stays BLOCKED
   (`NOT_EXECUTABLE` / `NEEDS_IMPLEMENTATION`).
6. **Search is bounded and staged**: proposals → canonicalize → singles → bounded pairs
   → bounded triples → conflicts → dedupe → first-order estimates → estimate-dominance
   pruning (only when the comparison is valid) → calibration → adaptive replay budget →
   full replay → Pareto frontier → decision policy.
7. **Calibration can reject early only when it is sound**: the full replay could not pass
   a hard gate whatever the unsampled cases do (bounds computed from known passthrough
   results). Calibration is never VERIFIED.
8. **Pareto frontier over VERIFIED plans only**; unknown on a compared dimension makes
   the comparison incomplete, never better or worse. Decision policies are explicit
   lexicographic rules over the frontier; they cannot reach a non-frontier plan
   (code + database trigger).
9. **Bad-Day Replay** is a deterministic fault overlay on a plan's own replay results
   and the recorded baseline (no provider call, no production traffic). Its verdict is
   stored separately and labelled `BAD-DAY REPLAY`.
10. **Budgets and resumability**: per-search bounds and spend; bounded synchronous
    stages with a database lock, persisted state, idempotent executions and an explicit
    continuation; `SEARCH_BUDGET_EXHAUSTED` and `cancelled` are terminal and explained.
11. **Demo**: a second synthetic workload (`SYNTHETIC DEMO — NOT CUSTOMER DATA`) adds an
    agent loop with repeated tool calls and duplicated retrieval to the Part 2A triage
    traces. The Part 2A demo is unchanged.

## 3. Files

New
- `supabase/migrations/018_optimization_intelligence.sql`, `supabase/rollback/018_optimization_intelligence.rollback.sql`
- `api/_lib/optimize/{transformations,search,composed,calibration,pareto,badday,plan-verdict,search-store,intelligence}.js`
- `api/_lib/handlers/optimize-search.js`
- tests `tests/plan-*.test.ts`, `tests/plan-search-{db,acceptance}.test.ts`, view test additions
- docs: this plan, `execution-plan-model.md`, `plan-composition.md`, `plan-search.md`,
  `calibration-replay.md`, `pareto-frontier.md`, `agent-workflow-pass.md`,
  `retrieval-pass.md`, `cache-pass.md`, `deterministic-replacement-pass.md`,
  `bad-day-replay.md`, `vnext-part2b-rollout.md`

Changed (additive)
- `api/_lib/optimize/passes.js` (+4 passes, transformation emitters; Part 2A
  `generateCandidates` unchanged), `diagnose.js` (+2 structural families), `demo.js`
  (v2 workload), `store.js` (extended evidence read), `report.js` (search summary)
- `api/_lib/product/run-plan.js` (injectable executor; refuses `execution_plan` rows
  without it), `api/index.js`
- `src/product/optimize.ts`, `src/product/views/OptimizeView.tsx` (+ plan views)
- `tests/helpers/pg.ts` (apply 018), `tests/client-boundary.test.ts`, `supabase/tests/rls_privilege_check.sql`

Untouched: `evaluator.js`, `executor.js`, `strategies.js`, graders, billing, Part 1 ZevIR
identity/hash/privacy, the Part 2A diagnosis families and their hashes.
