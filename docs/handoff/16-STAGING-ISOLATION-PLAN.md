# Staging Isolation Plan — Vercel Preview vs Production (2026-11-04)

**Status: PLAN ONLY — NOT EXECUTED. Requires explicit approval from Khuslen (CTO) and Nero (Vercel project owner).**
Production must stay byte-for-byte unchanged: no production value edited, no production redeploy, no production database change.

## 1. Current state (read-only evidence, 2026-11-04)

Vercel project `zevqora` (`prj_D4UBJZcnGCctIDSDz5sBgsncbSZj`, team `nero404`). Env records listed without decryption:

| Key | Record id | Targets | Kind |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | `zk4qE1RUpHwv3Kmz` | production, preview | **credential — must split** |
| `PUBLIC_SUPABASE_URL` | `cD2BgvMImixC5LUf` | production, preview | **DB target — must split** |
| `PUBLIC_SUPABASE_ANON_KEY` | `S1y7Tw4nn3MW5d8i` | production, preview | **DB target — must split** |
| `DESKTOP_HANDOFF_SECRET` | `qL0lgU4dvDIpRpxL` | production, preview | secret — split |
| `CRON_SECRET` | `tR0MJfaeCkmz0Tji` | production, preview | secret — split |
| `PUBLIC_APP_URL` | `BYnRSqE0yooOvu70` | production, preview | link target — split (invite/billing links must not send staging users to production) |
| `PUBLIC_CONTACT_EMAIL` | `x7uYQAamWMuBoE7F` | production, preview | public — may stay shared |
| `PUBLIC_DESKTOP_DOWNLOAD_URL` | `pc7c0XJvL79JdNZU` | production, preview | public — may stay shared |
| `SUPABASE_URL` | `vbbxC0RAWQcthS0Z` | production | unchanged |
| `ANALYTICS_SECRET` | `lDml9WUNkgBQqEkD` | production | unchanged |
| `SECURITY_HASH_SECRET` | `b6Wt0nyOu9LXvgz4` | production | unchanged |
| `OPENROUTER_API_KEY` | `a7xjJfVmu0dkHzN9` / `lfu7Kxd9RhlXtuaJ` | production / preview (separate) | preview record: remove or keep — see §4 step 6 |

Deployments: production `dpl_5GKGgvc7jwZVofhzWCBzbp9df5ih` (READY, `main@4d5de6f`); stale preview
`dpl_D8yCisRHAzPUzRH26VLU2VCfUvGW` (READY, CLI, 2026-11-02, built with the production credentials). SSO protection on all
deployment URLs except custom domains.

## 2. Why this does not disrupt production

- A Vercel deployment's environment is fixed when it is built. Editing variables never changes a running deployment, so the
  live production deployment is untouched by every step below.
- The shared records keep their **id, value and production target**; only `preview` is removed from their target list. Any
  future production build reads exactly the same values as today.
- No step edits a production value, triggers a production deployment, or touches the production Supabase project.
- Conversely, removing `preview` does **not** clean already-built previews: `dpl_D8yC…` keeps the production key until it is
  deleted (step 5). That is why deletion is part of the plan.
- Order matters: Vercel does not allow two records with the same key for the same target, so the Preview target is removed
  first and the staging-valued Preview record added immediately after. In that window previews have no Supabase variables and
  fail (`Supabase server configuration is incomplete.`) — fail closed, production unaffected.

## 3. Preconditions

1. Draft PR from `cto/release-gates-audit-2026-11-04` reviewed; merging it is recommended **before** step 4 so every new preview
   runs `api/_lib/env-isolation.js` (503 if it ever points at production again). Merging to `main` triggers a normal
   production build of `main`; schedule it as its own decision.
2. Staging values gathered by Khuslen directly from the Supabase dashboard of `lxbcynzgeuqzmynkuzqg` (Settings → API) and typed into
   Vercel by him/Nero. **Never pasted into chat, tickets or git.**
3. New random staging secrets (≥ 32 chars) for `DESKTOP_HANDOFF_SECRET`, `CRON_SECRET`, `ANALYTICS_SECRET`, `SECURITY_HASH_SECRET`
   (e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, run locally).
4. A read-only snapshot of the env list (key, id, targets, `updatedAt`) saved before starting, to diff afterwards.

## 4. Steps (each one needs the approval; executed by Nero or Khuslen in the Vercel dashboard, or by the agent via the Vercel API only after approval)

1. **Snapshot** (read-only): list env records; record ids/targets/`updatedAt`; confirm production deployment id is still `dpl_5GKG…`.
2. **Remove Preview from the shared credential records** — edit targets only, value untouched:
   `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `DESKTOP_HANDOFF_SECRET`, `CRON_SECRET`, `PUBLIC_APP_URL`
   → targets `[production]`. (API: `PATCH /v9/projects/{id}/env/{recordId}` with `{"target":["production"]}` and no `value` field.)
3. **Add Preview records with staging values** (type `sensitive`, target `preview`, optionally `gitBranch: staging` to limit them to one branch):
   `SUPABASE_URL` = `https://lxbcynzgeuqzmynkuzqg.supabase.co`, `PUBLIC_SUPABASE_URL` = same, `PUBLIC_SUPABASE_ANON_KEY` = staging anon key,
   `SUPABASE_SERVICE_ROLE_KEY` = staging service-role key, `DESKTOP_HANDOFF_SECRET` / `CRON_SECRET` / `ANALYTICS_SECRET` /
   `SECURITY_HASH_SECRET` = new staging secrets, `PUBLIC_APP_URL` = the staging preview URL.
4. **Verify the records** (read-only): every credential key has exactly one production record (same id and `updatedAt` as the
   snapshot for the value) and one preview record (new id). Diff against the snapshot.
5. **Delete the stale preview** `dpl_D8yCisRHAzPUzRH26VLU2VCfUvGW` (it was built with the production key).
6. **OpenRouter in Preview**: remove the preview `OPENROUTER_API_KEY` record (keeps staging deterministic and avoids paid calls) —
   or keep it only with an explicit spend approval.
7. **Create one staging preview**: either a CLI preview of the merged branch, or allow a `staging` branch in `vercel.json`'s ignore
   step (code change via PR: add `|| [ "$VERCEL_GIT_COMMIT_REF" = "staging" ]`) — never broaden it to all branches.
8. **Verify isolation at runtime** (read-only):
   `GET <preview>/api/health` (with `x-vercel-protection-bypass` if needed) → `environment: "preview"`,
   `isolation.supabase_ref` and `public_supabase_ref` = `lxbcynzgeuqzmynkuzqg`, `service_key_project` ≠ `mismatch`, `violation: null`;
   `GET <preview>/api/public-config` → staging URL; then `npm run staging:guard` → `STAGING_GUARD PASS`.
9. **Production check** (read-only): production deployment id unchanged; `https://zevqora.vercel.app/api/health` 200; site loads.
10. Only then: run Gate 1 (`npm run test:staging`) with the approved disposable staging writes.

Optional, separate approval (this one **is** a production change): rotate the production service-role key in Supabase and update
the production record + redeploy production in a maintenance window. Recommended because previews held the key since project creation.

## 5. Rollback

- Steps 2–3: delete the new Preview records and re-add `preview` to the original records' targets → exactly today's state
  (which re-opens the risk; production never changed in either direction).
- Step 5 cannot be undone, and does not need to be (a preview).
- Step 7 (`vercel.json`): revert the PR.

## 6. Alternative without any Vercel change (for Gate 1 only)

Serve the API locally against staging: put staging values for `SUPABASE_URL`, `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` in an untracked `.env.staging.local`, run `node --env-file=.env.staging.local scripts/dev-api.mjs`,
`npm run build`, then run `npm run test:staging` with `STAGING_APP_URL=http://127.0.0.1:3000` (loopback mode, guarded). This proves
the API and RLS against hosted staging; it does **not** fix B1 (previews still hold production credentials until steps 2–5).

## 7. Status markers (until genuinely verified)

- Staging E2E: **BLOCKED**
- Live customer proof: **BLOCKED** (fixture proof only)
- Preview isolation: **NOT DONE** (plan above, awaiting approval)
