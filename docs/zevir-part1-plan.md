# ZevIR Part 1 — audit and implementation plan

Branch `nero/zevir-part1`, based on `nero/mvp-proof-engine` @ `5909447`.
Scope: Observe → canonical ZevIR graph → provenance → persistence → read APIs.
Part 2 (Diagnose, OptimizationPass, plan search, Pareto, Guard) is out of scope.

## 1. Audit of what exists

### Engine data (migrations 009–015, all applied in production except 013)

| Table | Holds | Browser access |
|---|---|---|
| `engine_products` | one connected repository or workload (`root_path workload://…`) per row; `evaluation_requirements` (014), `evaluation_trial` (015) | none (012) |
| `engine_traces` | one row per recorded model request: `request_id` (unique per product), `symbol`, `workflow`, provider/model triple, tokens, latency, TTFT, `cost_usd` + `cost_source` + `pricing_version`, `attempt`, `retry_reason`, `input_hash`/`output_hash`, `system_prompt_hash` (010), raw `input_text`/`output_text`/`system_prompt`/`messages`, `protected`, `metadata` | none |
| `engine_ai_calls`, `engine_findings`, `engine_plans`, `engine_executions`, `engine_evaluations`, `engine_implementations` | static scan, plans, replays, verdicts, patches | none |

Every engine table has a member `SELECT` policy, but migration 012 revoked every
client grant, so the browser reads nothing directly; `/api/engine/*` serves it.
012 also revoked the default privileges, so a new table gets no client grant
unless a migration adds one.

Live project `czhufhufvwvgyhjuaauo` (read-only checks on 2026-10-07): 24 engine
traces in 5 products; `pgmq` 1.5.1 and `pg_cron` are *available but not installed*.

### Telemetry normalization

`api/_lib/product/traces.js#normalizeTrace` is the only normalizer for engine
evidence. It already keeps unknown cost as `null`, labels cost provenance
(`provider_reported | pricing_snapshot_estimate | imported_external`) and hashes
input/output/system prompt (`hashing.js#sha256Text`). ZevIR reads the stored rows;
it does not re-normalize or modify them.

### Auth / workspace / service-role boundary

- `requireUser` (auth.js) resolves the Supabase JWT server-side and rejects suspended users.
- `requireWorkspaceRole(admin, ws, uid, min)` answers 404 for non-members (no enumeration).
- All writes use `adminClient()` (service role). The browser holds only the anon key + user JWT.
- `public.is_workspace_member(ws, uid)` (011) is the RLS membership predicate.

### Router and tests

- One Vercel function (`api/index.js`) imports handler modules that register routes with `on()`.
- `tests/engine-routes.test.ts` drives routes through the real router with auth mocked.
- `tests/client-boundary.test.ts` pins which tables browser code may touch.
- `supabase/tests/rls_privilege_check.sql` is a role-switched check that always aborts (safe on prod).
- Baseline before this work: 16 files, 95 tests, all passing.

### Environment constraints found

- No Docker, Supabase CLI or `psql` on this machine → no local Supabase stack.
  Disposable database = **PGlite** (Postgres 17 compiled to WASM, dev dependency),
  which enforces roles, grants and RLS (verified with a probe).
- Vercel serverless with one daily cron; there is no long-running worker.

## 2. Decisions

1. **One ZevIR graph = one execution trace.** Engine: one graph per `engine_traces`
   row. OTel/OpenInference: one graph per `trace_id`. Graphs stay small and bounded;
   cross-trace questions join on stable keys (entity-scoped nodes such as `Runtime`
   share a stable key across graphs).
2. **Deterministic identity everywhere.** Stable key = sha256 of canonical
   `[workspace_id, source_kind, source_trace_id, source_span_id, kind]`
   (entity nodes: `[workspace_id, "entity", kind, …identity]`). Graph id, node id,
   edge id and evidence id are deterministic UUIDs derived from those keys, so a
   rebuild rewrites the same rows instead of adding new ones.
3. **Atomic persistence in Postgres.** `public.zevir_persist_graphs(jsonb)` writes a
   batch of graphs in one transaction, no-ops on an unchanged `graph_hash`, refuses
   a non-superset replacement for external traces, and re-checks provenance and
   counts. `SECURITY INVOKER`, executable by `service_role` only.
4. **Cross-workspace edges are impossible by construction**: composite foreign keys
   `(graph_id, workspace_id, node_id)` on edges and evidence refs.
5. **Bounded neighborhood in SQL**: `public.zevir_neighborhood(...)`, a depth-limited
   recursive CTE (depth ≤ 6, nodes ≤ 500, overflow reported, not truncated silently).
6. **Browser may read, never write.** `SELECT` grant + member RLS on graphs, nodes,
   edges and evidence refs (they hold no raw content). `zevir_ingest_runs` stays
   server-only (operational log). No `INSERT/UPDATE/DELETE` grant to any client role.
7. **No raw content.** Adapters keep sha256 + length + mime type; content keys are
   refused by the schema and stripped by the canonicalizer. `capture_content: true`
   is rejected with `CONTENT_CAPTURE_UNSUPPORTED` in Part 1.
8. **pgmq is not enabled in Part 1.** It is available, but there is no consumer
   runtime (Vercel functions, one daily cron, `pg_cron` not installed), and enabling
   an extension on production cannot be rehearsed on a disposable Supabase here.
   Part 1 ships a bounded synchronous path with a durable, idempotent
   `zevir_ingest_runs` record. The queue migration is documented as a concrete
   follow-up in `docs/zevir-rollout.md`.
9. **Shadow mode behind a flag.** `feature_flags.zevir_shadow` (default off,
   per-workspace override via `workspace_overrides`). Off ⇒ build/ingest return
   `ZEVIR_DISABLED`; nothing in the proof loop reads ZevIR.

## 3. Exact files

### New

| Path | Purpose |
|---|---|
| `supabase/migrations/016_zevir_part1.sql` | 5 tables, CHECK enums, composite FKs, indexes, RLS, grants, `zevir_persist_graphs`, `zevir_prune_graphs`, `zevir_neighborhood`, `zevir_shadow` flag |
| `supabase/rollback/016_zevir_part1.rollback.sql` | drops everything 016 added |
| `schemas/zevir/v0.1/{graph,node,edge,evidence-ref,ingest-envelope}.schema.json` | JSON Schema 2020-12 contract |
| `api/_lib/zevir/contracts.js` | versions, enums, limits |
| `api/_lib/zevir/validate.js` | Ajv 2020 validation + graph invariants |
| `api/_lib/zevir/canonicalize.js` | draft → canonical graph, attribute sanitizer, span-tree resolution |
| `api/_lib/zevir/hash.js` | stable keys, deterministic ids, graph hash |
| `api/_lib/zevir/adapters/engine.js` | `engine_traces` → ZevIR |
| `api/_lib/zevir/adapters/otlp.js` | shared OTLP/JSON span reader |
| `api/_lib/zevir/adapters/otel-genai.js` | OpenTelemetry GenAI → ZevIR |
| `api/_lib/zevir/adapters/openinference.js` | OpenInference → ZevIR |
| `api/_lib/zevir/store.js` | ingest runs, persistence RPC, feature flag |
| `api/_lib/zevir/query.js` | read model (summaries, lists, neighborhood) |
| `api/_lib/handlers/zevir.js` | routes |
| `scripts/zevir-backfill.mjs` | deterministic backfill (dry run by default) |
| `src/product/views/ZevirPanel.tsx` | minimal inspector inside the Project view |
| `tests/zevir-{contract,adapters,db,routes}.test.ts`, `tests/zevir-panel.test.tsx`, `tests/fixtures/zevir/*`, `tests/helpers/pg.ts` | tests and PGlite harness |
| `docs/zevir-v01-schema.md`, `docs/zevir-adapter-contract.md`, `docs/zevir-security.md`, `docs/zevir-rollout.md` | documentation |

### Changed (additive only)

| Path | Change |
|---|---|
| `api/index.js` | import `handlers/zevir.js` |
| `api/_lib/handlers/engine.js` | after a trace import, best-effort shadow projection of the new traces when the flag is on; failure never fails the import |
| `src/product/engine.ts`, `src/product/types.ts` | ZevIR read/build calls (cloud engine; local engine answers "platform only") |
| `src/product/views/ProjectView.tsx` | host the panel |
| `tests/client-boundary.test.ts` | ZevIR tables in the granted/server-only sets |
| `supabase/tests/rls_privilege_check.sql` | ZevIR checks, skipped when 016 is not applied |
| `package.json` | `ajv` ^8 (runtime), `@electric-sql/pglite` (dev) |

Untouched: `api/_lib/sanitize.js` (reused, not changed), candidate generation, `evaluator.js`, gates, billing, deployment,
`engine_*` schemas and rows.
