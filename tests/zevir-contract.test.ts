/**
 * The ZevIR v0.1 contract: exactly eight node kinds, exactly eleven edge kinds,
 * JSON Schema 2020-12 validation, graph invariants and a deterministic hash.
 */
import { describe, expect, it } from 'vitest';
import { EDGE_KINDS, NODE_KINDS, SCHEMA_VERSION } from '../api/_lib/zevir/contracts.js';
import { schemas, validateEdge, validateEnvelope, validateGraph, validateNode } from '../api/_lib/zevir/validate.js';
import { finalize, Gaps, sanitizeAttributes } from '../api/_lib/zevir/canonicalize.js';
import { graphHash, spanStableKey } from '../api/_lib/zevir/hash.js';
import { sha256Json } from '../api/_lib/product/hashing.js';
import { summarizeGraph } from '../api/_lib/zevir/store.js';

const WS = '11111111-1111-4111-8111-111111111111';
const KEY = 'a'.repeat(64);
const KEY2 = 'b'.repeat(64);
const node = (over: Record<string, unknown> = {}) => ({ stable_key: KEY, kind: 'Task', attributes: {}, ...over });
const edge = (over: Record<string, unknown> = {}) => ({ source: KEY, target: KEY2, kind: 'CALLS', ordinal: null, attributes: {}, ...over });

const EXACT_NODE_KINDS = ['Task', 'ModelCall', 'Agent', 'ToolCall', 'Retrieval', 'Function', 'Runtime', 'Outcome'];
const EXACT_EDGE_KINDS = ['CALLS', 'USES', 'DEPENDS_ON', 'RETRIEVES', 'PROVIDES_CONTEXT', 'ROUTES_TO', 'SERVED_BY', 'REPLACES', 'PRODUCES', 'EVALUATED_BY', 'LOCATED_AT'];

/** A small hand-written draft: Task → ModelCall → Runtime, with evidence. */
function draft(order: 'forward' | 'reverse' = 'forward') {
  const ev = (span: string) => ({ source_id: span, source_trace_id: 't1', source_span_id: span, source_hash: sha256Json(span), locator: { span } });
  const nodes = [
    { ref: 'task', kind: 'Task', scope: { trace_id: 't1', span_id: null }, fields: { name: 'req' }, attributes: {}, evidence: [ev('task')] },
    { ref: 'call', kind: 'ModelCall', scope: { trace_id: 't1', span_id: 's1' }, fields: { name: 'gpt', operation: 'chat', input_tokens: 10, output_tokens: 2 }, attributes: { provider: 'openai', model: 'gpt' }, evidence: [ev('s1')] },
    { ref: 'rt', kind: 'Runtime', scope: { entity: ['model_endpoint', 'openai', 'gpt'] }, fields: { name: 'openai/gpt' }, attributes: { b: 1, a: 2 }, evidence: [ev('s1-rt')] },
  ];
  const edges = [
    { from: 'task', to: 'call', kind: 'CALLS', ordinal: 0 },
    { from: 'call', to: 'rt', kind: 'SERVED_BY' },
  ];
  const gaps = new Gaps();
  gaps.add('cost_unknown', 's1');
  const d = { source_kind: 'otel_genai', graph_key: 'trace:t1', source_trace_id: 't1', root: 'task', nodes, edges, gaps };
  return order === 'forward' ? d : { ...d, nodes: [...nodes].reverse(), edges: [...edges].reverse() };
}

describe('ZevIR v0.1 node kinds', () => {
  it('are exactly the eight canonical kinds, in code and in the schema', () => {
    expect([...NODE_KINDS]).toEqual(EXACT_NODE_KINDS);
    expect(schemas.node.properties.kind.enum).toEqual(EXACT_NODE_KINDS);
    for (const kind of EXACT_NODE_KINDS) expect(validateNode(node({ kind })).ok).toBe(true);
  });

  it.each(['Network', 'Embedding', 'Reranker', 'Guardrail', 'Evaluator', 'Prompt', 'Decision', 'LLM', 'CHAIN', 'task'])('rejects %s', (kind) => {
    const r = validateNode(node({ kind }));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/kind/);
  });

  it('keeps operation on ModelCall and semantic_role on Function', () => {
    expect(validateNode(node({ kind: 'ModelCall', operation: 'embedding' })).ok).toBe(true);
    expect(validateNode(node({ kind: 'ModelCall', operation: 'teleport' })).ok).toBe(false);
    expect(validateNode(node({ kind: 'ToolCall', operation: 'chat' })).ok).toBe(false);
    expect(validateNode(node({ kind: 'Function', attributes: { semantic_role: 'guardrail' } })).ok).toBe(true);
    expect(validateNode(node({ kind: 'Function', attributes: { semantic_role: 'judge' } })).ok).toBe(false);
    expect(validateNode(node({ kind: 'Agent', attributes: { semantic_role: 'evaluator' } })).ok).toBe(false);
  });

  it('cannot represent raw prompt or output content', () => {
    for (const key of ['prompt', 'messages', 'content', 'input_text', 'output_text', 'system_prompt', 'raw_body']) {
      expect(validateNode(node({ attributes: { [key]: 'hello' } })).ok).toBe(false);
    }
  });

  it('requires provenance for a known cost and allows an unknown one', () => {
    expect(validateNode(node({ kind: 'ModelCall', cost_usd: 0.01 })).ok).toBe(false);
    expect(validateNode(node({ kind: 'ModelCall', cost_usd: 0.01, cost_source: 'provider_reported' })).ok).toBe(true);
    expect(validateNode(node({ kind: 'ModelCall', cost_usd: 0, cost_source: 'provider_reported' })).ok).toBe(true);
    expect(validateNode(node({ kind: 'ModelCall', cost_usd: null, cost_source: null })).ok).toBe(true);
    expect(validateNode(node({ kind: 'ModelCall', cost_usd: -1, cost_source: 'provider_reported' })).ok).toBe(false);
  });
});

describe('ZevIR v0.1 edge kinds', () => {
  it('are exactly the eleven canonical kinds', () => {
    expect([...EDGE_KINDS]).toEqual(EXACT_EDGE_KINDS);
    expect(schemas.edge.properties.kind.enum).toEqual(EXACT_EDGE_KINDS);
    for (const kind of EXACT_EDGE_KINDS) expect(validateEdge(edge({ kind })).ok).toBe(true);
  });

  it.each(['NETWORK', 'calls', 'INVOKES', 'PARENT_OF', ''])('rejects %s', (kind) => {
    expect(validateEdge(edge({ kind })).ok).toBe(false);
  });

  it('rejects an edge whose endpoint is not a stable key', () => {
    expect(validateEdge(edge({ target: 'span-123' })).ok).toBe(false);
  });
});

describe('graph invariants', () => {
  it('finalizes a valid graph', () => {
    const g = finalize(draft(), { workspaceId: WS });
    expect(validateGraph(g)).toEqual({ ok: true, errors: [] });
    expect(g.schema_version).toBe(SCHEMA_VERSION);
    expect(g.status).toBe('incomplete');
  });

  it('rejects an edge whose endpoint does not exist in the graph', () => {
    const g = finalize(draft(), { workspaceId: WS });
    const broken = { ...g, edges: [...g.edges, { source: g.nodes[0].stable_key, target: 'c'.repeat(64), kind: 'CALLS', ordinal: null, attributes: {} }] };
    broken.graph_hash = graphHash(broken);
    const r = validateGraph(broken);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/is not a node of this graph/);
  });

  it('refuses a draft edge to an unknown ref', () => {
    const d = draft();
    d.edges.push({ from: 'call', to: 'nowhere', kind: 'CALLS', ordinal: 0 });
    expect(() => finalize(d, { workspaceId: WS })).toThrow(/unknown node/);
  });

  it('rejects a node without provenance', () => {
    const g = finalize(draft(), { workspaceId: WS });
    const orphan = { ...g, evidence: g.evidence.filter((r: { node: string }) => r.node !== g.nodes[0].stable_key) };
    orphan.graph_hash = graphHash(orphan);
    expect(validateGraph(orphan).errors.join(' ')).toMatch(/no evidence reference/);
  });

  it('rejects a tampered hash and duplicate stable keys', () => {
    const g = finalize(draft(), { workspaceId: WS });
    expect(validateGraph({ ...g, graph_hash: 'f'.repeat(64) }).errors).toContain('graph_hash does not match the graph');
    const dup = { ...g, nodes: [...g.nodes, g.nodes[0]] };
    dup.graph_hash = graphHash(dup);
    expect(validateGraph(dup).errors.join(' ')).toMatch(/duplicate stable_key/);
  });

  it('allows loops (no DAG rule)', () => {
    const d = draft();
    d.edges.push({ from: 'call', to: 'task', kind: 'DEPENDS_ON' });
    expect(validateGraph(finalize(d, { workspaceId: WS })).ok).toBe(true);
  });
});

describe('deterministic identity', () => {
  it('graph hash does not depend on node/edge/attribute input order', () => {
    const a = finalize(draft('forward'), { workspaceId: WS });
    const b = finalize(draft('reverse'), { workspaceId: WS });
    expect(a.graph_hash).toBe(b.graph_hash);
    expect(a).toEqual(b);
  });

  it('stable key is sha256 of workspace, source kind, trace, span and kind', () => {
    const g = finalize(draft(), { workspaceId: WS });
    const call = g.nodes.find((n: { kind: string }) => n.kind === 'ModelCall');
    expect(call.stable_key).toBe(spanStableKey(WS, 'otel_genai', 't1', 's1', 'ModelCall'));
    expect(spanStableKey(WS, 'otel_genai', 't1', 's1', 'ModelCall')).not.toBe(spanStableKey('22222222-2222-4222-8222-222222222222', 'otel_genai', 't1', 's1', 'ModelCall'));
    expect(spanStableKey(WS, 'otel_genai', 't1', 's1', 'ModelCall')).not.toBe(spanStableKey(WS, 'openinference', 't1', 's1', 'ModelCall'));
  });

  it('a different workspace yields different keys for the same trace', () => {
    const a = finalize(draft(), { workspaceId: WS });
    const b = finalize(draft(), { workspaceId: '22222222-2222-4222-8222-222222222222' });
    expect(a.graph_hash).not.toBe(b.graph_hash);
  });
});

describe('unknown cost', () => {
  it('stays null in the node and unknown in the summary — never $0', () => {
    const g = finalize(draft(), { workspaceId: WS });
    const call = g.nodes.find((n: { kind: string }) => n.kind === 'ModelCall');
    expect(call.cost_usd).toBeNull();
    expect(call.cost_source).toBeNull();
    const s = summarizeGraph(g);
    expect(s.cost).toEqual({ known: 0, unknown: 1, known_total_usd: null, complete: false });
  });

  it('keeps a known $0 distinct from unknown', () => {
    const d = draft();
    d.nodes[1].fields = { ...d.nodes[1].fields, cost_usd: 0, cost_source: 'provider_reported' } as never;
    const s = summarizeGraph(finalize(d, { workspaceId: WS }));
    expect(s.cost).toEqual({ known: 1, unknown: 0, known_total_usd: 0, complete: true });
  });

  it('drops a cost that arrives without provenance instead of trusting it', () => {
    const d = draft();
    d.nodes[1].fields = { ...d.nodes[1].fields, cost_usd: 0.5 } as never;
    const call = finalize(d, { workspaceId: WS }).nodes.find((n: { kind: string }) => n.kind === 'ModelCall');
    expect(call.cost_usd).toBeNull();
  });
});

describe('attribute sanitizer', () => {
  it('drops content and credential keys, redacts secret-shaped values, bounds size', () => {
    const out = sanitizeAttributes({ messages: ['hi'], prompt: 'x', api_key: 'k', auth_token: 't', note: 'key sk-abcdefghijklmnopqrstuvwxyz123456', max_tokens: 5, nested: { content: 'secret', ok: 1 }, long: 'x'.repeat(2000) });
    expect(out).toEqual({ long: 'x'.repeat(512), max_tokens: 5, nested: { ok: 1 }, note: 'key [redacted]' });
  });
});

describe('ingestion envelope', () => {
  const base = { schema_version: 'zevir.v0.1', workspace_id: WS, source_kind: 'otel_genai', payload: { resourceSpans: [] } };
  it('accepts a bounded external batch', () => {
    expect(validateEnvelope(base).ok).toBe(true);
    expect(validateEnvelope({ ...base, capture_content: false }).ok).toBe(true);
  });
  it('refuses content capture, engine source, unknown fields and a bad workspace id', () => {
    expect(validateEnvelope({ ...base, capture_content: true }).ok).toBe(false);
    expect(validateEnvelope({ ...base, source_kind: 'zevqora_engine' }).ok).toBe(false);
    expect(validateEnvelope({ ...base, extra: 1 }).ok).toBe(false);
    expect(validateEnvelope({ ...base, workspace_id: 'ws-1' }).ok).toBe(false);
  });
});
