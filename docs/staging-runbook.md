# Staging runbook — vNext Part 3.5

Purpose: verify Part 3 (and the unpushed ZevIR / 2A / 2B work it sits on) against a
**real, isolated Supabase project** and a **Vercel preview** before anything reaches
production. Nothing here has been executed yet. Every cloud step below needs explicit
founder approval.

## 0. Facts verified on 2026-10-12

| Item | State |
|---|---|
| Local branch | `nero/vnext-part3` — commits since `origin/nero/mvp-proof-engine` (ZevIR Part 1 → Part 3.5) are on no remote; list them with `git log --oneline origin/nero/mvp-proof-engine..HEAD` |
| GitHub `ZEVQORA/Zevqora` | **public**; no `nero/vnext-*` branches; `main` = `97079d5` |
| Supabase production | project ref `czhufhufvwvgyhjuaauo` (`Zevqora`, ACTIVE_HEALTHY) |
| Production migration history | 003–012, 014, 015 tracked. **013 (`site_hero_copy`) is not in the history.** 016–019 not applied. (001/002 predate tracking.) |
| Vercel | serves older `main` builds; no Part 3 preview |

## 1. Staging environment (choose one; both need approval)

**A. Dedicated staging project (recommended).** A new Supabase project, e.g.
`zevqora-staging`, in the same organization, with its own keys, auth users and
SMTP settings. Fully independent of production data and credentials.

**B. Supabase development branch of production.** Branches start with schema only
(no production rows) and their own keys; billing applies while the branch exists.
Delete it after the run.

Rules for either: synthetic data only; staging-only secrets (never the production
service-role key); email confirmation may stay on (the suite creates its identities
through the admin API and also exercises self-service signup).

## 2. Migration order for an empty staging database

Apply every file in `supabase/migrations/` in numeric order:

```
001 → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009 → 010 → 011 → 012
→ 013 → 014 → 015 → 016 → 017 → 018 → 019
```

Dependencies:

* Extensions: `pgcrypto` (created by 001). `gen_random_uuid()` is core Postgres.
* Supabase platform objects: `auth.users`, `auth.uid()`, roles `anon`,
  `authenticated`, `service_role` (present in every Supabase project).
* 005 grants `superadmin` to the two founder emails **if those accounts exist**.
  Staging test users use other emails; the staging admin is granted by the suite.
* 013 → 019: 019's hero-copy update is guarded on 013's exact text; without 013
  it does nothing (see §6).
* Data dependencies: 016 (ZevIR) reads `engine_*` from 009; 017/018 add
  `(id, workspace_id)` keys on 009 tables; 019 seeds content history from the
  `site_content` rows created by 004 and updated by 013.

Before 019 on a database that matters, run the tested dry-run wrapper
(`raise exception 'OPT19_DRY_RUN_OK'`, see `vnext-part3-rollout.md`).

## 3. Validation after migrating staging

1. `supabase/tests/rls_privilege_check.sql` (SQL editor) → expect `RLS_CHECK PASS`.
   Needs at least one workspace member: run it again after the suite creates users.
2. Advisors (security + performance) → no new ERROR-level findings.
3. Spot queries:
   ```sql
   select key, targeting, rollout_percent, enabled from feature_flags order by key;
   select key, version, status from site_content_revisions order by key, version;
   select relname, relrowsecurity from pg_class
    where relname in ('site_events','product_events','security_events','evaluation_requests','site_content_revisions');
   select has_table_privilege('anon','public.security_events','select'),
          has_table_privilege('authenticated','public.evaluation_requests','select');  -- both false
   ```

## 4. Preview deployment pointed at staging

A Vercel **preview** (never production) of `nero/vnext-part3` with staging values
for these variables (names only — never commit values):

```
PUBLIC_APP_URL                PUBLIC_SUPABASE_URL          PUBLIC_SUPABASE_ANON_KEY
PUBLIC_CONTACT_EMAIL          PUBLIC_DESKTOP_DOWNLOAD_URL
SUPABASE_URL                  SUPABASE_SERVICE_ROLE_KEY    (staging project's key)
CRON_SECRET                   DESKTOP_HANDOFF_SECRET
ANALYTICS_SECRET              SECURITY_HASH_SECRET          (≥ 32 random chars, staging-only)
OPENROUTER_API_KEY            (optional; unset keeps replays deterministic-only)
STRIPE_*                      (leave unset in staging)
VERCEL_WEB_ANALYTICS          (optional)
```

Preview deployments sit behind Vercel deployment protection; either use a protection
bypass token for the test runner or temporarily allow the runner. Note: pushing the
branch to the public GitHub repository is what triggers the preview — see §8.

## 5. Running the real-environment suite

```
STAGING_SUPABASE_URL=…  STAGING_SUPABASE_ANON_KEY=…  STAGING_SUPABASE_SERVICE_ROLE_KEY=…
STAGING_APP_URL=https://<preview>.vercel.app  STAGING_CONFIRM=I_UNDERSTAND_THIS_IS_STAGING
npm run test:staging
```

`scripts/staging/guard.mjs` refuses the production project ref, production domains,
a missing confirmation phrase, or a staging key equal to the production-named one.
`tests/staging/staging.e2e.staging.ts` (14 tests) covers: real signup; session and
tampered tokens; cross-workspace isolation through both the API and PostgREST/RLS;
viewer read-only enforcement; non-admin denial on every admin route (and its security
event); browser roles denied on all Part 3 tables and functions; public vs draft
content; no service-role key in the deployed bundle; admin reads audited; evaluation
requests; CMS draft → publish → restore; flag targeting per workspace; the
incomplete-workload path (null cost, INCOMPLETE baseline, rejected trace); and the
labelled synthetic demo through baseline → graph → diagnosis → plan search → replay
→ VERIFIED and REJECTED → decision, with no implementation created and realized
value NOT_YET_MEASURED. Everything it creates is deleted in `afterAll`.

## 6. Production order (after staging passes and approval)

1. Apply **013** (guarded; only replaces the original 004 hero seed).
2. Apply 016, 017, 018 (see `vnext-part2b-rollout.md`), then 019 (dry run first).
3. `rls_privilege_check.sql` + advisors.
4. Set the new secrets; deploy; follow `vnext-part3-rollout.md` §Steps 5–7.

If 013 is skipped, production keeps the 004 hero ("Make AI lighter.", CTA to
`/signup`) until an admin publishes new copy in the CMS — nothing breaks.

## 7. Rollback

`vnext-part3-rollout.md` §Rollback (019), then `vnext-part2b-rollout.md` for 018 and
earlier. A staging project is simply deleted; a development branch is deleted.

## 8. Push / PR procedure (needs approval — the repository is public)

1. Confirm `git status` shows only the founder's own `.gitignore` edit and log
   files, and never stage them (`git add` explicit paths only).
2. Re-run `npm run typecheck && npm run lint && npm test && npm run build && npm run verify:release`.
3. `git push -u origin nero/vnext-part3` — publishes every commit listed by `git log origin/nero/mvp-proof-engine..HEAD`, including the
   docs under `docs/` (architecture, security model, rollout). No secrets are in the
   diff (scanned 2026-10-12); review the docs for anything not meant to be public.
4. Open a **draft** PR into `main`; do not merge until staging passes.
