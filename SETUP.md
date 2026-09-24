# ZEVQORA — deployment checklist

## 1. Supabase

Project: the existing production project. Apply migrations in order (they are additive and idempotent):

```
supabase/migrations/001_zevqora_production.sql
supabase/migrations/002_username_auth.sql
supabase/migrations/003_billing_plan_starter.sql
supabase/migrations/004_platform.sql
supabase/migrations/005_admin_bootstrap.sql
supabase/migrations/006_rollups.sql
supabase/migrations/007_telemetry_event_key_unique.sql
supabase/migrations/008_credit_precision.sql
supabase/migrations/009_product_engine.sql
supabase/migrations/010_trace_prompt_evidence.sql
supabase/migrations/011_harden_security_definer_rpc_surface.sql   (already live since 2026-09-11; backfilled)
supabase/migrations/012_least_privilege_client_access.sql      (live since 2026-09-24)
supabase/migrations/013_site_hero_copy.sql                     (publishes the new hero copy: apply with the release)
supabase/migrations/014_engine_evaluation_requirements.sql     (live since 2026-09-24; additive)
```

Role-switched privilege check (always aborts, safe on production): `supabase/tests/rls_privilege_check.sql`.
Rollback for 012: `supabase/rollback/012_least_privilege_client_access.rollback.sql`.

Auth providers: Email/Password, Google, GitHub. Redirect URLs must include
`https://zevqora.vercel.app/**` (and any custom domain). **Enable leaked-password protection**
(Dashboard → Authentication → Providers → Email); it is a dashboard setting, not SQL.

Security advisor findings that remain **by design** after 012:

- `rls_enabled_no_policy` on `admin_audit_log`, `connection_secrets`, `desktop_auth_handoffs`, `feature_flags`:
  server-only tables, read and written by the API with the service role. No client policy and no client grant.
  Never add a permissive policy to silence this.
- `authenticated_security_definer_function_executable` on `is_workspace_member`, `has_workspace_role`,
  `shares_workspace_with`: RLS policies call them, so `authenticated` must keep EXECUTE. Since 011 they answer
  only about the caller (`uid` other than `auth.uid()` returns false), so direct RPC reveals nothing new.

Admins are rows in `public.admin_roles`. Further admins are granted from `/admin/admins` (superadmin only, audited).

## 2. Vercel environment (project `zevqora`, root directory `.`)

| Variable | Scope | Purpose |
| --- | --- | --- |
| `PUBLIC_APP_URL` | public | canonical origin |
| `PUBLIC_DESKTOP_DOWNLOAD_URL` | public | desktop installer link |
| `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` | public | browser Supabase client |
| `PUBLIC_CONTACT_EMAIL` | public | contact address |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | server | service-role access for the API |
| `OPENROUTER_API_KEY` | server | **platform credential for cloud replay experiments** |
| `OPENROUTER_BASE_URL` | server | optional, defaults to `https://openrouter.ai/api/v1` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | server | optional; self-serve checkout stays disabled until set |
| `DESKTOP_HANDOFF_SECRET` | server | 32-byte base64; desktop browser-auth handoff |
| `CRON_SECRET` | server | protects `/api/cron/daily` |

Never prefix a secret with `PUBLIC_` or `VITE_`; those are inlined into the browser bundle.

## 3. Stripe (optional)

Set the Stripe price ids per plan in `/admin/pricing` (monthly and annual). The webhook endpoint is
`POST /api/stripe/webhook` (events: `checkout.session.completed`, `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`).

## 4. Release

```bash
npm ci
npm run typecheck && npm run lint && npm run test && npm run build
git push origin main          # Vercel deploys production from main
```

After deployment verify: `/`, `/pricing`, `/login`, `/app` (signed in), `/admin` (admin), `/api/health`, `/api/public-config`.

## 5. Desktop

The desktop installer is built from `desktop-app/` (`scripts/package_windows.ps1`). It signs in with the same Supabase
account and uses `/desktop-auth` for the browser handoff.
