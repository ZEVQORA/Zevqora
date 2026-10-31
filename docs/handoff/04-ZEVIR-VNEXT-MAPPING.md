# ZevIR v0.1 + Verified Optimization Mapping
Snapshot: release `8e591cd`; `api/_lib/handlers/zevir.js`, `api/_lib/handlers/optimize.js`, `api/_lib/handlers/optimize-search.js`, `src/product/graph/api.ts`, `src/product/optimize.ts`.

## Canonical ZevIR `schema_version: zevir.v0.1`
**Exactly eight node kinds:** `Task`, `ModelCall`, `Agent`, `ToolCall`, `Retrieval`, `Function`, `Runtime`, `Outcome`.
**Exactly eleven edge kinds:** `CALLS`, `USES`, `DEPENDS_ON`, `RETRIEVES`, `PROVIDES_CONTEXT`, `ROUTES_TO`, `SERVED_BY`, `REPLACES`, `PRODUCES`, `EVALUATED_BY`, `LOCATED_AT`.
Source kinds: `zevqora_engine`, `otel_genai`, `openinference`. `adapter_version` required. One graph per request/trace; retries/cycles are valid and the graph must **not** be treated as a DAG.

- Content capture OFF; provenance + hash/evidence refs, allowlisted attributes, no raw prompts/output/docs/tool arguments.
- Unknown `cost_usd`, tokens, latency, outcome remain `null` + gap reasons; `0` has distinct meaning.
- Max stored per graph 5,000 nodes / 20,000 edges. Neighbourhood `depth<=6`, `max_nodes<=500`; bounded client default `depth=2`, `max_nodes=300` from `src/product/graph/api.ts`.
- UI's full-load cutoff 600 nodes; larger graphs fetch bounded neighbourhood and avoid crashing low-end mobile.
- Graph shadow projection must not modify evaluator verdict or any economic claim.

## Existing frontend mapping — preserve, do not rebuild
- `GraphExplorer.tsx`: React Flow, list/table, node inspector, overlays, source markers and query-driven selection; load via `graphApi` only with verified workspace session/flags.
- `graphApi.list → GET /api/zevir/graphs`, `graph → GET /graphs/:id`, `node → GET /graphs/:id/nodes/:nodeId`, `neighbourhood → GET /nodes/:nodeId/neighborhood`; paged nodes/edges. Source handler `zevir.js` lines 70–180.
- `OptimizeView.tsx` and `PlanSearchSection`: existing Part 2A/2B engine, not fake cost calculations. `optimization_intelligence_vnext` and `verified_optimization_vnext` flags checked on backend.
- `CommandCenterView.tsx` and `experience.ts`: one workspace dataset, CEO/CTO/Developer are presentation modes. Real `CommandCenter.observed.spend_usd` and coverage are nullable; `Projection` is NOT realized savings.
- NEW (2026-10-31) `src/lib/clients/evidence-sources.ts`: per-`source_kind` summary of `graphApi`'s list endpoint for the Connections catalogue. Reads only; does not touch `GraphExplorer`, `graphApi` or any optimizer client.

## Evidence state contract
`NoEvidence → EvidencePartial → ReadyForContract → ContractFrozen → ReplayRunning → VERIFIED|REJECTED|INCOMPLETE → HumanReview`.
- VERIFIED: frozen gates passed on evaluated sample, not deployed or guaranteed realized savings.
- REJECTED: any required gate failed (e.g. protected case or quality floor).
- INCOMPLETE: missing required evidence/cancellation/inconclusive — never coerced into pass.
- `ApprovedChange` is independent of production deployed state. No autonomous route change, code merge, deploy or live traffic mutation from the frontend.
- Pareto compares cost, quality, latency, reliability and risk; only fully gated candidates eligible.

## Source-safe frontend DTO mapping
`src/lib/contracts/claims.ts` is **UI normalization only**, not a replacement for `ZevirGraph`, `GNode`, `GEdge`, `ContractRequirements`, `RunReport`, or `CommandCenter` types. Explicit adapters must map source fields and preserve `null`, source IDs and window/coverage. Avoid changes to backend shape for cosmetic components.

## Required staged tests
- Graph loops/back-edges survive; bounded/paginated selection works; 5,000-node input never forces full canvas; 404 hides cross-tenant existence.
- Missing cost/latency and incomplete graph show unknown/gaps, not free execution or incorrect critical path.
- Freeze contract before replay; prohibited gate failure returns REJECTED; incomplete never VERIFIED; repeat run idempotent and bounded continuation; cancel terminal.
- Compare executive/developer report from same verified response. No synthetic result flowing into realized card or public screenshot.
