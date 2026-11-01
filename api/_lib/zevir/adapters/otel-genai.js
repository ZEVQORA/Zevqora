/**
 * OpenTelemetry GenAI semantic conventions → ZevIR.
 *
 * External attribute names (gen_ai.*, mcp.*, server.*) live only in this file.
 * Recognized when present; never required. A value the span did not carry
 * stays null — no provider, model, token count or cost is inferred. OTel
 * GenAI has no standard cost attribute, so OTel model calls carry no cost.
 *
 * Mapping by gen_ai.operation.name:
 *   chat / text_completion / generate_content / embeddings → ModelCall
 *   invoke_agent / create_agent                           → Agent
 *   execute_tool (or MCP tools/call)                      → ToolCall
 *   retrieval                                              → Retrieval
 *   anything else                                          → Function
 */
import { finalize, modelCallGaps, modelRuntime, optCount, optString, spanTraceDraft } from '../canonicalize.js';
import { dedupeSpans, digestAttributes, isContentAttribute, readSpans } from './otlp.js';

const SOURCE = 'otel_genai';

const MODEL_OPS = { chat: 'chat', text_completion: 'completion', generate_content: 'generate_content', embeddings: 'embedding' };
const AGENT_OPS = new Set(['invoke_agent', 'create_agent']);

const REQUEST_PARAMS = ['temperature', 'top_p', 'top_k', 'max_tokens', 'frequency_penalty', 'presence_penalty', 'seed', 'choice.count', 'stop_sequences'];

/** gen_ai.* scalars this adapter does not map explicitly, kept as-is (content excluded). */
function passthrough(a, mapped) {
  const out = {};
  // Sorted before capping, so which keys survive never depends on input order.
  for (const k of Object.keys(a).sort()) {
    const v = a[k];
    if (!k.startsWith('gen_ai.') || mapped.has(k) || isContentAttribute(k)) continue;
    if (v === null || typeof v === 'object') continue;
    out[k] = v;
    if (Object.keys(out).length >= 24) break;
  }
  return Object.keys(out).length ? out : null;
}

function server(a) {
  const host = optString(a['server.address'], 200);
  if (!host) return null;
  return a['server.port'] ? `${host}:${a['server.port']}` : host;
}

function mcpBlock(a) {
  const method = optString(a['mcp.method.name'], 80);
  if (!method) return null;
  return { protocol: 'mcp', protocol_version: optString(a['mcp.protocol.version'], 40), method, tool_name: optString(a['gen_ai.tool.name'], 200), server: server(a), session_id: optString(a['mcp.session.id'], 200) };
}

const MAPPED = new Set(['gen_ai.operation.name', 'gen_ai.provider.name', 'gen_ai.system', 'gen_ai.request.model', 'gen_ai.response.model', 'gen_ai.response.id', 'gen_ai.usage.input_tokens', 'gen_ai.usage.output_tokens', 'gen_ai.usage.prompt_tokens', 'gen_ai.usage.completion_tokens', 'gen_ai.usage.cache_read.input_tokens', 'gen_ai.response.finish_reasons', 'gen_ai.agent.id', 'gen_ai.agent.name', 'gen_ai.agent.description', 'gen_ai.conversation.id', 'gen_ai.tool.name', 'gen_ai.tool.call.id', 'gen_ai.tool.type', 'gen_ai.tool.description', 'gen_ai.data_source.id', 'gen_ai.output.type', ...REQUEST_PARAMS.map((p) => `gen_ai.request.${p}`)]);

export function mapOtelSpan(s) {
  const a = s.attributes;
  const op = optString(a['gen_ai.operation.name'], 60);
  const provider = optString(a['gen_ai.provider.name'], 80) || optString(a['gen_ai.system'], 80);
  const requestModel = optString(a['gen_ai.request.model'], 160);
  const responseModel = optString(a['gen_ai.response.model'], 160);
  const mcp = mcpBlock(a);
  const timing = { started_at: s.start_iso, ended_at: s.end_iso, duration_ms: s.duration_ms, status: s.status };
  const common = {
    span_kind: s.otel_kind ?? null,
    scope: s.scope?.name ? { name: s.scope.name, version: s.scope.version } : null,
    conversation_id: optString(a['gen_ai.conversation.id'], 200),
    error_type: optString(a['error.type'], 120),
    server: server(a),
    event_count: s.event_names.length || null,
    source_attributes: passthrough(a, MAPPED),
  };
  const inputDigest = digestAttributes(a, (k) => isContentAttribute(k) && /(^gen_ai\.(input|system_instructions|prompt))|(^gen_ai\.tool\.call\.arguments)/.test(k));
  const outputDigest = digestAttributes(a, (k) => isContentAttribute(k) && /(^gen_ai\.(output|completion))|(^gen_ai\.tool\.call\.result)/.test(k));
  const gaps = s.start_iso ? [] : ['timing_unknown'];

  if (op && MODEL_OPS[op]) {
    const model = responseModel || requestModel;
    const fields = {
      name: model || s.name,
      operation: MODEL_OPS[op],
      ...timing,
      // The span is the call: its duration is the observed latency.
      latency_ms: s.duration_ms,
      input_tokens: optCount(a['gen_ai.usage.input_tokens'] ?? a['gen_ai.usage.prompt_tokens']),
      output_tokens: optCount(a['gen_ai.usage.output_tokens'] ?? a['gen_ai.usage.completion_tokens']),
      cached_input_tokens: optCount(a['gen_ai.usage.cache_read.input_tokens']),
    };
    const params = {};
    for (const p of REQUEST_PARAMS) if (a[`gen_ai.request.${p}`] !== undefined) params[p] = a[`gen_ai.request.${p}`];
    const finish = Array.isArray(a['gen_ai.response.finish_reasons']) ? a['gen_ai.response.finish_reasons'].filter((x) => typeof x === 'string') : null;
    const attributes = { ...common, provider, model, request_model: requestModel, response_model: responseModel, provider_request_id: optString(a['gen_ai.response.id'], 200), request_params: Object.keys(params).length ? params : null, output_type: optString(a['gen_ai.output.type'], 40), input_digest: inputDigest };
    gaps.push(...modelCallGaps(fields, attributes));
    const hasOutput = Boolean(outputDigest || (finish && finish.length));
    if (!hasOutput && MODEL_OPS[op] !== 'embedding') gaps.push('no_output_evidence');
    return {
      kind: 'ModelCall',
      fields,
      attributes,
      gaps,
      content_hash: inputDigest?.sha256 ?? null,
      runtime: modelRuntime(provider, model),
      outcome: hasOutput ? { fields: { name: 'output', ended_at: s.end_iso }, attributes: { finish_reasons: finish, output_digest: outputDigest }, content_hash: outputDigest?.sha256 ?? null } : null,
    };
  }

  if (op && AGENT_OPS.has(op)) {
    return {
      kind: 'Agent',
      fields: { name: optString(a['gen_ai.agent.name']) || s.name, ...timing },
      attributes: { ...common, operation_name: op, agent_id: optString(a['gen_ai.agent.id'], 200), agent_name: optString(a['gen_ai.agent.name'], 200), agent_description: optString(a['gen_ai.agent.description'], 300), provider, model: responseModel || requestModel },
      gaps,
    };
  }

  if (op === 'execute_tool' || mcp?.method === 'tools/call') {
    const runtime = mcp?.server ? { identity: ['mcp_server', mcp.server], name: mcp.server, attributes: { runtime_kind: 'mcp_server', protocol: 'mcp', server: mcp.server } } : null;
    return {
      kind: 'ToolCall',
      fields: { name: optString(a['gen_ai.tool.name']) || s.name, ...timing },
      attributes: { ...common, tool_name: optString(a['gen_ai.tool.name'], 200), tool_call_id: optString(a['gen_ai.tool.call.id'], 200), tool_type: optString(a['gen_ai.tool.type'], 40), tool_description: optString(a['gen_ai.tool.description'], 300), protocol: mcp, arguments_digest: inputDigest, result_digest: outputDigest },
      gaps,
      content_hash: inputDigest?.sha256 ?? null,
      runtime,
    };
  }

  if (op === 'retrieval') {
    return { kind: 'Retrieval', fields: { name: optString(a['gen_ai.data_source.id']) || s.name, ...timing }, attributes: { ...common, data_source_id: optString(a['gen_ai.data_source.id'], 200), query_digest: inputDigest, documents_digest: outputDigest }, gaps };
  }

  return {
    kind: 'Function',
    fields: { name: s.name, ...timing },
    attributes: { ...common, operation_name: op, protocol: mcp, http_method: optString(a['http.request.method'], 16), http_status: optCount(a['http.response.status_code']), db_system: optString(a['db.system.name'] ?? a['db.system'], 60), rpc_system: optString(a['rpc.system'], 60) },
    gaps,
  };
}

/** OTLP/JSON GenAI batch → canonical graphs, one per trace. */
export function otelGenAiToGraphs(payload, { workspaceId, sourceVersion = null }) {
  const { traces, rejected, spanCount, sourceVersion: detected } = readSpans(payload);
  const graphs = [];
  for (const [traceId, raw] of traces) {
    try {
      const spans = dedupeSpans(raw);
      const service = optString(spans.map((s) => s.resource?.['service.name']).filter((x) => typeof x === 'string').sort()[0], 120);
      const draft = spanTraceDraft({ sourceKind: SOURCE, sourceVersion: sourceVersion || detected, traceId, spans, mapSpan: mapOtelSpan, taskName: service });
      graphs.push(finalize(draft, { workspaceId }));
    } catch (error) {
      rejected.push({ source_trace_id: traceId, reason: String(error?.message || error).slice(0, 300), errors: error?.errors?.slice(0, 5) || [] });
    }
  }
  return { graphs, rejected, received: traces.size, spanCount };
}
