# Nero Backend Work — Prioritized Dependencies and Acceptance
These are implementation tasks, not promises of shipped capabilities. Preserve server schema, request types, migrations and RLS in current release. Do not greenfield the backend or replace existing handlers to fit the new UI DTOs.

## Critical — enable honest existing flow first
- [ ] Clone/inspect actual release SHA and divergence; reconcile only approved new frontend files onto `8e591cd...`; confirm CI baseline and branch protections.
- [ ] Run ordered migrations 016–019 on **isolated staging** with schema history, backup/rollback and A/B RLS tests; check feature flags `zevir_shadow`, `zevir_graph_ui`, `verified_optimization_vnext`, `optimization_intelligence_vnext`; NEVER assume prod migrated.
- [ ] Test Supabase signup/session → workspace membership → create engine workload → scoped telemetry or OTel sample ingest → ZevIR graph → frozen contract → baseline → diagnosis → candidates → bounded replay → VERIFIED/REJECTED/INCOMPLETE → reports. Save run/graph IDs, request IDs and evidence provenance.
- [ ] Show `ZEVIR_DISABLED`, missing evidence, unauthorized graph 404, plan restricted and `OFFLINE` as truthful states; no automatic fallback to preview data.
- [ ] Verify optimize search continuation/idempotency, spend cap, cancellation, protected cases and reproducible evidence. No automatic PR merge, route mutation or deploy.

## Integration control plane — implement one or two real methods
- [ ] Decide whether existing telemetry/OTLP tables already cover workspace connections. If not, implement catalog/lifecycle tables and vault reference per `03-DATA-MODEL-MAP.md`.
- [ ] Add `GET /api/integrations/catalog` and `GET /api/workspaces/:id/integrations` only with server-backed available methods/tenant scope; response IDs/nullable coverage and errors versioned.
- [ ] Add authorized setup/test/rotate/revoke for the selected real method(s), with method-specific scope validation, CSRF/OAuth state where relevant, idempotency, audit and rate limiting; `healthy` only after server test evidence.
- [ ] Generate setup snippets from actual docs/SDK and verify on sandbox provider; NO claims of universal one-click OAuth.
- [ ] Reconcile TS `ConnectionCard` UI DTO with actual request/response via small typed adapters; preserve existing handler response.

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

## Owners and decision state
Nero (CEO): server priorities, commercial/legal approval, GO/HOLD. Khuslen (CTO): architecture, security, testing, integration and reliability signoff. Bat-Ochir (CMO): public claims review. All approvals **PENDING** in this artifact.
