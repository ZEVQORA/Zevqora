/**
 * Candidate execution: bounded, budgeted, provenance-hashed. Ported from the
 * desktop engine's executor; the provider call is injected so the platform
 * proxy (server credential + credit accounting) does the spending.
 */
import { sha256Json, sha256Text } from './hashing.js';
import { estimateSampleCost, executeExactReuseSample, executeModelSubstitutionSample, reuseSourceFor } from './strategies.js';

const MIXED = 'mixed';

export function provenanceHashFor(plan, { baselineIds, sampleResults, provider, model }) {
  return sha256Json({
    plan_version: plan.plan_version,
    strategy: plan.strategy,
    config_hash: plan.config_hash,
    baseline_trace_ids: baselineIds,
    candidate_config: plan.candidate_config || {},
    provider,
    model,
    pricing_version: sampleResults.find((r) => r.pricing_version)?.pricing_version || null,
    sample_digests: sampleResults.map((r) => ({ baseline_trace_id: r.baseline_trace_id, cost_source: r.cost_source ?? null, cost_usd: r.cost_usd ?? null, provider_request_id: r.provider_request_id ?? null, output_hash: sha256Text(r.output_text) })),
  });
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Runs a READY plan over its sample scope. Returns the execution record fields
 * (status, samples, aggregates, provenance). Budget is enforced before and after
 * every provider call.
 */
export async function executePlan({ plan, traces, complete, pricing, allowedModels, maxConcurrency = 2 }) {
  const byId = new Map(traces.map((t) => [t.id, t]));
  const sampleIds = plan.sample_scope || [];
  const model = plan.candidate_config?.model || null;
  const startedAt = new Date().toISOString();

  let estimated = 0;
  if (plan.strategy === 'model_substitution') {
    for (const id of sampleIds) {
      const t = byId.get(id);
      if (!t) continue;
      const est = estimateSampleCost(pricing, model, t);
      if (est === null) throw new Error('Cannot execute under strict budget: candidate cost is not estimable from verified pricing.');
      estimated += est;
    }
    if (estimated > plan.max_budget_usd) throw new Error(`Estimated max cost ${estimated.toFixed(6)} USD exceeds plan budget ${Number(plan.max_budget_usd).toFixed(6)} USD.`);
  }

  let spent = 0;
  let providerCalls = 0;
  let finalStatus = 'SUCCEEDED';
  let errorCategory = null;
  let errorDetail = null;

  const runOne = async (traceId) => {
    const baseline = byId.get(traceId);
    if (!baseline) return { baseline_trace_id: traceId, status: 'failed', error_category: 'ineligible', error_detail: 'Baseline trace missing.', execution_proven: false };
    if (finalStatus === 'BUDGET_EXCEEDED') return { baseline_trace_id: traceId, status: 'failed', error_category: 'budget_exceeded', error_detail: 'Plan already exceeded budget.', execution_proven: false };
    if (plan.strategy === 'model_substitution') {
      const est = estimateSampleCost(pricing, model, baseline);
      if (est === null || est > plan.max_budget_usd - spent + 1e-12) {
        finalStatus = 'BUDGET_EXCEEDED';
        return { baseline_trace_id: traceId, status: 'failed', error_category: 'budget_exceeded', error_detail: 'Remaining plan budget insufficient for next provider call.', execution_proven: false };
      }
    }
    let result;
    if (plan.strategy === 'exact_reuse') result = executeExactReuseSample(plan, baseline, reuseSourceFor(plan, traceId, byId));
    else result = await executeModelSubstitutionSample(plan, baseline, complete, { allowedModels, pricing });

    if (result.provider_call_count) providerCalls += result.provider_call_count;
    if (result.cost_usd !== null && result.cost_usd !== undefined) {
      spent += result.cost_usd;
      if (spent > plan.max_budget_usd + 1e-9) {
        finalStatus = 'BUDGET_EXCEEDED';
        result = { ...result, status: 'failed', error_category: 'budget_exceeded', error_detail: 'Cumulative candidate spend exceeded plan budget.' };
      }
    }
    if (result.status === 'failed') {
      if (result.error_category === 'budget_exceeded') finalStatus = 'BUDGET_EXCEEDED';
      else if (finalStatus === 'SUCCEEDED') {
        finalStatus = 'FAILED';
        errorCategory = result.error_category || 'unknown';
        errorDetail = result.error_detail || null;
      }
    }
    return result;
  };

  const results = sampleIds.length ? await mapLimit(sampleIds, plan.strategy === 'exact_reuse' ? 8 : maxConcurrency, runOne) : [];
  if (!sampleIds.length) {
    finalStatus = 'FAILED';
    errorCategory = 'ineligible';
    errorDetail = 'Plan sample scope is empty.';
  }
  if (results.some((r) => r.status === 'failed') && finalStatus === 'SUCCEEDED') finalStatus = 'FAILED';

  const succeeded = results.filter((r) => r.status === 'succeeded');
  let aggCost = null;
  let aggSource = null;
  if (plan.strategy === 'exact_reuse' && succeeded.length) {
    const sources = new Set(succeeded.map((r) => r.cost_source).filter(Boolean));
    sources.delete('deterministic_reuse');
    if (sources.size) {
      aggCost = null;
      aggSource = MIXED;
    } else {
      aggCost = 0;
      aggSource = 'deterministic_reuse';
    }
  } else if (succeeded.length && succeeded.every((r) => r.cost_usd !== null && r.cost_usd !== undefined)) {
    aggCost = Number(succeeded.reduce((a, r) => a + r.cost_usd, 0).toFixed(10));
    const sources = new Set(succeeded.map((r) => r.cost_source).filter(Boolean));
    aggSource = sources.size === 1 ? [...sources][0] : sources.size ? MIXED : null;
  }
  const paired = succeeded.filter((r) => r.cost_usd !== null && r.cost_usd !== undefined && r.baseline_cost_usd !== null && r.baseline_cost_usd !== undefined);
  let delta = null;
  if (aggCost !== null && paired.length && paired.length === succeeded.length) {
    delta = Number((paired.reduce((a, r) => a + r.cost_usd, 0) - paired.reduce((a, r) => a + r.baseline_cost_usd, 0)).toFixed(10));
  }
  const latencies = succeeded.map((r) => r.latency_ms).filter((v) => v !== null && v !== undefined);
  const versions = new Set(succeeded.map((r) => r.pricing_version).filter(Boolean));
  const provider = plan.strategy === 'exact_reuse' ? 'none' : 'openrouter';
  const sum = (key) => succeeded.reduce((a, r) => a + (r[key] || 0), 0);
  const inputTokens = succeeded.length ? sum('input_tokens') : null;
  const outputTokens = succeeded.length ? sum('output_tokens') : null;

  return {
    status: finalStatus,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    provider,
    requested_model: model,
    resolved_model: plan.strategy === 'exact_reuse' ? null : succeeded.find((r) => r.resolved_model)?.resolved_model || model,
    baseline_trace_ids: sampleIds,
    sample_results: results,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_input_tokens: succeeded.length ? sum('cached_input_tokens') || null : null,
    cost_usd: aggCost,
    cost_source: aggSource,
    pricing_version: versions.size === 1 ? [...versions][0] : null,
    latency_ms: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null,
    provider_request_id: succeeded.find((r) => r.provider_request_id)?.provider_request_id || null,
    provider_call_count: providerCalls,
    candidate_cost_delta_usd: delta,
    error_category: errorCategory,
    error_detail: errorDetail,
    fallback_used: false,
    provenance_hash: provenanceHashFor(plan, { baselineIds: sampleIds, sampleResults: results, provider, model }),
    spent_usd: spent,
  };
}
