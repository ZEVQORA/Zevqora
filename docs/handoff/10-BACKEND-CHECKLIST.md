# Backend Implementation Checklist — Staging and Real Integration

Updated 2026-10-31. Audited against `api/_lib/handlers/*.js`, `api/_lib/auth.js`, `api/_lib/zevir/*`, `api/_lib/platform-compute.js` and `supabase/migrations/*` at release `8e591cd` (this branch changes none of them).

How to read this file:
- **EXISTING** means the route is registered in the release source, with `file:line`. It does **not** mean deployed, migrated or tested against real Postgres.
- **PROPOSED** means no route exists. The frontend never calls it (`disconnectedGateway`, `PUBLIC_SUPPORT_MODE='public_faq'`, `ENTERPRISE_REQUEST_API_AVAILABLE=false`).
- **EXTEND** means build on an existing route or table instead of adding a parallel one.

Route inventory: 151 `on()` calls in 19 handler files. That is 151 method+path routes once the `calibrate`/`replay` loop at `optimize-search.js:122` expands, plus `OPTIONS /api/telemetry/ingest`. (Earlier handoff text said 141; corrected here and in `02`.)

Rules that apply to every item: authorize every object on the server with `requireWorkspaceRole` (404 for non-members, 403 for low role), keep secrets server-only, idempotency on mutations, `null` never becomes `0`, VERIFIED never means shipped, and no production migration, paid provider call, billing change or deploy without the approvals in section 8.

---

## 1. ZevIR ingestion, graph queries and evidence provenance

### EXISTING
| Route | Where | Min role / guard |
|---|---|---|
| `POST /api/zevir/ingest` | `zevir.js:88` | member + `zevir_shadow`; envelope validated; `capture_content:true` → `422 CONTENT_CAPTURE_UNSUPPORTED`; `Idempotency-Key` header; 3 MB body; 20/min per user |
| `GET /api/zevir/ingest-runs/:runId` | `zevir.js:117` | viewer of the run's workspace |
| `POST /api/engine/products/:id/zevir/build` | `zevir.js:70` | member + flag; 10/min |
| `GET /api/engine/products/:id/zevir` | `zevir.js:79` | viewer |
| `GET /api/zevir/graphs` (+ `/:graphId`, `/nodes`, `/edges`, `/evidence`, `/nodes/:nodeId`, `/neighborhood`) | `zevir.js:131–180` | viewer; unknown and cross-tenant graphs both 404 |

Limits: `api/_lib/zevir/contracts.js:28` (5,000 nodes / 20,000 edges per graph). Content exclusion: `canonicalize.js:29` drops content keys and keeps only `content_hash` + `redaction_state` (`hashed_only` / `not_captured`).

### Gaps and tasks
- [ ] **Machine credential for ZevIR ingest (blocker for real collectors).** `POST /api/zevir/ingest` calls `requireUser` (`zevir.js:89`), so it accepts only a signed-in user's session JWT. An OTel/OpenInference exporter would have to carry a user session token, which must never be documented. **EXTEND** the existing `connections` + `connection_secrets` token model (`004_platform.sql:367,389`; token hash only, returned once) with a `zevir:ingest` scope and a token-authenticated ingest path. Acceptance: token bound to one workspace; revoked token → 401; scope `telemetry:write` cannot ingest ZevIR; workspace in body ≠ token workspace → 404; rate limit per connection; token never logged.
- [ ] Apply migration 016 on isolated staging (`zevir_ingest_runs`, `zevir_graphs`, `zevir_nodes`, `zevir_edges`, `zevir_evidence_refs`). Then run A/B tests: B cannot list, read nodes, read evidence or read neighbourhood of A's graph (404 each).
- [ ] Golden ingest on staging: one OTel GenAI and one OpenInference fixture → graph → evidence rows have `source_trace_id`, `source_span_id`, `source_hash`, `adapter_version`, `schema_version`, and no raw prompt/output (assert on stored rows, not the response).
- [ ] Idempotency: same `Idempotency-Key` + same body → same run; same key + different body → conflict, no second graph.
- [ ] Optional **PROPOSED** `GET /api/zevir/sources?workspace_id=` → per `source_kind` `{graph_count, incomplete_count, last_evidence_at}` (viewer). Removes the 100-graph lower bound in the Connections catalogue. The frontend adapter (`src/lib/clients/evidence-sources.ts`) can switch to it without a screen change.

## 2. vNext evaluation, optimization search, quality gates and evidence reports

### EXISTING
| Route family | Where | Min role / guard |
|---|---|---|
| `GET /api/optimize/products/:id`, `POST …/contracts` | `optimize.js:62,73` | viewer / admin + `verified_optimization_vnext` (`optimize.js:11`, `OPTIMIZE_DISABLED`) |
| `POST …/contracts/:cid/freeze` | `optimize.js:80` | admin |
| `POST …/runs`, `/baseline`, `/diagnoses`, `/candidates` | `optimize.js:88–123` | member |
| `POST /runs/:runId/candidates/:planId/replay` | `optimize.js:129` | member; 6/min; body ignored so no gate can be loosened; `reused` on repeat |
| `GET /runs/:runId/report` | `optimize.js:143` | viewer |
| `POST /api/optimize/demo` | `optimize.js:162` | internal admin only; keep, never public |
| Plan search: `POST/GET /runs/:runId/searches`, `GET /searches/:id`, `/calibrate`, `/replay`, `/cancel`, `/decision` | `optimize-search.js:100–141` | member (viewer for reads) + `optimization_intelligence_vnext`; terminal states → `409 SEARCH_TERMINAL` |
| Plans: `GET /plans/:planId`, `/promote`, bad-day profiles, `/bad-day` | `optimize-search.js:150–195` | as above |
| Legacy engine evaluations: `GET/POST /api/engine/products/:id/evaluations` | `engine.js` | separate from vNext; do not mix verdicts |

### Tasks
- [ ] Apply 017 and 018 on staging after 016. Enable both flags for **one** staging workspace only.
- [ ] End-to-end on staging with `OPENROUTER_API_KEY` **unset** first: every replay must return a truthful "compute not configured" or INCOMPLETE, never VERIFIED.
- [ ] Paid replay run (**needs Nero's approval and a spend cap**): set a staging-only provider key, run one bounded search, record `budget` from the stage response, and confirm the spend stops at the cap.
- [ ] Negative gates: protected-case failure → REJECTED; missing required evidence → INCOMPLETE; unfrozen contract → no verdict; member cannot freeze (admin only); viewer cannot replay; cancel is terminal; repeat replay is `reused`.
- [ ] Report: executive and developer views render from the same `RunReport`; `null` cost/latency stays unknown; `ApprovedChange` ≠ deployed.
- [ ] Do not add new optimizer endpoints for the UI. `src/product/optimize.ts` already types every response.

## 3. Real SaaS integrations, credentials and server-verified connection state

### EXISTING (the audit found more than the earlier handoff listed)
| Route | Where | Behaviour |
|---|---|---|
| `POST /api/projects/:id/connections` | `projects.js:91` | member; kinds `server_telemetry`, `runtime_api`, `repository`; `github` → `409 COMING_SOON`; `zqt_` token returned **once**, only its hash is stored (`connection_secrets`); 10 active per project; `runtime_telemetry` flag |
| `PATCH /api/connections/:id` | `projects.js:144` | member; rename / toggle `capture_samples` |
| `DELETE /api/connections/:id` | `projects.js:160` | creator or admin; sets `revoked`, deletes the secret |
| `POST /api/connections/:id/rotate` | `projects.js:172` | creator or admin; active telemetry only; new token once |
| `POST /api/telemetry/ingest` | `telemetry.js:116` | token auth; writes `telemetry_events`; updates `last_used_at`/`last_seen_at` |
| `GET /api/workspaces/:id/overview` | `workspaces.js:76` | viewer; returns active connections with server-derived `live` = `waiting`/`live`/`idle`/`stale` from `last_seen_at` (`workspaces.js:68`) |

Frontend clients for the four connection routes already exist (`src/app/data.ts:10–13`), but no screen calls them. That is why the catalogue says NOT CONNECTED for runtime telemetry.

### Tasks
- [ ] **Decide (Nero + Khuslen):** wire token issuance into `/app/connections` using the existing routes, or retire the telemetry path. If wired, the UI may show the server's `live` value plus `last_seen_at`. That is server-verified "last seen", which is still not "healthy".
- [ ] **EXTEND, do not duplicate:** the PROPOSED `…/integrations/:connectionId/rotate` and `DELETE …/integrations/:connectionId` in `02` should be served by the existing `/api/connections/:id/rotate` and `DELETE /api/connections/:id`. Add only what is missing:
  - [ ] **PROPOSED** `GET /api/workspaces/:id/connections` (viewer): masked list `{id, kind, name, status, scopes, token_prefix, token_last4, last_seen_at, live, created_by, revoked_at}`; never a hash or token.
  - [ ] **PROPOSED** `POST /api/connections/:id/test` (creator/admin): a bounded server-side verification run that records sampled count, source and time. Only this run may produce a "verified" state.
- [ ] Hardening found in the existing routes (pre-existing behaviour; change with a migration-free server patch and tests):
  - [ ] `PATCH /api/connections/:id` lets **any member** turn `capture_samples` on for any connection in the workspace. Restrict it to the creator or an admin, as DELETE/rotate already are, and record a `config_change` security event.
  - [ ] `POST /api/connections/:id/rotate` checks state (`409 INVALID_STATE`) **before** membership. A non-member who holds a connection id can tell it exists. Move `requireWorkspaceRole` before the state check.
  - [ ] Revoke and rotate are not rate-limited, and nothing emits the `connection_revoked` security event kind that 019 defines. Add both.
  - [ ] A repeat revoke rewrites `revoked_at`/`revoked_by`. Make it a no-op once revoked.
- [ ] Vendor OAuth (OpenAI, Anthropic, LangSmith, Langfuse, GitHub App): stays **NOT AVAILABLE** until one provider is chosen. Per provider: server-side OAuth with `state` + PKCE, redirect allowlist, refresh token in a server vault referenced by id (never a plaintext column), revoke on disconnect, scope review, signed webhooks. Schema proposals are in `03` (`workspace_integrations`, `integration_credentials`, `integration_verification_runs`).
- [ ] Never: token in URL, localStorage, analytics, logs or error details; green "Connected" from static data; `connected_unverified` displayed as healthy.

## 4. Enterprise onboarding, workspace provisioning, RBAC and auditing

### EXISTING
| Route | Where | Min role |
|---|---|---|
| `GET/PATCH /api/me`, `POST /api/invites/accept` | `me.js:48,78,121` | signed in; `/api/me` returns `workspaces[].role` and `.features` |
| `POST /api/workspaces`, `PATCH /api/workspaces/:id` | `workspaces.js:29,45` | signed in / admin |
| Members and invites: `GET …/members`, `POST …/invites`, `DELETE …/invites/:inviteId`, `PATCH/DELETE …/members/:userId` | `workspaces.js:177–281` | viewer read; admin writes |
| `GET …/usage`, `…/overview`, `…/command-center` | `workspaces.js:297,76`, `experience.js` | viewer |
| `POST /api/evaluation-requests` | `analytics.js:59` | public; honeypot, consent required, 5 per 10 min per IP, 3 per day per email; admin queue at `GET/PATCH /api/admin/evaluation-requests` (`admin-v3.js:244,257`) |
| `security_events` table (019) | `019_product_experience.sql:68` | has `workspace_id`, `actor_id`, hashed IP prefix; server writes via `securityError` (`auth.js:57`) |

Role rank `owner 4 > admin 3 > member 2 > viewer 1` (`auth.js:4`). Platform `admin_roles` is staff administration, not a customer role.

### Tasks
- [ ] Staging: run the full role matrix (`src/lib/contracts/roles.ts` lists 12 endpoints; extend it to members/invites) with four users per workspace plus a workspace-B user. Expected: viewer 403 on writes; non-member 404 everywhere.
- [ ] Test the owner and admin rules that are already in the code:
  - The owner role cannot be changed or removed (`workspaces.js:274,290`).
  - Only the owner grants, revokes or removes an admin (`workspaces.js:275,291`).
  - Any member may remove themself (`workspaces.js:286`).
- [ ] **PROPOSED** owner transfer, if enterprise onboarding needs it. No route exists today.
- [ ] Role changes, removals and invites write no `security_events`/audit row. Add an `admin_action`-style event with workspace, actor, target and old→new role, so the tenant audit view below has data.
- [ ] **EXTEND for enterprise requests:** serve the PROPOSED `POST /api/enterprise/requests` by adding a `kind`/`requested_features` field to the existing `evaluation_requests` flow and its admin queue (a 019 follow-up migration). That reuses the rate limits, consent and honeypot instead of adding a second public form. The UI switches from mailto only after this passes tests.
- [ ] **PROPOSED** `GET /api/workspaces/:id/enterprise/capabilities` (admin): returns only server-configured state; nothing defaults to available. SSO/SCIM/regions stay "request" until each is built and reviewed separately.
- [ ] **PROPOSED** `GET /api/workspaces/:id/audit` (admin): paginated, redacted view over `security_events WHERE workspace_id = :id`, plus workspace-scoped admin actions. Never expose the platform-wide `admin_audit_log`. Needs RLS or server-only access and a retention window.

## 5. Public Zev support, separate from authenticated Ask Zev

### EXISTING
- Public: `SupportZevLauncher` (frontend only, finite FAQ, zero network requests; tested).
- Authenticated Ask Zev: `POST /api/engine/agent/chat` (`engine.js:599`): `requireUser`, 30/min, history capped at 16 messages × 8,000 chars, product loaded with viewer check, and billing via `resolveBilling`, which requires **member** of the workspace (`platform-compute.js:29`). Returns a truthful "compute not configured" when no provider key is set.

### Tasks
- [ ] Keep the public FAQ for launch (recommended), or build the **PROPOSED** `POST /api/support/messages` and `POST /api/support/tickets` as a **separate** handler file that imports no workspace store, uses an allowlisted public corpus, has per-IP and global budgets, rejects any `workspace_id`/`product_id` field, and has its own spend cap. Test that it cannot reach `engine_*`, `zevir_*` or `optimization_*` tables.
- [ ] Tickets: reuse the `evaluation_requests` pattern (consent, honeypot, email limit, admin queue) instead of a new storage path.
- [ ] Never route the public sticker to `/api/engine/agent/chat`. A test in `tests/unified-integration.test.tsx` already fails if the source references it.

## 6. CEO / CTO / Developer presentation modes

### EXISTING
- Modes are frontend only (`CommandCenterView.tsx:165,187,240`). The server returns the same `CommandCenter` for every mode (`experience.js:11`), and no handler reads a mode, lens or persona parameter. Verified by search of `api/_lib`.
- `/app/enterprise` shows the server role from `/api/me`, never the selected mode.

### Tasks
- [ ] Add a server test: `GET /api/workspaces/:id/command-center` with any `mode`/`view`/`lens` query parameter returns a byte-identical body to the request without it.
- [ ] Add a test that a viewer in "CEO" mode still gets 403 on freeze, replay, invite and role change.
- [ ] Rule for any future endpoint: never accept a presentation mode as input to authorization or data selection.

---

## 7. Staging prerequisites (names only, never values)

| Need | Variable names |
|---|---|
| Staging guard and target (`tests/staging`, `docs/staging-runbook.md`) | `STAGING_CONFIRM`, `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY`, `STAGING_APP_URL`, `STAGING_EMAIL_DOMAIN` |
| Server runtime (from `.env.example`) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `PUBLIC_APP_URL`, `PUBLIC_CONTACT_EMAIL`, `PUBLIC_DESKTOP_DOWNLOAD_URL`, `DESKTOP_HANDOFF_SECRET`, `CRON_SECRET`, `ANALYTICS_SECRET`, `SECURITY_HASH_SECRET`, `VERCEL_WEB_ANALYTICS` |
| Provider compute (leave **unset** until a paid run is approved) | `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL` |
| Billing (leave **unset** on staging; no billing changes) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, `STRIPE_TEAM_PRICE_ID` |

Other prerequisites:
- A **separate** Supabase project for staging. The staging guard refuses the production ref.
- A database backup before any migration.
- Migrations in order 001 … 013, 016, 017, 018, 019, then `supabase/tests/rls_privilege_check.sql`.
- Two test workspaces with four users each, on `STAGING_EMAIL_DOMAIN` addresses only.
- A Vercel preview whose environment points at staging, with preview protection left on.
- Founder approvals recorded before each step.

## 8. Implementation order

1. **Staging DB and RLS** (Khuslen): migrations, privilege check, `npm run test:staging` A/B. Blocks everything else.
2. **Connection hardening** (section 3): server-only fixes with tests; no migration.
3. **Existing flow end-to-end without provider key**: sign-in → workspace → trace import → ZevIR graph → contract → freeze → baseline → candidates → INCOMPLETE/compute-not-configured states.
4. **Presentation-mode and role-matrix server tests** (sections 4 and 6).
5. **ZevIR machine credential** (section 1) and masked `GET /api/workspaces/:id/connections`, then `POST /api/connections/:id/test`. The catalogue then upgrades from EVIDENCE RECEIVED to server-verified states.
6. **One approved paid replay** on staging with a spend cap (Nero).
7. **Tenant audit view** and **enterprise request** via `evaluation_requests` (section 4).
8. **First vendor OAuth**: only after one provider is chosen and reviewed.
9. **Public generative support**: optional, last; FAQ ships first.

Production (013 first, then 016–019, flags per workspace) only after 1–4 pass and all three sign-offs exist.
