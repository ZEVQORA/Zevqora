# Integration, Provider Readiness and Security Boundaries

## Grounded source support
| Integration family | Existing source evidence | UI label (integration branch) | Future work |
|---|---|---|---|
| ZEVQORA telemetry `zqt_` token + POST `/api/telemetry/ingest` | Release backend and `/app/docs`; token API `POST /api/projects/:id/connections` (plus PATCH/DELETE/rotate under `/api/connections/:id`) exists and has clients in `src/app/data.ts`, but no current screen calls them, and the data does not feed the proof-engine baseline | **NOT CONNECTED** (corrected from the patch's SETUP REQUIRED) | Decide whether to expose token issuance in Connections or retire the path; verify create/test/revoke in staging |
| OpenTelemetry GenAI | `api/_lib/zevir/adapters/otel-genai.js`, `POST /api/zevir/ingest` (member + `zevir_shadow`) | SETUP REQUIRED → **EVIDENCE RECEIVED** when the server returns an `otel_genai` graph for the workspace; NOT ENABLED when the flag is off and no graph exists | Document exact collector/export shapes, test bounded ingest |
| OpenInference | `api/_lib/zevir/adapters/openinference.js` | Same rule with `openinference` graphs | Validate import coverage, content exclusion |
| Sanitized JSON/JSONL traces | Existing `ConnectionsView` import; ZevIR projection via `POST /api/engine/products/:id/zevir/build` | Same rule with `zevqora_engine` graphs | Preserve explicit export redaction guidance |
| Browser/desktop repository scan | Existing product scanner | SETUP REQUIRED | Clearly distinguish local scan from GitHub hosted connector |
| OpenAI/Anthropic hosted account OAuth | No verified direct connector | NOT AVAILABLE | Per-provider API/security/consent review |
| LangSmith/Langfuse native connector | No verified direct OAuth control plane | NOT AVAILABLE | OTel/export compatibility tests first |
| GitHub hosted OAuth installation | No verified control plane in this release | NOT AVAILABLE | Explicit permissions and installation event lifecycle |

## Contract and secret handling
- `SETUP_CATALOG` is a list of possible setup paths, not real workspace connection inventory or health. `disconnectedGateway.listWorkspaceConnections/testConnection` rejects `INTEGRATION_NOT_CONNECTED`; no synthetic successful data.
- No `VITE_`/`PUBLIC_` server secrets; service role/OpenRouter/Stripe secret stay on backend. All scope grants, OAuth callback integrity, key vault, rotation and revoke happen server-side.
- Display only credential fingerprint/last-four, never full value. No token in localStorage, URL query, first-party analytics, source code, toast or error detail.
- `workspace_id` in browser route is a selector, **never** authorization proof. Backend verifies authenticated membership plus role on each object, prevents A/B workspace enumeration.
- Treat OTel/OpenInference/MCP fields as untrusted external metadata. Allowlist fields; content capture off in ZevIR; redact hashes/safe identifiers as needed. Raw source code is not public support knowledge.
- Distinguish `connected_unverified` from `healthy`; `healthy` requires server-confirmed evidence source, ingest count and timestamp. `partial` shows missing coverage.
- `GET` retries may be bounded; mutations require idempotency and explicit user trigger. Rate limiting, audit and billing guards remain on server.

## First-run experience acceptance
Account/workspace → choose supported source → read privacy scope → scoped credential via actual backend → bounded sample ingestion → server verified status → ZevIR graph → frozen contract. When a step is disabled, the UI must explain the next authorized setup action, not show a green Connected badge.

## Negative tests
Provider card never becomes connected from static data; cross-tenant connections deny; expired scopes can't be used; revocation invalidates credential; tokens don't echo to logs/analytics; zero samples never becomes healthy; missing cost remains unknown; unsigned callbacks fail; duplicate POST doesn't double-charge; admin platform role not granted by choosing CTO display view.

## What "EVIDENCE RECEIVED" means (implemented 2026-10-31)
The release has no provider-health or connection-verification endpoint. The strongest truthful state the UI shows is therefore EVIDENCE RECEIVED: `GET /api/zevir/graphs?workspace_id=` (viewer membership checked server-side) returned at least one graph of that `source_kind` for the active workspace. The card shows the server's graph count (with `+` when the 100-row page is full), incomplete graphs, and the newest server timestamp or "time unknown". It is never labelled CONNECTED or HEALTHY; `tests/unified-integration.test.tsx` checks every availability × state combination.
