# 20 — CTO handoff (Khuslen), production launch 2026-11-13

Public repository: names and references only, never secret values.

## Release

| Item | Value |
| --- | --- |
| Production URL | https://zevqora.vercel.app |
| Admin | https://zevqora.vercel.app/admin |
| `main` merge commit | `59576b662786751d66004423d6166304aae337b8` (PR ZEVQORA/Zevqora#20) |
| Vercel project / team | `zevqora` (`prj_D4UBJZcnGCctIDSDz5sBgsncbSZj`) / `nero404` |
| Production deployment | `dpl_J663JuZ35CV5pr2TGBrtyU8w8Lxt` — READY, region `iad1` |
| Previous production (rollback candidate) | `dpl_5GKGgvc7jwZVofhzWCBzbp9df5ih` (main `4d5de6f`) — **built against the legacy database**; see Rollback |
| Production database | Supabase `dhqagbcaqspdrxcsxgfb` ("Zevqora.ai", ap-southeast-2) — fresh start, CEO decision 2026-11-13 |
| Legacy database | Supabase `czhufhufvwvgyhjuaauo` — preserved untouched for future migration/recovery |

Composition of the release: PR #16 (launch hardening: SEC-01/02, isolation guards, signed-in `/` → `/app`), PR #17 (three-scene homepage, Ask Zev stage, app navigation, Engineering Zev IDE, Claude adapter with budgets, welcome, optimizer `spend_skipped` fix), PR #18 (narrative, folded into #17). Ledger: `docs/handoff/19-EXECUTION-2026-11-13.md`.

## Architecture

- Web: Vite + React 19 + TypeScript + Tailwind v4 (`src/`), served by Vercel as a SPA (`vercel.json` rewrites).
- API: one Vercel function `api/index.js` → `api/_lib/router.js` → `api/_lib/handlers/*` (Node, `maxDuration` 120 s).
- Data/auth: Supabase Auth + Postgres with RLS; the server uses the service-role key only in `api/_lib/supabase.js`.
- Public Ask Zev: `POST /api/support/message` (`handlers/support.js`, public knowledge only, durable limits via migration 021).
- Engineering Zev (signed-in): `POST /api/engine/agent/chat` (`handlers/engine.js`); provider = Claude (`api/_lib/anthropic.js`) when `ANTHROPIC_API_KEY` is set, else OpenRouter platform compute, else "not configured". Read-only tools, server-scoped to the authorized product.
- Desktop: `desktop-app/` (Electron + FastAPI), unchanged by this release.

## Environment variables (Production) — names and owners

| Name | Present | Owner / note |
| --- | --- | --- |
| `SUPABASE_URL`, `PUBLIC_SUPABASE_URL` | yes → `dhqag…` | Founder |
| `PUBLIC_SUPABASE_ANON_KEY` | yes (publishable key of `dhqag…`, verified) | Founder |
| `SUPABASE_SERVICE_ROLE_KEY` | yes (verified working against `dhqag…` by a live limiter write) | Founder |
| `OPENROUTER_API_KEY` | yes (live completion verified via public Ask Zev) | Founder |
| `PUBLIC_SUPPORT_AI_ENABLED` | `true` (public Ask Zev answers generatively; daily cap 300, per-visitor limits) | Founder |
| `ANTHROPIC_API_KEY` | **absent** | Founder — add as Sensitive, Production only, to enable Claude |
| `ENGINEERING_ZEV_PROVIDER`, `ENGINEERING_ZEV_MODEL`, `ENGINEERING_ZEV_DAILY_CAP`, `ENGINEERING_ZEV_DAILY_USD_WORKSPACE`, `ENGINEERING_ZEV_DAILY_USD_PLATFORM` | absent (defaults: auto, `claude-opus-5-5`, 200 req, $5, $50) | CTO |
| `PUBLIC_SUPPORT_AI_MODEL`, `PUBLIC_SUPPORT_AI_DAILY_CAP` | absent (defaults `openai/gpt-4o-mini`, 300) | CTO |
| `SECURITY_HASH_SECRET`, `ANALYTICS_SECRET`, `CRON_SECRET`, `DESKTOP_HANDOFF_SECRET`, `PUBLIC_APP_URL`, `PUBLIC_CONTACT_EMAIL`, `PUBLIC_DESKTOP_DOWNLOAD_URL` | yes | Founder |
| Stripe | absent (`stripeConfigured: false`) | Founder (deferred) |

Preview: no Supabase credentials in Preview targets. Branch-scoped Preview secrets remain for `design/aurora-redesign` (`ANALYTICS_SECRET`, `SECURITY_HASH_SECRET`) and a Preview `OPENROUTER_API_KEY` exists; previews are skipped by `vercel.json` `ignoreCommand` plus the project-level Ignored Build Step. Clean these up or rotate before ever enabling previews.

## Database state (`dhqag…`)

- Migrations applied: 001–020, then **021 `public_support_rate_limits`** and **022 `usage_budget_counters`** (applied 2026-11-13 12:29 UTC before the merge; additive; RLS on, anon/authenticated denied, service_role only; rollbacks in `supabase/rollback/`).
- No platform backup could be triggered or confirmed with the available tools. Confirm daily backups / PITR in the Supabase dashboard (Database → Backups) for this project's plan.
- Admins: exactly one `superadmin` (the founder-designated account). Granted directly in `public.admin_roles` (same mechanism as migration 005).
- Feature flags (global): ON — `cloud_replay`, `pdf_export`, `product_analytics`, `runtime_telemetry`. OFF — `zevir_shadow`, `zevir_graph_ui`, `verified_optimization_vnext`, `optimization_intelligence_vnext`, `experimental_graph_overlays`, `github_integration`, `enterprise_sso`, `visitor_intelligence`. No plan/workspace overrides.
- Security advisor: INFO "RLS enabled, no policy" on service-role-only tables (intended); WARN SECURITY DEFINER helpers callable by `authenticated` (`has_workspace_role`, `is_workspace_member`, `shares_workspace_with`, used by RLS — review); WARN leaked-password protection disabled (enable in Auth settings).

## Endpoints and health checks

- `GET /api/health` — public: `ok`, `environment`, `isolation` (expected `supabase_ref`/`public_supabase_ref` = `dhqag…`, `violation: null`).
- `GET /api/public-config` — public config (Supabase URL, publishable key, contact).
- `GET /api/engine/health` — signed-in: `engineering_zev_provider` (`anthropic` | `openrouter` | `none`) and model.
- `POST /api/support/message` — public Ask Zev; response `mode: faq | ai`.
- Scripted clients get Vercel's Security Checkpoint (HTTP 429); use a browser or a bypass token for probes.

## SHIPPED / VERIFIED / DEFERRED / BLOCKED

**VERIFIED on production (2026-11-13 ~12:55 UTC):** deployment READY at `59576b6`; homepage renders three scenes (hero without chat, `#ask-zev` stage with the only composer, `#workbench`, `#proof`); `/api/health` ok with both refs `dhqag…` and no isolation violation; public config points at `dhqag…`; public Ask Zev answered in `mode: "ai"` (OpenRouter live; service-role key and migration 021 working on `dhqag…`); unauthenticated `/api/engine/health` and `/api/admin/*` return 401; mobile 390: no horizontal overflow, full-height menu; no error/warning runtime logs for the deployment in the first 20 minutes.

**Founder-confirmed on production (2026-11-13, reported by the founder, not independently logged):** sign-in with the superadmin account → `/app` with the Welcome back area; `/admin` opens for the superadmin.

**SHIPPED, verified only by tests (not on production):** returning-session restore after browser restart, navigation, Engineering Zev IDE and its provider label, non-admin denial in the admin UI (unauthenticated 401 is verified live), Claude adapter (provider selection, workspace authorization, USD budgets, fallback accounting).

**DEFERRED:** ZevIR/vNext rollout (flags off); additional integrations (GitHub OAuth, provider OAuth); durable checkpoint/resume for long optimizer runs; broader provider/model verification; observability (alerts, error tracking); UI/mobile refinements in the app; Stripe.

**BLOCKED / owner action:** live Claude (`ANTHROPIC_API_KEY` absent); isolated staging environment + E2E (staging project inactive; `npm run staging:guard` refuses); SEC-03 (GoTrue signup email enumeration — enable CAPTCHA/rate limits in Supabase Auth or accept the risk in writing); legacy-user migration (separate, owner-approved window).

## Rollback

1. Code: in Vercel, promote a previous production deployment (Deployments → … → Promote). **Caution:** `dpl_5GKG…` was built when Production pointed at the legacy database, so promoting it would serve the legacy data. Prefer reverting the merge on `main` (`git revert -m 1 59576b6` via PR) so the rebuild uses the current `dhqag…` env.
2. Database: migrations 021/022 are additive; their rollbacks (`supabase/rollback/021_*.sql`, `022_*.sql`) only drop the new objects. The pre-release code ignores them, so a code rollback does not require a schema rollback.
3. Public AI off switch: set `PUBLIC_SUPPORT_AI_ENABLED=false` (or `PUBLIC_SUPPORT_AI_DAILY_CAP=0`) and redeploy → FAQ only.

## Recommended next priorities

1. Founder: confirm Supabase backups for `dhqag…`; enable leaked-password protection and CAPTCHA (SEC-03).
2. Provision isolated staging (own Supabase + Vercel target) and run the auth/session/cross-tenant E2E (`tests/staging`).
3. Add `ANTHROPIC_API_KEY` and run one budgeted live Engineering Zev call; confirm `engineering_zev_provider: anthropic`.
4. Error monitoring and alerting on `/api/*` 5xx and Supabase auth errors.
5. Review the three SECURITY DEFINER helpers flagged by the advisor.
6. Plan the legacy-user migration (UUID-preserving) as its own project.
7. ZevIR/vNext: enable `zevir_shadow` for an internal workspace first, then `zevir_graph_ui`.
