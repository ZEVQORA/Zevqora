# Supabase production cut-over plan (NOT executed)

**CEO decision 2026-11-13:** the legacy project `czhufhufvwvgyhjuaauo` (existing
users and workspaces) is the provisional canonical production source. Nothing
in this plan runs without explicit approval, and no production credential has
been changed by engineering.

## 1. What exists today

| | Legacy `czhuf…` (canonical) | New `dhqag…` (Zevqora.ai) |
|---|---|---|
| Serves the live site | **Yes**: deployment `dpl_5GKG…` (main 4d5de6f, 2026-11-01) | No |
| Vercel Production env vars | Overwritten about 06:10 UTC 2026-11-13; the values now point at `dhqag…` | Target of the env vars; takes effect at the next production build |
| Access from engineering tools | **None today**: the Supabase connector only sees org `zrtvgcbtkpjtjmyfrbni` | Full (connector) |
| Migrations | 001–020 (013 and 016–020 applied 2026-11-01, MD5-pinned) | 001–020 recorded |
| RLS | `RLS_CHECK PASS 51` on 2026-11-01 | 51/51 public tables with RLS |
| Auth users / identities | **unknown, needs access**; includes the founder account (signup 2026-11-01) | 3 (all email, all confirmed) |
| Workspaces / members / projects | **unknown**; founder workspace "Zevqora" with 4 vNext/ZevIR flag overrides | 2 / 2 / 0 |
| Subscriptions / admin roles | unknown | 3 / 0 |
| Evidence (engine runs, ZevIR graphs, telemetry, evaluation requests) | unknown | 0 everywhere |
| Feature flags | `cloud_replay` on; workspace overrides for the founder | `cloud_replay`, `pdf_export`, `product_analytics`, `runtime_telemetry` on; vNext/ZevIR off; no overrides |
| Storage | unknown | no buckets, 0 objects |
| Backups | in-DB `zq_backup_20261101`, `zq_backup_20261101b` (33 tables incl. auth, row MD5 manifest) | none |
| Auth config | custom SMTP via founder's admin Gmail; email only | email confirmation on, signups open, email only, SMTP unknown |

**Missing for a full comparison:** read access to `czhuf…`. Either grant the
Supabase account used by the connector access to the legacy organization, or
run the count/MD5 queries in §4 yourself in the legacy SQL editor and share
the output (counts and hashes only, no rows).

## 2. Step 0: protect production now (owner action, needs your approval)

The next production build (any merge to `main`, or a redeploy) moves the live
site to `dhqag…`, where the legacy users don't exist. Until a migration is
approved, **set the four Production variables back to the legacy project**:
`SUPABASE_URL`, `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`. Copy the values from the legacy project's
dashboard (Settings → API). The old values were overwritten and are not
recoverable from Vercel. Verify with `/api/health` on a new production build:
`isolation.supabase_ref` must be `czhufhufvwvgyhjuaauo`.

## 3. Options

**A. Stay on legacy (recommended for the 2026-11-19 diligence window).**
Restore the env vars (step 0), keep `dhqag…` as a non-production project (or
repurpose it as a second staging), and merge PR #16 only after the staging E2E.
No data moves. Lowest risk.

**B. Migrate legacy → new, later, in a planned window.** Only if the new
organization or region is required. Steps:

1. **Freeze**: announce a window; set the site banner via `/admin`; pause cron (`/api/cron/daily`).
2. **Back up both sides**: create a fresh in-DB backup schema on legacy (same pattern as `zq_backup_20261101`, with a row-MD5 manifest), plus `supabase db dump` (schema, data, `--schema auth`) stored off-platform. Back up `dhqag…` too, even though it is nearly empty.
3. **Identity mapping**:
   - Copy `auth.users` and `auth.identities` with the **same UUIDs** (bcrypt password hashes are portable), so every `owner_id`/`user_id` foreign key stays valid.
   - Resolve the 3 existing `dhqag…` users first: same email as a legacy user → keep the legacy UUID and drop or merge the new one (it owns no projects); otherwise keep as is.
   - All sessions end because the JWT secret differs. Users sign in again; the browser storage key is project-scoped, so old tokens are ignored.
4. **Data copy order** (FK-safe): `profiles`, `subscriptions`, `credit_balances`, `workspaces`, `workspace_members`, `workspace_invites`, `projects`, `connections` (+ `connection_secrets`: token hashes are plain SHA-256 and therefore portable), `telemetry_events`, 009–020 engine/evidence/ZevIR/optimizer tables, `product_events`, `site_content(+_revisions)`, `feature_flags` (incl. overrides), `admin_roles`, `admin_audit_log`, `security_events`. Use `session_replication_role = replica` only inside the copy transaction, then re-run the FK and RLS checks.
5. **Verify**: per-table row counts and MD5 manifest equal on both sides; `RLS_CHECK` 51; `supabase/tests/security_definer_check.sql`; founder login; the founder workspace shows its projects, evidence and flags; signup and reset mail through the configured SMTP.
6. **Switch**: set the Production env to `dhqag…`, deploy, and smoke-test (§5 of the launch report).
7. **Rollback**: legacy stays untouched and read-only during the window. Rolling back = restoring the four env vars to legacy and redeploying the previous build (`vercel rollback dpl_5GKG…`). Writes made on `dhqag…` after the switch are lost on rollback unless replayed. Keep the window short and re-copy if needed.

## 4. Comparison queries (run on each project; output counts and hashes only)

```sql
select 'auth_users', count(*) from auth.users union all
select 'identities', count(*) from auth.identities union all
select 'workspaces', count(*) from public.workspaces union all
select 'members', count(*) from public.workspace_members union all
select 'projects', count(*) from public.projects union all
select 'subscriptions', count(*) from public.subscriptions union all
select 'zevir_graphs', count(*) from public.zevir_graphs union all
select 'telemetry_events', count(*) from public.telemetry_events union all
select 'evaluation_requests', count(*) from public.evaluation_requests union all
select 'flag_overrides', count(*) from public.feature_flags where workspace_overrides <> '{}'::jsonb union all
select 'storage_objects', count(*) from storage.objects;
select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations;
```
