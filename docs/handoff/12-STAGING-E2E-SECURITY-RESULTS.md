# Staging E2E and Security Results — 2026-11-04

Gates 1 and 2. Branch `cto/release-gates-audit-2026-11-04`, final code commit `2e0f878`.
Every remote action below was **read-only** or ran inside a transaction that **always rolls back**. Nothing was written to
production or persisted on staging.

## 1. Gate 1 — staging end-to-end: **BLOCKED (not run)**

`npm run test:staging` was **not executed against any target**. Counts: 0 passed / 0 failed / 0 skipped against staging.
The only executions were the guard's refusal path (`staging.guard_refusal`: exit 1, `STAGING_GUARD REFUSED — missing: …`) and
the suite without configuration (`1 failed | 17 skipped`, exit 1 — it now fails instead of silently skipping).

Why it is blocked (all three must be cleared):
1. **No isolated deployment target.** Vercel previews carry the production service-role key and Supabase URL (see `11-…` §2).
   Running write tests against a preview would write to production. The prepared alternative needs no Vercel change:
   serve the API locally against staging (`scripts/dev-api.mjs`) — the guard now accepts a loopback app URL.
2. **No staging service-role credential in this environment.** It must not be pasted into chat or committed; Khuslen places it in an
   untracked local env file (`.env.*` is git-ignored).
3. **No approval for staging writes** (disposable users, workspaces, products, flags, CMS revisions; all deleted in `afterAll`).

What the suite will prove once unblocked (17 tests, `tests/staging/staging.e2e.staging.ts`):

| Requirement | Test |
|---|---|
| Signup and login | real `/auth/v1/signup`; admin-API users + password grant |
| Session validation, tampered token | `/api/me` 200 with token, 401 without, 401 tampered |
| Two users, two workspaces, isolation | API 404 + PostgREST returns `[]` for the other tenant |
| Cross-tenant write denial | **new**: API 404 for product create / workspace rename in another tenant; PostgREST self-insert into `workspace_members` ≥ 400; workspace row and membership verified unchanged |
| Viewer / editor / admin | viewer write 403; **new** editor (member) can create a product but contract creation 403 `FORBIDDEN` and workspace rename 403; admin control plane audited; non-admin 404 on every admin route |
| Invalid input | **new**: empty / 81-char workspace name 400; malformed workspace id 400 `VALIDATION` |
| RLS / server-only tables | browser roles get non-200 on six Part 3 tables and three functions |
| Immutability | **new**: PATCH of a frozen `evaluation_contracts` row as service role fails with `CONTRACT_IMMUTABLE` |
| Account deletion | `afterAll` deletes every user via the Auth admin API and now **verifies**: delete < 300, GET 404, no workspaces/products left; otherwise the run fails |
| Bundle | no service-role key or claim in the served JS (local mode: the local `dist/`) |

Fail-closed guard changes (`scripts/staging/guard.mjs`, tests `tests/staging-guard.test.ts`, 16 tests, all pass):
- Supabase URL must be exactly `https://lxbcynzgeuqzmynkuzqg.supabase.co` (allowlist; another staging ref only via `STAGING_SUPABASE_REF`, never production).
- https required; plain http only for a loopback app URL.
- Refuses production hosts `zevqora.vercel.app`, `zevqora-nero404.vercel.app`, `zevqora.com`, `www.zevqora.com` and the branch aliases `zevqora-git-main-*`, `zevqora-git-release-vnext-part3-production-*` (these serve production builds).
- JWT-format keys must carry the staging ref and the right role; identical anon/service keys refused.
- **Runtime preflight before any write**: `/api/health` must report `environment=preview` (or `local` for loopback), server and browser project = staging, service key not `mismatch`, no isolation violation; `/api/public-config` must serve the staging URL. A deployment without the new isolation report is refused.

## 2. Gate 2 — Supabase / Auth / RLS findings

| # | Finding | Classification | Evidence | Remediation |
|---|---|---|---|---|
| S1 | Vercel previews use the production service-role key + URL; a READY CLI preview exists (`dpl_D8yC…`, 2026-11-02) | **Confirmed configuration risk — HIGH** (no outsider exploit observed; previews are behind Vercel SSO) | env records listed without values; deployment list | Code guard done (`ce69d22`). Needs approval: split variables, delete the CLI preview, consider rotating the production service-role key (§4) |
| S2 | Leaked-password protection disabled (production and staging) | **Configuration risk — MEDIUM** | advisor `auth_leaked_password_protection` | §3 |
| S3 | `has_workspace_role`, `is_workspace_member`, `shares_workspace_with` callable by `authenticated` (advisor 0029) | **False positive (intentional, guarded)** | identical definitions on both projects (md5 `45a75acd…`, `8b36656d…`, `1a3d16db…`); owner `postgres`; `search_path=public`; `anon` execute false; `SD_CHECK PASS (11 checks)` on staging; local regression `tests/security-definer-helpers.test.ts` (6 tests) runs 004 + 011 verbatim | none required. Optional defense in depth: move helpers to a non-exposed schema and repoint policies (migration; not proposed for this release) |
| S4 | `ops.apply_pinned` mutable `search_path` (staging only) | **Informational (staging-only tooling)** | SECURITY INVOKER; executable only by `postgres`; `ops` schema has no USAGE for anon/authenticated/service_role; not in the repository; uses the `http` extension (installed on staging only) to fetch pinned migration files with an md5 check | after staging bootstrap: `drop function ops.apply_pinned(text, text); drop schema ops;` and drop the `http` extension if unused — staging change, needs approval |
| S5 | `rls_enabled_no_policy` on 10 server-only tables | **Informational (by design: deny-all for browser roles)** | `RLS_CHECK PASS (51 checks)` includes direct-read denial on these tables | none |
| S6 | Staging vs production drift | **Informational (formatting/history only)** | aggregate definition hashes identical for 827 columns, 420 constraints, 236 indexes, 41 policies, 51 RLS flags, 26 browser grants, 11 triggers; 9 public functions differ byte-wise but their whitespace/comment-normalized hashes are identical; staging-only: `ops.apply_pinned`, `http` extension; history-only: production lacks 001/002 entries and names 008–012/014/015 without prefixes; staging has `020_user_deletion_guards_r2` | none for release; keep history notes in the rollout doc |
| S7 | Privileged credentials in client bundle | **No finding** | `node scripts/cto/scan-bundle.mjs dist`: PASS, 143 files; no service-role JWT, secret-key shape, service-role variable name or server secret value. INFO only: admin pages label `CRON_SECRET`/`ANALYTICS_SECRET`/`SECURITY_HASH_SECRET`, and the browser repo scanner matches `OPENROUTER_API_KEY` in user code (names, not values) | none |
| S8 | Verdict integrity: unlabelled workload → REJECTED on invented quality 0 | **Confirmed defect — fixed** (`1c89dc8`) | reproduced before the fix (`expected 'REJECTED' to be 'INCOMPLETE'`); regression `tests/unlabelled-evidence-verdict.test.ts` | done |

Executed staging database checks (both raise at the end, so every statement is rolled back):

| Check | File | Result |
|---|---|---|
| Role-switched RLS/privilege regression | `supabase/tests/rls_privilege_check.sql` | `RLS_CHECK PASS (51 checks)` — profile/credit/subscription self-escalation, self-join to another workspace, admin self-grant, foreign workspace/project/experiment/ZevIR rows, server-only tables and functions, remaining browser write grants, anon reads, service-role access |
| SECURITY DEFINER helpers | `supabase/tests/security_definer_check.sql` (new) | `SD_CHECK PASS (11 checks)` — asking about another user returns false; own-identity answers true; `workspace_role_of` / `is_admin` not executable by signed-in users; none executable by `anon` |

Not run: the same SQL on production (it is designed to be safe there, but production execution was out of scope today).

## 3. Leaked-password protection — exact remediation

Why: Supabase Auth can reject passwords found in the HaveIBeenPwned corpus; disabled on both projects.
How (staging first, then production; each needs approval because it changes Auth settings):
1. Dashboard → *Authentication* → *Attack Protection* (Password security) → enable **Prevent use of leaked passwords**.
   Equivalent Management API: `PATCH https://api.supabase.com/v1/projects/{ref}/config/auth` with `{"password_hibp_enabled": true}`.
   (This feature requires a paid Supabase plan.)
2. While there, set a minimum password length ≥ 8 (the API already rejects shorter ones in `/api/auth/password-login`).
3. Verify: security advisors no longer list `auth_leaked_password_protection`; a signup with a known-breached password is rejected.
Existing users are unaffected until they change their password.

## 4. Preview isolation — exact remediation (needs approval)

1. Vercel → `zevqora` → Environment Variables: for `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`,
   `DESKTOP_HANDOFF_SECRET`, `CRON_SECRET`, `PUBLIC_APP_URL`: remove the **Preview** target from the shared record.
2. Add Preview-scoped records (optionally restricted to a `staging` git branch) with **staging** values; set `SUPABASE_URL` for Preview to the staging URL.
3. Delete the stale CLI preview `dpl_D8yCisRHAzPUzRH26VLU2VCfUvGW` (or redeploy it after step 2).
4. Optional, recommended after step 1: rotate the production service-role key (the shared record dates from project creation, 2026-08-14).
5. Merge the audit branch so every future preview fails closed if the variables regress.
6. Verify: `GET <preview>/api/health` → `environment: "preview"`, `isolation.supabase_ref: "lxbcynzgeuqzmynkuzqg"`, `violation: null`; then `npm run staging:guard` passes.

## 5. Local test evidence (CI-equivalent, this machine)

Final run on `2e0f878` (clean tree), 2026-11-04T09:27Z–09:31Z — `node scripts/cto/run-gates.mjs`:

| Step | Command | Exit | Result |
|---|---|---|---|
| web.typecheck | `npm run typecheck` | 0 | PASS |
| web.lint | `npm run lint` | 0 | PASS |
| web.test | `npm run test` | 0 | **565 passed (565)** (baseline 530; +35 new) |
| web.proof_loop | `npm run test:proof-loop` | 0 | 1 passed |
| web.verify_release | `npm run verify:release` | 0 | PASS |
| web.build | `npm run build` | 0 | PASS |
| web.bundle_scan | `node scripts/cto/scan-bundle.mjs dist` | 0 | PASS (5 INFO name references) |
| web.api_load | `node --input-type=module -e "await import('./api/index.js')…"` | 0 | `api ok` |
| web.secret_scan | CI `git grep` pattern | 1 (no match) | PASS |
| backend.ruff_check / ruff_format | `python -m ruff check .` / `format --check .` | 0 / 0 | PASS |
| backend.pytest | `python -m pytest -q` | 0 | **189 passed, 12 skipped** (all 12: "DUREM repository not available") |
| desktop.typecheck / build / electron parse | `npm run typecheck`, `npx vite build`, `node --check electron/*.cjs` | 0 / 0 / 0 | PASS |
| evidence.verify | `python scripts/verify_evidence.py` | 0 | PASS |
| staging.guard_refusal | `npm run test:staging` (staging vars stripped) | 1 | **BLOCKED** — guard refused; 0 staging tests executed |

Baseline (unmodified `main@4d5de6f`): typecheck PASS, test 530/530, verify PASS, build PASS, api ok, backend 189/12, desktop PASS,
evidence PASS — matching CI. Its only lint error was in the new runner script itself (fixed).

Flakiness disclosed: on this Windows machine the unmodified baseline failed 1 of 3 full runs (`oauth-providers` 5 s timeout);
the audit branch showed the same flake once. Two full proof-loop runs in parallel with the unit suite starved timing-sensitive tests,
so the loop runs as its own step (`vitest.proof.config.ts`, new CI step). A real race in `website-admin-ui.test.tsx` was fixed.
CI (Linux) results for the audit branch are **not available** — the branch is not pushed.
