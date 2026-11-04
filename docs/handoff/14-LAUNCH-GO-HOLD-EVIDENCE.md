# Launch GO / HOLD Evidence — 2026-11-04

## Recommendation: **HOLD**

Production is up and CI is green, but the release gates are not met:
- **Gate 1 (staging E2E): BLOCKED** — not run; there is no isolated deployment, and Vercel previews are wired to production.
- **Gate 2 (security): PARTIAL** — staging DB checks pass and the advisor findings are classified; preview isolation and
  leaked-password protection remain open and need approval.
- **Gate 3 (proof loop): PASS as FIXTURE PROOF only** — VERIFIED / REJECTED / INCOMPLETE proven on real code paths with a
  synthetic workload; no real-customer validation exists.
- All fixes are on a local branch: **not pushed, not reviewed, not in CI, not deployed.**

## Evidence summary

| Area | Status | Evidence |
|---|---|---|
| Production deployment | READY on `main@4d5de6f` | Vercel `dpl_5GKGgvc7jwZVofhzWCBzbp9df5ih` |
| CI on main / release | Success 4/4 / Success 4/4 | runs 41295107804 / 41298570513 |
| Local gates on audit branch `2e0f878` | 16/16 PASS + staging BLOCKED by design | `test-summary-2026-11-04.json` |
| Web/API tests | 565/565 (baseline 530/530) | same |
| Backend tests | 189 passed, 12 skipped (DUREM repo unavailable) | same |
| Staging RLS / SD checks | 51/51, 11/11 (rolled back) | `12-…` §2 |
| Schema drift prod ↔ staging | none semantic | `12-…` S6 |
| Bundle credential scan | PASS | `12-…` S7 |
| Staging E2E | **NOT RUN** | `12-…` §1 |
| Preview isolation | **FAILS** (production credentials in Preview) | `11-…` §2 |
| Leaked-password protection | **disabled** (both projects) | advisors |
| Real-workload proof | **none** | `13-…` |

## Three highest-impact blockers

### B1 — Vercel previews run with production database credentials
- **Repro:** Vercel → zevqora → Environment Variables: `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`
  are single records targeting Production **and** Preview; `SUPABASE_URL` is Production-only and `api/_lib/supabase.js` falls back
  to `PUBLIC_SUPABASE_URL`. Live READY preview `dpl_D8yCisRHAzPUzRH26VLU2VCfUvGW` (CLI, 2026-11-02, unknown source).
- **Impact:** any preview build (CLI deploy, or any branch the ignore step lets through) has service-role (RLS-bypassing) access to
  production data; staging E2E cannot run on Vercel; a test there would write to production.
- **Owner:** Khuslen (CTO) with Nero (Vercel project owner).
- **Remediation:** split the variables (Preview → staging values), delete the CLI preview, optionally rotate the production
  service-role key, merge the fail-closed guard (`ce69d22`). Exact steps: `12-…` §4.
- **Verify:** `curl -s <preview>/api/health` → `"environment":"preview"`, `"supabase_ref":"lxbcynzgeuqzmynkuzqg"`, `"violation":null`;
  `npm run staging:guard` → `STAGING_GUARD PASS`. Unit proof of the guard: `npx vitest run tests/env-isolation.test.ts`.

### B2 — Staging end-to-end has not been executed
- **Repro:** `npm run test:staging` → `STAGING_GUARD REFUSED — missing: …` (no credentials here, no isolated target).
- **Impact:** cross-tenant isolation, role enforcement, deletion/cleanup and the deployed proof loop are proven only on PGlite and
  by rolled-back SQL on staging, not through the HTTP API against hosted Supabase with this code.
- **Owner:** Khuslen.
- **Remediation (no Vercel change needed):** in a local, untracked env file set staging values for `SUPABASE_URL`,
  `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; run `node --env-file=<file> scripts/dev-api.mjs`;
  `npm run build`; then with `STAGING_*` variables and `STAGING_APP_URL=http://127.0.0.1:3000` run `npm run test:staging`.
  Requires approval for staging writes (disposable users/rows, deleted and verified in `afterAll`).
- **Verify:** 17/17 pass, `[staging] cleanup: N users deleted, 0 problem(s)`; afterwards `select count(*) from auth.users where email like 'zqstg%'` on staging = 0.
  Self-service signup may still fail on the built-in mailer (seen 2026-11-01) until custom SMTP is configured.

### B3 — Leaked-password protection disabled (and no real-workload proof)
- **Repro:** Supabase security advisors on both projects → `auth_leaked_password_protection` WARN.
- **Impact:** users can register with passwords from known breaches; credential-stuffing exposure at public launch.
- **Owner:** Khuslen.
- **Remediation:** enable "Prevent use of leaked passwords" (staging, then production) — `12-…` §3.
- **Verify:** advisors no longer report it; a breached password is rejected at signup.
- Related claim limit: until an authorized real workload is run through the loop, any savings figure is FIXTURE ONLY
  (`13-…`), and the plan-promotion reproducibility limitation (`13-…` §5) should be resolved before external claims.

## What can be said externally today
- "Production build is live from `4d5de6f`, CI green." — true.
- "Staging verified" / "end-to-end tested on staging" — **not true today**.
- "Saves 59 %" — **not true**; that figure is an evaluated result on a synthetic fixture, never realized production savings.
