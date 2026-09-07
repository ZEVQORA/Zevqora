import { sha256Json, sha256Text } from './hashing.js';

function meta(trace) {
  return trace.metadata && typeof trace.metadata === 'object' ? trace.metadata : {};
}

/** Model-independent task identity for baseline ↔ candidate equivalence. */
export function taskFingerprint(trace) {
  const m = meta(trace);
  return sha256Json({
    input_hash: sha256Text(trace.input_text) || sha256Text(trace.expected_output),
    symbol: trace.symbol || '',
    workflow: trace.workflow || '',
    temperature: m.temperature ?? null,
    system_prompt_version: m.system_prompt_version || m.prompt_version || null,
    system_prompt_hash: trace.system_prompt_hash || m.system_prompt_hash || sha256Text(m.system_prompt) || null,
    prompt_shape_hash: sha256Json((trace.messages || []).map((x) => x.role)),
    response_format: m.response_format ?? null,
    tool_schema_hash: m.tool_schema_hash ?? null,
    context_id: m.context_id || m.retrieval_context_id || null,
    model_config: m.model_config || m.generation_config || null,
    prompt_config_version: m.prompt_config_version || m.app_prompt_version || null,
  });
}

/** Immutable baseline evidence identity for paid idempotency (timestamps excluded). */
export function baselineEvidenceHash(traces) {
  const items = [...traces]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((t) => {
      const m = meta(t);
      return {
        trace_id: t.id,
        request_id: t.request_id,
        input_hash: t.input_hash || sha256Text(t.input_text),
        output_hash: t.output_hash || sha256Text(t.output_text),
        task_fingerprint: taskFingerprint(t),
        provider: t.provider ?? null,
        model: t.model || t.requested_model || null,
        symbol: t.symbol ?? null,
        workflow: t.workflow ?? null,
        protected: Boolean(t.protected),
        system_prompt_version: m.system_prompt_version || m.prompt_version || null,
        system_prompt_hash: t.system_prompt_hash || m.system_prompt_hash || null,
        tool_schema_hash: m.tool_schema_hash ?? null,
        context_id: m.context_id || m.retrieval_context_id || null,
        response_format: m.response_format ?? null,
      };
    });
  return sha256Json(items);
}

/** Behaviour-affecting factors two traces must share to be reusable. */
export function reuseIdentity(trace) {
  const m = meta(trace);
  return {
    input_hash: sha256Text(trace.input_text) || sha256Text(trace.expected_output),
    symbol: trace.symbol || '',
    workflow: trace.workflow || '',
    provider: (trace.provider || '').toLowerCase(),
    model: (trace.model || trace.requested_model || '').trim(),
    temperature: m.temperature ?? null,
    system_prompt_version: m.system_prompt_version || m.prompt_version || null,
    system_prompt_hash: trace.system_prompt_hash || m.system_prompt_hash || sha256Text(m.system_prompt) || null,
    response_format: m.response_format ?? null,
    tool_schema_hash: m.tool_schema_hash ?? null,
    context_id: m.context_id || m.retrieval_context_id || null,
    model_config: m.model_config || m.generation_config || null,
  };
}

export function reuseIdentityHash(trace) {
  const identity = reuseIdentity(trace);
  if (!identity.input_hash) return null;
  return sha256Json(identity);
}

export function unsafeForReuse(trace) {
  if (trace.protected) return 'Protected/high-risk traces are not eligible for exact reuse.';
  const m = meta(trace);
  if (m.side_effects || m.non_idempotent || m.state_changing) return 'Trace metadata indicates non-idempotent or state-changing behavior.';
  if ((m.personalized || m.session_id) && !m.context_id && !m.retrieval_context_id) return 'Personalized/session-specific traces lack a safe context identity.';
  if (m.tools_executed || m.has_tool_calls) return 'Traces with tool execution are not eligible for exact reuse.';
  if (!trace.output_text) return 'Baseline output missing; cannot reuse an empty result.';
  if (!(trace.input_text || trace.expected_output)) return 'No normalized input/task identity available.';
  return null;
}
