/**
 * Verified Performance: what a workload's recorded evidence actually shows.
 *
 * Deterministic, computed only from evidence present. Unknown stays unknown:
 * a missing cost is not $0, a missing latency is not 0 ms, a missing task
 * outcome is neither a success nor a failure. Nothing here projects savings.
 *
 * Inputs are engine_traces rows of one product (a bounded window). Raw output
 * text is read only by the existing deterministic graders (the evaluation
 * boundary) to score quality/task success; only scores leave this module.
 */
import { sha256Json } from '../product/hashing.js';
import { defaultCases, gradeOutput } from '../product/evaluator.js';
import { normalizeRequirements } from './contract.js';

export const PERFORMANCE_VERSION = 'perf_v0.1';
export const WINDOW_LIMIT = 5000;

const known = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const meta = (t) => (t.metadata && typeof t.metadata === 'object' && !Array.isArray(t.metadata) ? t.metadata : {});
const round = (v, d = 6) => (v === null || v === undefined ? null : Number(Number(v).toFixed(d)));
const ratio = (a, b) => (b > 0 ? round(a / b, 6) : null);

/**
 * Order-independent sum: floating-point addition is not associative, so the
 * same evidence read in a different order could round differently and change
 * a hash. Values are added in ascending order.
 */
export function stableSum(values) {
  return values.map(Number).sort((a, b) => a - b).reduce((a, b) => a + b, 0);
}

/**
 * Nearest-rank percentile on ascending values: rank = ceil(p/100 · n).
 * Always an observed value (no interpolation); null for an empty set.
 */
export function percentile(values, p) {
  const xs = values.filter((v) => known(v)).map(Number).sort((a, b) => a - b);
  if (!xs.length) return null;
  const rank = Math.min(xs.length, Math.max(1, Math.ceil((p / 100) * xs.length)));
  return xs[rank - 1];
}

export function latencySummary(values, minSamples) {
  const xs = values.filter((v) => known(v)).map(Number);
  return {
    samples: xs.length,
    p50_ms: percentile(xs, 50),
    p95_ms: percentile(xs, 95),
    p99_ms: percentile(xs, 99),
    max_ms: xs.length ? Math.max(...xs) : null,
    low_evidence: xs.length < minSamples,
  };
}

// ---- per-trace signals ----------------------------------------------------------
/** Attempts of one logical request share metadata.logical_request_id; otherwise a trace is its own request. */
export const logicalKey = (t) => String(meta(t).logical_request_id || meta(t).request_group_id || t.request_id);
export const attemptNo = (t) => (Number.isInteger(Number(t.attempt)) && Number(t.attempt) > 0 ? Number(t.attempt) : 1);

const ERROR_TEXT = (t) => [meta(t).error_type, meta(t).error_category, meta(t).status === 'error' ? 'error' : null].filter(Boolean).join(' ').toLowerCase();
export function callErrored(t) {
  const m = meta(t);
  if (m.status === 'error' || m.error_type || m.error_category) return true;
  if (m.status === 'ok' || t.output_hash || t.output_text) return false;
  return null; // neither an output nor an error recorded: unknown
}
const isTimeout = (text) => /timeout|timed out|deadline/.test(text);
const isRateLimit = (text) => /rate.?limit|429|too many requests/.test(text);

/** Explicit outcome first (reported), else a deterministic grade against expected_output, else unknown. */
function outcomeOf(t, graded) {
  const m = meta(t);
  if (typeof m.task_success === 'boolean') return { success: m.task_success, source: 'reported' };
  if (m.outcome === 'success') return { success: true, source: 'reported' };
  if (['failure', 'failed', 'error'].includes(m.outcome)) return { success: false, source: 'reported' };
  if (graded) return { success: graded.passed, source: 'graded_against_expected_output' };
  return { success: null, source: null };
}

function gradeBaseline(traces) {
  const withExpected = traces.filter((t) => t.expected_output !== null && t.expected_output !== undefined && t.expected_output !== '' && t.output_text !== null && t.output_text !== undefined);
  const byTrace = new Map(withExpected.map((t) => [t.id, t]));
  const cases = defaultCases(withExpected.map((t) => ({ baseline_trace_id: t.id })), byTrace);
  const out = new Map();
  for (const c of cases) {
    const t = byTrace.get(c.baseline_trace_id);
    const g = gradeOutput(t.output_text, c.expected, c.graders);
    if (g.score !== null) out.set(t.id, { score: g.score, passed: g.passed });
  }
  return out;
}

const costBasis = (sources) => {
  const s = new Set(sources);
  if (!s.size) return null;
  const estimated = s.has('pricing_snapshot_estimate');
  const observed = [...s].some((x) => x !== 'pricing_snapshot_estimate');
  return estimated && observed ? 'mixed' : estimated ? 'estimated' : 'observed';
};

/**
 * The Verified Performance Snapshot of a bounded trace window.
 * `graphs` is the ZevIR graph set summary ({ hashes, count, truncated }).
 */
export function performanceSnapshot(traces, requirements, { graphs = null, truncated = false, contractHash = null } = {}) {
  const req = normalizeRequirements(requirements);
  const graded = gradeBaseline(traces);

  // Logical requests and their attempts.
  const groups = new Map();
  for (const t of traces) {
    const k = logicalKey(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const requests = [...groups.entries()].map(([key, rows]) => {
    const sorted = [...rows].sort((a, b) => attemptNo(a) - attemptNo(b) || String(a.request_id).localeCompare(String(b.request_id)));
    const final = sorted[sorted.length - 1];
    const executed = Math.max(sorted.length, attemptNo(final));
    const costKnown = sorted.every((r) => known(r.cost_usd)) && executed === sorted.length;
    const latKnown = sorted.every((r) => known(r.latency_ms)) && executed === sorted.length;
    return {
      key,
      rows: sorted,
      final,
      executed,
      recorded: sorted.length,
      cost: costKnown ? stableSum(sorted.map((r) => r.cost_usd)) : null,
      latency: latKnown ? stableSum(sorted.map((r) => r.latency_ms)) : null,
      outcome: outcomeOf(final, graded.get(final.id)),
      errored: callErrored(final),
      protected: sorted.some((r) => r.protected),
    };
  });

  const n = requests.length;
  const executedAttempts = requests.reduce((a, r) => a + r.executed, 0);
  const pricedRows = traces.filter((t) => known(t.cost_usd));
  const totalKnownCost = pricedRows.length ? round(stableSum(pricedRows.map((t) => t.cost_usd)), 10) : null;
  const costCoverage = ratio(pricedRows.length, executedAttempts);
  const nonFinal = requests.flatMap((r) => r.rows.slice(0, -1));
  const wastedKnown = nonFinal.filter((t) => known(t.cost_usd));
  const unsuccessfulKnown = requests.filter((r) => r.outcome.success === false || r.errored === true).flatMap((r) => r.rows).filter((t) => known(t.cost_usd));

  // Cost per logical request: only over requests whose every attempt is priced.
  const costedRequests = requests.filter((r) => r.cost !== null);
  const reqCoverage = ratio(costedRequests.length, n);
  const costPerRequest = n && reqCoverage !== null && reqCoverage >= req.cost.min_coverage && costedRequests.length ? round(stableSum(costedRequests.map((r) => r.cost)) / costedRequests.length, 10) : null;

  // Cost per successful outcome. Population: requests with a known outcome AND a
  // fully priced set of attempts. Unknown outcomes never enter the denominator.
  const outcomeKnown = requests.filter((r) => r.outcome.success !== null);
  const population = outcomeKnown.filter((r) => r.cost !== null);
  const successes = population.filter((r) => r.outcome.success === true);
  const numeratorCoverage = ratio(population.length, outcomeKnown.length);
  const denominatorCoverage = ratio(outcomeKnown.length, n);
  const cpsoReasons = [];
  if (!n) cpsoReasons.push('no logical requests in the window');
  if (denominatorCoverage === null || denominatorCoverage < req.evidence.min_outcome_coverage) cpsoReasons.push(`task outcome known for ${outcomeKnown.length} of ${n} requests (${pct(denominatorCoverage)}); contract requires ${pct(req.evidence.min_outcome_coverage)}`);
  if (outcomeKnown.length && (numeratorCoverage === null || numeratorCoverage < req.cost.min_coverage)) cpsoReasons.push(`cost fully known for ${population.length} of ${outcomeKnown.length} requests with a known outcome (${pct(numeratorCoverage)}); contract requires ${pct(req.cost.min_coverage)}`);
  if (population.length && !successes.length) cpsoReasons.push('zero successful outcomes: cost per successful outcome is undefined, not zero');
  const cpso = cpsoReasons.length ? null : round(stableSum(population.map((r) => r.cost)) / successes.length, 10);

  const attemptLatency = latencySummary(traces.map((t) => t.latency_ms), req.evidence.min_latency_samples);
  const requestLatency = latencySummary(requests.map((r) => r.latency), req.evidence.min_latency_samples);
  const ttft = latencySummary(traces.map((t) => t.ttft_ms), req.evidence.min_latency_samples);

  const gradedScores = [...graded.values()].map((g) => g.score);
  const reportedQuality = traces.map((t) => meta(t).quality_score).filter((v) => known(v) && v >= 0 && v <= 1).map(Number);
  const qualityValues = gradedScores.length ? gradedScores : reportedQuality;
  const qualitySource = gradedScores.length ? 'graded_against_expected_output' : reportedQuality.length ? 'reported' : null;
  const succeeded = outcomeKnown.filter((r) => r.outcome.success).length;
  const outcomeSources = [...new Set(outcomeKnown.map((r) => r.outcome.source))].sort();
  const protectedReqs = requests.filter((r) => r.protected);
  const protectedKnown = protectedReqs.filter((r) => r.outcome.success !== null);

  // Reliability = execution failures (the final attempt errored), not task failures:
  // a wrong answer is a task-success fact, reported under quality.
  const errorKnown = requests.filter((r) => r.errored !== null);
  const failures = requests.filter((r) => r.errored === true);
  const retried = requests.filter((r) => r.executed > 1);
  // One classified event per failed attempt: its own error, or — when that attempt
  // was not recorded — the retry_reason of the attempt that followed it.
  const classified = [];
  for (const r of requests) {
    const recordedAttempts = new Set(r.rows.map(attemptNo));
    for (const t of r.rows) {
      const own = ERROR_TEXT(t);
      if (own) classified.push(own);
      if (t.retry_reason && attemptNo(t) > 1 && !recordedAttempts.has(attemptNo(t) - 1)) classified.push(String(t.retry_reason).toLowerCase());
    }
  }
  const anyErrorOrRetry = failures.length > 0 || retried.length > 0;
  const fallbackObserved = traces.some((t) => 'fallback' in meta(t) || 'fallback_used' in meta(t));
  const retryLatency = nonFinal.filter((t) => known(t.latency_ms));

  // Bad-day profile: what the worst observed requests looked like (historical, not simulated).
  const costliest = costedRequests.slice().sort((a, b) => b.cost - a.cost || a.key.localeCompare(b.key)).slice(0, 5).map((r) => ({ logical_request: r.key, cost_usd: round(r.cost, 10), attempts: r.executed }));
  const slowest = requests.filter((r) => r.latency !== null).sort((a, b) => b.latency - a.latency || a.key.localeCompare(b.key)).slice(0, 5).map((r) => ({ logical_request: r.key, latency_ms: r.latency, attempts: r.executed }));

  const coverage = {
    cost: costCoverage,
    latency: ratio(attemptLatency.samples, traces.length),
    task_success: denominatorCoverage,
    quality: ratio(qualityValues.length, traces.length),
    reliability: ratio(errorKnown.length, n),
    protected: protectedReqs.length ? ratio(protectedKnown.length, protectedReqs.length) : null,
  };
  const missing = [];
  const need = new Set(req.required_metrics);
  if (!n) missing.push('no traces in the evidence window');
  if (need.has('cost') && (costCoverage === null || costCoverage < req.cost.min_coverage)) missing.push(`cost: coverage ${pct(costCoverage)} < required ${pct(req.cost.min_coverage)}`);
  if (need.has('latency') && attemptLatency.samples < req.evidence.min_latency_samples) missing.push(`latency: ${attemptLatency.samples} samples < required ${req.evidence.min_latency_samples}`);
  if (need.has('task_success') && (denominatorCoverage === null || denominatorCoverage < req.evidence.min_outcome_coverage)) missing.push(`task_success: outcome known for ${pct(denominatorCoverage)} < required ${pct(req.evidence.min_outcome_coverage)}`);
  if (need.has('quality') && !qualityValues.length) missing.push('quality: no graded or reported quality evidence');
  if (need.has('reliability') && !errorKnown.length) missing.push('reliability: no request records an output or an error');
  if (need.has('protected') && protectedReqs.length < Math.max(1, req.protected.min_cases)) missing.push(`protected: ${protectedReqs.length} protected requests < required ${Math.max(1, req.protected.min_cases)}`);
  if (truncated) missing.push(`window: newest ${WINDOW_LIMIT} traces only; older evidence not included`);

  const snapshot = {
    version: PERFORMANCE_VERSION,
    samples: { logical_requests: n, recorded_attempts: traces.length, executed_attempts: executedAttempts, protected_samples: protectedReqs.length },
    economics: {
      total_known_cost_usd: totalKnownCost,
      known_cost_count: pricedRows.length,
      cost_coverage: costCoverage,
      cost_basis: costBasis(pricedRows.map((t) => t.cost_source || 'imported_external')),
      wasted_attempt_known_cost_usd: wastedKnown.length ? round(stableSum(wastedKnown.map((t) => t.cost_usd)), 10) : null,
      unsuccessful_request_known_cost_usd: unsuccessfulKnown.length ? round(stableSum(unsuccessfulKnown.map((t) => t.cost_usd)), 10) : null,
      cost_per_logical_request_usd: costPerRequest,
      cost_per_logical_request_coverage: reqCoverage,
      cost_per_successful_outcome_usd: cpso,
      cpso: { value_usd: cpso, numerator_coverage: numeratorCoverage, denominator_coverage: denominatorCoverage, successful_outcomes: successes.length, population: population.length, unavailable_reasons: cpsoReasons },
    },
    latency: { request: requestLatency, attempt: attemptLatency, ttft },
    quality: {
      score: qualityValues.length ? round(stableSum(qualityValues) / qualityValues.length, 6) : null,
      samples: qualityValues.length,
      source: qualitySource,
      task_success: { known: outcomeKnown.length, succeeded, rate: ratio(succeeded, outcomeKnown.length), unknown: n - outcomeKnown.length, sources: outcomeSources },
      protected: { requests: protectedReqs.length, outcome_known: protectedKnown.length, failed: protectedKnown.filter((r) => !r.outcome.success).length },
    },
    reliability: {
      failure_count: failures.length,
      failure_rate: ratio(failures.length, errorKnown.length),
      retry_count: executedAttempts - n,
      retry_rate: ratio(retried.length, n),
      retry_amplification: ratio(executedAttempts, n),
      retried_requests: retried.length,
      retry_latency_ms: retryLatency.length ? stableSum(retryLatency.map((t) => t.latency_ms)) : null,
      timeout_count: anyErrorOrRetry && !classified.length ? null : classified.filter(isTimeout).length,
      rate_limit_count: anyErrorOrRetry && !classified.length ? null : classified.filter(isRateLimit).length,
      fallback_count: fallbackObserved ? traces.filter((t) => meta(t).fallback === true || meta(t).fallback_used === true).length : null,
    },
    bad_day: {
      p99_request_latency_ms: requestLatency.p99_ms,
      max_request_latency_ms: requestLatency.max_ms,
      worst_retry_amplification: n ? Math.max(...requests.map((r) => r.executed)) : null,
      costliest_requests: costliest,
      slowest_requests: slowest,
      note: 'Observed history only. Not a simulation or fault-injection result.',
    },
    evidence: {
      coverage,
      required_metrics: req.required_metrics,
      completeness: missing.length ? 'incomplete' : 'complete',
      missing,
      contract_hash: contractHash,
      graph_count: graphs?.count ?? 0,
      graph_set_hash: graphs?.hashes?.length ? sha256Json([...graphs.hashes].sort()) : null,
      graphs_truncated: Boolean(graphs?.truncated),
      window_truncated: Boolean(truncated),
    },
  };
  return { ...snapshot, snapshot_hash: sha256Json(snapshot) };
}

function pct(v) {
  return v === null || v === undefined ? 'unknown' : `${Math.round(v * 1000) / 10}%`;
}
