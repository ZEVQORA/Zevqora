# vNext Part 2A — rollout and rollback

Nothing here has been applied. Branch `nero/vnext-part2a` is local, not pushed,
not deployed. Migrations 016 and 017 are **not** on production.

## Flag

`feature_flags.verified_optimization_vnext` — seeded **off** by 017.
Enable per workspace only: `workspace_overrides = {"<workspace_id>": true}`.
All `/api/optimize/*` routes return `OPTIMIZE_DISABLED` (403) otherwise; the
status route returns `enabled: false`; the "Optimize" nav item is hidden (per-workspace
`features` from `/api/me`). ZevIR keeps its own `zevir_shadow` flag; building a
run's baseline projects that one product into ZevIR regardless, because
diagnoses reference ZevIR nodes.

## Production steps (in order, by hand, after review)

1. `list_migrations` on `czhufhufvwvgyhjuaauo` must end at 015 (013 intentionally absent).
2. **016** dry run, apply, verify — exactly as in `docs/zevir-rollout.md`.
3. **017 dry run** (rolls back by construction):
   ```sql
   do $dry$
   begin
     -- body of 017_verified_optimization.sql, unchanged
     raise exception 'OPT_DRY_RUN_OK';
   end
   $dry$;
   ```
   Expect `OPT_DRY_RUN_OK` (tested in PGlite).
4. Apply `017_verified_optimization.sql` (name `verified_optimization`). Additive:
   4 tables, nullable columns on 3 engine tables, 1 unique index on
   `engine_products(id, workspace_id)`, 4 functions, 1 flag row.
   Brief locks on `engine_products`, `engine_plans`, `engine_executions`,
   `engine_evaluations` while columns/constraints are added (no rewrite: all new
   columns are nullable without defaults; the CHECK on `engine_plans` is
   satisfied by existing rows because `executable_status` is NULL).
5. Run `supabase/tests/rls_privilege_check.sql` → `RLS_CHECK PASS`; `get_advisors`.
6. Deploy the application with the flag still off. Verify `/api/optimize/products/:id`
   answers `enabled: false`.
7. Enable for one internal workspace, load the demo (`POST /api/optimize/demo`),
   walk the flow end to end, then a real workload.

## Rollback (least to most invasive)

1. Flag off (`workspace_overrides = '{}'`, `enabled = false`): routes and nav disappear.
2. Revert the application deploy. The proof loop never depended on 017; the engine
   execute route's shared function behaves exactly as before.
3. `supabase/rollback/017_verified_optimization.rollback.sql` drops the four tables,
   the lineage columns, the functions and the flag. Existing plans, executions and
   evaluations keep every pre-017 column and verdict (tested). Export
   `evaluation_contracts` first if contracts must be kept. 016 is untouched.

## Performance limits

| Limit | Value |
|---|---|
| Evidence window | newest 5000 traces per product (truncation reported) |
| ZevIR graphs per analysis | 200 (one SQL call, `zevir_product_graph_set`, refuses > 500) |
| Candidates per diagnosis | 3 |
| Diagnosis refs | 50 affected nodes / 50 evidence refs |
| Replay | engine limits: ≤ 10 samples for model substitution, budgeted |
| Rate | baseline 10/min, replay 6/min per user |

No N+1: traces in one query, graphs+nodes+edges in one RPC.

## Known gaps

- Only `exact_reuse` and (with platform compute) `model_substitution` can be replayed;
  retry policy, prompt caching and context capping are delivered as
  NEEDS_IMPLEMENTATION candidates.
- Latency critical path needs span timestamps; engine-only workloads get per-node
  latency, not root share.
- Reuse replay latency is the in-process reuse path (≈0 ms); a real cache adds lookup time.
- Baseline quality/task success depend on `expected_output` or reported outcomes.
- No fault injection (bad-day profile is observed history); no realized-savings
  measurement; no plan composition/search (Part 2B+).
- pgmq still not enabled (see `docs/zevir-rollout.md`).
