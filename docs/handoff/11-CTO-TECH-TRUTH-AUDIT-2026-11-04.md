# CTO Tech Truth Audit — 2026-11-04

Owner: Khuslen (Co-founder & CTO). Prepared on branch `cto/release-gates-audit-2026-11-04` (local, **not pushed**).
Scope: the three outstanding release gates (staging E2E + cross-tenant security, Supabase/Auth/RLS hardening, real proof loop).
Nothing in production was changed: no deploy, no migration, no Auth/RLS/env change, no customer data read.

**Verdict: HOLD** (details and evidence in `14-LAUNCH-GO-HOLD-EVIDENCE.md`).

## 1. Source, CI and deployment evidence (verified today)

| Item | Evidence | How verified |
|---|---|---|
| `main` | `4d5de6fe254cb4dd37e54d2d93d758087d8c0a46` | `git ls-remote` |
| `release/vnext-part3-production` | `6a10a1ae10c2b4693e675e7b9e01af682c226903`; `git diff --stat main release` is empty (same tree) | clone + diff |
| CI on `main` | [run 41295107804](https://github.com/ZEVQORA/Zevqora/actions/runs/41295107804): Success, 4/4 jobs (Web+API, Backend, Desktop, Evidence integrity), 2026-11-01 09:54 | public run page |
| CI on release | [run 41298570513](https://github.com/ZEVQORA/Zevqora/actions/runs/41298570513): Success, 4/4 jobs, 2026-11-01 10:41 | public run page |
| Production deployment | `dpl_5GKGgvc7jwZVofhzWCBzbp9df5ih`, target `production`, READY, `main@4d5de6f`, created 2026-11-01T09:54:12Z | Vercel API (read-only) |
| Release-branch deployment | `dpl_GDqhrSDXuznXG3HNBqujW6FMdEYi` CANCELED (ignored build step) | Vercel API |
| **Latest deployment** | `dpl_D8yCisRHAzPUzRH26VLU2VCfUvGW`, **preview (target null), READY**, created 2026-11-02T13:44:46Z by a CLI deploy (no git metadata, source commit unknown), no alias | Vercel API |
| Deployment protection | Vercel SSO enabled, `all_except_custom_domains`; password/trusted-IP off | Vercel project settings |
| Supabase production | `czhufhufvwvgyhjuaauo` "Zevqora", ACTIVE_HEALTHY, Postgres 17.6.1.155 | Supabase API |
| Supabase staging | `lxbcynzgeuqzmynkuzqg` "zevqora-staging", ACTIVE_HEALTHY, Postgres 17.11.0.016 (release channel `withdrawn`) | Supabase API |

Local re-run of every CI gate on this machine (Windows 11, Node 24.18.0, Python 3.13.14): see
`12-STAGING-E2E-SECURITY-RESULTS.md` §5 and `test-summary-2026-11-04.json`.

## 2. Environment isolation — established, not assumed

The Vercel project's environment variables were listed **without decrypting values** (key, target, record id).
A record that targets both `production` and `preview` is one record with one value, so those values are identical by construction.

| Variable | Targets | Consequence |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | production **+ preview** (one record) | every preview holds the production service-role key |
| `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` | production **+ preview** (one record each) | previews point the browser at production |
| `SUPABASE_URL` | production only | `api/_lib/supabase.js` falls back to `PUBLIC_SUPABASE_URL` → previews' **server** also talks to production |
| `DESKTOP_HANDOFF_SECRET`, `CRON_SECRET`, `PUBLIC_APP_URL`, `PUBLIC_CONTACT_EMAIL`, `PUBLIC_DESKTOP_DOWNLOAD_URL` | production + preview | shared secrets |
| `OPENROUTER_API_KEY` | separate production and preview records | values not compared (not decrypted) |
| `ANALYTICS_SECRET`, `SECURITY_HASH_SECRET` | production only | previews fall back to per-instance secrets |

**Conclusion: staging isolation is disproven for Vercel previews.** Any preview (including the live CLI preview
`dpl_D8yCisRHAzPUzRH26VLU2VCfUvGW`) runs with service-role access to production data. Access to preview URLs needs
Vercel SSO (team members), so this is a **confirmed configuration risk, not an observed exploit**.
`vercel.json`'s ignore step builds only `production`, `main`, or an empty ref (CLI deploys) — which is how the CLI preview was built.

Per the safety rules, **no write-capable staging test was run against any deployment.**

Fix prepared in code (commit `ce69d22`, not deployed): `api/_lib/env-isolation.js` refuses every database-backed
request with `503 ENVIRONMENT_ISOLATION_VIOLATION` when `VERCEL_ENV=preview` and any of the server URL, browser URL
or service-role key belongs to the production project (or key and URL disagree); `/api/health` reports the
environment and project refs (no key material). Production (`VERCEL_ENV=production`) and local runs are unaffected.
The Vercel variable split itself needs approval (see `15-CTO-DONE-BLOCKED-NEXT.md`).

## 3. Architecture inventory (relevant to the gates)

- Web: Vite + React 19 SPA (`src/`), one Vercel function `api/index.js` dispatching ~25 handler modules (`api/_lib/handlers`).
- Auth: Supabase JWT verified server-side (`requireUser` → `auth.getUser`); workspace roles owner/admin/member/viewer;
  non-members get 404 (`requireWorkspaceRole`); admin routes check `admin_roles` and return 404.
- DB: `supabase/migrations/001–020`; browser roles hold SELECT on a fixed table list only (012); server-only tables have RLS with no policies (deny-all for browser roles).
- Optimization engine: contract freeze → baseline snapshot → diagnoses → plan search → calibration → full replay →
  verdict (VERIFIED/REJECTED/INCOMPLETE) → Pareto frontier → decision policy; immutability enforced by DB triggers (017/018/020).
- Desktop app (`desktop-app/`): Electron + FastAPI backend; unchanged by this audit.
- Staging tooling: `scripts/staging/guard.mjs`, `vitest.staging.config.ts`, `tests/staging/staging.e2e.staging.ts`.

## 4. WORKING / STAGING / NOT SHIPPED / UNKNOWN

| State | Item | Evidence |
|---|---|---|
| WORKING (production) | Production site/API at `main@4d5de6f`, READY | Vercel `dpl_5GKG…` |
| WORKING (production) | CI green on `main` and release (4/4 jobs each) | runs 41295107804, 41298570513 |
| WORKING (production) | Production schema = staging schema by definition: columns 827, constraints 420, indexes 236, policies 41, RLS flags 51, browser grants 26, triggers 11 — identical aggregate hashes | read-only catalog hashes, §12-3 |
| WORKING (production) | Three advisor-flagged SECURITY DEFINER helpers answer only about the caller; `anon` cannot execute them | definitions identical to staging; SD_CHECK PASS on staging |
| STAGING | Staging DB `lxbcynzgeuqzmynkuzqg` at 001–020 (+`020_user_deletion_guards_r2`) | migration list |
| STAGING | `RLS_CHECK PASS (51 checks)`, `SD_CHECK PASS (11 checks)` on staging today (always rolled back) | §12-2 |
| STAGING | Staging app deployment with staging credentials | **does not exist / not verified** |
| NOT SHIPPED | Preview fail-closed guard, staging-guard hardening, verdict fix (unknown ≠ failure), proof-loop CI step, regression tests | branch `cto/release-gates-audit-2026-11-04`, commits `ce69d22…2e0f878` |
| NOT SHIPPED | Leaked-password protection (disabled on both projects) | advisors |
| NOT SHIPPED | Vercel preview/production variable split | env listing |
| UNKNOWN | Source commit and purpose of the live CLI preview `dpl_D8yC…` | Vercel shows no git metadata |
| UNKNOWN | Production row counts today (query blocked by the safety reviewer; not needed for any gate). Baseline audit reported 0 ZevIR graphs / optimization runs / plan searches | — |
| UNKNOWN | Origin of 3 auth users / 2 workspaces currently in staging (earlier report said the suite cleaned up to 0) | staging counts |
| UNKNOWN | Self-service signup mail delivery (built-in mailer failed on 2026-11-01; custom SMTP status not re-checked) | `12-LAUNCH-STATUS.md` |

## 5. Defects found and fixed in code today

1. **Preview → production database (configuration risk, high).** Code-level fail-closed guard added (`ce69d22`). Vercel change still required.
2. **Staging guard could be pointed at production deployments.** It denylisted only three hostnames, accepted any non-production project ref, allowed http, did not know the `zevqora-git-main-…`/`zevqora-nero404` production aliases, and could not detect a preview wired to production. Now an allowlist + JWT-claim checks + a runtime preflight of the deployed app (`ce69d22`, `c3a1bf0`, `2e0f878`).
3. **Staging suite silently skipped when unconfigured.** Now it fails (`1 failed | 17 skipped`, exit 1) and its cleanup is verified (`ce69d22`).
4. **Verdict integrity: unknown outcomes produced REJECTED.** A workload with no recorded outcomes was graded quality 0 and REJECTED on the candidate-replay path. Now INCOMPLETE with quality and task success unknown (`1c89dc8`, regression test `tests/unlabelled-evidence-verdict.test.ts`).
5. **Flaky title assertion** in `tests/website-admin-ui.test.tsx` (raced a `useEffect`) — now waits (`c632ce3`).
