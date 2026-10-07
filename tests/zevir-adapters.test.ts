/**
 * Input adapters → canonical ZevIR graphs. Each source is pinned to the exact
 * graph it must produce, and to what it must never produce: raw content,
 * fabricated values, or a source vocabulary leaking into the canonical enums.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { engineTracesToGraphs } from '../api/_lib/zevir/adapters/engine.js';
import { otelGenAiToGraphs } from '../api/_lib/zevir/adapters/otel-genai.js';
import { openInferenceToGraphs } from '../api/_lib/zevir/adapters/openinference.js';
import { NODE_KINDS } from '../api/_lib/zevir/contracts.js';
import { validateGraph } from '../api/_lib/zevir/validate.js';
import { spanStableKey } from '../api/_lib/zevir/hash.js';

type Node = { stable_key: string; kind: string; name: string | null; operation: string | null; cost_usd: number | null; cost_source: string | null; input_tokens: number | null; output_tokens: number | null; cached_input_tokens: number | null; reasoning_tokens: number | null; latency_ms: number | null; duration_ms: number | null; status: string | null; attributes: Record<string, unknown> };
type Graph = { nodes: Node[]; edges: { source: string; target: string; kind: string }[]; evidence: Record<string, unknown>[]; status: string; graph_hash: string; source_version: string | null; source_trace_id: string; completeness: { gaps: { code: string; count: number }[] } };

const WS = '11111111-1111-4111-8111-111111111111';
const PRODUCT = { id: '22222222-2222-4222-8222-222222222222', workspace_id: WS, project_id: null };
const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'zevir', name), 'utf8'));
const label = (n: Node) => `${n.kind}:${n.name}${n.operation ? `(${n.operation})` : ''}${n.attributes.semantic_role ? `[${n.attributes.semantic_role}]` : ''}`;
function shape(g: Graph) {
  const by = new Map(g.nodes.map((n) => [n.stable_key, n]));
  return {
    nodes: g.nodes.map(label).sort(),
    edges: g.edges.map((e) => `${label(by.get(e.source)!)} -${e.kind}-> ${label(by.get(e.target)!)}`).sort(),
  };
}
const gapCodes = (g: Graph) => g.completeness.gaps.map((x) => x.code);
const find = (g: Graph, kind: string, name?: string) => g.nodes.find((n) => n.kind === kind && (name === undefined || n.name === name))!;

const engineTrace = (over: Record<string, unknown> = {}) => ({
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  product_id: PRODUCT.id,
  workspace_id: WS,
  request_id: 'req-1',
  timestamp: '2026-09-01T10:00:00.000Z',
  symbol: 'classify_ticket',
  workflow: 'support',
  provider: 'openai',
  model: 'openai/gpt-4o',
  requested_model: 'openai/gpt-4o',
  response_model: 'openai/gpt-4o-2024-11-20',
  provider_request_id: 'gen-1',
  input_text: 'RAW-INPUT my invoice is wrong',
  output_text: 'RAW-OUTPUT billing',
  expected_output: 'RAW-EXPECTED billing',
  system_prompt: 'RAW-SYSTEM classify',
  messages: [{ role: 'user', content: 'RAW-MESSAGE' }],
  system_prompt_hash: 'c'.repeat(64),
  input_tokens: 40,
  output_tokens: 2,
  cached_input_tokens: 32,
  reasoning_tokens: null,
  latency_ms: 610,
  ttft_ms: 180,
  cost_usd: 0.003,
  cost_source: 'imported_external',
  pricing_version: 'model_pricing@2026-09-01',
  attempt: 2,
  retry_reason: 'rate_limited',
  input_hash: 'a'.repeat(64),
  output_hash: 'b'.repeat(64),
  protected: true,
  metadata: { team: 'cx', prompt: 'RAW-META-PROMPT', api_key: 'sk-should-not-survive-1234567890' },
  ...over,
});

describe('engine adapter', () => {
  it('projects an engine trace into Task → Function → ModelCall → Runtime/Outcome', () => {
    const { graphs, rejected } = engineTracesToGraphs([engineTrace()], { product: PRODUCT });
    expect(rejected).toEqual([]);
    const g = graphs[0] as Graph;
    expect(shape(g)).toEqual({
      nodes: ['Function:classify_ticket', 'ModelCall:openai/gpt-4o-2024-11-20', 'Outcome:output', 'Runtime:openai/gpt-4o-2024-11-20', 'Task:support'],
      edges: [
        'Function:classify_ticket -CALLS-> ModelCall:openai/gpt-4o-2024-11-20',
        'ModelCall:openai/gpt-4o-2024-11-20 -PRODUCES-> Outcome:output',
        'ModelCall:openai/gpt-4o-2024-11-20 -SERVED_BY-> Runtime:openai/gpt-4o-2024-11-20',
        'Task:support -CALLS-> Function:classify_ticket',
      ],
    });
    expect(g.status).toBe('complete');
    expect(g.source_trace_id).toBe('req-1');
    const call = find(g, 'ModelCall');
    expect(call).toMatchObject({ input_tokens: 40, output_tokens: 2, cached_input_tokens: 32, reasoning_tokens: null, latency_ms: 610, cost_usd: 0.003, cost_source: 'imported_external' });
    expect(call.attributes).toMatchObject({ provider: 'openai', requested_model: 'openai/gpt-4o', response_model: 'openai/gpt-4o-2024-11-20', provider_request_id: 'gen-1', pricing_version: 'model_pricing@2026-09-01', attempt: 2, retry_reason: 'rate_limited', protected: true, input_digest: { sha256: 'a'.repeat(64) }, output_digest: { sha256: 'b'.repeat(64) }, system_prompt_sha256: 'c'.repeat(64), metadata: { team: 'cx' } });
    expect(validateGraph(g).ok).toBe(true);
  });

  it('links Task straight to ModelCall when the trace names no symbol', () => {
    const g = engineTracesToGraphs([engineTrace({ symbol: null })], { product: PRODUCT }).graphs[0] as Graph;
    expect(shape(g).edges).toContain('Task:support -CALLS-> ModelCall:openai/gpt-4o-2024-11-20');
    expect(g.nodes.some((n) => n.kind === 'Function')).toBe(false);
  });

  it('preserves engine trace ids and hashes in evidence references', () => {
    const g = engineTracesToGraphs([engineTrace()], { product: PRODUCT }).graphs[0] as Graph;
    const call = find(g, 'ModelCall');
    const ref = g.evidence.find((r) => r.node === call.stable_key)!;
    expect(ref).toMatchObject({ source_kind: 'zevqora_engine', source_id: 'aaaaaaaa-0000-4000-8000-000000000001', source_trace_id: 'req-1', source_span_id: 'model_call', adapter_version: 'zevir-engine/0.1.0', schema_version: 'zevir.v0.1', redaction_state: 'hashed_only', locator: { table: 'engine_traces', id: 'aaaaaaaa-0000-4000-8000-000000000001', product_id: PRODUCT.id, request_id: 'req-1' } });
    expect(ref.source_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(ref.content_hash).toMatch(/^[0-9a-f]{64}$/);
    const outcomeRef = g.evidence.find((r) => r.node === find(g, 'Outcome').stable_key)!;
    expect(outcomeRef.content_hash).toBe('b'.repeat(64));
    for (const n of g.nodes) expect(g.evidence.some((r) => r.node === n.stable_key)).toBe(true);
  });

  it('keeps unknown cost unknown and reports the gap', () => {
    const g = engineTracesToGraphs([engineTrace({ cost_usd: null, cost_source: null, input_tokens: null, latency_ms: null })], { product: PRODUCT }).graphs[0] as Graph;
    const call = find(g, 'ModelCall');
    expect(call.cost_usd).toBeNull();
    expect(call.input_tokens).toBeNull();
    expect(call.latency_ms).toBeNull();
    expect(g.status).toBe('incomplete');
    expect(gapCodes(g)).toEqual(['cost_unknown', 'latency_unknown', 'tokens_unknown']);
  });

  it('does not invent an Outcome when no output was recorded', () => {
    const g = engineTracesToGraphs([engineTrace({ output_hash: null, output_text: null })], { product: PRODUCT }).graphs[0] as Graph;
    expect(g.nodes.some((n) => n.kind === 'Outcome')).toBe(false);
    expect(gapCodes(g)).toContain('no_output_evidence');
  });

  it('never carries raw input, output, expected output, prompt or credentials', () => {
    const text = JSON.stringify(engineTracesToGraphs([engineTrace()], { product: PRODUCT }));
    expect(text).not.toMatch(/RAW-|sk-should-not-survive/);
  });

  it('shares entity nodes (Function, Runtime) across traces by stable key', () => {
    const { graphs } = engineTracesToGraphs([engineTrace(), engineTrace({ id: 'aaaaaaaa-0000-4000-8000-000000000002', request_id: 'req-2' })], { product: PRODUCT });
    const [a, b] = graphs as Graph[];
    expect(find(a, 'Runtime').stable_key).toBe(find(b, 'Runtime').stable_key);
    expect(find(a, 'Function').stable_key).toBe(find(b, 'Function').stable_key);
    expect(find(a, 'ModelCall').stable_key).not.toBe(find(b, 'ModelCall').stable_key);
  });

  it('is deterministic for the same trace', () => {
    const a = engineTracesToGraphs([engineTrace()], { product: PRODUCT }).graphs[0];
    const b = engineTracesToGraphs([engineTrace()], { product: PRODUCT }).graphs[0];
    expect(a).toEqual(b);
  });
});

describe('OpenTelemetry GenAI adapter', () => {
  const { graphs, rejected, received, spanCount } = otelGenAiToGraphs(fixture('otel-genai.json'), { workspaceId: WS });
  const agentTrace = graphs.find((g: Graph) => g.source_trace_id === '5b8efff798038103d269b633813fc60c') as Graph;
  const partial = graphs.find((g: Graph) => g.source_trace_id === '0af7651916cd43dd8448eb211c80319c') as Graph;

  it('maps an agent trace to the expected graph', () => {
    expect(rejected).toEqual([]);
    expect(received).toBe(2);
    expect(spanCount).toBe(6);
    expect(shape(agentTrace)).toEqual({
      nodes: ['Agent:support-agent', 'Function:POST /v1/support', 'ModelCall:gpt-4o-2024-11-20(chat)', 'ModelCall:text-embedding-3-small(embedding)', 'Outcome:output', 'Runtime:openai/gpt-4o-2024-11-20', 'Runtime:openai/text-embedding-3-small', 'Runtime:orders-mcp.internal:8443', 'Task:POST /v1/support', 'ToolCall:lookup_order'],
      edges: [
        'Agent:support-agent -CALLS-> ModelCall:gpt-4o-2024-11-20(chat)',
        'Agent:support-agent -CALLS-> ModelCall:text-embedding-3-small(embedding)',
        'Agent:support-agent -CALLS-> ToolCall:lookup_order',
        'Function:POST /v1/support -CALLS-> Agent:support-agent',
        'ModelCall:gpt-4o-2024-11-20(chat) -PRODUCES-> Outcome:output',
        'ModelCall:gpt-4o-2024-11-20(chat) -SERVED_BY-> Runtime:openai/gpt-4o-2024-11-20',
        'ModelCall:text-embedding-3-small(embedding) -SERVED_BY-> Runtime:openai/text-embedding-3-small',
        'Task:POST /v1/support -CALLS-> Function:POST /v1/support',
        'ToolCall:lookup_order -SERVED_BY-> Runtime:orders-mcp.internal:8443',
      ],
    });
    expect(agentTrace.source_version).toBe('1.37.0');
    expect(validateGraph(agentTrace).ok).toBe(true);
  });

  it('maps tokens, timing and identity from gen_ai.* without inventing cost', () => {
    const chat = find(agentTrace, 'ModelCall', 'gpt-4o-2024-11-20');
    expect(chat).toMatchObject({ input_tokens: 812, output_tokens: 64, cached_input_tokens: 512, reasoning_tokens: null, duration_ms: 1250, latency_ms: 1250, cost_usd: null, cost_source: null });
    expect(chat.attributes).toMatchObject({ provider: 'openai', request_model: 'gpt-4o', response_model: 'gpt-4o-2024-11-20', provider_request_id: 'chatcmpl-123', request_params: { max_tokens: 512, temperature: 0.2 } });
    expect(find(agentTrace, 'Agent').attributes).toMatchObject({ agent_id: 'agt_support_01', agent_name: 'support-agent', conversation_id: 'conv_7781' });
    expect(gapCodes(agentTrace)).toEqual(['cost_unknown']);
  });

  it('records MCP tool metadata as adapter metadata on the ToolCall', () => {
    const tool = find(agentTrace, 'ToolCall');
    expect(tool.attributes.protocol).toEqual({ protocol: 'mcp', protocol_version: '2026-07-28', method: 'tools/call', tool_name: 'lookup_order', server: 'orders-mcp.internal:8443' });
    expect(tool.attributes).toMatchObject({ tool_name: 'lookup_order', tool_call_id: 'call_9', tool_type: 'function' });
    expect((tool.attributes.arguments_digest as { sha256: string }).sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(find(agentTrace, 'Runtime', 'orders-mcp.internal:8443').attributes).toEqual({ protocol: 'mcp', runtime_kind: 'mcp_server', server: 'orders-mcp.internal:8443' });
  });

  it('keeps incomplete telemetry incomplete instead of manufacturing values', () => {
    expect(partial.status).toBe('incomplete');
    expect(gapCodes(partial)).toEqual(['cost_unknown', 'missing_parent', 'missing_root', 'no_output_evidence', 'provider_unknown', 'tokens_unknown']);
    const call = find(partial, 'ModelCall');
    expect(call).toMatchObject({ input_tokens: null, output_tokens: null, cost_usd: null, status: 'error' });
    expect(call.attributes.provider).toBeUndefined();
    expect(partial.nodes.some((n) => n.kind === 'Outcome')).toBe(false);
    // The orphan span is not attached to anything it was not observed under.
    expect(partial.edges.filter((e) => e.target === call.stable_key)).toEqual([]);
    expect(find(partial, 'Runtime').attributes).toEqual({ model: 'claude-sonnet-5-5', runtime_kind: 'model_endpoint' });
  });

  it('preserves trace and span ids in evidence references', () => {
    const chat = find(agentTrace, 'ModelCall', 'gpt-4o-2024-11-20');
    expect(chat.stable_key).toBe(spanStableKey(WS, 'otel_genai', '5b8efff798038103d269b633813fc60c', '0000000000000c01', 'ModelCall'));
    const ref = agentTrace.evidence.find((r) => r.node === chat.stable_key)!;
    expect(ref).toMatchObject({ source_kind: 'otel_genai', source_id: '0000000000000c01', source_trace_id: '5b8efff798038103d269b633813fc60c', source_span_id: '0000000000000c01', redaction_state: 'hashed_only', adapter_version: 'zevir-otel-genai/0.1.0' });
    expect(ref.source_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never stores prompt, output, system instructions or tool arguments', () => {
    expect(JSON.stringify(graphs)).not.toMatch(/SECRET-/);
  });

  it('produces the same graph whatever the span order', () => {
    const f = fixture('otel-genai.json');
    f.resourceSpans[0].scopeSpans[0].spans.reverse();
    for (const s of f.resourceSpans[0].scopeSpans[0].spans) s.attributes.reverse();
    const again = otelGenAiToGraphs(f, { workspaceId: WS }).graphs.find((g: Graph) => g.source_trace_id === agentTrace.source_trace_id);
    expect(again.graph_hash).toBe(agentTrace.graph_hash);
  });

  it('rejects a trace with two different spans under one id, keeps the rest', () => {
    const f = fixture('otel-genai.json');
    const spans = f.resourceSpans[0].scopeSpans[0].spans;
    spans.push({ ...spans[2], name: 'conflicting' });
    const out = otelGenAiToGraphs(f, { workspaceId: WS });
    expect(out.rejected.map((r: { source_trace_id: string }) => r.source_trace_id)).toEqual(['5b8efff798038103d269b633813fc60c']);
    expect(out.graphs).toHaveLength(1);
  });
});

describe('OpenInference adapter', () => {
  const { graphs, rejected } = openInferenceToGraphs(fixture('openinference.json'), { workspaceId: WS });
  const g = graphs[0] as Graph;

  it('maps every span kind onto the canonical nodes', () => {
    expect(rejected).toEqual([]);
    expect(shape(g)).toEqual({
      nodes: ['Agent:planner', 'Function:faithfulness_eval[evaluator]', 'Function:pii_guard[guardrail]', 'Function:rag_pipeline[chain]', 'ModelCall:cohere-rerank-v4(rerank)', 'ModelCall:gpt-4o-mini', 'ModelCall:text-embedding-3-small(embedding)', 'Outcome:output', 'Retrieval:retrieve', 'Runtime:cohere-rerank-v4', 'Runtime:openai/gpt-4o-mini', 'Runtime:openai/text-embedding-3-small', 'Task:rag_pipeline', 'ToolCall:lookup_order'],
      edges: [
        'Function:rag_pipeline[chain] -CALLS-> Agent:planner',
        'Function:rag_pipeline[chain] -CALLS-> Function:faithfulness_eval[evaluator]',
        'Function:rag_pipeline[chain] -CALLS-> Function:pii_guard[guardrail]',
        'Function:rag_pipeline[chain] -CALLS-> ModelCall:cohere-rerank-v4(rerank)',
        'Function:rag_pipeline[chain] -CALLS-> ModelCall:gpt-4o-mini',
        'Function:rag_pipeline[chain] -CALLS-> ToolCall:lookup_order',
        'Function:rag_pipeline[chain] -RETRIEVES-> Retrieval:retrieve',
        'ModelCall:cohere-rerank-v4(rerank) -SERVED_BY-> Runtime:cohere-rerank-v4',
        'ModelCall:gpt-4o-mini -EVALUATED_BY-> Function:faithfulness_eval[evaluator]',
        'ModelCall:gpt-4o-mini -PRODUCES-> Outcome:output',
        'ModelCall:gpt-4o-mini -SERVED_BY-> Runtime:openai/gpt-4o-mini',
        'ModelCall:text-embedding-3-small(embedding) -SERVED_BY-> Runtime:openai/text-embedding-3-small',
        'Retrieval:retrieve -CALLS-> ModelCall:text-embedding-3-small(embedding)',
        'Task:rag_pipeline -CALLS-> Function:rag_pipeline[chain]',
      ],
    });
    expect(validateGraph(g).ok).toBe(true);
  });

  it('never lets an OpenInference span kind into the canonical kind enum', () => {
    for (const n of g.nodes) expect(NODE_KINDS).toContain(n.kind);
    expect(g.nodes.map((n) => n.kind)).not.toEqual(expect.arrayContaining(['LLM', 'CHAIN', 'RETRIEVER', 'EVALUATOR']));
  });

  it('keeps tokens, cost provenance, documents and evaluation metadata', () => {
    const llm = find(g, 'ModelCall', 'gpt-4o-mini');
    expect(llm).toMatchObject({ input_tokens: 640, output_tokens: 48, cached_input_tokens: 256, reasoning_tokens: 0, cost_usd: 0.000125, cost_source: 'imported_external', duration_ms: 2000, status: 'ok' });
    expect(find(g, 'Retrieval').attributes).toMatchObject({ document_count: 2, document_refs: [{ id: 'kb-17', score: 0.91 }, { id: 'kb-03', score: 0.42 }] });
    expect(find(g, 'Function', 'faithfulness_eval').attributes.evaluation).toEqual({ label: 'faithful', name: 'faithfulness', score: 0.97 });
    expect(find(g, 'ToolCall').attributes).toMatchObject({ tool_name: 'lookup_order', tool_call_id: 'tc_1', tool_description: 'Fetch an order' });
    expect(find(g, 'Function', 'rag_pipeline').attributes).toMatchObject({ session_id: 'sess_42', input_mime_type: 'text/plain' });
  });

  it('keeps no content and only a pseudonymous user reference', () => {
    const text = JSON.stringify(graphs);
    expect(text).not.toMatch(/SECRET-|alice/);
    expect(find(g, 'Function', 'rag_pipeline').attributes.user_ref).toMatch(/^[0-9a-f]{64}$/);
  });

  it('marks a rerank without a provider as incomplete, not guessed', () => {
    expect(g.completeness.gaps).toEqual([
      { code: 'cost_unknown', count: 2, sample: ['1000000000000003', '1000000000000008'] },
      { code: 'provider_unknown', count: 1, sample: ['1000000000000003'] },
    ]);
  });
});
