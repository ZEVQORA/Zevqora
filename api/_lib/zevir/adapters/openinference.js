/**
 * OpenInference semantic spans → ZevIR.
 *
 * OpenInference span kinds are input vocabulary only; they never become ZevIR
 * kinds. Each maps onto one of the eight canonical nodes plus typed metadata:
 *
 *   LLM        → ModelCall                     EMBEDDING → ModelCall { operation: embedding }
 *   RERANKER   → ModelCall { operation: rerank } DECISION → ModelCall { operation: decision }
 *   AGENT      → Agent                         TOOL      → ToolCall
 *   RETRIEVER  → Retrieval                     CHAIN     → Function { semantic_role: chain }
 *   PROMPT     → Function { semantic_role: prompt }
 *   GUARDRAIL  → Function { semantic_role: guardrail }
 *   EVALUATOR  → Function { semantic_role: evaluator }
 *   UNKNOWN / missing → Function
 *
 * input.value / output.value, message contents, prompt templates, document
 * contents, tool arguments and embeddings are reduced to hash + length.
 */
import { finalize, modelCallGaps, modelRuntime, optCount, optNonNegative, optString, spanTraceDraft } from '../canonicalize.js';
import { dedupeSpans, digestAttributes, isContentAttribute, readSpans } from './otlp.js';
import { sha256Json } from '../hash.js';

const SOURCE = 'openinference';

const MODEL_KINDS = { LLM: null, EMBEDDING: 'embedding', RERANKER: 'rerank', DECISION: 'decision' };
const ROLE_KINDS = { CHAIN: 'chain', PROMPT: 'prompt', GUARDRAIL: 'guardrail', EVALUATOR: 'evaluator' };

function spanKindOf(s) {
  const raw = s.attributes['openinference.span.kind'] ?? s.span_kind;
  return typeof raw === 'string' ? raw.trim().toUpperCase() : null;
}

/** Indexed list attributes (retrieval.documents.N.document.id) → [{id, score}] without content. */
function documents(a, prefix) {
  const rows = new Map();
  for (const [k, v] of Object.entries(a)) {
    const m = k.match(new RegExp(`^${prefix.replace(/\./g, '\\.')}\\.(\\d+)\\.document\\.(id|score)$`));
    if (!m) continue;
    const i = Number(m[1]);
    if (!rows.has(i)) rows.set(i, {});
    rows.get(i)[m[2]] = m[2] === 'score' ? (typeof v === 'number' && Number.isFinite(v) ? v : null) : optString(String(v ?? ''), 200);
  }
  const indexes = new Set([...Object.keys(a)].map((k) => k.match(new RegExp(`^${prefix.replace(/\./g, '\\.')}\\.(\\d+)\\.`))?.[1]).filter(Boolean).map(Number));
  return { count: indexes.size || null, items: [...rows.entries()].sort((x, y) => x[0] - y[0]).slice(0, 32).map(([, r]) => r) };
}

const inputKey = (k) => isContentAttribute(k) && /^(input\.|llm\.input_messages|llm\.prompts|llm\.prompt_template|llm\.invocation_parameters|tool_call\.function\.arguments|tool\.parameters|reranker\.query|reranker\.input_documents|embedding\.embeddings)/.test(k);
const outputKey = (k) => isContentAttribute(k) && /^(output\.|llm\.output_messages|reranker\.output_documents|retrieval\.documents)/.test(k);

export function mapOpenInferenceSpan(s) {
  const a = s.attributes;
  const kind = spanKindOf(s);
  const timing = { started_at: s.start_iso, ended_at: s.end_iso, duration_ms: s.duration_ms, status: s.status };
  const inputDigest = digestAttributes(a, inputKey);
  const outputDigest = digestAttributes(a, outputKey);
  const common = {
    openinference_kind: kind,
    session_id: optString(a['session.id'], 200),
    // user.id identifies a person: kept only as a pseudonymous hash.
    user_ref: a['user.id'] !== undefined && a['user.id'] !== null ? sha256Json(['openinference.user', String(a['user.id'])]) : null,
    tags: Array.isArray(a['tag.tags']) ? a['tag.tags'].filter((t) => typeof t === 'string').slice(0, 16) : null,
    input_mime_type: optString(a['input.mime_type'], 80),
    output_mime_type: optString(a['output.mime_type'], 80),
    metadata_digest: digestAttributes(a, (k) => k === 'metadata' || k.startsWith('metadata.')),
    scope: s.scope?.name ? { name: s.scope.name, version: s.scope.version } : null,
  };
  const gaps = s.start_iso ? [] : ['timing_unknown'];

  if (kind && kind in MODEL_KINDS) {
    const operation = MODEL_KINDS[kind];
    const provider = optString(a['llm.provider'], 80) || optString(a['llm.system'], 80);
    const model = kind === 'EMBEDDING' ? optString(a['embedding.model_name'], 160) : kind === 'RERANKER' ? optString(a['reranker.model_name'], 160) : optString(a['llm.model_name'], 160);
    const total = optNonNegative(a['llm.cost.total']);
    const fields = {
      name: model || s.name,
      operation,
      ...timing,
      latency_ms: s.duration_ms,
      input_tokens: optCount(a['llm.token_count.prompt']),
      output_tokens: optCount(a['llm.token_count.completion']),
      cached_input_tokens: optCount(a['llm.token_count.prompt_details.cache_read']),
      reasoning_tokens: optCount(a['llm.token_count.completion_details.reasoning']),
      // Present only when the exporter reported it; imported, not provider-verified.
      cost_usd: total,
      cost_source: total !== null ? 'imported_external' : null,
    };
    const attributes = {
      ...common,
      provider,
      model,
      total_tokens: optCount(a['llm.token_count.total']),
      cost_breakdown: total !== null ? { prompt: optNonNegative(a['llm.cost.prompt']), completion: optNonNegative(a['llm.cost.completion']) } : null,
      top_k: optCount(a['reranker.top_k']),
      input_digest: inputDigest,
    };
    if (kind === 'RERANKER') attributes.document_counts = { input: documents(a, 'reranker.input_documents').count, output: documents(a, 'reranker.output_documents').count };
    if (kind === 'EMBEDDING') attributes.embedding_count = documents(a, 'embedding.embeddings').count;
    gaps.push(...modelCallGaps(fields, attributes));
    const hasOutput = Boolean(outputDigest) && kind === 'LLM';
    if (kind === 'LLM' && !hasOutput) gaps.push('no_output_evidence');
    return {
      kind: 'ModelCall',
      fields,
      attributes,
      gaps,
      content_hash: inputDigest?.sha256 ?? null,
      runtime: modelRuntime(provider, model),
      outcome: hasOutput ? { fields: { name: 'output', ended_at: s.end_iso }, attributes: { output_digest: outputDigest }, content_hash: outputDigest.sha256 } : null,
    };
  }

  if (kind === 'AGENT') {
    return { kind: 'Agent', fields: { name: optString(a['agent.name']) || s.name, ...timing }, attributes: { ...common, agent_name: optString(a['agent.name'], 200), input_digest: inputDigest, output_digest: outputDigest }, gaps };
  }

  if (kind === 'TOOL') {
    const name = optString(a['tool.name']) || optString(a['tool_call.function.name']) || s.name;
    return {
      kind: 'ToolCall',
      fields: { name, ...timing },
      attributes: { ...common, tool_name: optString(a['tool.name'], 200) || optString(a['tool_call.function.name'], 200), tool_call_id: optString(a['tool_call.id'], 200), tool_description: optString(a['tool.description'], 300), arguments_digest: inputDigest, result_digest: outputDigest },
      gaps,
      content_hash: inputDigest?.sha256 ?? null,
    };
  }

  if (kind === 'RETRIEVER') {
    const docs = documents(a, 'retrieval.documents');
    return { kind: 'Retrieval', fields: { name: s.name, ...timing }, attributes: { ...common, document_count: docs.count, document_refs: docs.items.length ? docs.items : null, query_digest: inputDigest, documents_digest: outputDigest }, gaps, content_hash: outputDigest?.sha256 ?? null };
  }

  const role = kind ? ROLE_KINDS[kind] ?? null : null;
  const evaluation = role === 'evaluator' ? { label: optString(a['eval.label'] ?? a['evaluation.label'], 120), score: typeof (a['eval.score'] ?? a['evaluation.score']) === 'number' ? a['eval.score'] ?? a['evaluation.score'] : null, name: optString(a['eval.name'] ?? a['evaluation.name'], 120) } : null;
  return {
    kind: 'Function',
    fields: { name: s.name, ...timing },
    attributes: { ...common, semantic_role: role, evaluation, input_digest: inputDigest, output_digest: outputDigest },
    gaps: kind && !(kind in ROLE_KINDS) && kind !== 'UNKNOWN' ? [...gaps, 'unrecognized_span_kind'] : gaps,
  };
}

/** OpenInference batch (OTLP/JSON or flat span list) → canonical graphs, one per trace. */
export function openInferenceToGraphs(payload, { workspaceId, sourceVersion = null }) {
  const { traces, rejected, spanCount, sourceVersion: detected } = readSpans(payload);
  const graphs = [];
  for (const [traceId, raw] of traces) {
    try {
      const spans = dedupeSpans(raw);
      const project = optString(spans.map((s) => s.resource?.['openinference.project.name'] ?? s.resource?.['service.name']).filter((x) => typeof x === 'string').sort()[0], 120);
      const draft = spanTraceDraft({ sourceKind: SOURCE, sourceVersion: sourceVersion || detected, traceId, spans, mapSpan: mapOpenInferenceSpan, taskName: project });
      graphs.push(finalize(draft, { workspaceId }));
    } catch (error) {
      rejected.push({ source_trace_id: traceId, reason: String(error?.message || error).slice(0, 300), errors: error?.errors?.slice(0, 5) || [] });
    }
  }
  return { graphs, rejected, received: traces.size, spanCount };
}
