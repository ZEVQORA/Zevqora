# Database Model and Migration Handoff
All proposed objects below are **schema proposals**, not existing migrations. Existing 011–019 are never replaced by this patch. `supabase/migrations/` remains unmodified.

## Existing authoritative entities (release source; deployment unverified)
- `workspaces`, `workspace_members`, server-scoped membership/roles and RLS: source of truth for tenancy. Existing `admin_roles` is **platform** administration, not customer SSO/tenant-owner authority.
- Existing plans/feature_flags, `engine_*` product, trace, run and evidence objects; telemetry scoped tokens; optimization contracts/runs/candidates/search/quality; ZevIR graph, node, edge, evidence, import and ingest-run objects from migration 016; later 017/018/019 optimize/intelligence/product expansions.
- Payment/credit and admin audit entities remain server-controlled; frontend must not add direct SQL writes or migration side effects.
- Actual SQL column identities, indexes, triggers and FK names MUST be taken from checked release migrations, not inferred from these UI DTOs.

## Migration map (read from `supabase/migrations` at `8e591cd`; the integration branch changes none of them)

| Migration | Adds | RLS | Rollback script | Applied where? |
|---|---|---|---|---|
| `013_site_hero_copy.sql` | Guarded update of the `site_content` hero row (no tables) | n/a | none (guarded data update) | **Missing in production history** (2026-10-13 check); apply before 019 or 019's hero update is a no-op |
| `016_zevir_part1.sql` | `zevir_ingest_runs`, `zevir_graphs`, `zevir_nodes`, `zevir_edges`, `zevir_evidence_refs` | 5 tables enabled | `supabase/rollback/016_zevir_part1.rollback.sql` | Not applied to production |
| `017_verified_optimization.sql` | `evaluation_contracts`, `optimization_runs`, `performance_snapshots`, `optimization_diagnoses` + nullable lineage columns on `engine_*` | 4 enabled | `017_…rollback.sql` | Not applied |
| `018_optimization_intelligence.sql` | `plan_searches`, `execution_plans`, `plan_calibrations`, `plan_decisions`, `bad_day_profiles`, `bad_day_results` | 6 enabled | `018_…rollback.sql` | Not applied |
| `019_product_experience.sql` | `site_events`, `product_events`, `security_events`, `evaluation_requests`, `site_content_revisions`, flag targeting, `cms_publish()` | 5 enabled | `019_…rollback.sql` | Not applied |
| `020_user_deletion_guards.sql` | No tables: the 017/018 guards accept the user-deletion `set null`; `execution_plans_evaluation_fk` becomes `on delete cascade` | n/a | `020_…rollback.sql` | Not applied in production; applied on staging |

Order on an empty staging DB: 001 → … → 013 → 016 → 017 → 018 → 019 → 020 (see `docs/staging-runbook.md` §2). `supabase/tests/rls_privilege_check.sql` is the existing privilege check. Real-Postgres RLS has never been exercised — prior gates ran on PGlite.

The new frontend adds **no** table, column or policy. `evidence-sources.ts` reads `zevir_graphs` only through the server route.

## New control plane requires a capabilities and data-model audit first
| PROPOSED entity | Why existing cannot be assumed enough | Minimal fields | RLS, retention, write boundary |
|---|---|---|---|
| `integration_provider_catalog` (or code registry) | Existing adapters don't equal a vendor auth control plane | `provider_id` PK, supported_method, captured/excluded field allowlists, availability, status/version, `updated_at` | Public-safe read metadata, admin-only write, signed provider version. No secrets |
| `workspace_integrations` | Per-workspace provider authorization and lifecycle | `connection_id` PK, `workspace_id` FK, provider/method, creator, lifecycle enum, scopes, `last_verified_at`, `last_ingest_at`, `error_code`, retention policy | Workspace viewer masked read; owner/admin writes only via service handler. A/B 404. Never show OAuth verifier/credential |
| `integration_credentials` (vault reference, NOT key plaintext table) | API keys/OAuth refresh need encrypted secret storage | connection FK, vault secret reference, fingerprint, expiry, rotation version, created/revoked times | Server/service role only; no client SELECT, logging, analytics or trigger-exposed plaintext; rotate/revoke + audit |
| `integration_verification_runs` | Proof of real connection success and coverage | run PK, connection/workspace FKs, sampled count, coverage and source, status, `request_id`, started/completed, redacted error | Workspace-scoped read, server writes, TTL and evidence policy agreed; null for missing coverage |
| `enterprise_requests` | Request/ticket workflow not an existing SSO entitlement | request PK, workspace FK nullable, contact, requested feature keys, consent, created timestamp, status, anti-spam metadata | Public insert only through rate-limited API, no direct anon SELECT; restricted internal queue; PII TTL |
| `enterprise_capabilities` or audited configuration | Requested/available SSO etc must be authoritative | workspace FK, capability enum, status, verified_at, config reference, actor, version | Owner/admin read and controlled server writes, not UI toggles; no premature availability |
| `public_support_threads`, `public_support_tickets` | Public help must stay isolated from authenticated Ask Zev | opaque thread/ticket PK, consent, retention, safe public-context enum, redacted message, created/closed | Rate-limited public creation, no public list/read by guessed ID, no joins to private traces, specific deletion TTL |
| `workspace_audit_exports` (only if needed) | Tenant-safe exports separate from global admin log | export PK, workspace FK, requester, status, date window, redacted file URI, expiry | Owner/admin request, signed short-lived download, restricted auditing, no admin-global leak |

## Constraints
- Never duplicate/reseed existing workspace, ZevIR, billing, trial credits or evaluation tables without migration review. Prefer source-backed existing entities first.
- Every new record includes source/actor, explicit enum, created/updated time, retention/TTL and classification; no raw prompt/output documents in ZevIR metadata, support queue or first-party analytics.
- Avoid `service_role` credential in browser. SQL RLS default deny, server-only mutation, tenant FK, audited role check, proper unique idempotency key constraints.
- Staging-only migration review: ordered 016 → 017 → 018 → 019, backup/forward rollback design, row security A/B, EXPLAIN/index and partial migration recovery, no downgrade of live RLS policies.

## Acceptance tests for Nero
Create workspace A/B, cross-tenant read/write negative tests, anon SELECT/INSERT negative tests, credential redaction and rotation, verified ingest source identity, duplicate idempotency handling, support data deletion, GDPR/privacy request policy as applicable, and audit event retention. Do not assume schema names beyond existing source without inspecting actual migrations.
