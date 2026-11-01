# Production Launch Status — 2026-11-01

**Verdict: HOLD.** The staging API end-to-end run was not done: the founder chose HOLD rather than provide the staging service-role key. Without it there is no production migration, no merge to `main` and no production deploy.

## Verified state (read live on 2026-11-01)

| Item | Value |
|---|---|
| `main` (production branch) | `97079d5`, the merge base of the release, so release → main has no conflicts |
| `release/vnext-part3-production` | `8e591cd` (39 commits ahead of `main`) |
| `integration/unified-vnext-zevir-ui` | `80fb36f` on GitHub (PR #9, draft, 10/10 checks green). Local `a3c53c0` adds the security fixes; **not pushed** (see Vercel below) |
| Open PR #8 `design/zevqora-frontend-refresh → main` | Must **not** be merged: it deletes the vNext backend |
| Branch protection | Set on 2026-11-01 for `main` and `release/vnext-part3-production`: 4 required checks (Web + API, Backend, Desktop, Evidence integrity), no force-push, no deletion, admins may override |
| Production deployment | `dpl_3Vt4y6EYyxBL2WJ5LV3HLRmcfgGX` (zevqora-rcwa4o6zb, from `97079d5`, 52 days old). `/api/health` 200, HSTS/CSP/XFO/XCTO/Referrer/Permissions headers present, Stripe not configured |
| Supabase production | `czhufhufvwvgyhjuaauo`. History: 003–012, 014, 015. **013 and 016–019 missing**; none of the vNext tables exist. 31 tables, all RLS on, 0 browser-writable tables. 8 auth users, 5 workspaces |
| Supabase staging | `zevqora-staging` `lxbcynzgeuqzmynkuzqg` (new, $0, free plan, ap-southeast-1). 001–019 applied in order from commit `80fb36f`, each file MD5-checked against git. 51 tables, all RLS. Synthetic users only (`@zevqora-staging.test`, workspaces A/B) |
| Staging RLS | `supabase/tests/rls_privilege_check.sql` → **RLS_CHECK PASS (51 checks)** on real Postgres |

## Security work in this round
- `a3c53c0` fixes four findings in the existing connection and member routes, each covered by `tests/connection-membership-security.test.ts`. Six of its ten tests fail on the old handlers.
  - Only the connection's creator or an admin can change sample capture.
  - Rotation checks membership before revealing state, and is rate limited.
  - Revocation is idempotent and rate limited.
  - Audit events are recorded for connection and membership changes.
- Advisors on production:
  - `has_workspace_role`, `is_workspace_member` and `shares_workspace_with` are SECURITY DEFINER and executable by signed-in users. They already return false for any uid other than the caller's, so no membership probing is possible, and RLS needs them. Accepted.
  - Four server-only tables have RLS with no policies (intended).
  - **Leaked-password protection is off**: enable it in the dashboard (Auth → Passwords).
- **Vercel environment isolation (blocker):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `OPENROUTER_API_KEY`, `CRON_SECRET` and `DESKTOP_HANDOFF_SECRET` are scoped "Production, Preview". Every preview deployment therefore runs against the **production** database with the production service-role key. Fix in the Vercel dashboard: restrict those to Production, and add the staging project's values for Preview. Until then, do not push branches. `ANALYTICS_SECRET` and `SECURITY_HASH_SECRET` (needed by 019) are not set in any environment.

## QA on `a3c53c0` (local, two workers)
typecheck 0 · lint 0 · **519/519 tests, 43 files** · build 0 · verify:release 0 · API import ok.

## Gated launch sequence (each step only after the previous one passes)
1. **Staging key:** the founder pastes the staging service-role key into `.env.staging.local` (gitignored).
2. **Staging API end to end:** run the real API locally against staging, then `npm run test:staging` with `STAGING_APP_URL=http://127.0.0.1:3000`. That covers signup → workspace → connection → ingest → ZevIR → optimization (no provider key: INCOMPLETE / not configured) → report, plus workspace A/B denial.
3. **Backward compatibility:** run the current production code (`97079d5`) against staging after 016–019, to prove the additive schema does not break the old build during the switch.
4. **Vercel environment split** (step above), then push `a3c53c0`. PR #9 CI must pass and the founders review.
5. **Release PR:** merge PR #9 → `release/vnext-part3-production`, then open release → `main`, with all required checks green.
6. **Production database:**
   - Take a backup first. The free plan has no point-in-time recovery: take a `pg_dump` from the dashboard connection string.
   - Apply 013, 016, 017, 018 and 019 in order, with the same pinned, MD5-checked method.
   - Run the RLS check and the advisors.
   - New feature flags start off.
7. **Set production environment variables:** `ANALYTICS_SECRET` and `SECURITY_HASH_SECRET` (each at least 32 characters).
8. **Deploy:** merge release → `main`. Vercel's Git integration deploys production automatically; start no manual deploy.
9. **Production smoke test:**
   - Public routes at 375/768/1440px.
   - Login, signup and reset.
   - Protected routes.
   - A dashboard in an isolated test workspace.
   - ZevIR and optimize endpoints, flags off and then on for the test workspace only.
   - Runtime logs.
10. **Enable features per workspace**, never globally.

## Rollback
- **Code:**
  - Vercel → Deployments → promote `dpl_3Vt4y6EYyxBL2WJ5LV3HLRmcfgGX`, or run `vercel rollback`.
  - Alternatively, revert the merge commit on `main` through a PR. Force-push is blocked by branch protection.
- **Features:** set `zevir_shadow`, `zevir_graph_ui`, `verified_optimization_vnext`, `optimization_intelligence_vnext` and `visitor_intelligence` off. That needs no deploy.
- **Database:**
  - 013 and 016–019 are additive, so the previous build ignores the new tables.
  - Do not run `supabase/rollback/019…016` unless a migration itself is faulty, and only after a backup: they drop tables and their data.
- **References:** main `97079d5`; deployment `dpl_3Vt4y6EYyxBL2WJ5LV3HLRmcfgGX`; backup identifier to be recorded in step 6.
