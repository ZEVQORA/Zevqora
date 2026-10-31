# Backend API Contract Map — EXISTING vs PROPOSED
Source priority: release source handlers and typed clients before this design handoff. **EXISTING_IN_BRANCH ≠ DEPLOYED or TESTED**.

> Updated 2026-10-31 against the checked-out release (`8e591cd`): 141 routes are registered in `api/_lib/handlers/*.js` (the `calibrate` / `replay` search stages are registered in a loop at `optimize-search.js:122`). No live API calls were made; there is no staging environment in this session.

## Frontend gateway modules — IMPLEMENTED on `integration/unified-vnext-zevir-ui`

| Module | Calls (existing only) | Returns | Guarantees (tested in `tests/unified-integration.test.tsx`) |
|---|---|---|---|
| `src/lib/clients/evidence-sources.ts` `loadEvidenceSources(workspaceId, ingestEnabled)` | `GET /api/zevir/graphs?workspace_id=…&limit=100` (viewer) | `{state:'ok', sources: Record<'zevqora_engine'\|'otel_genai'\|'openinference', EvidenceSourceStatus>, capped}` or `{state:'error', status, code, message}` | `evidence_received` only from server graphs; `lastEvidenceAt` is a server timestamp or `null`; rows for another workspace dropped; `capped` when the page is full; errors keep the server code (`OFFLINE`, `NOT_FOUND`, …) |
| `sourceBadge(availability, observed)` | — | `NOT AVAILABLE` · `EVIDENCE RECEIVED` · `NOT ENABLED FOR THIS WORKSPACE` · `NOT CONNECTED` · `PLAN RESTRICTED` · `STATUS UNAVAILABLE` · `SETUP REQUIRED` | Exhaustively tested never to produce CONNECTED / HEALTHY / ACTIVE |
| `src/lib/contracts/roles.ts` `SERVER_ACTIONS`, `roleAllows` | — | Minimum role per endpoint, below | Each row is checked against the handler source; drift fails the suite |
| `src/lib/clients/integrations.ts` `disconnectedGateway` | none | rejects `INTEGRATION_NOT_CONNECTED` | No synthetic connection list or test result |
| `src/lib/contracts/{support,enterprise}.ts` | none | `PUBLIC_SUPPORT_MODE='public_faq'`, `ENTERPRISE_REQUEST_API_AVAILABLE=false` | Public support and enterprise request send nothing |

### Minimum workspace role per existing endpoint (server-enforced; mirrored in `roles.ts`)
| Endpoint | Min role |
|---|---|
| `GET /api/workspaces/:id/command-center`, `GET /api/zevir/graphs`, `GET /api/optimize/runs/:runId/report` | viewer |
| `POST /api/zevir/ingest` (+ `zevir_shadow` flag), `POST /api/optimize/products/:id/runs`, `…/candidates/:planId/replay`, `POST /api/optimize/runs/:runId/searches`, `POST /api/optimize/searches/:id/decision` | member |
| `POST /api/optimize/products/:id/contracts`, `…/contracts/:cid/freeze`, `POST /api/workspaces/:id/invites`, `PATCH /api/workspaces/:id/members/:userId`, `POST /api/optimize/demo` | admin |

Rank (from `api/_lib/auth.js`): owner 4 > admin 3 > member 2 > viewer 1. Unknown graph ids and graphs in another workspace both return 404.

## EXISTING_IN_BRANCH — server routes and matching clients
| Method | Endpoint family | Source / frontend adapter | Auth/flag/negative state |
|---|---|---|---|
| GET | `/api/me`, `/api/workspaces`, members/invites/usage | `src/lib/session`, existing API routes | Auth; workspace membership and RBAC; cross-tenant denied |
| GET | `/api/public-config`, plan rows | `src/lib/site.ts`, `src/marketing/Pricing.tsx` | Public; frontend fallback must be marked reference |
| POST | `/api/telemetry/ingest` | telemetry handler, scoped token `zqt_` | Scoped token, rate limits, workspace binding; no public browser secret |
| POST | `/api/engine/products/:id/zevir/build` | `api/_lib/handlers/zevir.js:70` | Member+`zevir_shadow`, disabled returns `403 ZEVIR_DISABLED` |
| GET | `/api/engine/products/:id/zevir` | `zevir.js:79` | Authorized product/workspace; flag |
| POST | `/api/zevir/ingest` | `zevir.js:88` | Authorized bounded OTel/OpenInference envelope; never content-capture by default |
| GET | `/api/zevir/ingest-runs/:runId` | `zevir.js:117` | Workspace owner/member authorized; run-scoped |
| GET | `/api/zevir/graphs?workspace_id=&product_id=&limit=&offset=` | `zevir.js:131`, `src/product/graph/api.ts:37` | Authorized workspace; pagination, bounded; null costs retained |
| GET | `/api/zevir/graphs/:graphId` | `zevir.js:140`, `graph/api.ts:38` | Unauthorized/unknown object treated indistinguishably (404 by schema security docs) |
| GET | `/api/zevir/graphs/:graphId/nodes` | `zevir.js:145`, `graph/api.ts:46` | Paginated node objects |
| GET | `/api/zevir/graphs/:graphId/edges` | `zevir.js:151`, `graph/api.ts:46` | Paginated edge objects |
| GET | `/api/zevir/graphs/:graphId/evidence` | `zevir.js:157` | Provenance only, optional `node_id`, redacted |
| GET | `/api/zevir/graphs/:graphId/nodes/:nodeId` | `zevir.js:164`, `graph/api.ts:39` | Node+incoming/outgoing+evidence |
| GET | `/api/zevir/graphs/:graphId/nodes/:nodeId/neighborhood` | `zevir.js:172`, `graph/api.ts:40` | `depth<=6`, `max_nodes<=500`; loops allowed |
| GET | `/api/workspaces/:id/command-center?days=30` | `api/_lib/handlers/experience.js`, `src/product/experience.ts:123` | User+workspace; source/null semantics via `CommandCenter` type |
| GET/POST | `/api/optimize/products/:id` + `/contracts` + `/:cid/freeze` + `/runs` | `api/_lib/handlers/optimize.js`, `src/product/optimize.ts` | Auth+workspace+`verified_optimization_vnext`, budgets, authorization |
| POST/GET | `/api/optimize/runs/:runId/{baseline,diagnoses,candidates}` | `optimize.js`, `src/product/optimize.ts` | Frozen contract before verdict, evidence requirements |
| POST | `/api/optimize/runs/:runId/candidates/:planId/replay` | `optimize.js`, `src/product/optimize.ts` | Authorized bounded charged operation; no blind retry |
| GET | `/api/optimize/runs/:runId/report` | `optimize.js`, `src/product/optimize.ts` | Report with REQUIRED/FAILED/INCOMPLETE gates and claim labels |
| POST/GET | `/api/optimize/runs/:runId/searches` | `api/_lib/handlers/optimize-search.js:100,110` | Additional `optimization_intelligence_vnext` flag; idempotent input hash |
| GET | `/api/optimize/searches/:id` | `optimize-search.js:117` | Auth+workspace and poll/rate budgets |
| POST | `/api/optimize/searches/:id/{calibrate,replay}` | `optimize-search.js:123` | Explicit continuation, up to bounded stage work; no blind loop |
| POST | `/api/optimize/searches/:id/cancel` | `optimize-search.js:135` | Auth; terminal cancellation |
| POST | `/api/optimize/searches/:id/decision` | `optimize-search.js:141` | Policy, frontier/gates; NOT deployment |
| GET | `/api/optimize/plans/:planId` | `optimize-search.js:150` | Inspect plan, lineage and evidence |
| POST | `/api/optimize/plans/:planId/promote` | `optimize-search.js:167` | Bounded full-replay escalation, not shipping |
| GET/POST | `/api/optimize/products/:id/bad-day-profiles` | `optimize-search.js:181,188` | Authorized profile creation; hash idempotency |
| POST | `/api/optimize/plans/:planId/bad-day` | `optimize-search.js:195` | Verified plan, bounded replay |
| POST | `/api/engine/agent/chat` | `src/product/views/ZevView.tsx`, engine agent handler | Signed-in agent; must NOT power public FAQ |
| `/api/admin/*` | Admin-specific routes | Existing `api/_lib` admin | `admin_roles`, audit log, never CEO/CTO display toggle |
| `/api/stripe/*` | Payment handlers | Existing server | Not usable without live secrets/Stripe product price ids, unverified here |

### Existing typed response owners — do not create competing schemas
- `src/product/experience.ts`: `CommandCenter`, `ObservedBlock`, `BaselineBlock`, `Projection`, `ProductCard`. Observed `spend_usd: number|null`, `cost_coverage: number|null` and p95/p99 nullable.
- `src/product/graph/api.ts`: `LoadedGraph`, `NodeDetail`, `graphApi`; `FULL_LOAD_MAX_NODES=600`, page=500, max edges=3000. `src/product/graph/model.ts` owns node/edge view models.
- `src/product/optimize.ts`: `ContractRequirements`, `EvaluationContract`, `OptimizationRun`, `RunEvaluation`, `RunReport`, `SearchReport`, `ExecutionPlan`, `StageResult` and server-backed methods. `ContractRequirements` includes quality, success, latency, protected, cost, evidence, reliability, allowed providers/models, policy, dataset version.
- `src/lib/api.ts`: `api<T>` handles Bearer session, typed `ApiClientError(status,code,details)`, `signal` and `OFFLINE`; avoid another unaudited auth client.

### Existing API error and retry contract
| Case | Expected UI behavior |
|---|---|
| 401 | Offer login; don't render private previous-workspace data |
| 403 / `ZEVIR_DISABLED` / plan or flag rejected | Availability = `flag_disabled`/`plan_restricted`; no fake working screen |
| 404 unauthorized cross-tenant graph | No existence disclosure |
| 409 conflicting state / 422 invalid frozen gate | Show actionable constraint and do NOT autosubmit |
| 429 rate-limited | Respect server retry/backoff and stage continuation |
| 5xx / `OFFLINE` / incompatible JSON | ErrorState + request id (when provided), bounded GET retry only; no synthetic success |

## PROPOSED — frontend types but network DISABLED
These routes do not exist in the inspected release. **Do not call them until a tested capability says available.**
| Method | Proposed path | Role | Request / response DTO | Server acceptance and tests |
|---|---|---|---|---|
| GET | `/api/integrations/catalog` | Signed-in | `IntegrationCatalogEntry[]` | Only verified methods, no token; 401 denied; empty allowed |
| GET | `/api/workspaces/:id/integrations` | Viewer+ | `ConnectionCard[]` | Workspace RLS, optional unknown coverage, never credentials; A/B denial |
| POST | `/api/workspaces/:id/integrations` | Owner/admin | `{provider_id,method,scopes,idempotency_key}` → opaque setup status | CSRF/OAuth state, encrypted server vault, one-time token display; 403/429/409 tests |
| POST | `/api/workspaces/:id/integrations/:connectionId/test` | Owner/admin | `{idempotency_key}` → `ConnectionCard` | Real bounded test ingest, verified source/time/count; no client fabrication |
| POST | `/api/workspaces/:id/integrations/:connectionId/rotate` | Owner/admin | `{idempotency_key}` → sanitized credential hint | Old token revoked, audit, no echo of new secret except designated one-time path |
| DELETE | `/api/workspaces/:id/integrations/:connectionId` | Owner/admin | `{idempotency_key}` → terminal revoke | Audit, deterministic repeated revoke, no cross-tenant access |
| GET | `/api/workspaces/:id/enterprise/capabilities` | Owner/admin | `EnterpriseCapability[]` | SSO/SCIM/regions from configured server, no optimistic defaults |
| POST | `/api/enterprise/requests` | Public or signed-in | `{contact_email, requested_features, notes, idempotency_key}` → `{request_id,status}` | Anti-spam, safe retention/consent and queue, 429/error tests |
| POST | `/api/support/messages` | Public | `PublicSupportMessageRequest` → `PublicSupportMessageResponse` | Public vetted corpus, abuse limits, redaction; cannot call workspace tools |
| POST | `/api/support/tickets` | Public | `PublicSupportTicketRequest` → opaque ticket id | Consent, retention, anti-spam, human reply boundaries |
| GET | `/api/workspaces/:id/audit` | Owner/admin | Paginated redacted tenant audit events | Strict tenant isolation, no platform-global events |

### Example proposed integration payload (NOT an existing server response)
```json
{
  "data": {"id":"opaque-id","lifecycle":"connected_unverified","provider_id":"otel-genai","last_verified_at":null},
  "meta":{"api_version":"2026-10-31-draft","request_id":"opaque-correlation-id","source":"server","capability":"setup_required"}
}
```
No secret/token/prompt/source-code is valid in this display DTO. `connected_unverified` is NOT `healthy`.

## Per-contract acceptance test template for Nero
For EACH proposed endpoint: schema validation, authorized happy path, 401 signed-out, 403 role denial, A/B workspace separation, 404 opaque unknown object, 409 duplicate/expired state, 429 rate limit, 5xx recovery, null/partial evidence, no raw secret echo, idempotent repeat, audit/event and abort or request-id tracing. Never claim `IMPLEMENTED_AND_TESTED` without source+test output.
