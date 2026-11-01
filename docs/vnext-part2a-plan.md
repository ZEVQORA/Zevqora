# vNext Part 2A — Verified Optimization Run: audit and plan

Branch `nero/vnext-part2a`, from `nero/zevir-part1` @ `95eb0dd` (Part 1's six local
commits verified present). Baseline before any edit: typecheck, lint, build,
verify:release green; 21 files / 202 tests pass. Not pushed, not deployed;
migrations 016/017 not applied to production.

## 1. What exists (audit)

| Area | Today | Part 2A use |
|---|---|---|
| Project floor | `engine_products.evaluation_requirements` (014): quality_floor, min_samples, require_protected_cases, require_latency, max_latency_regression_pct; `enforceRequirements` makes it a floor | Kept. The Evaluation Contract maps onto the same gate config and the project floor is still applied on top (`max` of both). |
| Plans | `engine_plans` via `strategies.js`: `exact_reuse` (deterministic, no provider), `model_substitution` (platform provider, budgeted), `bounded_routing` (always BLOCKED) | Candidates are `engine_plans` rows with additive lineage columns. Only the two executable strategies can ever run. |
| Execution | `executor.js#executePlan`, inline in `POST …/optimization/plans/:planId/execute` | Same executor; the route body is extracted into one shared function both routes call. |
| Evaluation | `evaluator.js#runEvaluation` → `evaluateGates` → `decideStatus` (VERIFIED/REJECTED/INCOMPLETE) | Called unchanged. Contract gates are **appended**; adding required gates can only make a verdict stricter, so existing semantics hold. |
| Graders | deterministic (classification / exact / required facts); read raw output server-side, persist scores | The only place raw text is read for quality / task success (the existing evaluation boundary). |
| Task success | not a trace field | Explicit `metadata.task_success`/`outcome`, else graded pass against `expected_output`, else **unknown**. |
| Retries | `attempt`, `retry_reason` columns; no logical-request link | `metadata.logical_request_id` groups attempts; without it each trace is its own request. |
| ZevIR | per-trace graphs (Part 1), behind `zevir_shadow` | Read through one bounded SQL call for latency/critical-path and node references. Still decides nothing on its own. |
| Pricing | `model_pricing.tier`, `tierOf`, `cheaperCandidateFor` | ModelOverprovisioning evidence and ModelProviderPass candidate. |
| Flags | `/api/me` resolves `plan_overrides` only | Adds a per-workspace `features` map so the nav can respect `workspace_overrides`. |
| UI | `src/product/*` views, `AppRoutes` under `/app` | New `/app/optimize` view inside the product layout. |

## 2. Decisions

1. **One new product concept: the Optimization Run** (`optimization_runs`). It binds one product, one frozen contract (by id + hash), one baseline snapshot, its diagnoses, candidates (`engine_plans`), executions and evaluations.
2. **Evaluation Contract** (`evaluation_contracts`): versioned; `draft → frozen → superseded`; frozen rows are immutable in the database (trigger), a new version supersedes the old one; at most one draft and one frozen contract per product.
3. **Verified Performance Snapshot** (`performance_snapshots`): deterministic metrics over a bounded evidence window (latest 5000 traces); nearest-rank percentiles; unknown stays null; CPSO only above contract coverage thresholds.
4. **Zev Diagnose v0.1** (`optimization_diagnoses`): five deterministic families, hashed, with evidence refs to engine traces and ZevIR nodes. No LLM.
5. **OptimizationPass v0.1**: a plain object interface, four passes. RedundantCall → `exact_reuse` (executable); ModelProvider → `model_substitution` (executable when platform compute is configured, else NOT_EXECUTABLE); RetryAmplification and ContextMemory → `NEEDS_IMPLEMENTATION` (never run).
6. **Verdict under contract**: replay request bodies cannot supply gates; only the frozen contract (plus project floor) decides.
7. **Flag** `verified_optimization_vnext`, default off, workspace override only. ZevIR keeps its own flag; building a run's baseline projects that product into ZevIR because diagnoses reference it.
8. **Server-only tables**: the four new tables get RLS + member SELECT policy but **no client grant** (same model as `engine_*`); every hostile default grant is revoked explicitly.
9. **Demo**: one synthetic workload labelled `DEMO / SYNTHETIC — NOT CUSTOMER DATA`, loadable per workspace behind the flag; it produces a REJECTED and a VERIFIED `exact_reuse` candidate honestly through the real executor and evaluator.

## 3. Files

New
- `supabase/migrations/017_verified_optimization.sql`, `supabase/rollback/017_verified_optimization.rollback.sql`
- `api/_lib/optimize/{contract,performance,latency,diagnose,passes,verdict,store,report,demo}.js`
- `api/_lib/product/run-plan.js` (execute path shared by the engine route and the run replay)
- `api/_lib/handlers/optimize.js`
- `src/product/optimize.ts`, `src/product/views/OptimizeView.tsx`
- tests `tests/optimize-{core,db,acceptance}.test.ts`, `tests/optimize-view.test.tsx`, harness `tests/helpers/routes.ts` (the demo workload lives in `api/_lib/optimize/demo.js`)
- docs: this plan, `verified-performance.md`, `evaluation-contract.md`, `zev-diagnose-v01.md`, `optimization-pass-v01.md`, `optimization-run-product.md`, `vnext-part2a-rollout.md`

Changed (additive)
- `api/index.js` (register handler), `api/_lib/handlers/engine.js` (execute route calls the extracted function; behaviour unchanged)
- `api/_lib/handlers/me.js` (per-workspace `features`)
- `src/app/AppRoutes.tsx`, `src/app/AppShell.tsx`, `src/app/CommandPalette.tsx` (route + flag-gated nav item), `src/lib/types.ts`
- `tests/helpers/pg.ts` (apply 017, billing lookups, ESM-portable paths), `tests/client-boundary.test.ts`, `supabase/tests/rls_privilege_check.sql`

Untouched: `evaluator.js` gates and `decideStatus`, `executor.js`, `strategies.js`, graders, billing (`platform-compute.js`), Part 1 ZevIR identity/hash/privacy.
