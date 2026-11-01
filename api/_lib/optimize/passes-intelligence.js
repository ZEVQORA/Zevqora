/**
 * OptimizationPass v0.2 (vNext Part 2B).
 *
 * The Part 2A interface is kept on every pass (id, version, applicability,
 * requiredEvidence, propose, expectedEffects, riskClass, protectedSlices,
 * falsifier, rollback, materializerHints). For plan search each pass also
 * declares:
 *
 *   transformations(diagnosis, ctx) → canonical transformation drafts
 *   compatibilityTags()             → what the pass's changes touch
 *   conflictsWith()                 → kind pairs that must never compose
 *   compositionRules()              → kind pairs that compose, and in which order
 *
 * The four Part 2A passes keep their behaviour for the Part 2A candidate route
 * (`passes.js#generateCandidates` is unchanged); here they gain transformation
 * emitters. Four passes are new: Cache, AgentWorkflow, RetrievalOptimization
 * and DeterministicReplacement.
 *
 * Executable today: exact-response reuse, validated exact lookup, model
 * substitution (platform compute only). Every other transformation is
 * proposed with full metadata and stays blocked.
 */
import { normalizeModel } from '../pricing.js';
import { outputCapFor, estimateSampleCost } from '../product/strategies.js';
import { contextMemoryPass, modelProviderPass, redundantCallPass, retryAmplificationPass, NEEDS_IMPLEMENTATION, NOT_EXECUTABLE, EXECUTABLE } from './passes.js';
import { cacheKey, LABEL, lookupKey, repeatIntervals, simulateCache, simulateLookup, STANDARD_TTLS_MS, streamOrder, ttlLabel } from './replay-model.js';
import { attemptNo, logicalKey, percentile } from './performance.js';

const meta = (t) => (t.metadata && typeof t.metadata === 'object' && !Array.isArray(t.metadata) ? t.metadata : {});
const scopeOf = (t) => t.symbol || t.workflow || 'unattributed';
const SENSITIVE = /^(pii|phi|pci|secret|confidential|restricted)$/i;

/** Final attempt of every logical request in the window. */
export function finalRows(traces) {
  const last = new Map();
  for (const t of traces) {
    const k = logicalKey(t);
    const prev = last.get(k);
    if (!prev || attemptNo(t) > attemptNo(prev)) last.set(k, t);
  }
  return [...last.values()].sort(streamOrder);
}

const source = (pass, d) => ({ pass: pass.id, pass_version: pass.version, diagnosis_hash: d.diagnosis_hash, diagnosis_family: d.family });
const base = (pass, d) => ({ pass: pass.id, pass_version: pass.version, sources: [source(pass, d)], diagnosis_hashes: [d.diagnosis_hash], affected_nodes: d.affected_nodes || [] });
const blockedTx = (reason) => ({ executable_status: NEEDS_IMPLEMENTATION, not_executable_reason: reason });
const NO_HARNESS = 'The replay harness cannot execute this change yet; it needs an implementation before it can be evaluated.';

// ---------------------------------------------------------------- Part 2A passes
Object.assign(redundantCallPass, {
  compatibilityTags: () => ['interceptor:response', 'call_site'],
  conflictsWith: () => [],
  compositionRules: () => [],
  /** Unbounded exact reuse (the Part 2A candidate): content-addressed key, no expiry. */
  transformations(d, ctx) {
    if (!this.applicability(d, ctx).applicable) return [];
    const rows = finalRows(ctx.traces).filter((t) => scopeOf(t) === d.scope && cacheKey(t));
    const hits = simulateCache(rows, null);
    const stateless = rows.length > 0 && rows.every((t) => meta(t).stateless === true);
    return [
      {
        ...base(this, d),
        kind: 'exact_response_reuse',
        scope: d.scope,
        call_site: d.scope,
        settings: { [`response_cache:${d.scope}`]: { ttl_ms: null } },
        config: { ttl_ms: null, key_basis: 'reuse_identity_v1' },
        label: 'Exact reuse (no expiry)',
        executable_status: EXECUTABLE,
        affected_trace_ids: rows.map((t) => t.id),
        // No expiry: safe only if answers never depend on time or external state.
        risk_class: stateless ? 'medium' : 'high',
        implementation_complexity: 1,
        rollback_complexity: 1,
        required_evidence: this.requiredEvidence(d, ctx),
        expected_effects: { cost: { direction: 'decrease', basis: 'estimated from recorded repeats' }, quality: { direction: 'unchanged_required', basis: 'replay decides' } },
        protected_slices: this.protectedSlices(d, ctx),
        falsifier: d.falsifier,
        rollback: this.rollback(),
        materializer_hints: { kind: 'cache_layer', target: d.scope, notes: 'In-process or shared cache keyed on the reuse identity; never cache protected or side-effecting calls.' },
        metadata: { cache_scope: d.scope, cache_key_basis: 'input_hash + system_prompt_hash + provider/model + temperature + response_format + tool_schema + context + model_config', ttl_ms: null, observed_repeat_rate: rows.length ? Number(((rows.length - new Set(rows.map(cacheKey)).size) / rows.length).toFixed(6)) : null, expected_hit_rate: rows.length ? Number((hits.length / rows.length).toFixed(6)) : null, invalidation_requirements: ['any prompt/model/config change is a new key', 'no time-based expiry: answers must not depend on time or external state'], data_sensitivity: 'not_sensitive_declared_or_unknown', staleness_risk: stateless ? 'declared stateless' : 'unbounded' },
      },
    ];
  },
});

Object.assign(modelProviderPass, {
  compatibilityTags: () => ['model_routing'],
  conflictsWith: () => [],
  compositionRules: () => [
    { kinds: ['model_substitution', 'retry_policy'], order: ['model_substitution', 'retry_policy'], note: 'the retry policy wraps calls to the substituted model' },
    { kinds: ['provider_prompt_cache', 'model_substitution'], order: ['provider_prompt_cache', 'model_substitution'], note: 'prompt-cache support and pricing differ per model', escalates: true },
    { kinds: ['context_window_cap', 'model_substitution'], order: ['context_window_cap', 'model_substitution'], note: 'the smaller model receives the capped context', escalates: true },
  ],
  transformations(d, ctx) {
    const app = this.applicability(d, ctx);
    if (!app.applicable) return [];
    const candidate = this.candidateModel(d);
    const rows = finalRows(ctx.traces).filter((t) => !t.protected && (t.input_text || t.expected_output) && normalizeModel(t.provider, t.model || t.requested_model).key === d.scope);
    const allowed = Boolean(candidate && ctx.allowedModels.has(candidate));
    const estimable = rows.length > 0 && rows.every((t) => estimateSampleCost(ctx.pricing, candidate, t, { maxOutputTokens: outputCapFor(rows) }) !== null);
    const executable = allowed && estimable && ctx.platformCompute;
    return [
      {
        ...base(this, d),
        kind: 'model_substitution',
        scope: d.scope,
        call_site: d.scope,
        settings: { [`model:${d.scope}`]: candidate },
        config: { from: d.scope, to: candidate, temperature: 0, max_tokens: outputCapFor(rows) },
        label: `Smaller model (${candidate})`,
        executable_status: executable ? EXECUTABLE : NOT_EXECUTABLE,
        not_executable_reason: executable ? null : !allowed ? `${candidate} is not on the platform allowlist.` : !estimable ? 'Candidate cost is not estimable from verified pricing; refusing a budgeted replay.' : 'Platform compute is not configured on this deployment.',
        affected_trace_ids: rows.map((t) => t.id),
        risk_class: 'medium',
        implementation_complexity: 1,
        rollback_complexity: 1,
        required_evidence: [...this.requiredEvidence(d, ctx), { key: 'verified_pricing', present: estimable, detail: estimable ? 'every replayed case is estimable' : 'pricing unknown for at least one case' }],
        expected_effects: this.expectedEffects(),
        protected_slices: this.protectedSlices(),
        falsifier: d.falsifier,
        rollback: `Route ${d.scope} back to its current model.`,
        materializer_hints: { kind: 'model_config', target: `call sites using ${d.scope}`, notes: `Change the model to ${candidate} behind a flag; keep ${d.scope} as fallback.` },
        metadata: { from_model: d.scope, to_model: candidate, replayable_samples: rows.length },
      },
    ];
  },
});

Object.assign(retryAmplificationPass, {
  compatibilityTags: () => ['transport'],
  conflictsWith: () => [],
  compositionRules: () => [
    { kinds: ['exact_response_reuse', 'retry_policy'], order: ['exact_response_reuse', 'retry_policy'], note: 'cache hits never reach the retrying client' },
    { kinds: ['exact_lookup', 'retry_policy'], order: ['exact_lookup', 'retry_policy'], note: 'lookup hits never reach the retrying client' },
    { kinds: ['provider_prompt_cache', 'retry_policy'], order: ['provider_prompt_cache', 'retry_policy'], note: 'retries resend the cacheable prefix' },
  ],
  transformations(d, ctx) {
    if (!this.applicability(d, ctx).applicable) return [];
    const [draft] = this.propose(d);
    return [
      {
        ...base(this, d),
        kind: 'retry_policy',
        scope: 'workload',
        call_site: 'provider_client',
        settings: { 'retry:workload': draft.candidate_config },
        config: draft.candidate_config,
        ...blockedTx('Retry policies change behaviour on failures the replay harness cannot reproduce; implement the policy, then measure. (Bad-Day Replay can stress a plan under injected failures.)'),
        affected_trace_ids: [],
        risk_class: 'medium',
        implementation_complexity: 2,
        rollback_complexity: 1,
        required_evidence: this.requiredEvidence(d, ctx),
        expected_effects: this.expectedEffects(draft, d),
        protected_slices: this.protectedSlices(),
        falsifier: this.falsifier(),
        rollback: this.rollback(),
        materializer_hints: this.materializerHints(draft),
      },
    ];
  },
});

Object.assign(contextMemoryPass, {
  compatibilityTags: () => ['context'],
  conflictsWith: () => [{ kinds: ['context_window_cap', 'retrieval_top_k'], reason: 'both shrink the same assembled context; no composition logic decides which content is kept' }],
  compositionRules: () => [{ kinds: ['provider_prompt_cache', 'context_window_cap'], order: ['context_window_cap', 'provider_prompt_cache'], note: 'capping history must not change the cached prefix', escalates: true }],
  transformations(d, ctx) {
    if (!this.applicability(d, ctx).applicable) return [];
    const out = [];
    for (const draft of this.propose(d)) {
      const kind = draft.strategy === 'prompt_cache' ? 'provider_prompt_cache' : 'context_window_cap';
      out.push({
        ...base(this, d),
        kind,
        scope: 'workload',
        call_site: 'prompt_assembly',
        settings: kind === 'provider_prompt_cache' ? { 'prompt_cache:system_prompt': true } : { 'context:history': draft.candidate_config },
        config: kind === 'provider_prompt_cache' ? { prefix: 'system_prompt' } : draft.candidate_config,
        ...blockedTx(NO_HARNESS),
        affected_trace_ids: [],
        risk_class: draft.risk,
        implementation_complexity: kind === 'provider_prompt_cache' ? 1 : 3,
        rollback_complexity: 1,
        required_evidence: this.requiredEvidence(d, ctx),
        expected_effects: this.expectedEffects(draft),
        protected_slices: this.protectedSlices(),
        falsifier: this.falsifier(draft),
        rollback: this.rollback(draft),
        materializer_hints: this.materializerHints(draft),
        metadata: kind === 'provider_prompt_cache' ? { cache_scope: 'system prompt prefix', cache_key_basis: 'provider prefix hash', expected_hit_rate: null, observed_repeat_rate: null, invalidation_requirements: ['prefix must be byte-identical'], data_sensitivity: 'provider-side cache', staleness_risk: 'none (same tokens)' } : {},
      });
    }
    return out;
  },
});

// ---------------------------------------------------------------- 5. CachePass
function ttlVariants(rows) {
  const gaps = repeatIntervals(rows);
  if (!gaps.length) return { variants: [], gaps };
  const pick = (g) => STANDARD_TTLS_MS.find((t) => t >= g) ?? STANDARD_TTLS_MS[STANDARD_TTLS_MS.length - 1];
  return { variants: [...new Set([pick(percentile(gaps, 50)), pick(percentile(gaps, 95))])].sort((a, b) => a - b), gaps };
}

export const cachePass = {
  id: 'cache',
  version: '0.2.0',
  families: ['redundant_call', 'context_amplification', 'agent_workflow', 'retrieval_redundancy'],
  applicability(d) {
    if (d.family === 'redundant_call') return d.metrics.reusable_groups ? { applicable: true, reasons: [] } : { applicable: false, reasons: ['no reusable repeated group'] };
    if (d.family === 'agent_workflow') return d.metrics.repeated_tool_calls > 0 ? { applicable: true, reasons: [] } : { applicable: false, reasons: ['no repeated tool call with unchanged result'] };
    if (d.family === 'retrieval_redundancy') return d.metrics.repeat_retrievals > 0 ? { applicable: true, reasons: [] } : { applicable: false, reasons: ['no repeated retrieval query'] };
    return { applicable: false, reasons: [`no cache evidence in ${d.family}`] };
  },
  requiredEvidence(d, ctx) {
    if (d.family !== 'redundant_call') return [{ key: 'repeated_identical_inputs', present: true, detail: 'from digests' }];
    const rows = finalRows(ctx.traces).filter((t) => scopeOf(t) === d.scope);
    const timed = rows.filter((t) => t.timestamp).length;
    return [
      { key: 'exact_repeated_input_hash', present: d.metrics.groups > 0, detail: `${d.metrics.groups} repeated group(s)` },
      { key: 'request_timestamps', present: timed === rows.length && rows.length > 0, detail: `${timed}/${rows.length} timed — a TTL is chosen from observed repeat intervals` },
    ];
  },
  propose(d, ctx) {
    return this.transformations(d, ctx).map((t) => ({ strategy: t.kind, status: 'BLOCKED', candidate_config: t.config, blocked_reason: 'plan_search_only', reason: t.label }));
  },
  expectedEffects: () => ({ cost: { direction: 'decrease', basis: 'estimated from recorded repeats within the TTL' }, latency: { direction: 'decrease', basis: 'hits skip the call (cache lookup time not measured)' }, quality: { direction: 'unchanged_required', basis: 'replay decides' } }),
  riskClass: (t) => t.risk_class,
  protectedSlices: () => ['protected, side-effecting and tool-executing calls are never cached'],
  falsifier: () => 'Wrong if a cached answer fails the graders on any replayed case, or if answers depend on time or state the key does not capture (then the TTL is too long).',
  rollback: () => 'Disable the cache (flag) and flush it; every request takes the uncached path again.',
  materializerHints: (t) => ({ kind: 'cache_layer', target: t.scope, notes: `Key: ${t.metadata.cache_key_basis}. TTL ${ttlLabel(t.metadata.ttl_ms ?? null)}. Invalidate on prompt/model/config change.` }),
  compatibilityTags: () => ['interceptor:response', 'agent_control:tool', 'context:retrieval'],
  conflictsWith: () => [
    { kinds: ['exact_response_reuse', 'exact_lookup'], reason: 'both answer the same call before the model; no precedence rule is declared' },
    { kinds: ['tool_result_cache', 'repeated_tool_suppression'], reason: 'both intercept the same tool call' },
  ],
  compositionRules: () => [
    { kinds: ['exact_response_reuse', 'model_substitution'], order: ['exact_response_reuse', 'model_substitution'], note: 'cache first; on a miss the substituted model answers and the cache stores that answer' },
    { kinds: ['exact_response_reuse', 'provider_prompt_cache'], order: ['exact_response_reuse', 'provider_prompt_cache'], note: 'response-cache misses still benefit from prefix caching' },
    { kinds: ['retrieval_result_cache', 'retrieval_dedupe'], order: ['retrieval_result_cache', 'retrieval_dedupe'], note: 'cached results are deduplicated like fresh ones' },
    { kinds: ['retrieval_result_cache', 'retrieval_top_k'], order: ['retrieval_result_cache', 'retrieval_top_k'], note: 'the cache key must include k', escalates: true },
    { kinds: ['agent_step_budget', 'tool_result_cache'], order: ['agent_step_budget', 'tool_result_cache'], note: 'cached tool results still count as steps' },
    { kinds: ['agent_loop_guard', 'tool_result_cache'], order: ['agent_loop_guard', 'tool_result_cache'], note: 'the guard sees cached results like fresh ones' },
  ],
  transformations(d, ctx) {
    if (!this.applicability(d, ctx).applicable) return [];
    if (d.family === 'agent_workflow') {
      return [{ ...base(this, d), kind: 'tool_result_cache', scope: d.scope, call_site: `agent:${d.scope}:tools`, settings: { [`tool_cache:${d.scope}`]: { scope: 'run' } }, config: { scope: 'within_one_agent_run', tools: Object.keys(d.metrics.tools || {}).sort() }, ...blockedTx(NO_HARNESS), affected_trace_ids: [], risk_class: 'medium', implementation_complexity: 2, rollback_complexity: 1, required_evidence: [{ key: 'repeated_tool_call_unchanged_result', present: true, detail: `${d.metrics.repeated_tool_calls} repeat(s)` }, { key: 'tool_is_read_only', present: false, detail: 'a tool result may only be cached when the tool has no side effects (declare it)' }], expected_effects: { latency: { direction: 'decrease', basis: 'structural' }, cost: { direction: 'unknown', basis: 'tool cost not recorded' } }, protected_slices: this.protectedSlices(), falsifier: 'Wrong if the tool result can change within a run (e.g. a status the agent polls).', rollback: 'Remove the per-run tool cache.', materializer_hints: { kind: 'agent_runtime', target: `agent ${d.scope}`, notes: 'Memoize tool results within a run on (tool, arguments digest).' }, metadata: { cache_scope: 'one agent run', cache_key_basis: 'tool name + arguments digest', expected_hit_rate: null, observed_repeat_rate: d.metrics.runs ? Number((d.metrics.repeated_tool_calls / Math.max(1, d.metrics.runs)).toFixed(6)) : null, invalidation_requirements: ['run boundary', 'tool must be read-only'], data_sensitivity: 'unknown', staleness_risk: 'within one run' } }];
    }
    if (d.family === 'retrieval_redundancy') {
      return [{ ...base(this, d), kind: 'retrieval_result_cache', scope: d.scope, call_site: `retrieval:${d.scope}`, settings: { [`retrieval_cache:${d.scope}`]: { scope: 'task' } }, config: { scope: 'within_one_task', key: 'query_digest + index_version' }, ...blockedTx(NO_HARNESS), affected_trace_ids: [], risk_class: 'low', implementation_complexity: 2, rollback_complexity: 1, required_evidence: [{ key: 'repeated_query_digest', present: true, detail: `${d.metrics.repeat_retrievals} repeat(s)` }, { key: 'index_version_in_key', present: false, detail: 'invalidation needs the index version' }], expected_effects: { latency: { direction: 'decrease', basis: 'repeated retrievals skipped' }, quality: { direction: 'unchanged_expected', basis: 'same documents within a task' } }, protected_slices: this.protectedSlices(), falsifier: 'Wrong if the index changes within a task.', rollback: 'Remove the retrieval cache.', materializer_hints: { kind: 'retrieval_client', target: d.scope, notes: 'Memoize retrieval within a task on (query digest, index version).' }, metadata: { cache_scope: 'one task', cache_key_basis: 'query digest + index version', expected_hit_rate: d.metrics.query_repeat_rate, observed_repeat_rate: d.metrics.query_repeat_rate, invalidation_requirements: ['task boundary', 'index version'], data_sensitivity: 'unknown', staleness_risk: 'within one task' } }];
    }
    // Exact-response cache with a TTL chosen from observed repeat intervals.
    const rows = finalRows(ctx.traces).filter((t) => scopeOf(t) === d.scope && cacheKey(t));
    const evidence = this.requiredEvidence(d, ctx);
    const promptKeyed = rows.length > 0 && rows.every((t) => t.system_prompt_hash || meta(t).system_prompt_hash || meta(t).system_prompt || t.system_prompt);
    const sensitive = rows.filter((t) => SENSITIVE.test(String(meta(t).data_sensitivity || '')) || meta(t).contains_pii === true);
    const { variants, gaps } = ttlVariants(rows);
    const unsafe = !promptKeyed ? 'No safe invalidation: the prompt version is not part of the recorded identity, so a prompt change would serve stale answers.' : sensitive.length ? `${sensitive.length} cached answer(s) would hold sensitive data; caching needs a data-handling review first.` : null;
    if (!variants.length) {
      return [{ ...base(this, d), kind: 'exact_response_reuse', scope: d.scope, call_site: d.scope, settings: { [`response_cache:${d.scope}`]: { ttl_ms: 'unknown' } }, config: { ttl_ms: null, key_basis: 'reuse_identity_v1', ttl: 'unknown' }, label: 'Exact-response cache (TTL unknown)', executable_status: EXECUTABLE, affected_trace_ids: rows.map((t) => t.id), risk_class: 'medium', implementation_complexity: 2, rollback_complexity: 1, required_evidence: evidence, expected_effects: this.expectedEffects(), protected_slices: this.protectedSlices(), falsifier: this.falsifier(), rollback: this.rollback(), materializer_hints: { kind: 'cache_layer', target: d.scope, notes: 'Needs repeat intervals to choose a TTL.' }, metadata: { cache_scope: d.scope, cache_key_basis: 'reuse identity', ttl_ms: null, expected_hit_rate: null, observed_repeat_rate: null, invalidation_requirements: ['TTL from observed repeat intervals (missing)'], data_sensitivity: 'unknown', staleness_risk: 'unknown' } }];
    }
    return variants.map((ttl) => {
      const hits = simulateCache(rows, ttl);
      return {
        ...base(this, d),
        kind: 'exact_response_reuse',
        scope: d.scope,
        call_site: d.scope,
        settings: { [`response_cache:${d.scope}`]: { ttl_ms: ttl } },
        config: { ttl_ms: ttl, key_basis: 'reuse_identity_v1' },
        label: `Exact-response cache (TTL ${ttlLabel(ttl)})`,
        executable_status: unsafe ? NOT_EXECUTABLE : EXECUTABLE,
        not_executable_reason: unsafe,
        affected_trace_ids: rows.map((t) => t.id),
        risk_class: ttl <= 3_600_000 ? 'low' : 'medium',
        implementation_complexity: 2,
        rollback_complexity: 1,
        required_evidence: [...evidence, { key: 'safe_invalidation', present: !unsafe, detail: unsafe || 'content-addressed key (prompt/model/config) + TTL' }],
        expected_effects: this.expectedEffects(),
        protected_slices: this.protectedSlices(),
        falsifier: this.falsifier(),
        rollback: this.rollback(),
        materializer_hints: { kind: 'cache_layer', target: d.scope, notes: `Shared cache, TTL ${ttlLabel(ttl)}, keyed on the reuse identity; never cache protected or side-effecting calls.` },
        metadata: { cache_scope: d.scope, cache_key_basis: 'input_hash + system_prompt_hash + provider/model + temperature + response_format + tool_schema + context + model_config', ttl_ms: ttl, observed_repeat_rate: rows.length ? Number(((rows.length - new Set(rows.map(cacheKey)).size) / rows.length).toFixed(6)) : null, expected_hit_rate: rows.length ? Number((hits.length / rows.length).toFixed(6)) : null, repeat_interval_p50_ms: percentile(gaps, 50), repeat_interval_p95_ms: percentile(gaps, 95), invalidation_requirements: ['any prompt/model/config change is a new key', `entries expire ${ttlLabel(ttl)} after they are written`], data_sensitivity: sensitive.length ? 'sensitive' : 'not_sensitive_declared_or_unknown', staleness_risk: `at most ${ttlLabel(ttl)}` },
      };
    });
  },
};

// ------------------------------------------------------ 6. AgentWorkflowPass
export const agentWorkflowPass = {
  id: 'agent_workflow',
  version: '0.2.0',
  families: ['agent_workflow'],
  applicability: (d) => (d.family === 'agent_workflow' ? { applicable: true, reasons: [] } : { applicable: false, reasons: ['only applies to agent_workflow'] }),
  requiredEvidence: (d) => [
    { key: 'agent_steps_with_digests', present: d.metrics.runs > 0, detail: `${d.metrics.runs} run(s)` },
    { key: 'structural_repeat_or_loop', present: d.metrics.wasted_steps > 0 || d.metrics.excessive_runs > 0, detail: `${d.metrics.wasted_steps} wasted step(s)` },
  ],
  propose(d, ctx) {
    return this.transformations(d, ctx).map((t) => ({ strategy: t.kind, status: 'BLOCKED', candidate_config: t.config, blocked_reason: 'needs_implementation', reason: t.label }));
  },
  expectedEffects: () => ({ cost: { direction: 'decrease', basis: 'structural: fewer repeated steps' }, latency: { direction: 'decrease', basis: 'structural' }, task_success: { direction: 'unknown', basis: 'an agent change must be replayed' } }),
  riskClass: () => 'medium',
  protectedSlices: () => ['runs where a repeated step legitimately polls for a state change'],
  falsifier: () => 'Wrong if task success drops when repeats are suppressed or the loop is cut.',
  rollback: () => 'Remove the guard / budget; the agent runs unbounded as before.',
  materializerHints: (t) => ({ kind: 'agent_runtime', target: `agent ${t.scope}`, notes: JSON.stringify(t.config) }),
  compatibilityTags: () => ['agent_control'],
  conflictsWith: () => [],
  compositionRules: () => [
    { kinds: ['agent_step_budget', 'agent_loop_guard'], order: ['agent_step_budget', 'agent_loop_guard'], note: 'the loop guard fires inside the step budget' },
    { kinds: ['agent_step_budget', 'repeated_tool_suppression'], order: ['agent_step_budget', 'repeated_tool_suppression'], note: 'suppressed calls do not consume budget' },
    { kinds: ['agent_loop_guard', 'repeated_tool_suppression'], order: ['agent_loop_guard', 'repeated_tool_suppression'], note: 'suppression runs before the guard counts a repeat' },
  ],
  transformations(d) {
    if (!this.applicability(d).applicable) return [];
    const common = (kind, label, config, complexity, risk) => ({ ...base(this, d), kind, label, scope: d.scope, call_site: `agent:${d.scope}`, settings: { [`agent:${d.scope}:${kind}`]: config }, config, ...blockedTx('Agent changes need an agent replay harness (not built yet): proposed with evidence, never replayed.'), affected_trace_ids: [], risk_class: risk, implementation_complexity: complexity, rollback_complexity: 1, required_evidence: this.requiredEvidence(d), expected_effects: this.expectedEffects(), protected_slices: this.protectedSlices(), falsifier: this.falsifier(), rollback: this.rollback(), materializer_hints: { kind: 'agent_runtime', target: `agent ${d.scope}`, notes: JSON.stringify(config) } });
    const out = [];
    if (d.metrics.repeated_tool_calls > 0) out.push(common('repeated_tool_suppression', 'Reuse unchanged tool results', { tools: Object.keys(d.metrics.tools || {}).sort(), match: 'tool name + arguments digest; only while the result digest is unchanged' }, 2, 'low'));
    if (d.metrics.no_progress_loops > 0) out.push(common('agent_loop_guard', 'No-progress loop guard', { window_steps: 3, rule: 'stop or escalate when a step window repeats with identical inputs and outputs' }, 2, 'medium'));
    if (d.metrics.steps_p95 !== null && (d.metrics.no_progress_loops > 0 || d.metrics.excessive_runs > 0)) out.push(common('agent_step_budget', 'Agent step budget', { max_steps: Math.max(1, Math.ceil((d.metrics.steps_p50 ?? d.metrics.steps_p95) * 1.5)), basis: 'p50 steps × 1.5 (observed)' }, 1, 'medium'));
    return out.slice(0, 3);
  },
};

// ------------------------------------------ 7. RetrievalOptimizationPass
export const retrievalOptimizationPass = {
  id: 'retrieval',
  version: '0.2.0',
  families: ['retrieval_redundancy'],
  applicability: (d) => (d.family === 'retrieval_redundancy' ? { applicable: true, reasons: [] } : { applicable: false, reasons: ['only applies to retrieval_redundancy'] }),
  requiredEvidence: (d) => [
    { key: 'retrieval_nodes_with_digests', present: d.metrics.retrievals > 0, detail: `${d.metrics.retrievals} retrieval(s)` },
    { key: 'retrieval_latency', present: d.metrics.latency.samples > 0, detail: `${d.metrics.latency.samples} timed` },
  ],
  propose(d, ctx) {
    return this.transformations(d, ctx).map((t) => ({ strategy: t.kind, status: 'BLOCKED', candidate_config: t.config, blocked_reason: 'needs_implementation', reason: t.label }));
  },
  expectedEffects: (t) => (t?.kind === 'retrieval_top_k' ? { cost: { direction: 'decrease', basis: 'fewer context tokens' }, quality: { direction: 'unknown', basis: 'fewer documents can lose the answer; VERIFIED requires a graded replay' } } : { cost: { direction: 'decrease', basis: 'structural' }, latency: { direction: 'decrease', basis: 'structural' }, quality: { direction: 'unknown', basis: 'replay decides' } }),
  riskClass: (t) => t.risk_class,
  protectedSlices: () => ['questions whose answer depends on lower-ranked documents'],
  falsifier: (t) => (t?.kind === 'retrieval_top_k' ? 'Wrong if graded quality drops with fewer documents.' : 'Wrong if duplicated chunks carried distinct information or repeated retrievals returned fresher documents.'),
  rollback: (t) => (t?.kind === 'retrieval_top_k' ? 'Restore the previous top-k.' : 'Remove deduplication.'),
  materializerHints: (t) => ({ kind: 'retrieval_client', target: t.scope, notes: JSON.stringify(t.config) }),
  compatibilityTags: () => ['context:retrieval'],
  conflictsWith: () => [],
  compositionRules: () => [{ kinds: ['retrieval_dedupe', 'retrieval_top_k'], order: ['retrieval_dedupe', 'retrieval_top_k'], note: 'k applies after duplicates are removed', escalates: true }],
  transformations(d) {
    if (!this.applicability(d).applicable) return [];
    const ev = this.requiredEvidence(d);
    const mk = (kind, label, config, risk, complexity) => ({ ...base(this, d), kind, label, scope: d.scope, call_site: `retrieval:${d.scope}`, settings: { [`retrieval:${d.scope}:${kind}`]: config }, config, ...blockedTx('Retrieval changes need a retrieval replay harness (not built yet): proposed with evidence, never replayed.'), affected_trace_ids: [], risk_class: risk, implementation_complexity: complexity, rollback_complexity: 1, required_evidence: ev, expected_effects: this.expectedEffects({ kind }), protected_slices: this.protectedSlices(), falsifier: this.falsifier({ kind }), rollback: this.rollback({ kind }), materializer_hints: { kind: 'retrieval_client', target: d.scope, notes: JSON.stringify(config) }, metadata: { latency: d.metrics.latency, requires_replay: true } });
    const out = [];
    if (d.metrics.duplicate_chunk_refs > 0) out.push(mk('retrieval_dedupe', 'Deduplicate retrieved chunks', { by: 'document_id', scope: 'one task' }, 'low', 1));
    if (d.metrics.documents_p50 !== null && d.metrics.documents_p50 >= 8) out.push(mk('retrieval_top_k', 'Lower retrieval top-k', { from: d.metrics.documents_p50, to: Math.max(3, Math.floor(d.metrics.documents_p50 / 2)), requires_replay: true }, 'medium', 1));
    return out;
  },
};

// -------------------------------------- 8. DeterministicReplacementPass
export function labelSet(rows) {
  const outs = rows.map((t) => t.output_text).filter((v) => v !== null && v !== undefined);
  if (!outs.length) return null;
  const values = [...new Set(outs.map((v) => String(v).trim()))];
  if (values.length > 20 || !values.every((v) => LABEL.test(v))) return null;
  return values.sort();
}

export const deterministicReplacementPass = {
  id: 'deterministic_replacement',
  version: '0.2.0',
  families: ['redundant_call'],
  rows(d, ctx) {
    return finalRows(ctx.traces).filter((t) => scopeOf(t) === d.scope && !t.protected && lookupKey(t));
  },
  applicability(d, ctx) {
    if (d.family !== 'redundant_call') return { applicable: false, reasons: ['needs repeated exact inputs (redundant_call)'] };
    const rows = this.rows(d, ctx);
    if (!labelSet(rows)) return { applicable: false, reasons: ['outputs are free text or more than 20 distinct values: this is semantic work, not a deterministic mapping'] };
    return { applicable: true, reasons: [] };
  },
  requiredEvidence(d, ctx) {
    const rows = this.rows(d, ctx);
    const labelled = rows.filter((t) => t.expected_output !== null && t.expected_output !== undefined).length;
    const hits = simulateLookup(rows, rows);
    return [
      { key: 'repeated_exact_inputs', present: d.metrics.groups > 0, detail: `${d.metrics.groups} group(s)` },
      { key: 'enum_outputs', present: Boolean(labelSet(rows)), detail: (labelSet(rows) || []).join(', ') },
      { key: 'validated_prior_observations', present: hits.length > 0, detail: `${labelled}/${rows.length} labelled; ${hits.length} request(s) answerable from earlier validated answers` },
    ];
  },
  propose(d, ctx) {
    return this.transformations(d, ctx).map((t) => ({ strategy: t.kind, status: t.executable_status === EXECUTABLE ? 'READY' : 'BLOCKED', candidate_config: t.config, reason: t.label }));
  },
  expectedEffects: () => ({ cost: { direction: 'decrease', basis: 'lookup hits skip the model' }, latency: { direction: 'decrease', basis: 'lookup hits skip the model' }, quality: { direction: 'unchanged_required', basis: 'replay decides; misses fall back to the model' } }),
  riskClass: () => 'medium',
  protectedSlices: () => ['protected requests always use the model'],
  falsifier: () => 'Wrong if a validated earlier answer is not the right answer for a later identical request (the label drifted), or the input contract misses context that changes the answer.',
  rollback: () => 'Disable the lookup table (flag); every request goes to the model again.',
  materializerHints: (t) => ({ kind: 'deterministic_lookup', target: t.scope, notes: 'Build the table offline from validated history; ship it versioned; route misses to the model.' }),
  compatibilityTags: () => ['interceptor:response'],
  conflictsWith: () => [{ kinds: ['deterministic_rule', 'model_substitution'], reason: 'a deterministic rule replaces the model on every case; substituting that model is irrelevant' }],
  compositionRules: () => [{ kinds: ['exact_lookup', 'model_substitution'], order: ['exact_lookup', 'model_substitution'], note: 'lookup first; misses go to the substituted model' }],
  transformations(d, ctx) {
    if (!this.applicability(d, ctx).applicable) return [];
    const rows = this.rows(d, ctx);
    const evidence = this.requiredEvidence(d, ctx);
    const values = labelSet(rows);
    return [
      {
        ...base(this, d),
        kind: 'exact_lookup',
        label: 'Validated exact lookup',
        scope: d.scope,
        call_site: d.scope,
        settings: { [`lookup:${d.scope}`]: { min_validated: 1 } },
        config: { min_validated: 1, key_basis: 'lookup_identity_v1' },
        executable_status: EXECUTABLE,
        affected_trace_ids: rows.map((t) => t.id),
        risk_class: 'medium',
        implementation_complexity: 3,
        rollback_complexity: 1,
        required_evidence: evidence,
        expected_effects: this.expectedEffects(),
        protected_slices: this.protectedSlices(),
        falsifier: this.falsifier(),
        rollback: this.rollback(),
        materializer_hints: this.materializerHints({ scope: d.scope }),
        metadata: {
          applicability_reason: `Repeated exact inputs with enum outputs (${values.length} label(s)); answers validated against labels.`,
          input_contract: { key: ['symbol', 'workflow', 'input_hash', 'system_prompt_hash', 'response_format'], exact: true },
          output_contract: { type: 'enum', values },
          failure_mode: 'unseen or unvalidated input → miss (no answer is invented)',
          fallback_path: 'the current model call (baseline path) on every miss',
          replay_requirement: 'full replay under the frozen contract; the table is built only from answers earlier than each replayed request',
        },
      },
    ];
  },
};

/** Every pass the plan search consults, in deterministic order. */
export const SEARCH_PASSES = Object.freeze([redundantCallPass, cachePass, deterministicReplacementPass, modelProviderPass, retryAmplificationPass, contextMemoryPass, agentWorkflowPass, retrievalOptimizationPass]);
export const searchPassById = (id) => SEARCH_PASSES.find((p) => p.id === id) || null;
