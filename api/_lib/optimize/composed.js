/**
 * Composed-plan executor (vNext Part 2B).
 *
 * Runs one execution plan over its sample scope (calibration sample or the
 * search's evaluation set), case by case in request order, applying the
 * plan's transformations in composition order:
 *
 *   validated lookup hit  → the earlier validated answer (no provider call)
 *   response-cache hit    → the answer THIS replay stored for the same key
 *                           (so a cache in front of a smaller model serves the
 *                           smaller model's answers, never the baseline's)
 *   model substitution    → the existing model-substitution sample executor
 *                           (platform provider, budgeted)
 *   no transformation     → the unchanged path: the recorded baseline result,
 *                           labelled `baseline_passthrough`
 *
 * A plan containing any transformation this harness cannot execute is refused
 * before anything runs: a plan is never partly executed.
 *
 * It returns the same execution-record fields as executor.js#executePlan so the
 * existing evaluator judges it unchanged.
 */
import { sha256Json, sha256Text } from '../product/hashing.js';
import { estimateSampleCost, executeModelSubstitutionSample } from '../product/strategies.js';
import { taskFingerprint } from '../product/fingerprints.js';
import { provenanceHashFor } from '../product/executor.js';
import { EXECUTABLE_KINDS } from './transformations.js';
import { finalRows } from './passes-intelligence.js';
import { responseCache, streamOrder, validatedLookup } from './replay-model.js';

export const COMPOSED_STRATEGY = 'execution_plan';
const scopeOf = (t) => t.symbol || t.workflow || 'unattributed';
const known = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));

export class CompositionNotExecutable extends Error {}

/** Refuses a composition the harness cannot run in full. */
export function assertExecutable(composition) {
  if (!Array.isArray(composition) || !composition.length) throw new CompositionNotExecutable('Plan has no composition.');
  const bad = composition.filter((t) => !EXECUTABLE_KINDS.includes(t.kind) || t.executable_status !== 'EXECUTABLE');
  if (bad.length) throw new CompositionNotExecutable(`Plan is not executable as a whole: ${bad.map((t) => `${t.kind} (${t.executable_status})`).join(', ')}. A plan is never partly executed.`);
}

/** Upper bound on provider spend: every sampled case a substitution could serve. */
export function maxProviderCost(composition, rows, pricing) {
  let total = 0;
  for (const tx of composition.filter((t) => t.kind === 'model_substitution')) {
    const affected = new Set(tx.affected_trace_ids);
    for (const r of rows) {
      if (!affected.has(r.id)) continue;
      const e = estimateSampleCost(pricing, tx.config.to, r, { maxOutputTokens: tx.config.max_tokens });
      if (e === null) return null;
      total += e;
    }
  }
  return total;
}

export async function executeComposedPlan({ plan, traces, complete, pricing, allowedModels }) {
  // Stored pass instances carry `transformation_hash`; every map below is keyed by it.
  const composition = (plan.candidate_config?.composition || []).map((t) => ({ ...t, hash: t.hash || t.transformation_hash }));
  assertExecutable(composition);
  if (new Set(composition.map((t) => t.hash)).size !== composition.length || composition.some((t) => !t.hash)) throw new CompositionNotExecutable('Every transformation in a composition needs a distinct hash.');
  const startedAt = new Date().toISOString();
  const byId = new Map(traces.map((t) => [t.id, t]));
  const history = finalRows(traces);
  const rows = (plan.sample_scope || []).map((id) => byId.get(id)).filter(Boolean).sort(streamOrder);
  const missing = (plan.sample_scope || []).filter((id) => !byId.has(id));
  const bound = maxProviderCost(composition, rows, pricing);
  if (bound === null) throw new Error('Cannot execute under strict budget: a substituted call is not estimable from verified pricing.');
  if (bound > Number(plan.max_budget_usd) + 1e-12) throw new Error(`Estimated max provider cost ${bound.toFixed(6)} USD exceeds the plan budget ${Number(plan.max_budget_usd).toFixed(6)} USD.`);

  const caches = new Map(composition.filter((t) => t.kind === 'exact_response_reuse').map((t) => [t.hash, responseCache(t.config.ttl_ms ?? null)]));
  const lookups = new Map(composition.filter((t) => t.kind === 'exact_lookup').map((t) => [t.hash, validatedLookup(history.filter((h) => scopeOf(h) === t.scope && !h.protected), { minValidated: t.config.min_validated || 1 })]));
  let spent = 0;
  let providerCalls = 0;
  let status = 'SUCCEEDED';
  let errorCategory = null;
  let errorDetail = null;
  const results = missing.map((id) => ({ baseline_trace_id: id, status: 'failed', error_category: 'ineligible', error_detail: 'Baseline trace missing.', execution_proven: false }));

  for (const b of rows) {
    const started = Date.now();
    let result = null;
    const writeBack = [];
    for (const tx of composition) {
      if (tx.kind === 'exact_lookup' && scopeOf(b) === tx.scope) {
        const d = lookups.get(tx.hash).decide(b);
        if (!d.hit) continue;
        result = { status: 'succeeded', path: 'lookup_hit', served_by: tx.hash, transformation: tx.kind, output_text: d.output, cost_usd: 0, cost_source: 'deterministic_lookup', provider: 'none', provider_call_count: 0, reused_from_trace_id: d.source_trace_id, latency_ms: Date.now() - started, latency_basis: 'in-process replay (production lookup time not measured)' };
        break;
      }
      if (tx.kind === 'exact_response_reuse' && scopeOf(b) === tx.scope) {
        const d = caches.get(tx.hash).decide(b);
        if (d.hit) {
          result = { status: 'succeeded', path: 'cache_hit', served_by: tx.hash, transformation: tx.kind, output_text: d.entry.output_text, cost_usd: 0, cost_source: 'deterministic_reuse', provider: 'none', provider_call_count: 0, reused_from_trace_id: d.entry.source_trace_id, latency_ms: Date.now() - started, latency_basis: 'in-process replay (production cache lookup time not measured)' };
          break;
        }
        if (d.eligible) writeBack.push(caches.get(tx.hash));
        continue;
      }
      if (tx.kind === 'model_substitution' && tx.affected_trace_ids.includes(b.id)) {
        const est = estimateSampleCost(pricing, tx.config.to, b, { maxOutputTokens: tx.config.max_tokens });
        if (est === null || est > Number(plan.max_budget_usd) - spent + 1e-12) {
          status = 'BUDGET_EXCEEDED';
          result = { status: 'failed', path: 'model_call', served_by: tx.hash, transformation: tx.kind, error_category: 'budget_exceeded', error_detail: 'Remaining plan budget insufficient for the next provider call.', execution_proven: false };
          break;
        }
        const sample = await executeModelSubstitutionSample({ candidate_config: { model: tx.config.to, temperature: tx.config.temperature ?? 0, max_tokens: tx.config.max_tokens } }, b, complete, { allowedModels, pricing });
        providerCalls += sample.provider_call_count || 0;
        if (known(sample.cost_usd)) spent += Number(sample.cost_usd);
        result = { ...sample, path: 'model_call', served_by: tx.hash, transformation: tx.kind };
        break;
      }
    }
    if (!result) {
      // Unchanged path: the recorded result of the baseline execution of this exact request.
      result = { status: 'succeeded', path: 'baseline_passthrough', served_by: null, transformation: null, output_text: b.output_text, cost_usd: b.cost_usd ?? null, cost_source: b.cost_source ?? null, pricing_version: b.pricing_version ?? null, provider: b.provider || null, resolved_model: b.model || null, provider_call_count: 0, latency_ms: b.latency_ms ?? null, input_tokens: b.input_tokens ?? null, output_tokens: b.output_tokens ?? null, latency_basis: 'recorded baseline' };
    }
    // A hit hides what the next path would have answered; if that path is a substituted model it was
    // never run for this case, so a bad-day cache miss cannot know its answer (see badday.js).
    if (result.path === 'cache_hit' || result.path === 'lookup_hit') result.fallback_unknown = composition.some((t) => t.kind === 'model_substitution' && t.affected_trace_ids.includes(b.id));
    const full = {
      baseline_trace_id: b.id,
      task_fingerprint: taskFingerprint(b),
      candidate_config_fingerprint: sha256Json({ plan_hash: plan.candidate_config?.plan_hash || null, served_by: result.served_by, path: result.path }),
      output_hash: result.output_text === undefined ? null : sha256Text(result.output_text),
      baseline_cost_usd: b.cost_usd ?? null,
      baseline_cost_source: b.cost_source ?? null,
      candidate_cost_delta_usd: known(result.cost_usd) && known(b.cost_usd) ? Number(result.cost_usd) - Number(b.cost_usd) : null,
      // The unchanged path is proven by its recorded execution; hits and substituted calls by this replay.
      execution_proven: result.status === 'succeeded' && result.execution_proven !== false,
      proof: result.path === 'baseline_passthrough' ? 'recorded_baseline' : 'replay',
      ...result,
    };
    if (full.status === 'succeeded') for (const c of writeBack) c.write(b, { output_text: full.output_text });
    if (full.status !== 'succeeded' && status === 'SUCCEEDED') {
      status = full.error_category === 'budget_exceeded' ? 'BUDGET_EXCEEDED' : 'FAILED';
      errorCategory = full.error_category || 'unknown';
      errorDetail = full.error_detail || null;
    }
    results.push(full);
    if (status === 'BUDGET_EXCEEDED') break;
  }
  if (missing.length && status === 'SUCCEEDED') {
    status = 'FAILED';
    errorCategory = 'ineligible';
    errorDetail = `${missing.length} baseline trace(s) missing.`;
  }
  if (!rows.length) {
    status = 'FAILED';
    errorCategory = 'ineligible';
    errorDetail = 'Plan sample scope is empty.';
  }

  const ok = results.filter((r) => r.status === 'succeeded');
  const allKnown = ok.length > 0 && ok.length === results.length && ok.every((r) => known(r.cost_usd));
  const sources = new Set(ok.map((r) => r.cost_source).filter(Boolean));
  const providers = new Set(ok.filter((r) => r.provider_call_count > 0 || r.path === 'baseline_passthrough').map((r) => r.provider).filter(Boolean));
  const lat = ok.map((r) => r.latency_ms).filter(known).map(Number);
  const versions = new Set(ok.map((r) => r.pricing_version).filter(Boolean));
  const sub = composition.find((t) => t.kind === 'model_substitution');
  const paired = ok.filter((r) => known(r.cost_usd) && known(r.baseline_cost_usd));
  return {
    status,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    provider: providers.size === 1 ? [...providers][0] : providers.size ? 'mixed' : 'none',
    requested_model: sub ? sub.config.to : null,
    resolved_model: sub ? ok.find((r) => r.path === 'model_call' && r.resolved_model)?.resolved_model || sub.config.to : null,
    baseline_trace_ids: plan.sample_scope || [],
    sample_results: results,
    input_tokens: null,
    output_tokens: null,
    cached_input_tokens: null,
    cost_usd: allKnown ? Number(ok.reduce((a, r) => a + Number(r.cost_usd), 0).toFixed(10)) : null,
    cost_source: sources.size === 1 ? [...sources][0] : sources.size ? 'mixed' : null,
    pricing_version: versions.size === 1 ? [...versions][0] : null,
    latency_ms: lat.length ? lat.reduce((a, v) => a + v, 0) / lat.length : null,
    provider_request_id: ok.find((r) => r.provider_request_id)?.provider_request_id || null,
    provider_call_count: providerCalls,
    candidate_cost_delta_usd: allKnown && paired.length === ok.length ? Number((paired.reduce((a, r) => a + Number(r.cost_usd) - Number(r.baseline_cost_usd), 0)).toFixed(10)) : null,
    error_category: errorCategory,
    error_detail: errorDetail,
    fallback_used: false,
    provenance_hash: provenanceHashFor(plan, { baselineIds: plan.sample_scope || [], sampleResults: results, provider: providers.size ? [...providers].sort().join(',') : 'none', model: sub ? sub.config.to : null }),
    spent_usd: spent,
  };
}
