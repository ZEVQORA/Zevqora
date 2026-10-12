# vNext Part 3 — rollout and rollback

Nothing in this document has been run against production. Every step needs
founder approval. Order matters: 016 → 017 → 018 → 019, then the application.

## Preconditions

* Production migrations end at 015 (check with `list_migrations`). If 016–018
  are not applied, follow `vnext-part2b-rollout.md` first.
* A staging project (or a Supabase branch) where the same steps are rehearsed.
  The local gate used PGlite (Postgres 17 in WASM) with Supabase's roles; it has
  not been run on a real Supabase project.

## New server environment variables (Vercel, server-only)

| Variable | Required | Why |
|---|---|---|
| `ANALYTICS_SECRET` | yes, ≥ 32 random chars | Daily HMAC for cookieless visitor keys. Without it each server instance uses its own key and visitor counts are overstated (the admin page says so). |
| `SECURITY_HASH_SECRET` | yes, ≥ 32 random chars | Keyed hash for security-event source correlation. |
| `CRON_SECRET` | already required | The daily job now also purges website events (400 days) and security events (90 days). |
| `VERCEL_WEB_ANALYTICS` | optional (`1`) | Shown in System health only; first-party analytics stay the source of truth. |

PostHog is not integrated (it would need a third-party script origin in the CSP).

## Steps

1. Dry-run 019 inside a transaction that always rolls back (tested locally):
   ```sql
   do $dry$
   begin
     -- body of 019_product_experience.sql, unchanged
     raise exception 'OPT19_DRY_RUN_OK';
   end
   $dry$;
   ```
2. Apply `019_product_experience.sql` (name `product_experience`). Additive:
   5 server-only tables, 2 nullable columns + 2 checks on `feature_flags`,
   5 functions, 4 flag rows, content-history seed, and a guarded hero-copy
   update that only replaces the hero while it still holds 013's text (an
   admin-edited hero is left alone; the change is recorded as version 2).
3. Run `supabase/tests/rls_privilege_check.sql` → `RLS_CHECK PASS`, then
   `get_advisors` (security + performance).
4. Set the environment variables above, then deploy the application.
5. Smoke test as a ZEVQORA admin: `/admin` (command center), `/admin/system`
   (secrets show `configured`), `/admin/content` (draft → preview → publish →
   restore on a low-risk section such as the footer), `/admin/flags`.
6. Turn on `visitor_intelligence` only after the privacy notice mentions
   cookieless first-party analytics. `product_analytics` is on by default
   (first-party, ids and counts only).
7. Enable `zevir_graph_ui` with targeting `internal`, walk the demo
   (Command Center → Execution Graph → Diagnoses → Optimization), then widen to
   `selected` workspaces.

## Rollback

1. Turn `visitor_intelligence` off; set `zevir_graph_ui` to `off`.
2. Revert the application deploy (the pre-Part-3 app does not read 019 tables).
3. Export `evaluation_requests` if the leads must be kept.
4. Run `supabase/rollback/019_product_experience.rollback.sql`. It drops the
   019 tables, functions and flag columns, removes the four 019 flags, and puts
   the hero back to 013's copy only if it still holds the copy 019 published
   (the old app has no `/evaluation` or `/product` pages). Tested locally:
   rollback, then re-apply, is clean.
5. 016–018 are untouched by this rollback.
