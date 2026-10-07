/**
 * Deterministic identity. Every key and id is a pure function of canonical
 * source identity, so importing the same evidence twice produces the same
 * keys, the same row ids and the same graph hash.
 */
import { deterministicUuid, sha256Json } from '../product/hashing.js';
import { SCHEMA_VERSION } from './contracts.js';

export { sha256Json };

/**
 * Stable key of a trace-scoped node:
 * sha256([workspace_id, source_kind, source_trace_id, source_span_id, kind]).
 */
export function spanStableKey(workspaceId, sourceKind, traceId, spanId, kind) {
  return sha256Json(['zevir.node', workspaceId, sourceKind, traceId ?? null, spanId ?? null, kind]);
}

/**
 * Stable key of an entity node that is the same thing across traces (a model
 * runtime, an MCP server, a code symbol). Source-agnostic on purpose, so an
 * engine trace and an OTel span served by the same model meet at one key.
 */
export function entityStableKey(workspaceId, kind, identity) {
  return sha256Json(['zevir.entity', workspaceId, kind, identity]);
}

export const graphId = (workspaceId, sourceKind, graphKey) => deterministicUuid(`zevir.graph:${workspaceId}:${sourceKind}:${graphKey}`);
export const nodeId = (graphUuid, stableKey) => deterministicUuid(`zevir.node:${graphUuid}:${stableKey}`);
export const edgeId = (graphUuid, edge) => deterministicUuid(`zevir.edge:${graphUuid}:${edge.source}:${edge.kind}:${edge.target}`);
export const evidenceId = (graphUuid, ref) => deterministicUuid(`zevir.evidence:${graphUuid}:${ref.node ?? '-'}:${ref.source_kind}:${ref.source_id ?? '-'}:${ref.source_span_id ?? '-'}:${ref.source_hash}`);

const edgeOrder = (a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.target < b.target ? -1 : a.target > b.target ? 1 : 0);
const evidenceSortKey = (r) => `${r.node ?? ''}|${r.source_kind}|${r.source_id ?? ''}|${r.source_span_id ?? ''}|${r.source_hash}`;

/** Canonical order: nodes by stable key, edges by (source, kind, target), evidence by its identity. */
export function sortGraph(graph) {
  return {
    ...graph,
    nodes: [...graph.nodes].sort((a, b) => (a.stable_key < b.stable_key ? -1 : a.stable_key > b.stable_key ? 1 : 0)),
    edges: [...graph.edges].sort(edgeOrder),
    evidence: [...graph.evidence].sort((a, b) => (evidenceSortKey(a) < evidenceSortKey(b) ? -1 : evidenceSortKey(a) > evidenceSortKey(b) ? 1 : 0)),
  };
}

/**
 * Hash of what the graph says, independent of array order and of when or by
 * which adapter build it was produced (adapter_version is recorded, not hashed,
 * so an adapter release that emits identical graphs is a no-op).
 */
export function graphHash(graph) {
  const sorted = sortGraph(graph);
  return sha256Json({
    schema_version: SCHEMA_VERSION,
    source_kind: graph.source_kind,
    graph_key: graph.graph_key,
    source_trace_id: graph.source_trace_id ?? null,
    root: graph.root ?? null,
    status: graph.status,
    completeness: graph.completeness,
    capture_started_at: graph.capture_started_at ?? null,
    capture_ended_at: graph.capture_ended_at ?? null,
    nodes: sorted.nodes,
    edges: sorted.edges,
    evidence: sorted.evidence,
  });
}
