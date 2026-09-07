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
```

Auth providers: Email/Password, Google, GitHub. Redirect URLs must include
`https://zevqora.vercel.app/**` (and any custom domain). Recommended: enable leaked-password protection.

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
