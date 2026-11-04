# CTO DONE / BLOCKED / NEXT — 2026-11-04

Branch `cto/release-gates-audit-2026-11-04` (local only), from `main@4d5de6f`:

| Commit | Change |
|---|---|
| `ce69d22` | Preview → production fail-closed guard (`api/_lib/env-isolation.js`), `/api/health` isolation report, staging guard allowlist + runtime preflight, staging suite fails closed + verified cleanup + editor / cross-tenant write / invalid input / immutability tests |
| `1c89dc8` | Verdict fix: unknown outcomes are INCOMPLETE, never REJECTED (+ regression test) |
| `eedc2a4` | SECURITY DEFINER helper regression test + staging SQL check, bundle credential scanner + tests, fixture proof loop, release-gate runner |
| `c3a1bf0` | Proof loop as its own CI step (`npm run test:proof-loop`); guard knows `zevqora-nero404.vercel.app` |
| `c632ce3` | Fix a `useEffect` title race in `website-admin-ui.test.tsx` |
| `2e0f878` | Staging guard: loopback local API mode (no Vercel deployment needed) |
| (docs commit) | `docs/handoff/11–15`, `test-summary-2026-11-04.json`, `artifacts/proof-loop-2026-11-04.json` |

## DONE
- Inventory: git, CI runs, Vercel deployments and env records (no values), Supabase projects, migrations, advisors — read-only.
- Proved (not assumed) that Vercel previews share production Supabase credentials; found a live CLI preview.
- Code-level fail-closed isolation for previews; tests prove 503 on every DB route and production unaffected.
- Staging guard rewritten to fail closed; staging suite can no longer skip silently; cleanup is verified.
- Ran the repository's RLS check and a new SECURITY DEFINER check on staging (rolled back): 51/51 and 11/11.
- Classified every advisor finding; the three 0029 warnings are false positives with evidence and a regression test.
- Compared production and staging schemas by definition hashes: no semantic drift.
- Bundle credential scan on the real build: PASS.
- Proof loop on real code paths: VERIFIED, REJECTED and INCOMPLETE, run twice, artifact with hashes (FIXTURE PROOF).
- Found and fixed a verdict-integrity defect (invented REJECTED on unlabelled evidence).
- Full local CI-equivalent run on the final commit: all PASS (`test-summary-2026-11-04.json`).

## BLOCKED (and the approval each needs)
| # | Blocked item | Approval needed from Khuslen / Nero |
|---|---|---|
| A1 | Staging E2E (Gate 1) | (a) choose local-API mode or Vercel Preview mode; (b) provide the staging service-role key in an untracked local env file (never in chat or git); (c) approve disposable test writes on staging `lxbcynzgeuqzmynkuzqg` |
| A2 | Preview isolation | approve Vercel env changes (remove Preview from shared production records, add staging-valued Preview records), deletion of preview `dpl_D8yCisRHAzPUzRH26VLU2VCfUvGW`, and optionally production service-role key rotation |
| A3 | Leaked-password protection | approve the Auth setting change on staging, then production (paid-plan feature) |
| A4 | Staging tooling cleanup | approve dropping `ops.apply_pinned`, schema `ops` and (if unused) the `http` extension on staging |
| A5 | Publishing the branch | approve `git push -u origin cto/release-gates-audit-2026-11-04` and a **draft** PR into `main` (repository is public; diff reviewed for secrets: none) so Linux CI runs the new tests |

Not requested and not done: any production migration, deploy, data access or setting change.

## NEXT (in order)
1. A5 → CI on the branch → code review → merge (the guard is then live for every future preview).
2. A2 → verify `/api/health` on a staging preview → A1 → `npm run test:staging` (expect 17/17, cleanup 0 problems).
3. A3 on staging → verify advisors → production.
4. Configure custom SMTP (signup on the built-in mailer failed on 2026-11-01) and re-run the signup test.
5. Make plan promotion content-addressed (calibration ranking independent of database ids) with a `SEARCH_VERSION` bump and stored-hash migration plan.
6. Run the proof loop on an authorized real workload (e.g. the pre-registered DUREM evaluation) — only then report savings, labelled evaluated-not-realized.
7. Optional hardening: move RLS helper functions to a non-exposed schema; run `rls_privilege_check.sql` on production (designed to roll back) with approval.

## What CTO Khuslen can safely report to CEO Nero
- Production is live from `4d5de6f` and CI is green; nothing was changed in production today.
- Launch recommendation is **HOLD** until previews are separated from production credentials and the staging E2E passes.
- Database security checks on staging pass (51/51 RLS, 11/11 privileged functions); the three advisor warnings about functions are not exploitable (evidence attached); leaked-password protection must be switched on.
- The optimization engine was shown to accept good plans, reject cheaper-but-worse plans, and refuse to judge when evidence is missing — on a **synthetic** workload. No real-customer savings have been proven.
- One real engine bug (unknown evidence counted as failure) was found and fixed, with a test.
