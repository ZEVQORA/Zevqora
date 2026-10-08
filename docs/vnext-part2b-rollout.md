# vNext Part 2B — rollout and rollback

Nothing here has been applied. Branch `nero/vnext-part2b` is local, not pushed,
not deployed. Migrations 016, 017 and 018 are **not** on production.

## Flags

- `verified_optimization_vnext` (017) — Part 2A; required.
- `optimization_intelligence_vnext` (018) — Part 2B; seeded **off**.

Both must be on for a workspace (`workspace_overrides = {"<id>": true}`).
Otherwise every Part 2B route answers `INTELLIGENCE_DISABLED` (403), the status
route reports `intelligence: false`, and `/app/optimize` shows the Part 2A
flow only.

## Production steps (in order, by hand, after review)

1. `list_migrations` must end at 015 (013 intentionally absent).
2. **016**: dry run, apply, verify — `docs/zevir-rollout.md`.
3. **017**: dry run, apply, verify — `docs/vnext-part2a-rollout.md`.
4. **018 dry run** (rolls back by construction; tested in PGlite):
   ```sql
   do $dry$
   begin
     -- body of 018_optimization_intelligence.sql, unchanged
     raise exception 'OPT18_DRY_RUN_OK';
   end
   $dry$;
   ```
5. Apply `018_optimization_intelligence.sql` (name `optimization_intelligence`).
   Additive: 6 tables, nullable columns on `engine_executions` and
   `engine_evaluations`, 3 unique indexes on `(id, workspace_id)` of
   `engine_plans` / `engine_executions` / `engine_evaluations`, the diagnosis
   family CHECK widened by two values, 5 functions, 1 flag row. Brief locks on
   those engine tables while indexes/columns are added (indexes are built
   non-concurrently: run in a quiet window; the tables are small today).
6. `supabase/tests/rls_privilege_check.sql` → `RLS_CHECK PASS`; `get_advisors`.
7. Deploy the application **after** 018 (the code reads the v2 graph function
   and the new diagnosis families; it falls back to the 017 graph read if the
   v2 function is missing, but the family CHECK needs 018).
8. Enable both flags for one internal workspace; load the demo
   (`POST /api/optimize/demo` with `variant: 'intelligence'`); walk contract →
   baseline → diagnoses → plan search → calibration → full replay → frontier →
   policy → Bad-Day Replay; then a real workload.
9. Model substitution plans need platform compute (OpenRouter key and
   `cloud_replay` on). Keep `max_provider_spend_usd` at its default (1 USD per
   search) for the first real runs.

## Rollback (least to most invasive)

1. Flag off (`optimization_intelligence_vnext`): the Part 2B routes and UI
   steps disappear; Part 2A is unaffected.
2. Revert the application deploy.
3. `supabase/rollback/018_optimization_intelligence.rollback.sql`: drops the six
   tables, the lineage columns, the functions, the three tenancy indexes and the
   flag; deletes materialized `execution_plan` rows (with their executions and
   evaluations, which are derived); deletes diagnoses of the two new families and
   restores 017's family CHECK. Every other plan, execution and evaluation keeps
   its pre-018 columns and verdict (tested). Export `plan_decisions` and
   `bad_day_profiles` first if they must be kept.
4. Only then, if needed, 017's rollback (tested: 018 rollback → 017 rollback →
   017 and 018 re-apply).

## Performance limits

| Limit | Value |
|---|---|
| Evidence window | newest 5000 traces; 200 ZevIR graphs in one v2 call (refuses > 500) |
| Plans per search | 64 default / 96 max; transformations 24 / 32; ≤ 3 per plan |
| Evaluation set | 60 / 100 cases |
| Calibration | 12 plans, 10 cases per plan over 2 rounds, 180 cases total |
| Full replay | 5 plans, 300 replay samples total |
| Provider spend | 1 USD per search (5 max); paid plans that do not fit are skipped and listed |
| Stage call | ≤ 25 s of work, then `continuation: true`; lease 120 s |
| Wall clock | 30 min per search (60 max) |
| Report size | ~660 KB uncompressed for 58 plans (compact plan rows; full detail on `GET /api/optimize/plans/:id`) |
| Rate limits | search start 6/min, stage calls 20/min per user |

No N+1: one trace query and one graph RPC per stage; plans read per search.

## Known gaps

- Executable transformation kinds: exact-response reuse, validated exact lookup,
  model substitution (with platform compute). Agent, retrieval, retry, prompt
  caching and context changes are proposed but not replayed.
- Requests outside the evaluation set do not populate caches in the replay
  (conservative: fewer hits).
- A logical request's cost on the evaluation set is its final attempt's cost;
  retries are modelled by Bad-Day Replay, not by plan replay.
- Cache/lookup hit latency is in-process replay time.
- Calibration samples are ordered by trace ids under the search seed: the same
  workspace and evidence always sample the same way, but two workspaces holding
  the same synthetic data sample differently.
- Bad-Day Replay does not represent tool or retrieval faults, burst/concurrency,
  or provider fallback routing.
- pgmq is still not enabled; stages are bounded synchronous calls.
