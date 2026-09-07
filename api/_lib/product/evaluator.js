/**
 * Deterministic evaluation: graders, gates and the verdict. No LLM judge.
 * Ported from the desktop engine (evals_v1 / gates_v1) including the label
 * dedupe fix, so both surfaces reach the same PASS/FAIL on the same evidence.
 */
import { sha256Json, sha256Text } from './hashing.js';
import { taskFingerprint } from './fingerprints.js';

export const EVALUATION_VERSION = 'evals_v1';
export const GATE_SYSTEM_VERSION = 'gates_v1';
export const DEFAULT_CLASSIFICATION_LABELS = ['billing', 'technical', 'account'];

export const DEFAULT_GATE_CONFIG = { min_samples: 5, quality_floor: 0.95, non_inferiority_tolerance: 0, require_cost_improvement: true, min_cost_improvement_pct: 0, require_latency: true, max_latency_regression_pct: 20, require_fallback: true, require_protected_cases: false, latency_informational: false, aggregation: 'mean' };

export function normalizeGateConfig(raw = {}) {
  const cfg = { ...DEFAULT_GATE_CONFIG };
  const num = (k, min, max) => {
    if (raw[k] === undefined || raw[k] === null) return;
    const n = Number(raw[k]);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${k} must be between ${min} and ${max}.`);
    cfg[k] = n;
  };
  num('min_samples', 1, 100000);
  cfg.min_samples = Math.floor(cfg.min_samples);
  num('quality_floor', 0.000001, 1);
  num('non_inferiority_tolerance', 0, 1);
  num('min_cost_improvement_pct', 0, 100);
  num('max_latency_regression_pct', 0, 10000);
  for (const k of ['require_cost_improvement', 'require_latency', 'require_fallback', 'require_protected_cases', 'latency_informational']) if (raw[k] !== undefined) cfg[k] = Boolean(raw[k]);
  return cfg;
}

// ---- graders ----------------------------------------------------------------
function parseJsonish(text) {
  if (text === null || text === undefined) return null;
  const s = String(text).trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function canonicalJson(value) {
  return sha256Json(value);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function gradeExactMatch(actual, expected, cfg = {}) {
  const trim = cfg.trim !== false;
  const ci = Boolean(cfg.case_insensitive);
  if (actual === null || actual === undefined) return { grader: 'exact_match', version: '1.0.0', score: 0, passed: false, details: { error: 'actual_missing' } };
  if (cfg.mode === 'json') {
    const left = parseJsonish(actual);
    const right = typeof expected === 'string' ? parseJsonish(expected) : expected;
    if (left === null || right === null || right === undefined) return { grader: 'exact_match', version: '1.0.0', score: 0, passed: false, details: { error: 'json_parse_failed' } };
    const ok = canonicalJson(left) === canonicalJson(right);
    return { grader: 'exact_match', version: '1.0.0', score: ok ? 1 : 0, passed: ok, details: { mode: 'json' } };
  }
  let l = String(actual);
  let r = String(expected ?? '');
  if (trim) {
    l = l.trim();
    r = r.trim();
  }
  if (ci) {
    l = l.toLowerCase();
    r = r.toLowerCase();
  }
  const ok = l === r;
  return { grader: 'exact_match', version: '1.0.0', score: ok ? 1 : 0, passed: ok, details: { mode: 'text', trim, case_insensitive: ci } };
}

export function gradeClassification(actual, expected, cfg = {}) {
  const labels = [...new Set((cfg.labels || []).map(String))];
  const expectedLabel = String(cfg.expected_label || expected || '');
  const strict = cfg.strict !== false;
  const fail = (details) => ({ grader: 'classification', version: '1.0.0', score: 0, passed: false, details });
  if (actual === null || actual === undefined) return fail({ error: 'actual_missing' });
  const text = String(actual).trim();
  const pool = labels.length ? labels : expectedLabel ? [expectedLabel] : [];
  if (!pool.length || !expectedLabel) return fail({ error: 'labels_or_expected_missing' });
  let predicted;
  if (strict) {
    const normalized = text.toLowerCase();
    const hits = pool.filter((lab) => lab.toLowerCase() === normalized);
    if (hits.length !== 1) {
      const wordHits = pool.filter((lab) => new RegExp(`\\b${escapeRe(lab)}\\b`, 'i').test(text));
      if (wordHits.length > 1 || (wordHits.length === 1 && normalized !== wordHits[0].toLowerCase())) return fail({ error: 'ambiguous_or_nonexact', hits: wordHits });
      return fail({ error: 'no_exact_label', actual: text.slice(0, 200) });
    }
    predicted = hits[0];
  } else {
    const wordHits = pool.filter((lab) => new RegExp(`\\b${escapeRe(lab)}\\b`, 'i').test(text));
    if (wordHits.length !== 1) return fail({ error: 'ambiguous', hits: wordHits });
    predicted = wordHits[0];
  }
  const ok = predicted.toLowerCase() === expectedLabel.toLowerCase();
  return { grader: 'classification', version: '1.0.0', score: ok ? 1 : 0, passed: ok, details: { predicted, expected: expectedLabel, strict } };
}

export function gradeRequiredFacts(actual, expected, cfg = {}) {
  const raw = cfg.facts || expected || [];
  const facts = Array.isArray(raw) ? raw : [raw];
  const forbidden = cfg.forbidden_phrases || [];
  if (actual === null || actual === undefined) return { grader: 'required_facts', version: '1.1.0', score: 0, passed: false, details: { error: 'actual_missing' } };
  const hay = String(actual).toLowerCase();
  const violations = forbidden.filter((p) => hay.includes(String(p).toLowerCase()));
  if (violations.length) return { grader: 'required_facts', version: '1.1.0', score: 0, passed: false, details: { forbidden_found: violations } };
  const found = facts.filter((f) => hay.includes(String(f).toLowerCase()));
  const missing = facts.filter((f) => !hay.includes(String(f).toLowerCase()));
  return { grader: 'required_facts', version: '1.1.0', score: facts.length ? found.length / facts.length : 1, passed: !missing.length, details: { found, missing } };
}

export function gradeOutput(actual, expected, specs) {
  if (!specs?.length) return { score: null, results: [], passed: false };
  const results = specs.map((spec) => {
    const cfg = { ...(spec.config || {}) };
    if (spec.name === 'classification' && cfg.expected_label === undefined && expected !== null && expected !== undefined) cfg.expected_label = expected;
    if (spec.name === 'classification') return gradeClassification(actual, expected, cfg);
    if (spec.name === 'required_facts') return gradeRequiredFacts(actual, expected, cfg);
    return gradeExactMatch(actual, expected, cfg);
  });
  return { score: results.reduce((a, r) => a + r.score, 0) / results.length, results, passed: results.every((r) => r.passed) };
}

// ---- cases ------------------------------------------------------------------
function isLabel(value) {
  return typeof value === 'string' && Boolean(value.trim()) && !value.trim().includes('\n') && value.trim().length <= 80;
}

export function labelPool(samples, byTrace) {
  const pool = new Map();
  for (const s of samples) {
    const t = byTrace.get(s.baseline_trace_id);
    const expected = (t && t.expected_output) || s.expected_output;
    if (isLabel(expected)) pool.set(String(expected).trim(), true);
  }
  return pool.size ? [...pool.keys()] : [...DEFAULT_CLASSIFICATION_LABELS];
}

export function defaultCases(samples, byTrace) {
  const pool = labelPool(samples, byTrace);
  const cases = [];
  for (const s of samples) {
    if (!s.baseline_trace_id) continue;
    const t = byTrace.get(s.baseline_trace_id);
    const expected = (t && t.expected_output) || s.expected_output || null;
    let graders = [{ name: 'classification', version: null, config: { labels: [...pool], strict: true } }];
    if (isLabel(expected)) {
      const label = String(expected).trim();
      graders = [{ name: 'classification', version: null, config: { labels: [...new Set([...pool, label])], expected_label: label, strict: true } }];
    } else if (expected !== null && expected !== undefined) {
      graders = [{ name: 'exact_match', version: null, config: { trim: true, mode: 'text' } }];
    }
    cases.push({ case_id: `case:${s.baseline_trace_id}`, baseline_trace_id: s.baseline_trace_id, candidate_sample_baseline_trace_id: s.baseline_trace_id, protected: Boolean(t?.protected), graders, expected, weight: 1, metadata: { auto: true } });
  }
  return cases;
}

// ---- gates ------------------------------------------------------------------
export function evaluateGates(cfg, m) {
  const gates = [];
  gates.push({ name: 'evidence_completeness', required: true, outcome: m.evidenceComplete ? 'passed' : 'missing', observed: { complete: m.evidenceComplete, missing: m.missingReasons }, threshold: 'all_required_present', reason: m.evidenceComplete ? 'All required evaluation evidence present.' : m.missingReasons.join('; ') || 'Missing evidence.' });
  const sampleOk = m.sampleCount >= cfg.min_samples;
  gates.push({ name: 'minimum_samples', required: true, outcome: sampleOk ? 'passed' : 'missing', observed: m.sampleCount, threshold: cfg.min_samples, reason: `sample_count=${m.sampleCount}; minimum=${cfg.min_samples}.` });
  if (m.candidateQuality === null) gates.push({ name: 'quality_floor', required: true, outcome: 'missing', observed: null, threshold: cfg.quality_floor, reason: 'Candidate quality unavailable.' });
  else gates.push({ name: 'quality_floor', required: true, outcome: m.candidateQuality >= cfg.quality_floor ? 'passed' : 'failed', observed: m.candidateQuality, threshold: cfg.quality_floor, reason: `candidate_quality=${m.candidateQuality}; floor=${cfg.quality_floor}.` });
  if (m.baselineQuality === null || m.candidateQuality === null) gates.push({ name: 'non_inferiority', required: true, outcome: 'missing', observed: { baseline: m.baselineQuality, candidate: m.candidateQuality }, threshold: cfg.non_inferiority_tolerance, reason: 'Baseline or candidate quality missing.' });
  else {
    const limit = m.baselineQuality - cfg.non_inferiority_tolerance;
    gates.push({ name: 'non_inferiority', required: true, outcome: m.candidateQuality >= limit ? 'passed' : 'failed', observed: { baseline: m.baselineQuality, candidate: m.candidateQuality, delta: m.candidateQuality - m.baselineQuality, tolerance: cfg.non_inferiority_tolerance }, threshold: limit, reason: `candidate_quality >= baseline_quality - tolerance (${limit}).` });
  }
  if (m.protectedCount === 0 && cfg.require_protected_cases) gates.push({ name: 'protected_slice', required: true, outcome: 'missing', observed: { protected_count: 0, failures: 0 }, threshold: 0, reason: 'Protected coverage required but no protected cases were evaluated.' });
  else if (m.protectedCount === 0) gates.push({ name: 'protected_slice', required: false, outcome: 'informational', observed: { protected_count: 0, failures: 0 }, threshold: 0, reason: 'No protected cases were evaluated; this gate asserted nothing.' });
  else gates.push({ name: 'protected_slice', required: true, outcome: m.protectedFailures === 0 ? 'passed' : 'failed', observed: { protected_count: m.protectedCount, failures: m.protectedFailures }, threshold: 0, reason: 'Every protected case must pass; one failure rejects.' });
  if (!cfg.require_cost_improvement) gates.push({ name: 'cost_improvement', required: false, outcome: 'informational', observed: { baseline: m.baselineCost, candidate: m.candidateCost }, threshold: null, reason: 'Cost gate not required by configuration.' });
  else if (m.baselineCost === null || m.candidateCost === null) gates.push({ name: 'cost_improvement', required: true, outcome: 'missing', observed: { baseline: m.baselineCost, candidate: m.candidateCost }, threshold: '< baseline', reason: 'Cost evidence missing on one or both sides (unknown != 0).' });
  else {
    const cheaper = m.candidateCost < m.baselineCost;
    const pct = m.baselineCost ? ((m.baselineCost - m.candidateCost) / m.baselineCost) * 100 : null;
    const pctOk = cfg.min_cost_improvement_pct <= 0 ? true : pct !== null && pct >= cfg.min_cost_improvement_pct;
    gates.push({ name: 'cost_improvement', required: true, outcome: cheaper && pctOk ? 'passed' : 'failed', observed: { baseline: m.baselineCost, candidate: m.candidateCost, pct }, threshold: { strict_less: true, min_pct: cfg.min_cost_improvement_pct }, reason: 'Candidate total cost must be lower than baseline.' });
  }
  if (cfg.latency_informational && !cfg.require_latency) gates.push({ name: 'latency_regression', required: false, outcome: 'informational', observed: { baseline: m.baselineLatency, candidate: m.candidateLatency }, threshold: cfg.max_latency_regression_pct, reason: 'Latency informational; values missing.' });
  else if (!cfg.require_latency) gates.push({ name: 'latency_regression', required: false, outcome: 'informational', observed: { baseline: m.baselineLatency, candidate: m.candidateLatency }, threshold: cfg.max_latency_regression_pct, reason: 'Latency gate not required.' });
  else if (m.baselineLatency === null || m.candidateLatency === null) gates.push({ name: 'latency_regression', required: true, outcome: 'missing', observed: { baseline: m.baselineLatency, candidate: m.candidateLatency }, threshold: cfg.max_latency_regression_pct, reason: 'Required latency evidence missing.' });
  else {
    const limit = m.baselineLatency * (1 + cfg.max_latency_regression_pct / 100);
    gates.push({ name: 'latency_regression', required: true, outcome: m.candidateLatency <= limit ? 'passed' : 'failed', observed: { baseline: m.baselineLatency, candidate: m.candidateLatency, limit }, threshold: limit, reason: `candidate_latency <= baseline * (1 + ${cfg.max_latency_regression_pct}/100).` });
  }
  if (!cfg.require_fallback) gates.push({ name: 'fallback', required: false, outcome: 'informational', observed: { fallback_configured: m.fallbackConfigured, fallback_exercised: false }, threshold: true, reason: 'Fallback gate not required.' });
  else gates.push({ name: 'fallback', required: true, outcome: m.fallbackConfigured ? 'passed' : 'missing', observed: { fallback_configured: m.fallbackConfigured, fallback_exercised: false }, threshold: true, reason: 'Plan must define usable fallback metadata (not runtime-exercised proof).' });
  const execOk = m.executionSucceeded && m.executionProven && m.caseErrors === 0;
  gates.push({ name: 'execution_success', required: true, outcome: execOk ? 'passed' : 'failed', observed: { execution_succeeded: m.executionSucceeded, execution_proven: m.executionProven, case_errors: m.caseErrors }, threshold: { execution_succeeded: true, execution_proven: true, case_errors: 0 }, reason: 'Required candidate samples must succeed with execution-proven evidence.' });
  return gates;
}

export function decideStatus(gates) {
  const required = gates.filter((g) => g.required);
  if (required.some((g) => g.outcome === 'missing')) return 'INCOMPLETE';
  if (required.some((g) => g.outcome === 'failed')) return 'REJECTED';
  return 'VERIFIED';
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/**
 * Grade baseline + candidate, apply gates, return the evaluation record fields
 * and per-case results. Pure: callers persist.
 */
export function runEvaluation({ execution, plan, traces, gateConfig, cases }) {
  const cfg = normalizeGateConfig(gateConfig || {});
  const byTrace = new Map(traces.map((t) => [t.id, t]));
  const samples = Array.isArray(execution.sample_results) ? execution.sample_results : [];
  const sampleByBaseline = new Map(samples.filter((s) => s.baseline_trace_id).map((s) => [s.baseline_trace_id, s]));
  const specs = cases?.length ? cases : defaultCases(samples, byTrace);
  if (!specs.length) throw new Error('No evaluation cases available for this execution.');
  const seenIds = new Set();
  const seenBindings = new Set();
  for (const spec of specs) {
    if (seenIds.has(spec.case_id)) throw new Error(`Duplicate evaluation case_id ${spec.case_id}; each case must be distinct.`);
    seenIds.add(spec.case_id);
    const binding = spec.candidate_sample_baseline_trace_id || spec.baseline_trace_id;
    if (seenBindings.has(binding)) throw new Error(`Evaluation case ${spec.case_id} reuses candidate sample ${binding}.`);
    seenBindings.add(binding);
    if (!spec.graders?.length) throw new Error(`Evaluation case ${spec.case_id} declares no graders.`);
  }

  const missingReasons = [];
  let caseErrors = 0;
  let protectedCount = 0;
  let protectedFailures = 0;
  const baselineScores = [];
  const candidateScores = [];
  const weights = [];
  const caseRows = [];
  const digests = [];

  for (const spec of specs) {
    const baseline = byTrace.get(spec.baseline_trace_id);
    if (!baseline) {
      missingReasons.push(`baseline_missing:${spec.case_id}`);
      caseErrors += 1;
      continue;
    }
    const sample = sampleByBaseline.get(spec.candidate_sample_baseline_trace_id || spec.baseline_trace_id) || null;
    if (!sample) {
      missingReasons.push(`candidate_sample_missing:${spec.case_id}`);
      caseErrors += 1;
      continue;
    }
    if (!sample.execution_proven) {
      missingReasons.push(`candidate_not_execution_proven:${spec.case_id}`);
      caseErrors += 1;
    }
    if (sample.status !== 'succeeded') caseErrors += 1;
    const b = gradeOutput(baseline.output_text, spec.expected, spec.graders);
    const c = gradeOutput(sample.output_text ?? null, spec.expected, spec.graders);
    if (spec.protected) {
      protectedCount += 1;
      if (!c.passed) protectedFailures += 1;
    }
    if (b.score !== null) baselineScores.push(b.score);
    if (c.score !== null) {
      candidateScores.push(c.score);
      weights.push(Number(spec.weight) > 0 ? Number(spec.weight) : 1);
    }
    const taskFp = sample.task_fingerprint || taskFingerprint(baseline);
    const prov = sha256Json({ case_id: spec.case_id, baseline_trace_id: baseline.id, task_fingerprint: taskFp, baseline_output_hash: baseline.output_hash || sha256Text(baseline.output_text), candidate_output_hash: sample.output_hash ?? null, graders: spec.graders, baseline_score: b.score, candidate_score: c.score });
    digests.push({ case_id: spec.case_id, task_fingerprint: taskFp, baseline_score: b.score, candidate_score: c.score, case_provenance_hash: prov });
    caseRows.push({
      case_id: spec.case_id,
      baseline_trace_id: baseline.id,
      task_fingerprint: taskFp,
      protected: Boolean(spec.protected),
      graders: spec.graders,
      expected: spec.expected ?? null,
      baseline_output: baseline.output_text ?? null,
      candidate_output: sample.output_text ?? null,
      baseline_output_hash: baseline.output_hash || sha256Text(baseline.output_text),
      candidate_output_hash: sample.output_hash ?? null,
      baseline_score: b.score,
      candidate_score: c.score,
      baseline_grader: b.results,
      candidate_grader: c.results,
      baseline_cost_usd: baseline.cost_usd ?? null,
      candidate_cost_usd: sample.cost_usd ?? null,
      baseline_cost_source: baseline.cost_source ?? null,
      candidate_cost_source: sample.cost_source ?? null,
      baseline_latency_ms: baseline.latency_ms ?? null,
      candidate_latency_ms: sample.latency_ms ?? null,
      error_detail: sample.error_detail ?? null,
      case_provenance_hash: prov,
    });
  }

  const totalW = weights.reduce((a, b) => a + b, 0);
  const candidateQuality = candidateScores.length ? (candidateScores.length === weights.length && totalW > 0 ? candidateScores.reduce((a, s, i) => a + s * weights[i], 0) / totalW : mean(candidateScores)) : null;
  const baselineQuality = mean(baselineScores);
  const bCosts = caseRows.map((r) => r.baseline_cost_usd).filter((v) => v !== null);
  const cCosts = caseRows.map((r) => r.candidate_cost_usd).filter((v) => v !== null);
  const bLats = caseRows.map((r) => r.baseline_latency_ms).filter((v) => v !== null);
  const cLats = caseRows.map((r) => r.candidate_latency_ms).filter((v) => v !== null);
  const baselineCost = bCosts.length ? bCosts.reduce((a, b) => a + b, 0) : null;
  let candidateCost = execution.cost_usd !== null && execution.cost_usd !== undefined ? Number(execution.cost_usd) : cCosts.length ? cCosts.reduce((a, b) => a + b, 0) : null;
  if (candidateCost === null && cCosts.length && cCosts.length === caseRows.length) candidateCost = cCosts.reduce((a, b) => a + b, 0);
  const specIds = new Set(specs.map((c) => c.baseline_trace_id));
  const evidenceComplete = execution.status === 'SUCCEEDED' && Boolean(execution.provenance_hash) && samples.filter((s) => specIds.has(s.baseline_trace_id)).every((s) => s.execution_proven) && !missingReasons.some((r) => r.startsWith('baseline_missing') || r.startsWith('candidate_sample_missing')) && caseRows.length === specs.length;
  if (!evidenceComplete && !missingReasons.length) missingReasons.push('evidence_incomplete');
  const executionProven = samples.length ? samples.every((s) => Boolean(s.execution_proven)) : false;

  const gates = evaluateGates(cfg, {
    evidenceComplete,
    missingReasons,
    sampleCount: candidateScores.length,
    protectedCount,
    protectedFailures,
    baselineQuality,
    candidateQuality,
    baselineCost,
    candidateCost,
    baselineLatency: mean(bLats),
    candidateLatency: cLats.length ? mean(cLats) : execution.latency_ms ?? null,
    fallbackConfigured: Boolean((plan?.fallback || '').trim()),
    executionSucceeded: execution.status === 'SUCCEEDED',
    executionProven,
    caseErrors,
  });
  const status = decideStatus(gates);
  const rawDelta = baselineCost !== null && candidateCost !== null ? candidateCost - baselineCost : null;
  const rawPct = baselineCost !== null && candidateCost !== null && baselineCost ? ((baselineCost - candidateCost) / baselineCost) * 100 : null;
  const graderConfigHash = sha256Json(specs.map((c) => ({ case_id: c.case_id, graders: c.graders })));
  const gateConfigHash = sha256Json(cfg);
  const baselineEvidence = plan?.baseline_config?.baseline_evidence_hash || '';
  const evidenceVersion = sha256Json({ evaluation_version: EVALUATION_VERSION, gate_system_version: GATE_SYSTEM_VERSION, candidate_execution_provenance: execution.provenance_hash || '', baseline_evidence_hash: baselineEvidence, cases: specs.map((c) => ({ case_id: c.case_id, baseline_trace_id: c.baseline_trace_id, protected: Boolean(c.protected), graders: c.graders, expected: c.expected ?? null, weight: c.weight ?? 1 })), gate_config: cfg, aggregation: cfg.aggregation, case_results: digests });
  let rejectionReason = null;
  if (status === 'INCOMPLETE') rejectionReason = missingReasons.join('; ') || 'Incomplete required evidence.';
  else if (status === 'REJECTED') rejectionReason = 'Failed gates: ' + gates.filter((g) => g.required && g.outcome === 'failed').map((g) => g.name).join(', ');

  return {
    status,
    evaluation_version: EVALUATION_VERSION,
    sample_count: candidateScores.length,
    protected_sample_count: protectedCount,
    baseline_quality: baselineQuality,
    candidate_quality: candidateQuality,
    quality_delta: baselineQuality !== null && candidateQuality !== null ? candidateQuality - baselineQuality : null,
    baseline_cost_usd: baselineCost,
    candidate_cost_usd: candidateCost,
    raw_cost_delta_usd: rawDelta,
    raw_cost_delta_percent: rawPct,
    baseline_latency_ms: mean(bLats),
    candidate_latency_ms: cLats.length ? mean(cLats) : execution.latency_ms ?? null,
    evidence_completeness: evidenceComplete,
    verification_source: 'EXECUTION_EVALUATION',
    execution_proven: executionProven,
    evidence_version: evidenceVersion,
    gates,
    cases: caseRows,
    rejection_reason: rejectionReason,
    grader_config_hash: graderConfigHash,
    gate_config_hash: gateConfigHash,
    gate_config: cfg,
    completed_at: new Date().toISOString(),
  };
}
