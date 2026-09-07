/**
 * Deterministic optimization strategies — the planner emits READY or BLOCKED
 * plans only; nothing here calls a model. Ported from the desktop engine.
 */
import { sha256Json, sha256Text } from './hashing.js';
import { baselineEvidenceHash, reuseIdentityHash, taskFingerprint, unsafeForReuse } from './fingerprints.js';
import { estimateCost, normalizeModel } from '../pricing.js';

export const PLAN_VERSION = 'plan_v1';
export const MIN_REUSE_GROUP_SIZE = 2;
export const SMOKE_MAX_OUTPUT_TOKENS = 64;
// Ceiling for a replay's output cap, so a pathological baseline cannot turn one
// sample into an unbounded generation.
export const MAX_CANDIDATE_OUTPUT_TOKENS = 1024;
export const MAX_CANDIDATE_SAMPLES = 10;
export const DEFAULT_MAX_EXPERIMENT_COST_USD = 0.5;

export const IDENTITY_FIELDS = ['input_hash', 'symbol', 'workflow', 'provider', 'model', 'temperature', 'system_prompt_version', 'system_prompt_hash', 'response_format', 'tool_schema_hash', 'context_id', 'model_config'];

function scoped(traces, finding) {
  if (finding?.symbol) {
    const matching = traces.filter((t) => t.symbol === finding.symbol);
    if (matching.length) return matching;
  }
  return [...traces];
}

function order(a, b) {
  const ta = a.timestamp || '';
  const tb = b.timestamp || '';
  if (ta !== tb) return ta < tb ? -1 : 1;
  const ra = a.request_id || '';
  const rb = b.request_id || '';
  if (ra !== rb) return ra < rb ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

export function configHash(draft) {
  return sha256Json({ strategy: draft.strategy, baseline_config: draft.baseline_config, candidate_config: draft.candidate_config, sample_scope: draft.sample_scope, plan_version: draft.plan_version, max_budget_usd: draft.max_budget_usd });
}

function blocked(strategy, finding, reason, extra = {}) {
  return { strategy, status: 'BLOCKED', finding_id: finding?.id || null, reason, blocked_reason: reason, expected_mechanism: extra.expected_mechanism || strategy, risk: extra.risk || 'medium', fallback: 'retain_baseline', max_budget_usd: extra.max_budget_usd ?? 0, sample_scope: [], baseline_config: extra.baseline_config || {}, candidate_config: extra.candidate_config || {}, required_evidence: extra.required_evidence || [], plan_version: PLAN_VERSION };
}

export function planExactReuse(traces, finding) {
  const groups = new Map();
  const blockedSamples = [];
  for (const t of scoped(traces, finding)) {
    const unsafe = unsafeForReuse(t);
    if (unsafe) {
      blockedSamples.push(`${t.id}: ${unsafe}`);
      continue;
    }
    const k = reuseIdentityHash(t);
    if (!k) {
      blockedSamples.push(`${t.id}: insufficient identity`);
      continue;
    }
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const reusable = [...groups.entries()].filter(([, v]) => v.length >= MIN_REUSE_GROUP_SIZE);
  if (!reusable.length) {
    return blocked('exact_reuse', finding, `Exact reuse requires repeated equivalent runtime evidence (min group size ${MIN_REUSE_GROUP_SIZE}). Static source alone is insufficient.`, { expected_mechanism: 'exact_reuse_cache', risk: 'low', required_evidence: ['repeated_equivalent_runtime_traces'] });
  }
  const cacheGroups = {};
  const evidenceIds = [];
  for (const [k, members] of reusable) {
    const ordered = [...members].sort(order);
    cacheGroups[k] = ordered.map((t) => t.id);
    evidenceIds.push(...ordered.slice(1).map((t) => t.id));
  }
  const byId = new Map(traces.map((t) => [t.id, t]));
  const scopedTraces = evidenceIds.map((id) => byId.get(id)).filter(Boolean);
  for (const members of Object.values(cacheGroups)) for (const mid of members) if (byId.has(mid) && !scopedTraces.includes(byId.get(mid))) scopedTraces.push(byId.get(mid));
  const draft = {
    strategy: 'exact_reuse',
    status: 'READY',
    finding_id: finding?.id || null,
    reason: `Found ${reusable.length} equivalence group(s) with repeated runtime evidence.`,
    expected_mechanism: 'Return previously validated identical output without a provider call.',
    risk: 'low',
    fallback: 'retain_baseline',
    max_budget_usd: 0,
    sample_scope: evidenceIds,
    baseline_config: { cache_groups: cacheGroups, baseline_evidence_hash: baselineEvidenceHash(scopedTraces), identity_fields: IDENTITY_FIELDS },
    candidate_config: { provider_call_count: 0, cost_source: 'deterministic_reuse' },
    required_evidence: ['repeated_equivalent_runtime_traces', 'non_protected', 'idempotent'],
    plan_version: PLAN_VERSION,
    blocked_reason: null,
  };
  draft.config_hash = configHash(draft);
  return draft;
}

/** Conservative per-sample cost estimate from public list prices (+25% padding). */
/**
 * The request to replay for a baseline trace. A candidate is only a fair
 * comparison if it is asked the same question, so the recorded prompt is used
 * verbatim; assistant turns are dropped so the model answers rather than
 * continues its own reply.
 */
export function candidateMessages(trace) {
  if (Array.isArray(trace.messages) && trace.messages.length) {
    const turns = trace.messages.filter((m) => m.role !== 'tool');
    let end = turns.length;
    while (end > 0 && turns[end - 1].role === 'assistant') end -= 1;
    const replay = turns.slice(0, end);
    if (replay.some((m) => m.role === 'user')) return replay;
  }
  const user = trace.input_text || trace.expected_output || '';
  const system = trace.system_prompt || (trace.metadata && typeof trace.metadata.system_prompt === 'string' ? trace.metadata.system_prompt : '');
  return system ? [{ role: 'system', content: system }, { role: 'user', content: user }] : [{ role: 'user', content: user }];
}

/** True when no baseline trace records the prompt that produced its output. */
export function promptEvidenceMissing(traces) {
  return traces.length > 0 && traces.every((t) => !t.system_prompt && !(Array.isArray(t.messages) && t.messages.length) && !(t.metadata && t.metadata.system_prompt));
}

/**
 * Output cap for the replay. Too low and the candidate is truncated and graded
 * down for the wrong reason, so the baseline's own output length sets the floor.
 */
export function outputCapFor(traces) {
  const longest = traces.reduce((max, t) => Math.max(max, Number(t.output_tokens || 0), Math.ceil(String(t.output_text || t.expected_output || '').length / 3)), 0);
  return Math.min(MAX_CANDIDATE_OUTPUT_TOKENS, Math.max(SMOKE_MAX_OUTPUT_TOKENS, Math.ceil(longest * 1.5)));
}

export function estimateSampleCost(pricing, model, trace, { maxOutputTokens = SMOKE_MAX_OUTPUT_TOKENS } = {}) {
  const key = normalizeModel(null, model).key;
  const text = trace.input_text || trace.expected_output || '';
  const approxIn = text ? Math.max(Math.floor(text.length / 4), 1) : 0;
  const inTokens = Math.max(trace.input_tokens || 0, approxIn, text ? 64 : 0);
  const outTokens = Math.max(trace.output_tokens || 0, maxOutputTokens || 0);
  const est = estimateCost(pricing, key, { input: inTokens, output: outTokens, cached: trace.cached_input_tokens || 0 });
  if (!est) return null;
  return est.cost * 1.25;
}

export function planModelSubstitution(traces, finding, { candidateModel, allowedModels, maxBudgetUsd, pricing }) {
  const budget = maxBudgetUsd ?? DEFAULT_MAX_EXPERIMENT_COST_USD;
  if (!candidateModel) return blocked('model_substitution', finding, 'Model substitution requires an explicit candidate_model from the allowlist.', { max_budget_usd: budget, required_evidence: ['baseline_runtime_traces', 'allowlisted_candidate_model'] });
  if (!allowedModels.has(candidateModel)) return blocked('model_substitution', finding, `Candidate model '${candidateModel}' is not in the allowlist.`, { max_budget_usd: budget, required_evidence: ['baseline_runtime_traces', 'allowlisted_candidate_model'] });
  const usable = scoped(traces, finding).filter((t) => !t.protected && (t.input_text || t.expected_output) && (t.output_text !== null || t.expected_output !== null));
  const selected = usable.slice(0, MAX_CANDIDATE_SAMPLES);
  if (!selected.length) return blocked('model_substitution', finding, 'No bounded non-protected baseline traces with task input for model substitution.', { max_budget_usd: budget, required_evidence: ['baseline_runtime_traces', 'allowlisted_candidate_model'] });
  const outputCap = outputCapFor(selected);
  const promptsMissing = promptEvidenceMissing(selected);
  const estimates = selected.map((t) => estimateSampleCost(pricing, candidateModel, t, { maxOutputTokens: outputCap }));
  const ids = selected.map((t) => t.id);
  if (estimates.some((e) => e === null) && budget > 0) {
    return { ...blocked('model_substitution', finding, 'Cannot estimate candidate cost from pricing snapshot; refusing automatic run under strict budget.', { max_budget_usd: budget, required_evidence: ['verified_pricing_rates_or_provider_reported_cost'], baseline_config: { baseline_trace_ids: ids }, candidate_config: { model: candidateModel } }), sample_scope: ids, blocked_reason: 'unknown_pricing_under_strict_budget' };
  }
  const estimatedTotal = estimates.reduce((a, e) => a + (e || 0), 0);
  const draft = {
    strategy: 'model_substitution',
    status: 'READY',
    finding_id: finding?.id || null,
    reason: `Model substitution eligible for ${selected.length} baseline sample(s) → ${candidateModel}.${promptsMissing ? ' These traces record no prompt, so the replay can only send the recorded input; grade the result accordingly.' : ''}`,
    expected_mechanism: 'Send equivalent task to allowlisted candidate model via the platform provider.',
    risk: 'medium',
    fallback: 'retain_baseline',
    max_budget_usd: budget,
    sample_scope: ids,
    baseline_config: {
      baseline_trace_ids: ids,
      baseline_evidence_hash: baselineEvidenceHash(selected),
      task_fingerprints: Object.fromEntries(selected.map((t) => [t.id, taskFingerprint(t)])),
      baseline_hashes: Object.fromEntries(selected.map((t) => [t.id, { input_hash: t.input_hash || sha256Text(t.input_text), output_hash: t.output_hash || sha256Text(t.output_text), model: t.model, cost_source: t.cost_source }])),
    },
    candidate_config: { model: candidateModel, temperature: 0, max_tokens: outputCap, estimated_max_cost_usd: estimatedTotal, prompt_evidence: promptsMissing ? 'input_only' : 'recorded_prompt' },
    required_evidence: ['baseline_runtime_traces', 'allowlisted_candidate_model', 'budget_ok'],
    plan_version: PLAN_VERSION,
    blocked_reason: null,
  };
  draft.config_hash = configHash(draft);
  return draft;
}

/** Idempotency key tied to plan config AND immutable baseline evidence. */
export function executionKeyFor(plan, baselineTraces) {
  const scopeIds = plan.sample_scope || [];
  const scoped = baselineTraces.filter((t) => scopeIds.includes(t.id));
  return sha256Json({ plan_id: plan.id, config_hash: plan.config_hash, sample_scope: scopeIds, candidate_config: plan.candidate_config || {}, baseline_evidence_hash: baselineEvidenceHash(scoped) });
}

export function reuseSourceFor(plan, baselineId, byId) {
  if (plan.strategy !== 'exact_reuse') return null;
  const groups = plan.baseline_config?.cache_groups || {};
  for (const members of Object.values(groups)) {
    if (!members.includes(baselineId)) continue;
    return byId.get(members[0]) || null;
  }
  return null;
}

/** Deterministic no-provider sample. */
export function executeExactReuseSample(plan, baseline, reuseSource) {
  const started = Date.now();
  const fail = (detail) => ({ baseline_trace_id: baseline.id, status: 'failed', error_category: 'ineligible', error_detail: detail, execution_proven: false });
  if (!reuseSource || !reuseSource.output_text) return fail('Exact reuse requires a validated source trace with output.');
  if (reuseIdentityHash(baseline) !== reuseIdentityHash(reuseSource)) return fail('Baseline and reuse source do not share cache identity.');
  const unsafe = unsafeForReuse(baseline) || unsafeForReuse(reuseSource);
  if (unsafe) return fail(unsafe);
  const output = reuseSource.output_text;
  const baselineCost = baseline.cost_usd ?? null;
  return {
    baseline_trace_id: baseline.id,
    status: 'succeeded',
    task_fingerprint: taskFingerprint(baseline),
    candidate_config_fingerprint: sha256Json({ strategy: 'exact_reuse', reuse_source_id: reuseSource.id, provider_call_count: 0 }),
    provider: 'none',
    requested_model: null,
    resolved_model: null,
    output_text: output,
    output_hash: sha256Text(output),
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    reasoning_tokens: 0,
    cost_usd: 0,
    cost_source: 'deterministic_reuse',
    pricing_version: null,
    baseline_cost_source: baseline.cost_source ?? null,
    latency_ms: Date.now() - started,
    provider_request_id: null,
    provider_call_count: 0,
    reused_from_trace_id: reuseSource.id,
    baseline_cost_usd: baselineCost,
    candidate_cost_delta_usd: baselineCost !== null ? 0 - baselineCost : null,
    execution_proven: true,
  };
}

export function classifyProviderError(message) {
  const text = String(message || '').toLowerCase();
  if (text.includes('timeout') || text.includes('did not respond')) return 'timeout';
  if (text.includes('429') || text.includes('rate')) return 'rate_limit';
  if (text.includes('401') || text.includes('403') || text.includes('auth') || text.includes('session')) return 'authentication';
  if (text.includes('402') || text.includes('credit')) return 'budget_exceeded';
  if (text.includes('404') || (text.includes('model') && text.includes('not'))) return 'invalid_model';
  if (/\b5\d\d\b/.test(text)) return 'provider_5xx';
  if (text.includes('json') || text.includes('malformed')) return 'malformed_response';
  return 'unknown';
}

/** One candidate call through the injected `complete()` (the platform provider). */
export async function executeModelSubstitutionSample(plan, baseline, complete, { allowedModels, pricing }) {
  const cfg = plan.candidate_config || {};
  const model = cfg.model;
  if (!model || !allowedModels.has(model)) return { baseline_trace_id: baseline.id, status: 'failed', error_category: 'invalid_model', error_detail: 'Candidate model missing or not allowlisted.', execution_proven: false };
  const temperature = Number(cfg.temperature ?? 0);
  const maxTokens = Number(cfg.max_tokens || SMOKE_MAX_OUTPUT_TOKENS);
  const messages = candidateMessages(baseline);
  const started = Date.now();
  let response;
  try {
    response = await complete({ model, messages, temperature, max_tokens: maxTokens });
  } catch (error) {
    return { baseline_trace_id: baseline.id, status: 'failed', provider: 'openrouter', requested_model: model, error_category: classifyProviderError(error?.message), error_detail: String(error?.message || error).slice(0, 500), execution_proven: false, provider_call_count: 1, latency_ms: Date.now() - started };
  }
  const content = typeof response.content === 'string' ? response.content : null;
  let cost = response.cost ?? null;
  let costSource = cost === null ? null : 'provider_reported';
  let pricingVersion = null;
  if (cost === null && response.inputTokens !== null && response.outputTokens !== null) {
    const est = estimateCost(pricing, normalizeModel(null, response.model || model).key, { input: response.inputTokens || 0, output: response.outputTokens || 0, cached: response.cachedInputTokens || 0 });
    if (est) {
      cost = est.cost;
      costSource = est.source;
      pricingVersion = est.version;
    }
  }
  const baselineCost = baseline.cost_usd ?? null;
  return {
    baseline_trace_id: baseline.id,
    status: 'succeeded',
    task_fingerprint: taskFingerprint(baseline),
    candidate_config_fingerprint: sha256Json({ provider: 'openrouter', model, temperature, max_tokens: maxTokens }),
    provider: 'openrouter',
    requested_model: model,
    resolved_model: response.model || model,
    prompt_evidence: baseline.system_prompt || (Array.isArray(baseline.messages) && baseline.messages.length) ? 'recorded_prompt' : 'input_only',
    output_text: content,
    output_hash: sha256Text(content),
    input_tokens: response.inputTokens ?? null,
    output_tokens: response.outputTokens ?? null,
    cached_input_tokens: response.cachedInputTokens ?? 0,
    reasoning_tokens: 0,
    cost_usd: cost,
    cost_source: costSource,
    pricing_version: pricingVersion,
    baseline_cost_source: baseline.cost_source ?? null,
    latency_ms: response.latencyMs ?? Date.now() - started,
    provider_request_id: response.requestId || null,
    provider_call_count: 1,
    baseline_cost_usd: baselineCost,
    candidate_cost_delta_usd: cost !== null && baselineCost !== null ? cost - baselineCost : null,
    execution_proven: true,
  };
}
