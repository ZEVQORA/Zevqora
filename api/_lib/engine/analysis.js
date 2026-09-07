import { cheaperCandidateFor, estimateCost, priceRatio, tierOf } from '../pricing.js';

/**
 * Deterministic analysis over telemetry events. No model calls.
 *
 * Input: normalized events (provider/model keys already canonical, cost filled
 * where a pricing snapshot allows). Output: a spend summary and a list of
 * opportunity candidates, each carrying the evidence it was derived from.
 */
export const ANALYSIS_VERSION = 'analysis_v1.0.0';

const BOUNDED_OUTPUT_TOKENS = 64;

function median(values) {
  const arr = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function sum(values) {
  return values.reduce((acc, v) => acc + (typeof v === 'number' && Number.isFinite(v) ? v : 0), 0);
}

function round(value, digits = 6) {
  return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

export function summarize(events) {
  const byModel = new Map();
  const byProvider = new Map();
  let totalCost = 0;
  let costKnown = 0;
  let errors = 0;
  for (const e of events) {
    const key = e.model_key;
    const m = byModel.get(key) || { model: key, provider: e.provider_key, requests: 0, cost: 0, input_tokens: 0, output_tokens: 0, latencies: [], errors: 0, samples: 0 };
    m.requests += 1;
    m.cost += e.cost_usd || 0;
    m.input_tokens += e.input_tokens || 0;
    m.output_tokens += e.output_tokens || 0;
    if (typeof e.latency_ms === 'number') m.latencies.push(e.latency_ms);
    if (e.status !== 'ok') m.errors += 1;
    if (e.has_sample) m.samples += 1;
    byModel.set(key, m);
    const p = byProvider.get(e.provider_key) || { provider: e.provider_key, requests: 0, cost: 0, input_tokens: 0, output_tokens: 0, latencies: [] };
    p.requests += 1;
    p.cost += e.cost_usd || 0;
    p.input_tokens += e.input_tokens || 0;
    p.output_tokens += e.output_tokens || 0;
    if (typeof e.latency_ms === 'number') p.latencies.push(e.latency_ms);
    byProvider.set(e.provider_key, p);
    if (typeof e.cost_usd === 'number') {
      totalCost += e.cost_usd;
      costKnown += 1;
    }
    if (e.status !== 'ok') errors += 1;
  }
  const models = [...byModel.values()]
    .map((m) => ({ ...m, cost: round(m.cost), latency_p50_ms: round(median(m.latencies), 1), latencies: undefined }))
    .sort((a, b) => b.cost - a.cost);
  const providers = [...byProvider.values()]
    .map((p) => ({ ...p, cost: round(p.cost), latency_p50_ms: round(median(p.latencies), 1), latencies: undefined }))
    .sort((a, b) => b.cost - a.cost);
  return {
    events: events.length,
    errors,
    total_cost_usd: round(totalCost),
    cost_coverage: events.length ? round(costKnown / events.length, 3) : 0,
    models,
    providers,
  };
}

export function analyzeEvents(events, pricing, { windowDays = 30, retentionNote = null } = {}) {
  const summary = summarize(events);
  const opportunities = [];
  const monthlyFactor = windowDays > 0 ? 30 / windowDays : 1;

  // 1. Exact reuse: identical prompts executed repeatedly.
  const groups = new Map();
  for (const e of events) {
    if (!e.prompt_hash || e.status !== 'ok') continue;
    const g = groups.get(e.prompt_hash) || [];
    g.push(e);
    groups.set(e.prompt_hash, g);
  }
  let duplicateCalls = 0;
  let duplicateCost = 0;
  let groupCount = 0;
  let nondeterministic = 0;
  const groupModels = new Map();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    groupCount += 1;
    duplicateCalls += g.length - 1;
    const sorted = [...g].sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
    duplicateCost += sum(sorted.slice(1).map((e) => e.cost_usd));
    const hashes = new Set(g.map((e) => e.output_hash).filter(Boolean));
    if (hashes.size > 1) nondeterministic += 1;
    for (const e of g) groupModels.set(e.model_key, (groupModels.get(e.model_key) || 0) + 1);
  }
  const duplicateShare = events.length ? duplicateCalls / events.length : 0;
  if (groupCount >= 1 && duplicateCalls >= 3 && (duplicateShare >= 0.03 || duplicateCost > 0.01)) {
    const topModel = [...groupModels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    opportunities.push({
      fingerprint: 'exact_reuse:project',
      category: 'repeated_requests',
      title: 'Identical requests are paid for more than once',
      issue: `${duplicateCalls} of ${events.length} calls (${(duplicateShare * 100).toFixed(1)}%) repeated a prompt that had already been executed in the window.`,
      root_cause: 'The same prompt content reaches the provider repeatedly. A response cache keyed on the prompt hash would serve the repeats without a model call.',
      source_ref: 'runtime telemetry · prompt_hash',
      current_provider: topModel ? topModel.split('/')[0] : null,
      current_model: topModel,
      cost_driver: 'duplicate model calls',
      candidate_strategy: 'exact_reuse',
      candidate_config: { mechanism: 'prompt-hash response cache', ttl_hint: 'per deployment', fallback: 'cache miss executes the model as today' },
      baseline_cost_usd: round(summary.total_cost_usd),
      estimated_savings_usd: round(duplicateCost),
      estimated_savings_pct: summary.total_cost_usd ? round((duplicateCost / summary.total_cost_usd) * 100, 2) : null,
      confidence: nondeterministic ? 0.7 : 0.9,
      risk: nondeterministic ? 'medium' : 'low',
      evidence_completeness: 'complete',
      evidence: {
        duplicate_groups: groupCount,
        duplicate_calls: duplicateCalls,
        duplicate_share: round(duplicateShare, 4),
        duplicate_cost_usd: round(duplicateCost),
        nondeterministic_groups: nondeterministic,
        projected_monthly_savings_usd: round(duplicateCost * monthlyFactor, 4),
        note: nondeterministic ? `${nondeterministic} group(s) returned different outputs for the same prompt; replay will surface whether caching changes behaviour.` : 'Outputs were identical within every repeated group where an output hash was available.',
      },
    });
  }

  // 2 + 3. Expensive models on bounded or mixed outputs.
  for (const m of summary.models) {
    const tier = tierOf(pricing, m.model);
    if (tier !== 'frontier' || m.requests < 20) continue;
    const modelEvents = events.filter((e) => e.model_key === m.model && e.status === 'ok');
    const outputs = modelEvents.map((e) => e.output_tokens).filter((v) => typeof v === 'number');
    if (outputs.length < 10) continue;
    const med = median(outputs);
    const bounded = modelEvents.filter((e) => typeof e.output_tokens === 'number' && e.output_tokens <= BOUNDED_OUTPUT_TOKENS);
    const boundedShare = bounded.length / modelEvents.length;
    const candidate = cheaperCandidateFor(pricing, m.model);
    if (!candidate) continue;
    const ratio = priceRatio(pricing, m.model, candidate, { input: m.input_tokens || 1, output: m.output_tokens || 1 });
    if (ratio === null || ratio >= 1) continue;
    const samples = modelEvents.filter((e) => e.has_sample).length;
    const completeness = samples >= 8 ? 'complete' : samples >= 1 ? 'partial' : 'missing';

    if (med !== null && med <= BOUNDED_OUTPUT_TOKENS) {
      const savings = m.cost * (1 - ratio);
      opportunities.push({
        fingerprint: `model_substitution:${m.model}`,
        category: 'expensive_model',
        title: `${m.model} runs bounded work that a smaller model may handle`,
        issue: `${m.requests} calls with a median output of ${Math.round(med)} tokens. Short, bounded outputs rarely need a frontier model.`,
        root_cause: `Every call is routed to ${m.model} regardless of task complexity. The observed outputs look like classification, extraction or short structured answers.`,
        source_ref: `runtime telemetry · ${m.model}`,
        current_provider: m.provider,
        current_model: m.model,
        cost_driver: 'frontier model on bounded outputs',
        candidate_strategy: 'model_substitution',
        candidate_config: { candidate_model: candidate, temperature: 0, fallback: 'retain baseline model on gate failure' },
        baseline_cost_usd: round(m.cost),
        estimated_savings_usd: round(savings),
        estimated_savings_pct: round((1 - ratio) * 100, 2),
        confidence: 0.6,
        risk: 'medium',
        evidence_completeness: completeness,
        evidence: {
          requests: m.requests,
          median_output_tokens: med,
          bounded_share: round(boundedShare, 3),
          price_ratio: round(ratio, 4),
          samples_available: samples,
          projected_monthly_savings_usd: round(savings * monthlyFactor, 4),
          note: completeness === 'complete' ? 'Enough captured samples to replay on the candidate model.' : 'Enable sample capture on the connection to replay this candidate against real requests.',
        },
      });
    } else if (boundedShare >= 0.2) {
      const boundedCost = sum(bounded.map((e) => e.cost_usd));
      const savings = boundedCost * (1 - ratio);
      opportunities.push({
        fingerprint: `bounded_routing:${m.model}`,
        category: 'routing',
        title: `${Math.round(boundedShare * 100)}% of ${m.model} calls are bounded and could route to a cheaper tier`,
        issue: `${bounded.length} of ${modelEvents.length} calls produced at most ${BOUNDED_OUTPUT_TOKENS} output tokens while paying frontier prices.`,
        root_cause: 'One model serves both short bounded answers and long complex generations. A routing policy can send the bounded share to a cheaper model and keep the strong model as fallback.',
        source_ref: `runtime telemetry · ${m.model}`,
        current_provider: m.provider,
        current_model: m.model,
        cost_driver: 'no tiering between bounded and complex work',
        candidate_strategy: 'bounded_routing',
        candidate_config: { cheap_model: candidate, strong_model: m.model, bounded_output_tokens: BOUNDED_OUTPUT_TOKENS, fallback: 'strong model on invalid or low-confidence output' },
        baseline_cost_usd: round(m.cost),
        estimated_savings_usd: round(savings),
        estimated_savings_pct: m.cost ? round((savings / m.cost) * 100, 2) : null,
        confidence: 0.5,
        risk: 'medium',
        evidence_completeness: completeness,
        evidence: {
          requests: m.requests,
          bounded_calls: bounded.length,
          bounded_share: round(boundedShare, 3),
          bounded_cost_usd: round(boundedCost),
          price_ratio: round(ratio, 4),
          samples_available: samples,
          projected_monthly_savings_usd: round(savings * monthlyFactor, 4),
        },
      });
    }

    // 4. Oversized context.
    const inputs = modelEvents.map((e) => e.input_tokens).filter((v) => typeof v === 'number');
    const medIn = median(inputs);
    const inOut = m.output_tokens ? m.input_tokens / m.output_tokens : 0;
    if (medIn !== null && medIn >= 6000 && inOut >= 10) {
      const inputCost = estimateCost(pricing, m.model, { input: m.input_tokens, output: 0 })?.cost ?? m.cost * 0.7;
      const savings = inputCost * 0.3;
      opportunities.push({
        fingerprint: `context_reduction:${m.model}`,
        category: 'prompt_waste',
        title: `${m.model} carries a median ${Math.round(medIn / 1000)}k-token context for short answers`,
        issue: `Input tokens outnumber output tokens ${inOut.toFixed(0)}:1. Most of every request is context the model reads and discards.`,
        root_cause: 'Prompts include full history, large system instructions or unbounded retrieval. Windowing history and trimming retrieval usually preserves the answer.',
        source_ref: `runtime telemetry · ${m.model}`,
        current_provider: m.provider,
        current_model: m.model,
        cost_driver: 'oversized input context',
        candidate_strategy: 'context_reduction',
        candidate_config: { mechanism: 'window history and cap retrieval', assumed_reduction_pct: 30 },
        baseline_cost_usd: round(m.cost),
        estimated_savings_usd: round(savings),
        estimated_savings_pct: m.cost ? round((savings / m.cost) * 100, 2) : null,
        confidence: 0.4,
        risk: 'medium',
        evidence_completeness: 'partial',
        evidence: {
          median_input_tokens: medIn,
          input_output_ratio: round(inOut, 1),
          assumption: 'A 30% context reduction is an assumption, not a measurement. Verifying it requires a code-level change replayed with the desktop engine.',
        },
      });
    }
  }

  // 5. Retry and failure waste.
  const failed = events.filter((e) => e.status !== 'ok');
  const retried = events.filter((e) => typeof e.attempt === 'number' && e.attempt > 1);
  const failShare = events.length ? failed.length / events.length : 0;
  const retryShare = events.length ? retried.length / events.length : 0;
  if (events.length >= 50 && (failShare >= 0.05 || retryShare >= 0.05)) {
    const wasted = sum(failed.map((e) => e.cost_usd)) + sum(retried.map((e) => e.cost_usd));
    opportunities.push({
      fingerprint: 'retry_policy:project',
      category: 'retries',
      title: 'Failed and retried calls are consuming budget',
      issue: `${failed.length} failed and ${retried.length} retried calls in the window (${(failShare * 100).toFixed(1)}% failure, ${(retryShare * 100).toFixed(1)}% retries).`,
      root_cause: 'Timeouts, rate limits or malformed outputs trigger repeated paid attempts. Tighter timeouts, jittered backoff and validation before retry reduce the waste.',
      source_ref: 'runtime telemetry · status, attempt',
      current_provider: null,
      current_model: null,
      cost_driver: 'retry and failure overhead',
      candidate_strategy: 'retry_policy',
      candidate_config: { mechanism: 'bounded retries with validation', note: 'policy change; measured after deployment' },
      baseline_cost_usd: round(summary.total_cost_usd),
      estimated_savings_usd: round(wasted),
      estimated_savings_pct: summary.total_cost_usd ? round((wasted / summary.total_cost_usd) * 100, 2) : null,
      confidence: 0.7,
      risk: 'low',
      evidence_completeness: 'partial',
      evidence: { failed_calls: failed.length, retried_calls: retried.length, wasted_cost_usd: round(wasted), error_classes: [...new Set(failed.map((e) => e.error_class).filter(Boolean))].slice(0, 8) },
    });
  }

  return {
    version: ANALYSIS_VERSION,
    summary: { ...summary, window_days: windowDays, retention_note: retentionNote },
    opportunities,
  };
}
