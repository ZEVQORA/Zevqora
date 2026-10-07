/**
 * ZevIR v0.1 — ZEVQORA's internal canonical execution representation.
 *
 * External standards (OpenTelemetry GenAI, OpenInference, MCP) are input
 * adapters; their field names never appear here. The JSON Schema contract
 * lives in schemas/zevir/v0.1 and is the source of truth; these constants
 * mirror it for code and are pinned against it by tests.
 */
export const SCHEMA_VERSION = 'zevir.v0.1';

export const NODE_KINDS = Object.freeze(['Task', 'ModelCall', 'Agent', 'ToolCall', 'Retrieval', 'Function', 'Runtime', 'Outcome']);

export const EDGE_KINDS = Object.freeze(['CALLS', 'USES', 'DEPENDS_ON', 'RETRIEVES', 'PROVIDES_CONTEXT', 'ROUTES_TO', 'SERVED_BY', 'REPLACES', 'PRODUCES', 'EVALUATED_BY', 'LOCATED_AT']);

export const SOURCE_KINDS = Object.freeze(['zevqora_engine', 'otel_genai', 'openinference']);

/** Bumped whenever an adapter's mapping changes what it emits. */
export const ADAPTER_VERSIONS = Object.freeze({
  zevqora_engine: 'zevir-engine/0.1.0',
  otel_genai: 'zevir-otel-genai/0.1.0',
  openinference: 'zevir-openinference/0.1.0',
});

export const MODEL_OPERATIONS = Object.freeze(['chat', 'completion', 'generate_content', 'embedding', 'rerank', 'decision']);
export const SEMANTIC_ROLES = Object.freeze(['chain', 'prompt', 'guardrail', 'evaluator']);
export const COST_SOURCES = Object.freeze(['provider_reported', 'pricing_snapshot_estimate', 'imported_external']);

export const LIMITS = Object.freeze({
  maxNodesPerGraph: 5000,
  maxEdgesPerGraph: 20000,
  maxSpansPerBatch: 5000,
  maxTracesPerBatch: 200,
  maxIngestBytes: 3_000_000,
  maxEngineTraces: 5000,
  maxGraphsPerPersistCall: 100,
  maxNodesPerPersistCall: 4000,
  neighborhoodMaxDepth: 6,
  neighborhoodMaxNodes: 500,
  pageMax: 500,
});
