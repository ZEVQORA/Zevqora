# 20 — CTO handoff (Khuslen), end of day 2026-11-13

Public repository: names and references only, never secret values. Supersedes the draft in PR ZEVQORA/Zevqora#21.

## Release

| Item | Value |
| --- | --- |
| Production URL | https://zevqora.vercel.app (admin: `/admin`) |
| `main` | `6fc537b8b20e913a9fe3f78a8e40536beb5533d6` — merge of PR ZEVQORA/Zevqora#23 (chat-first UX) |
| Production deployment | `dpl_73uMcT7pygfmkFu6tXP1Xmwz3t7j` — READY, `iad1`, aliases `zevqora.vercel.app` |
| Rollback candidate | `dpl_2QKq3pJqKSh41rFfzsrTNZMjy8Vg` (main `6118c15`, PR #22) — same database and env, safe to promote |
| Do not promote | `dpl_5GKGgvc7jwZVofhzWCBzbp9df5ih` (main `4d5de6f`) — built against the legacy database |
| Vercel project / team | `zevqora` (`prj_D4UBJZcnGCctIDSDz5sBgsncbSZj`) / `nero404` |
| Production database | Supabase `dhqagbcaqspdrxcsxgfb` (ap-southeast-2), fresh start since 2026-11-13 |
| Legacy database | Supabase `czhufhufvwvgyhjuaauo` — preserved untouched |

Today's releases, in order: PR #20 (launch: #16 hardening + #17 homepage/IDE/Claude adapter), PR #22 (Quick Tour), PR #23 (chat-first app). Ledgers: `docs/handoff/19-EXECUTION-2026-11-13.md`, `docs/handoff/21-UX-RELAUNCH-2026-11-13.md`, daily report `docs/handoff/22-EOD-2026-11-13.md`.

## Architecture

- Web: Vite + React 19 + TypeScript + Tailwind v4 (`src/`), SPA on Vercel.
- API: one function `api/index.js` → `api/_lib/router.js` → `api/_lib/handlers/*` (Node, `maxDuration` 120 s).
- Data/auth: Supabase Auth + Postgres with RLS; service-role key only in `api/_lib/supabase.js`.
- Signed-in home `/app`: chat-first Zev (`src/product/command/ZevHome.tsx`) on `POST /api/engine/agent/chat`. Dashboard at `/app/command` ("Overview"). IDE at `/app/zev`.
- Engineering Zev provider (`api/_lib/anthropic.js` `engineeringZevProvider`): `ENGINEERING_ZEV_PROVIDER` pins `anthropic` | `openrouter`; otherwise Claude when `ANTHROPIC_API_KEY` is set, else OpenRouter, else none. **Pinning `anthropic` without a key yields "Unavailable", not an OpenRouter fallback.**
- Explanation style: `profiles.onboarding.explain_mode` → `explain_mode` on chat; allow-listed, wording only (never authorization).
- Public Ask Zev: `POST /api/support/message` (public knowledge, limits via migration 021).
- Desktop: `desktop-app/` unchanged today.

## Environment variables (Production) — names only, checked 2026-11-13 ~15:15 UTC

| Name | State |
| --- | --- |
| `SUPABASE_URL`, `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` | present → `dhqag…` |
| `SUPABASE_SERVICE_ROLE_KEY` | present (Sensitive) |
| `OPENROUTER_API_KEY` | present (Sensitive) |
| `PUBLIC_SUPPORT_AI_ENABLED` | `true` |
| `SECURITY_HASH_SECRET`, `ANALYTICS_SECRET`, `CRON_SECRET`, `DESKTOP_HANDOFF_SECRET`, `PUBLIC_APP_URL`, `PUBLIC_CONTACT_EMAIL`, `PUBLIC_DESKTOP_DOWNLOAD_URL` | present |
| **`ANTHROPIC_API_KEY`** | **absent** — Claude is not active |
| `ENGINEERING_ZEV_PROVIDER`, `ENGINEERING_ZEV_MODEL`, `ENGINEERING_ZEV_DAILY_CAP`, `ENGINEERING_ZEV_DAILY_USD_WORKSPACE`, `ENGINEERING_ZEV_DAILY_USD_PLATFORM` | absent → defaults: auto, `claude-opus-5-5`, 200 requests/day per scope, $5/day per workspace, $50/day platform |
| Stripe | absent (`stripeConfigured: false`) |

Preview: Preview-scoped `OPENROUTER_API_KEY` and branch-scoped secrets for `design/aurora-redesign` remain; previews are skipped by `vercel.json` `ignoreCommand`. Remove or rotate before enabling previews.

## Claude activation (owner, then CTO)

Status: **not configured, not verified.** No live Claude call has been made on any environment; all Claude behaviour is covered by tests with an injected client (`tests/engineering-zev-claude.test.ts`, 32 tests).

1. Owner: create an API key in the Anthropic Console (API billing, not a Claude.ai subscription) and set a monthly spend limit there.
2. Vercel → Project `zevqora` → Settings → Environment Variables: add `ANTHROPIC_API_KEY` as **Sensitive**, **Production only**. Optionally add `ENGINEERING_ZEV_PROVIDER=anthropic` in the same step (only together with the key).
3. Redeploy production (Deployments → current → Redeploy, or merge any PR to `main`). Environment changes need a new deployment.
4. Verify signed in at `/app`: the provider pill reads **Claude**. Ask one short question (for example "What can you see in this workspace?"). The reply shows `Claude · claude-opus-5-5`. A short answer typically costs cents. The worst case per request is ≤4 model calls of up to 8000 output tokens each, reserved up front and capped by the $5/day workspace and $50/day platform budgets.
5. Usage accounting: the call reserves its worst case in `usage_budget_counters` under `engzev:usd:<scope>:<day>` and `engzev:usd:platform:<day>`, then reconciles to the measured cost. Check with a read-only query on those buckets. If the counter RPC is unavailable the server refuses (fails closed).
6. If the model is unavailable to the key, set `ENGINEERING_ZEV_MODEL` to an available Claude model id and redeploy; the error is shown sanitized in the chat.

## Database state (`dhqag…`, read live 2026-11-13 ~15:20 UTC)

- 22 migrations recorded; latest `usage_budget_counters` (022) and `public_support_rate_limits` (021, creates `public_rate_limits` + `public_rate_limit_hit`).
- Feature flags: ON `cloud_replay`, `pdf_export`, `product_analytics`, `runtime_telemetry`. OFF `zevir_shadow`, `zevir_graph_ui`, `verified_optimization_vnext`, `optimization_intelligence_vnext`, `experimental_graph_overlays`, `github_integration`, `enterprise_sso`, `visitor_intelligence`.
- No active telemetry connection tokens and no telemetry events yet (no LiteLLM gateway connected).
- One superadmin (founder-designated). Backups/PITR not confirmed with available tools — confirm in the Supabase dashboard.

## Health and controls

- `GET /api/health` (public): `ok: true`, `environment: production`, `isolation.supabase_ref` and `public_supabase_ref` = `dhqag…`, `violation: null` (verified 15:17 UTC).
- Unauthenticated `GET /api/me`, `/api/engine/health`, `/api/admin/command-center`, `/api/admin/analytics/product`, `POST /api/engine/agent/chat`, `POST /api/telemetry/ingest` → 401 (verified 15:18 UTC).
- Spending controls: Engineering Zev request cap + USD reservations (022), fail closed; public Ask Zev daily cap 300 with per-visitor limits (021); telemetry ingest 120 requests/min per token, ≤500 events per request.
- Off switches: `ENGINEERING_ZEV_DAILY_CAP=0` pauses Engineering Zev; `PUBLIC_SUPPORT_AI_ENABLED=false` makes public Ask Zev FAQ-only; `runtime_telemetry` flag off pauses token issue and ingest. Each env change needs a redeploy.

## Connectors — what is real

| Connector | State |
| --- | --- |
| LiteLLM gateway | Working path: scoped `server_telemetry` token (shown once, revocable) + metadata-only callback to `/api/telemetry/ingest`. "Data flowing" only after stored events. Not yet exercised with a real gateway. Feeds cost/latency views, **not** replay or verification. |
| OpenTelemetry / OpenInference | `/api/zevir/ingest`, gated by `zevir_shadow` (off globally). |
| Trace import (JSON/JSONL), local folder scan | Working (Advanced). |
| Vercel | Not built: needs a registered Vercel integration (OAuth client, redirect, read-only scopes). UI says "Coming soon". |
| GitHub App, provider OAuth (OpenAI/Anthropic), LangSmith, Langfuse | Not built; shown as not available. |

## Outstanding ZevIR / vNext

- Flags off globally: `zevir_shadow`, `zevir_graph_ui`, `verified_optimization_vnext`, `optimization_intelligence_vnext`. Enable `zevir_shadow` for one internal workspace first, run an OTel ingest, then `zevir_graph_ui`.
- Durable checkpoint/resume for long optimizer runs; broader model coverage for replays.
- Realized production savings are not measured by any release ("NOT YET MEASURED" in UI).

## Outstanding security items

- SEC-03: Supabase Auth signup email enumeration — enable CAPTCHA / rate limits or accept the risk in writing.
- Leaked-password protection disabled in Supabase Auth (advisor WARN).
- SECURITY DEFINER helpers callable by `authenticated` (`has_workspace_role`, `is_workspace_member`, `shares_workspace_with`) — review.
- Preview-scoped secrets listed above — remove or rotate.
- No isolated staging; staging E2E (`tests/staging`) has never run.

## Monitoring and incident response

- Daily: Vercel → Project → Observability / Runtime errors (filter `/api`), and `GET /api/health`.
- Admin → Overview / System health / Security for 5xx, auth and rate-limit signals (5xx are recorded as `security_events`, route only).
- Scripted probes hit Vercel's Security Checkpoint (429): use a browser or a protection-bypass token.
- Incident: (1) identify the deployment and first error time; (2) if user-facing and caused by the latest release, promote `dpl_2QKq3pJqKSh41rFfzsrTNZMjy8Vg`; (3) if AI spend is the issue, set the relevant cap env to 0 and redeploy; (4) record the timeline in `docs/handoff/`.

## Rollback

1. Code: promote `dpl_2QKq3pJqKSh41rFfzsrTNZMjy8Vg` in Vercel, or revert the merge (`git revert -m 1 6fc537b` via PR). PR #23 changed no schema or data, except that telemetry ingest now updates `last_seen_at` only for stored events.
2. Never promote `dpl_5GKG…` (legacy database).
3. Database: 021/022 are additive with rollbacks in `supabase/rollback/`; not needed for a code rollback.

## Next priorities for Khuslen

1. Claude: once the owner adds the key, redeploy and run the single bounded verification above; record the outcome.
2. Security: SEC-03 decision, leaked-password protection, SECURITY DEFINER review, Preview secret cleanup; confirm backups.
3. Staging: provision isolated Supabase + Vercel target and run the auth/session/cross-tenant E2E.
4. One real LiteLLM gateway end to end (token → events → "Data flowing"), then decide whether usage telemetry should feed the proof engine.
5. ZevIR shadow on an internal workspace; Vercel integration only after a registered, reviewed OAuth app.
