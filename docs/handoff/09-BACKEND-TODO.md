# Nero Backend Work — Prioritized Dependencies and Acceptance
These are implementation tasks, not promises of shipped capabilities. Preserve server schema, request types, migrations and RLS in current release. Do not greenfield the backend or replace existing handlers to fit the new UI DTOs.

## Critical — enable honest existing flow first
- [x] Clone/inspect actual release SHA and divergence; reconcile only approved new frontend files onto `8e591cd...` — done locally on `integration/unified-vnext-zevir-ui` (see `08-TEST-RESULTS.md`).
- [ ] Push the branch and open a draft PR (founder approval; repository is public), then confirm CI and branch protections.
- [ ] Run ordered migrations 016–019 on **isolated staging** with schema history, backup/rollback and A/B RLS tests; check feature flags `zevir_shadow`, `zevir_graph_ui`, `verified_optimization_vnext`, `optimization_intelligence_vnext`; NEVER assume prod migrated.
- [ ] Test Supabase signup/session → workspace membership → create engine workload → scoped telemetry or OTel sample ingest → ZevIR graph → frozen contract → baseline → diagnosis → candidates → bounded replay → VERIFIED/REJECTED/INCOMPLETE → reports. Save run/graph IDs, request IDs and evidence provenance.
- [ ] Show `ZEVIR_DISABLED`, missing evidence, unauthorized graph 404, plan restricted and `OFFLINE` as truthful states; no automatic fallback to preview data.
- [ ] Verify optimize search continuation/idempotency, spend cap, cancellation, protected cases and reproducible evidence. No automatic PR merge, route mutation or deploy.

## Integration control plane — implement one or two real methods
- [ ] Decide whether existing telemetry/OTLP tables already cover workspace connections. If not, implement catalog/lifecycle tables and vault reference per `03-DATA-MODEL-MAP.md`.
- [ ] Add `GET /api/integrations/catalog` and `GET /api/workspaces/:id/integrations` only with server-backed available methods/tenant scope; response IDs/nullable coverage and errors versioned.
- [ ] Add authorized setup/test/rotate/revoke for the selected real method(s), with method-specific scope validation, CSRF/OAuth state where relevant, idempotency, audit and rate limiting; `healthy` only after server test evidence.
- [ ] Generate setup snippets from actual docs/SDK and verify on sandbox provider; NO claims of universal one-click OAuth.
- [ ] Reconcile TS `ConnectionCard` UI DTO with actual request/response via small typed adapters; preserve existing handler response. (Done for ZevIR evidence: `evidence-sources.ts` maps `ZevirGraph[]` without changing the server.)
- [ ] Optional, small: a per-workspace `GET /api/zevir/sources` summary (count + max(updated_at) per `source_kind`) would remove the 100-row lower-bound caveat. Not required for correctness.

## Public support and enterprise
- [ ] Approve public FAQ-only support launch OR build standalone `/api/support/messages`+`/tickets`. Generative chat requires vetted public corpus, redaction, abuse limits, consent/retention, scoped logs, no workspace agent tool use. Frontend deliberately ships FAQ only.
- [ ] Implement `/api/enterprise/requests` with anti-spam, consent, retention and real queue; revise UI from email draft to actual submit only after integration tests.
- [ ] Implement tenant `/enterprise/capabilities` as authoritative source, with request/setup/available enums, audited security state. Do not enable SSO/SCIM/regions/compliance claims without separate implementation and review.
- [ ] Tenant-specific audit export only after strict RLS; avoid exposing global `admin_audit_log` to customer admins.

## Mandatory negative tests (all backend)
- [ ] Workspace A user cannot list/read/change workspace B graphs, connections, tickets, audit, enterprise config or optimizer runs.
- [ ] Anonymous/client cannot call service-role handlers, direct writes to ZevIR/optimization tables or view private workspace agent content.
- [ ] Public support cannot invoke signed-in agent or private RAG sources, including cross-user caching/transcript leaks.
- [ ] Null cost/latency/outcome never becomes 0 or false VERIFIED; protected-case failure cannot pass frozen contract.
- [ ] Viewer cannot freeze, replay, authorize credentials, alter settings, bill, approve rollout; CEO/CTO *view* does not change RBAC.
- [ ] Secrets never returned/logged/client-stored; retries don't duplicate charge, tokens or ops; revocation effective.
- [ ] Flag disabled and migrations absent produce known server error and UI unavailable, not 500 and fixture success.
- [ ] Production deploy, Stripe events, migrations, releases need separate explicit reviewed authorization.

## Definition of backend-ready handoff
All new endpoints have OpenAPI/TS request/response, validated error codes, server-only auth, workspace/role matrix, tenant/abuse tests, idempotency and auditing, documented source tables/migrations and golden E2E against frozen test fixtures. Frontend should only need to implement the typed gateway and capability provider, **not redesign its screens**.

## Deploy and rollback — requires explicit founder approval for every step
Nothing below was executed. Follow `docs/staging-runbook.md`; this is the minimum.

1. **Push for review** (Nero approves; public repo): `git push -u origin integration/unified-vnext-zevir-ui`, open a **draft** PR against `release/vnext-part3-production` (not `main`).
2. **Staging DB** (Khuslen approves; never the production ref the staging guard refuses): apply 001…013, 016, 017, 018, 019 in order; run `supabase/tests/rls_privilege_check.sql`; then `npm run test:staging` with workspace A/B identities.
3. **Preview deploy** pointed at staging; walk sign-in → workspace → ingest → graph → freeze → baseline → plan search → bounded replay → verdict → evidence → human review, plus the negative cases in this file.
4. **Production** (Nero GO + Khuslen security sign-off + Bat-Ochir claims review): apply 013 first (missing in production), then 016–019; enable flags per workspace, not globally; deploy the reviewed commit.
5. **Rollback**: frontend — redeploy the previous production build (the frontend change is code-only); database — `supabase/rollback/019…`, `018…`, `017…`, `016…` in reverse order, only after a backup and only if the migration itself is the fault. Flags can be switched off without a rollback.

## Owners and decision state
Nero (CEO): server priorities, commercial/legal approval, GO/HOLD. Khuslen (CTO): architecture, security, testing, integration and reliability signoff. Bat-Ochir (CMO): public claims review. All approvals **PENDING** in this artifact.
