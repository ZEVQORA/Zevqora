# ZevIR Part 1 — rollout, backfill, rollback

ZevIR Part 1 is **shadow mode**: it observes and represents execution. It does
not change candidate generation, evaluation results, gate thresholds, billing,
deployment or routing. Nothing in `api/_lib/product/*` or the engine routes reads
ZevIR; the only coupling is a best-effort, flag-gated projection after a trace
import, whose failure is logged and never fails the import.

```
existing engine ──(unchanged)──▶ VERIFIED / REJECTED / INCOMPLETE
       │
       └── shadow projection ──▶ ZevIR graphs (read-only consumers)
```

## Flag

`feature_flags.zevir_shadow` (seeded **off** by 016).
- Global: `enabled`.
- Per workspace: `workspace_overrides = {"<workspace_id>": true|false}` wins over `enabled`.
- Off ⇒ `POST …/zevir/build` and `POST /api/zevir/ingest` answer `403 ZEVIR_DISABLED`;
  the import hook does nothing; reads still answer (empty until something was built).

## Production migration steps

Do these in order, by hand, after review. Nothing here was applied by this branch.

1. **Pre-check.** `list_migrations` on project `czhufhufvwvgyhjuaauo` must end at
   `engine_evaluation_trial` (015). 013 stays unapplied (unrelated).
2. **Dry run (no writes).** Run 016 inside a transaction that always rolls back
   (see "Dry run" below) and confirm it reports success.
3. **Apply** `supabase/migrations/016_zevir_part1.sql` (Supabase `apply_migration`,
   name `zevir_part1`). Additive: 5 new tables, 3 functions, 1 flag row. It takes
   brief `SHARE ROW EXCLUSIVE` locks on `workspaces`, `projects`, `engine_products`,
   `auth.users` while foreign keys are created; no table rewrite.
4. **Verify.** Run `supabase/tests/rls_privilege_check.sql` (always aborts; read
   `RLS_CHECK PASS` from the error). Run `get_advisors` (security + performance).
5. **Deploy** the application build. Flag still off ⇒ no behaviour change.
6. **Enable for one workspace** (internal): set `workspace_overrides` for it,
   then `POST /api/engine/products/:id/zevir/build` or
   `node scripts/zevir-backfill.mjs --apply --workspace <id>`.
7. **Observe** (Project view → Execution graph; `zevir_ingest_runs`), then widen.

### Dry run

```sql
do $dry$
begin
  -- paste the body of 016_zevir_part1.sql here, unchanged
  raise exception 'ZEVIR_DRY_RUN_OK';
end
$dry$;
```

`ZEVIR_DRY_RUN_OK` means every statement succeeded and everything was rolled
back. (016 uses `$$` tags internally, so the outer `$dry$` tag does not clash.)

## Backfill

`scripts/zevir-backfill.mjs` reuses the build path, so it is deterministic and
idempotent: a second run reports every product unchanged.

```
node scripts/zevir-backfill.mjs                          # dry run, counts only
node scripts/zevir-backfill.mjs --apply --workspace <id> # one workspace
node scripts/zevir-backfill.mjs --apply                  # all non-archived products
```

It reads `engine_traces` (no raw text columns), writes only `zevir_*`, and prunes
projections whose engine trace no longer exists. It never mutates engine tables.

## Rollback

From least to most invasive:

1. **Flag off** (`update feature_flags set enabled = false, workspace_overrides = '{}' where key = 'zevir_shadow'`).
   Immediate; builds, ingests and the import hook stop. Stored graphs remain readable.
2. **Revert the application deploy.** The proof loop never depended on ZevIR.
3. **Drop the schema**: `supabase/rollback/016_zevir_part1.rollback.sql`.
   Loses only derived projections (rebuildable from `engine_traces`) and external
   ingest history. Do this after step 2, or the ZevIR routes will answer 500.

## Ingestion reliability and the queue (pgmq)

Part 1 ingests synchronously within a request, bounded by the limits in
`docs/zevir-security.md`, with a durable `zevir_ingest_runs` row per request and
an idempotency key (client `Idempotency-Key` header or a payload hash). A retry
of a failed or abandoned (> 5 min) run takes it over; an identical completed run
is returned without writing.

**pgmq was not enabled** — concrete blockers, checked against the live project:
- `pgmq` 1.5.1 is available but not installed; enabling an extension on
  production could not be rehearsed (no local Supabase/Docker here; PGlite has no pgmq).
- There is no consumer runtime: the API is Vercel functions with one daily cron,
  and `pg_cron` is not installed either.

Queue migration when needed: (1) `create extension pgmq` in a migration,
`pgmq.create('zevir_ingest')`, revoke `pgmq` schema access from `anon` and
`authenticated`; (2) `POST /api/zevir/ingest` claims the run, stores the batch on the
queue and returns `202` with the run id; (3) a consumer (Vercel cron every minute,
or `pg_cron` + an Edge Function) reads with a visibility timeout and calls the same
`ingestExternal` path — already idempotent per run id and graph hash; (4) archive on
success, dead-letter after N reads.

## Known gaps (Part 1)

- No cross-batch span assembly; partial re-sends become `conflict`.
- `USES, PROVIDES_CONTEXT, ROUTES_TO, REPLACES, LOCATED_AT` defined, not emitted.
- No content capture; digests of low-entropy content are guessable (see security doc).
- OTel cost, reasoning tokens, TTFT and MCP authorization scope are not mapped.
- The Project-view inspector lists the latest 50 graphs; there is no graph visualization.
- Desktop local engine does not build ZevIR (platform only).

Part 2 (diagnosis, optimization passes, plan search, Pareto selection, Guard) is
not started and needs explicit founder approval.
