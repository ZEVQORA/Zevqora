# vNext Part 3 — Product Experience, Analytics and Admin Control Plane

Branch `nero/vnext-part3` (from `nero/vnext-part2b` @ c193f73). Nothing here is
pushed, deployed or applied to production.

Part 3 is the product experience and control plane on top of the existing
verified engine. It adds no optimization logic, no gateway, no new provider
and no autonomous production action. Every number it shows comes from an
existing table or API, or from the clearly labelled synthetic demo.

## 1. Audit (verified on 2026-10-08)

| Area | What exists | Part 3 decision |
|---|---|---|
| Repo | `ZEVQORA/Zevqora`, branch `nero/vnext-part2b` @ c193f73; user's `.gitignore` edit and four untracked log files left alone | branch `nero/vnext-part3` |
| Quality gate | typecheck 0, lint 0, **378/378 tests in 30 files** | baseline to preserve |
| Stack | React 19, Vite 7, Tailwind 4, React Router 7, Motion 12, Supabase JS 2, Vitest 3, PGlite | unchanged; no Next.js |
| Brand | `--zq-ink #0F1115`, `--zq-cloud #F7F8FA`, `--zq-blue #468BFF`, `--zq-stone #E6E9EE` in `globals.css`; Satoshi variable font self-hosted; traced mark and wordmark (`src/brand/marks.ts`, 98.8% / 98.1% IoU vs the board); Zev sprites `public/assets/zev/*.webp` extracted from the turnaround | reused exactly — see `part3-brand-system.md` |
| Marketing | `/`, `/pricing`, `/security`, `/team`, `/privacy`, `/terms`, `/download`; hero copy from `site_content` | redesign; add `/product`, `/technology`, `/evaluation`, `/company`; keep every old route |
| App | `/app` product views (overview, project, optimize, opportunities, experiments, evidence, savings, evaluation, changes, connections, zev) + workspace pages | new information architecture around them; all old paths keep working |
| Admin | `/admin` with users, workspaces, plans, content (direct save), flags (on/off + overrides), model pricing, audit log, admins; every route server-checked with `admin_roles`, every mutation in `admin_audit_log` | extend, never duplicate |
| Analytics | none for the website; `telemetry_events` is customer runtime telemetry (a product feature, not analytics) | first-party analytics (below) |
| Security events | none persisted; errors only logged | new server-only `security_events` |
| ZevIR | bounded read API: graphs, nodes, edges, evidence, node detail, BFS neighbourhood (depth ≤ 6, ≤ 500 nodes) | Graph Explorer on these routes; no new backend |
| Optimization | Part 2A run/contract/baseline/diagnoses/candidates, Part 2B search/calibration/replay/Pareto/decision/Bad-Day | wrapped, never rewritten |
| CSP | `script-src 'self'`; `connect-src 'self'` + Supabase | rules out third-party script CDNs |

## 2. Analytics architecture — one owner per domain

| Domain | Owner | Why |
|---|---|---|
| A. Website marketing analytics | **First-party Postgres** (`site_events`) via `POST /api/analytics/collect` | cookieless, no raw IP, no third party, works under the strict CSP; aggregated server-side in SQL so PostgREST row caps can never truncate a chart |
| B. Product usage analytics | **First-party Postgres** (`product_events`), typed versioned taxonomy, emitted server-side where the action happens | authoritative, deduplicated by key, joinable with workspace data without exporting it |
| C. Optimization / economic analytics | **Existing engine tables** (snapshots, searches, plans, decisions) | already the source of truth; never copied into an analytics store |
| Optional | Vercel Web Analytics (traffic cross-check) | only when `VERCEL_WEB_ANALYTICS=1`; same-origin script; shown as *not configured* otherwise |
| Not integrated | PostHog | would need a third-party origin in the CSP and is not needed for the funnels above; the admin shows it as *not integrated*, never as active |

Nothing sends prompts, outputs, traces, source code, evaluation samples or
credentials to any analytics system.

## 3. Visitor privacy model

* No cookies. A random per-tab `session_id` in `sessionStorage` (dies with the tab).
* `visitor_key` = HMAC-SHA256(daily secret, ip ‖ user-agent ‖ UTC day). It rotates every day,
  so it counts approximate daily unique visitors and cannot follow anyone across days or sites.
  The raw IP is never stored in `site_events`.
* Country / region come from the hosting edge headers and are labelled approximate.
* `DNT: 1` or `Sec-GPC: 1` → nothing is recorded. Collection is off until the global
  `visitor_intelligence` flag is turned on.
* Security operations keep a separate boundary: `security_events` stores a truncated IP prefix
  (IPv4 /24, IPv6 /48) and a keyed hash for correlation, is readable only through admin routes,
  every read is itself audited, and rows older than 90 days are purged by the daily cron.
  Site events are kept 400 days. Credentials are never logged.

## 4. Product event taxonomy (`zevqora.product_event.v1`)

`signup_started` (client, website) · `signup_completed` · `workspace_created` ·
`project_created` · `evidence_connected` · `trace_imported` · `baseline_created` ·
`contract_frozen` · `diagnosis_viewed` (client) · `plan_search_started` ·
`calibration_completed` · `full_replay_completed` · `verdict_verified` ·
`verdict_rejected` · `verdict_incomplete` · `pareto_viewed` (client) · `plan_selected` ·
`report_opened` (client) · `evaluation_requested`.

Every row carries `event`, `version`, `workspace_id`, `user_id`, `subject`, an
allow-listed `properties` object (ids, counts, enums — no free text) and a unique
`dedupe_key`, so a retried request can never count twice. Client-emitted view
events are accepted only for allow-listed names, only after a workspace
membership check, and are deduplicated per user/subject/day.

Funnel: Visitor → Signup → Workspace → Evidence connected → Baseline →
Optimization search → Replay → Verdict → Evidence viewed. Visitor counts come
from `site_events`; every later step is a distinct user from `product_events`.
History before 019 is not backfilled — the dashboards say so.

## 5. Database — migration 019 (additive)

`019_product_experience.sql` + `supabase/rollback/019_product_experience.rollback.sql`.

* `site_events`, `product_events`, `security_events`, `evaluation_requests`,
  `site_content_revisions` — RLS on, no browser policies, explicit revokes from
  `anon`/`authenticated` (hostile default grants tested), `service_role` only.
* `feature_flags` gains `targeting` (`off | internal | selected | limited | on`) and
  `rollout_percent`; `enabled` stays the legacy truth for flags without targeting.
  Limited rollout is deterministic: `sha256(flag:workspace) mod 100 < percent`.
  *Internal* = workspaces owned by an admin.
* SQL aggregate functions `analytics_site_summary`, `analytics_product_summary`
  (service role only).
* New flags: `zevir_graph_ui`, `visitor_intelligence` (off), `product_analytics` (on,
  first-party only), `experimental_graph_overlays`.

Site content stays published in `site_content` (public read, as today). Drafts,
history and rollback live in `site_content_revisions`, which the browser cannot read.

## 6. API (new handlers, same router, same auth helpers)

* `experience.js` — `GET /api/workspaces/:id/command-center` (observed / evaluated /
  projected / realized kept apart), `GET /api/workspaces/:id/workloads`,
  `POST /api/analytics/product-event` (allow-listed view events).
* `analytics.js` — `POST /api/analytics/collect` (public, rate-limited, DNT/GPC aware),
  `POST /api/evaluation-requests` (public, honeypot + rate limit).
* `admin-v3.js` — command centre, website/product/optimization analytics,
  security events (read audited), evaluation requests, CMS drafts/preview/publish/
  rollback/history, flag targeting, system health.
* The router records `security_events` for 401/403/429/5xx and for cross-workspace
  denials (the existing 404 for non-members is tagged at the source).

## 7. Product information architecture

Command Center · Workloads · Execution Graph · Diagnoses · Optimization ·
Experiments · Evidence · Changes · Value · Connections · Team · Settings
(+ Ask Zev, Usage, Docs, Desktop under "More").

A **presentation mode** (CEO / CTO / Developer) lives in the top bar. It changes
emphasis and wording only; every API still authorizes with workspace roles.
Old paths (`/app/project`, `/app/savings`, `/app/opportunities`, …) still resolve.

## 8. Graph Explorer

`@xyflow/react` (lazy-loaded on `/app/graph` only) for pan / zoom / fit / minimap /
touch. Layout is a deterministic layered layout written here (back edges detected,
so loops render instead of breaking the layout). Data comes from the existing bounded
ZevIR routes: ≤ 500 nodes per request, neighbourhood expansion through the BFS route.
Overlays: cost, latency, reliability, retries, tokens/context, security/policy metadata,
critical path (only from complete timing; otherwise the reason is shown).

## 9. Charts

The existing SVG chart primitives are extended (line, bar, funnel, scatter, share).
ECharts was evaluated and not added: ~1 MB unminified for charts we can draw in a few
hundred lines, and every chart here must carry a data-source/coverage/claim label and an
accessible table summary, which is simpler with our own components.

## 10. Website

`/` (12 sections from the brief), `/product`, `/technology`, `/security`,
`/evaluation` (real request form → `evaluation_requests`), `/company`, `/login`, `/signup`.
Per-route title/description/canonical/Open Graph, JSON-LD, sitemap, robots. Heavy
visuals lazy-load; all motion respects `prefers-reduced-motion`. The only performance
claim is the approved internal example (42.01% cheaper → REJECTED on quality).

## 11. Phases and commits

A audit + plan → B design system → C product experience → D graph explorer →
E analytics → F admin → G website → H QA. Each phase is committed separately.

## 12. Non-goals

No new optimization engine, gateway, provider, ZevIR backend, GPU work, coding agent,
autonomous deploy/merge/rollback, savings-share billing, fake live monitoring, fake
customers/testimonials/savings, or visitor identity resolution.
