/**
 * Bad-Day Replay v0.1 (vNext Part 2B).
 *
 * A deterministic fault overlay on a plan's own full-replay results and on the
 * recorded baseline — inside the bounded replay system only. No provider is
 * called, no production traffic is touched. Faults are drawn from
 * sha256(seed, profile, case, attempt), so the same profile always produces
 * the same bad day.
 *
 * The workload's own retry behaviour is read from evidence (highest observed
 * attempt number); the cost and latency of a failed attempt come from observed
 * failed attempts of that class, or are UNKNOWN — never 0.
 *
 * The bad-day verdict is stored apart from the normal verdict and labelled
 * BAD-DAY REPLAY: a simulation over replayed cases, not a production guarantee.
 */
import { sha256Json } from '../product/hashing.js';
import { decideStatus } from '../product/evaluator.js';
import { normalizeRequirements } from './contract.js';
import { attemptNo, percentile, stableSum } from './performance.js';
import { streamOrder } from './replay-model.js';

export const BAD_DAY_VERSION = 'badday_v1';
export const BAD_DAY_LABEL = 'BAD-DAY REPLAY';
const known = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));
const meta = (t) => (t.metadata && typeof t.metadata === 'object' && !Array.isArray(t.metadata) ? t.metadata : {});

/** Scenarios, their parameters (default, min, max) and what the harness must be able to represent. */
export const SCENARIOS = Object.freeze({
  PROVIDER_RATE_LIMIT: { params: { rate: [0.2, 0, 1], retry_after_ms: [500, 0, 60_000] }, requires: ['provider_calls'], describe: (p) => `provider 429 on ${Math.round(p.rate * 100)}% of attempts, retry after ${p.retry_after_ms} ms` },
  PROVIDER_TIMEOUT: { params: { rate: [0.1, 0, 1], timeout_ms: [30_000, 1, 600_000] }, requires: ['provider_calls'], describe: (p) => `provider timeout (${p.timeout_ms} ms) on ${Math.round(p.rate * 100)}% of attempts` },
  MODEL_LATENCY_MULTIPLIER: { params: { multiplier: [2, 1, 20] }, requires: ['provider_calls'], describe: (p) => `model latency × ${p.multiplier}` },
  CACHE_MISS: { params: { rate: [1, 0, 1] }, requires: ['cache_or_lookup_hits'], describe: (p) => `${Math.round(p.rate * 100)}% of cache/lookup hits miss` },
  TOOL_TIMEOUT: { params: { rate: [0.1, 0, 1], timeout_ms: [10_000, 1, 600_000] }, requires: ['tool_calls_in_replay'], describe: (p) => `tool timeout on ${Math.round(p.rate * 100)}% of tool calls` },
  TOOL_ERROR: { params: { rate: [0.1, 0, 1] }, requires: ['tool_calls_in_replay'], describe: (p) => `tool error on ${Math.round(p.rate * 100)}% of tool calls` },
  RETRIEVAL_SLOWDOWN: { params: { multiplier: [3, 1, 20] }, requires: ['retrieval_in_replay'], describe: (p) => `retrieval latency × ${p.multiplier}` },
});
/** What the replay harness can represent honestly today. */
export const HARNESS_CAPABILITIES = Object.freeze(['provider_calls', 'cache_or_lookup_hits']);

export class BadDayError extends Error {}

export function normalizeProfile({ scenario, parameters = {}, scope = 'workload', seed = 'bad-day-v1' }) {
  const s = SCENARIOS[scenario];
  if (!s) throw new BadDayError(`Unknown bad-day scenario '${scenario}'. Use one of ${Object.keys(SCENARIOS).join(', ')}.`);
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new BadDayError('parameters must be an object.');
  for (const k of Object.keys(parameters)) if (!(k in s.params)) throw new BadDayError(`Unknown parameter '${k}' for ${scenario}.`);
  const params = {};
  for (const [k, [def, min, max]] of Object.entries(s.params)) {
    const v = parameters[k] === undefined ? def : Number(parameters[k]);
    if (!Number.isFinite(v) || v < min || v > max) throw new BadDayError(`${k} must be between ${min} and ${max}.`);
    params[k] = v;
  }
  if (scope !== 'workload') throw new BadDayError('Only workload scope is supported.');
  const cleanSeed = String(seed).slice(0, 64) || 'bad-day-v1';
  const body = { version: BAD_DAY_VERSION, scenario, parameters: params, scope, seed: cleanSeed, required_capabilities: s.requires };
  return { ...body, profile_hash: sha256Json(body), description: s.describe(params) };
}

/** Deterministic uniform draw in [0, 1). */
export function draw(profile, caseId, attempt) {
  return parseInt(sha256Json({ seed: profile.seed, profile: profile.profile_hash, case: caseId, attempt }).slice(0, 13), 16) / 2 ** 52;
}

/** Observed failure behaviour of the workload: retry ceiling and the cost/latency of failed attempts. */
export function observedPolicy(traces) {
  const maxAttempt = traces.length ? Math.max(...traces.map(attemptNo)) : 1;
  const kind = (t) => `${meta(t).error_type || ''} ${meta(t).error_category || ''} ${t.retry_reason || ''}`.toLowerCase();
  const failed = traces.filter((t) => meta(t).status === 'error' || meta(t).error_type || meta(t).error_category);
  const of = (re) => {
    const rows = failed.filter((t) => re.test(kind(t)));
    const costs = rows.map((t) => t.cost_usd);
    const lats = rows.map((t) => t.latency_ms);
    return { observed: rows.length, cost_usd: rows.length && costs.every(known) ? stableSum(costs) / rows.length : null, latency_ms: rows.length && lats.every(known) ? stableSum(lats) / rows.length : null };
  };
  return { max_attempts: maxAttempt, rate_limit: of(/rate.?limit|429/), timeout: of(/timeout|timed out|deadline/) };
}

const passedAll = (g) => Array.isArray(g) && g.length > 0 && g.every((r) => r.passed);

/**
 * Overlays the profile on per-case results. `cases` = [{ id, path, cost_usd,
 * latency_ms, passed, score, fallback: { cost_usd, latency_ms, passed, score } | null }].
 */
export function overlay(cases, profile, policy) {
  const p = profile.parameters;
  const out = [];
  for (const c of cases) {
    const providerBound = c.path === 'model_call' || c.path === 'baseline_passthrough';
    let cost = c.cost_usd;
    let latency = c.latency_ms;
    let ok = true;
    let passed = c.passed;
    let score = c.score;
    let attempts = providerBound ? 1 : 0;
    let fallback = false;
    if (profile.scenario === 'PROVIDER_RATE_LIMIT' || profile.scenario === 'PROVIDER_TIMEOUT') {
      if (providerBound) {
        const rl = profile.scenario === 'PROVIDER_RATE_LIMIT';
        const failCost = rl ? policy.rate_limit.cost_usd : policy.timeout.cost_usd;
        const failLatency = rl ? policy.rate_limit.latency_ms : p.timeout_ms;
        let addCost = 0;
        let addLat = 0;
        let costUnknown = false;
        let latUnknown = false;
        let success = false;
        for (let a = 1; a <= policy.max_attempts; a += 1) {
          attempts = a;
          if (draw(profile, c.id, a) >= p.rate) {
            success = true;
            break;
          }
          if (known(failCost)) addCost += failCost;
          else costUnknown = true;
          if (known(failLatency)) addLat += failLatency + (rl && a < policy.max_attempts ? p.retry_after_ms : 0);
          else latUnknown = true;
        }
        cost = costUnknown || !known(cost) ? null : (success ? Number(cost) : 0) + addCost;
        latency = latUnknown || !known(latency) ? null : (success ? Number(latency) : 0) + addLat;
        if (!success) {
          ok = false;
          passed = false;
          score = 0;
        }
      }
    } else if (profile.scenario === 'MODEL_LATENCY_MULTIPLIER') {
      if (providerBound) latency = known(latency) ? Number(latency) * p.multiplier : null;
    } else if (profile.scenario === 'CACHE_MISS') {
      if (!providerBound && draw(profile, c.id, 1) < p.rate) {
        fallback = true;
        attempts = 1;
        // The request falls through to the next path. If that path's answer was never produced
        // in the normal replay (a substituted model behind the cache), it is UNKNOWN — not $0, not a pass.
        cost = c.fallback ? c.fallback.cost_usd : null;
        latency = c.fallback ? c.fallback.latency_ms : null;
        passed = c.fallback ? c.fallback.passed : null;
        score = c.fallback ? c.fallback.score : null;
      }
    }
    out.push({ id: c.id, path: c.path, ok, passed, score, cost_usd: cost, latency_ms: latency, attempts, fallback });
  }
  return out;
}

export function summarize(rows) {
  const n = rows.length;
  const costs = rows.map((r) => r.cost_usd);
  const lats = rows.map((r) => r.latency_ms);
  const graded = rows.filter((r) => r.passed !== null && r.passed !== undefined);
  const successes = graded.filter((r) => r.passed).length;
  const cost = n && costs.every(known) ? Number(stableSum(costs).toFixed(10)) : null;
  const providerBound = rows.filter((r) => r.attempts > 0);
  return {
    cases: n,
    cost_usd: cost,
    cost_unknown_cases: costs.filter((v) => !known(v)).length,
    p95_ms: lats.every(known) ? percentile(lats, 95) : null,
    latency_unknown_cases: lats.filter((v) => !known(v)).length,
    task_success: graded.length === n && n ? successes / n : null,
    outcome_unknown_cases: n - graded.length,
    quality: rows.every((r) => known(r.score)) && n ? stableSum(rows.map((r) => r.score)) / n : null,
    failure_rate: n ? rows.filter((r) => !r.ok).length / n : null,
    retry_amplification: providerBound.length ? stableSum(providerBound.map((r) => r.attempts)) / providerBound.length : null,
    fallback_used: rows.filter((r) => r.fallback).length,
    cpso_usd: cost !== null && graded.length === n && successes ? Number((cost / successes).toFixed(10)) : null,
  };
}

/**
 * Bad-Day Replay of a plan. Inputs: the plan's full-replay evaluation (cases
 * with grades) and execution (per-case paths), the evaluation rows, the
 * workload traces (for the observed policy), the frozen contract and the profile.
 */
export function badDayReplay({ evaluation, execution, rows, traces, contract, profile, normalVerdict }) {
  const req = normalizeRequirements(contract.requirements);
  const unsupported = profile.required_capabilities.filter((c) => !HARNESS_CAPABILITIES.includes(c));
  if (unsupported.length) {
    const body = { label: BAD_DAY_LABEL, profile_hash: profile.profile_hash, verdict: 'UNSUPPORTED', unsupported };
    return { verdict: 'UNSUPPORTED', gates: [], metrics: { label: BAD_DAY_LABEL, unsupported_capabilities: unsupported, statement: `The replay harness cannot represent ${profile.scenario} (needs ${unsupported.join(', ')}). Nothing was simulated.` }, result_hash: sha256Json(body) };
  }
  const policy = observedPolicy(traces);
  const byCase = new Map((evaluation.cases || []).map((c) => [c.baseline_trace_id, c]));
  const samples = new Map((execution.sample_results || []).map((s) => [s.baseline_trace_id, s]));
  const ordered = [...rows].sort(streamOrder);
  const baselineCases = ordered.map((t) => {
    const c = byCase.get(t.id);
    return { id: t.id, path: 'baseline_passthrough', cost_usd: t.cost_usd ?? null, latency_ms: t.latency_ms ?? null, passed: c ? passedAll(c.baseline_grader) : null, score: c ? c.baseline_score : null, fallback: null };
  });
  const planCases = ordered.map((t) => {
    const c = byCase.get(t.id);
    const s = samples.get(t.id) || {};
    const hasModelBehind = (s.path === 'cache_hit' || s.path === 'lookup_hit') && s.fallback_unknown === true;
    return {
      id: t.id,
      path: s.path || 'baseline_passthrough',
      cost_usd: s.cost_usd ?? null,
      latency_ms: s.latency_ms ?? null,
      passed: c ? passedAll(c.candidate_grader) : null,
      score: c ? c.candidate_score : null,
      fallback: hasModelBehind ? null : { cost_usd: t.cost_usd ?? null, latency_ms: t.latency_ms ?? null, passed: c ? passedAll(c.baseline_grader) : null, score: c ? c.baseline_score : null },
    };
  });
  const normal = summarize(planCases.map((c) => ({ ...c, ok: true, attempts: c.path === 'model_call' || c.path === 'baseline_passthrough' ? 1 : 0, fallback: false })));
  const plan = summarize(overlay(planCases, profile, policy));
  const baseline = summarize(overlay(baselineCases, profile, policy));

  const gates = [];
  const gate = (name, required, outcome, observed, threshold, reason) => gates.push({ name, required, outcome, observed, threshold, reason, source: 'bad_day_replay' });
  if (req.min_task_success_rate !== null) {
    if (plan.task_success === null) gate('bad_day_task_success_floor', true, 'missing', plan.outcome_unknown_cases, req.min_task_success_rate, `${plan.outcome_unknown_cases} case(s) have no known outcome under this scenario (the answer behind a missed cache was never produced).`);
    else gate('bad_day_task_success_floor', true, plan.task_success >= req.min_task_success_rate ? 'passed' : 'failed', plan.task_success, req.min_task_success_rate, `task success ${plan.task_success.toFixed(3)} under ${profile.description}.`);
  }
  if (plan.quality === null) gate('bad_day_quality_floor', true, 'missing', null, req.quality_floor, 'Quality unknown for some cases under this scenario.');
  else gate('bad_day_quality_floor', true, plan.quality >= req.quality_floor ? 'passed' : 'failed', plan.quality, req.quality_floor, `quality ${plan.quality.toFixed(3)} (failed requests score 0).`);
  if (req.latency.require) {
    if (plan.p95_ms === null) gate('bad_day_latency', true, 'missing', { unknown_cases: plan.latency_unknown_cases }, null, 'Latency of failed attempts was never observed for this workload: UNKNOWN, not 0 ms.');
    else if (req.latency.max_p95_ms !== null) gate('bad_day_latency', true, plan.p95_ms <= req.latency.max_p95_ms ? 'passed' : 'failed', plan.p95_ms, req.latency.max_p95_ms, `p95 ${plan.p95_ms} ms vs budget ${req.latency.max_p95_ms} ms.`);
    else if (baseline.p95_ms === null) gate('bad_day_latency', true, 'missing', plan.p95_ms, null, 'Baseline p95 under the same scenario is unknown.');
    else {
      const limit = baseline.p95_ms * (1 + (req.latency.max_regression_pct ?? 0) / 100);
      gate('bad_day_latency', true, plan.p95_ms <= limit ? 'passed' : 'failed', { plan: plan.p95_ms, baseline: baseline.p95_ms }, limit, 'p95 must stay within the contract regression limit of the baseline under the SAME scenario.');
    }
  }
  const failLimit = req.reliability.max_failure_rate;
  if (failLimit !== null) gate('bad_day_failure_rate', true, plan.failure_rate <= failLimit ? 'passed' : 'failed', plan.failure_rate, failLimit, `${Math.round(plan.failure_rate * 100)}% of requests exhausted their attempts.`);
  else gate('bad_day_failure_rate', true, plan.failure_rate <= baseline.failure_rate + 1e-12 ? 'passed' : 'failed', { plan: plan.failure_rate, baseline: baseline.failure_rate }, baseline.failure_rate, 'No more failures than the baseline under the same scenario.');
  if (req.cost.require_evidence) gate('bad_day_cost_evidence', true, plan.cost_usd === null ? 'missing' : 'passed', { unknown_cases: plan.cost_unknown_cases }, 'known', plan.cost_usd === null ? 'Cost of failed attempts (or of a path never executed) is not observed for this workload: UNKNOWN, not $0.' : 'Cost known for every case.');
  const verdict = decideStatus(gates);
  const failed = gates.filter((g) => g.required && g.outcome === 'failed').map((g) => g.name);
  const statement =
    verdict === 'VERIFIED'
      ? `Holds under ${profile.description} on the replayed evaluation cases. A BAD-DAY REPLAY is a simulation, not a production guarantee.`
      : verdict === 'REJECTED'
        ? `${normalVerdict === 'VERIFIED' ? 'Verified for the normal evaluation workload, but not' : 'Not'} resilient under ${profile.description}: ${failed.join(', ')} failed. The normal verdict is unchanged.`
        : `Incomplete under ${profile.description}: ${gates.filter((g) => g.required && g.outcome === 'missing').map((g) => g.name).join(', ')}. The normal verdict is unchanged.`;
  const metrics = { label: BAD_DAY_LABEL, scenario: profile.scenario, description: profile.description, observed_policy: policy, normal, bad_day: plan, baseline_bad_day: baseline, statement, not_claimed: 'Simulation/replay result ≠ production guarantee.' };
  return { verdict, gates, metrics, result_hash: sha256Json({ profile_hash: profile.profile_hash, evaluation_version: evaluation.evidence_version, verdict, gates: gates.map((g) => [g.name, g.outcome]), metrics: { normal, plan, baseline } }) };
}
