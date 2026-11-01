# Production Launch Status — 2026-11-01

**Verdict: HOLD.**
- The staging API end-to-end run is done: 13 of 14 pass. Self-service signup cannot pass without a mail provider (see below).
- The run found a database defect, now fixed by migration 020.
- Still open: Vercel Preview deployments use the production database and service-role key. So nothing is pushed, nothing is migrated in production, nothing is merged to `main` and nothing is deployed.

## Staging round 2 (key provided, 2026-11-01)
The real API (`api/index.js` at `3c6e543` + 020) and the built site were served locally against staging, with no provider key, so no paid call was possible.

**`npm run test:staging`: 13/14 pass.** Passing:
- session and tampered-token rejection;
- workspace A/B isolation, enforced by both the API (404) and RLS;
- a viewer cannot write (403);
- presentation views grant nothing, and the denial is logged;
- browser roles cannot read or call any Part 3 server-only table or function;
- published vs draft CMS content;
- no service-role credential in the built bundle;
- admin command center and security reads, both audited;
- evaluation requests;
- CMS draft → publish → rollback, all audited;
- per-workspace flag targeting;
- invalid traces rejected, unknown cost stays null, missing outcomes make the baseline INCOMPLETE;
- the labelled synthetic demo: baseline → ZevIR graph → diagnosis → plan search → replay → VERIFIED and REJECTED verdicts → decision → report, with REALIZED reported as NOT_YET_MEASURED and nothing deployed.

**Failing: self-service signup.** It cannot pass without a mail provider.
- Supabase's built-in mailer rejects addresses it cannot deliver to (`email_address_invalid` for `.test` and `example.com`).
- It then rate-limits (`over_email_send_rate_limit`).
- Production uses the same built-in mailer: configure custom SMTP before launch, or public signup will hit the same limit.

**Defect found, fixed in `020_user_deletion_guards.sql`.** The suite's cleanup could not delete its test owner through the Supabase Auth admin API. A user, workspace or product with optimization evidence could not be deleted:
1. **Immutability guards rejected the `on delete set null` update.** `evaluation_contracts_guard` raised CONTRACT_IMMUTABLE, `plan_decisions_guard` raised DECISION_IMMUTABLE.
2. **A user in two reference columns was updated twice.** When one user is both `created_by` and `frozen_by` (or `cancelled_by`), the row is updated twice. Postgres then re-checks the parent key after the cascade has removed the product (23503).
3. **A VERIFIED plan lost its evidence.** `execution_plans_evaluation_fk` (`set null`) stripped a VERIFIED plan of its evaluation (23514 `execution_plans_verified_evidence`). Now `on delete cascade`: a verdict cannot outlive its evidence.

020 fix and evidence:
- Direct edits of the same columns are still refused.
- Test: `tests/user-deletion-db.test.ts`, 7 tests. The 017/018 behaviour is reproduced first, then the fix, then the rollback.
- Before applying, it was probed on staging inside a rolled-back subtransaction against the real demo data. With the fix, the owner and everything under them deleted.
- Staging history:
  - `020_user_deletion_guards`: first version, superseded.
  - `020_user_deletion_guards_r2`: the final file, MD5 `baf01c3af2ef32cf1e5ec8e379cb1f77`.
  - Rollback file MD5 `a821ffd92d09ed7daeb7d0ed7db44749`.
  - History was not edited.
- After the fix, the leftover test owner was deleted through the Auth admin API (200). The full suite now cleans up after itself: 0 test users, workspaces, products, plans, admin roles or leads remain; flags and the hero copy are restored.

**Backward compatibility: PASS, 32/32.** The current production code (`97079d5`) was served against staging at 001–020. The run covered:
- health, public config and platform status (sign-in required);
- `/api/me`;
- workspace create, overview, usage and members;
- project;
- connection create, sample-capture change, rotate and revoke;
- engine product, trace import, findings, economics;
- an exact-reuse plan → execute (no provider) → evaluation;
- executions, evaluations, experiments, implementations;
- product archive;
- owner deletion through the Auth admin API, with no leftovers.

The additive schema does not break the running build during the switch.

**Still open:**
- **Vercel Preview → production database.** Checked again on 2026-11-01 with `vercel env ls`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `CRON_SECRET`, `DESKTOP_HANDOFF_SECRET` (and `PUBLIC_APP_URL`, `PUBLIC_CONTACT_EMAIL`, `PUBLIC_DESKTOP_DOWNLOAD_URL`) are still "Production, Preview". `OPENROUTER_API_KEY` has separate Preview and Production entries. Until the Supabase variables are split, pushing any branch builds a preview against production.
- **Production backup.** No backup is recorded. The free plan has no point-in-time recovery, so a `pg_dump` needs the database connection string. Only the founders have it.
- **Mail and secrets.** Custom SMTP is not configured. `ANALYTICS_SECRET` and `SECURITY_HASH_SECRET` are not set. Leaked-password protection is off.

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
1. **Staging key:** done.
2. **Staging API end to end:** done, 13/14. Signup needs custom SMTP.
3. **Backward compatibility:** done, 32/32 against 001–020.
4. **Vercel environment split** (founders, in the dashboard), then push the branch. PR #9 CI must pass and the founders review.
5. **Release PR:** merge PR #9 → `release/vnext-part3-production`, then open release → `main`, with all required checks green.
6. **Production database:**
   - Take a backup first. The free plan has no point-in-time recovery: take a `pg_dump` from the dashboard connection string.
   - Apply 013, 016, 017, 018, 019 and 020 in order, with the same pinned, MD5-checked method.
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
  - 013 and 016–020 are additive, so the previous build ignores the new tables. That was proven against staging, 32/32.
  - 020's rollback only restores functions and one foreign-key rule; it deletes no data.
  - Do not run `supabase/rollback/019…016` unless a migration itself is faulty, and only after a backup: they drop tables and their data.
- **References:** main `97079d5`; deployment `dpl_3Vt4y6EYyxBL2WJ5LV3HLRmcfgGX`; backup identifier to be recorded in step 6.
