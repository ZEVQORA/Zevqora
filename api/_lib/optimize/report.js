/**
 * Optimization Run report: one read model, two audiences.
 *
 * Vocabulary (used verbatim in the UI):
 *   Observed  — read from recorded workload evidence
 *   Measured  — produced by ZEVQORA during a replay
 *   Evaluated — compared under the frozen contract on replayed cases
 *   Verified  — evaluated AND every required contract gate passed
 *   Projected — an expectation; never evidence
 *   Realized  — measured in production after a change shipped (never in Part 2A)
 *
 * The report never contains raw prompts or outputs: evaluation cases are
 * reduced to ids, flags and scores.
 */
import { contractOut } from './store.js';

const caseOut = (c) => ({ case_id: c.case_id, baseline_trace_id: c.baseline_trace_id, protected: Boolean(c.protected), baseline_score: c.baseline_score, candidate_score: c.candidate_score, baseline_passed: Array.isArray(c.baseline_grader) && c.baseline_grader.length > 0 && c.baseline_grader.every((g) => g.passed), candidate_passed: Array.isArray(c.candidate_grader) && c.candidate_grader.length > 0 && c.candidate_grader.every((g) => g.passed), baseline_cost_usd: c.baseline_cost_usd, candidate_cost_usd: c.candidate_cost_usd, candidate_cost_source: c.candidate_cost_source, baseline_latency_ms: c.baseline_latency_ms, candidate_latency_ms: c.candidate_latency_ms, case_provenance_hash: c.case_provenance_hash });

export function candidateOut(p) {
  return { id: p.id, strategy: p.strategy, status: p.status, executable_status: p.executable_status, optimization_pass: p.optimization_pass, pass_version: p.pass_version, diagnosis_id: p.diagnosis_id, contract_hash: p.contract_hash, baseline_snapshot_id: p.baseline_snapshot_id, candidate_config_hash: p.candidate_config_hash, config_hash: p.config_hash, reason: p.reason, expected_mechanism: p.expected_mechanism, risk: p.risk, fallback: p.fallback, sample_count: (p.sample_scope || []).length, candidate_config: p.candidate_config || {}, blocked_reason: p.blocked_reason, lineage: p.lineage || {}, created_at: p.created_at };
}

export function evaluationOut(e) {
  return { id: e.id, candidate_plan_id: e.candidate_plan_id, candidate_execution_id: e.candidate_execution_id, status: e.status, rejection_reason: e.rejection_reason, contract_hash: e.contract_hash, sample_count: e.sample_count, protected_sample_count: e.protected_sample_count, gates: e.gates || [], performance_comparison: e.performance_comparison || null, evidence_version: e.evidence_version, created_at: e.created_at, cases: (e.cases || []).map(caseOut) };
}

export function snapshotOut(s) {
  return s && { id: s.id, run_id: s.run_id, contract_hash: s.contract_hash, version: s.version, metrics: s.metrics, latency_analysis: s.latency_analysis, completeness: s.completeness, trace_count: s.trace_count, window_truncated: s.window_truncated, snapshot_hash: s.snapshot_hash, created_at: s.created_at };
}

export function diagnosisOut(d) {
  return { id: d.id, family: d.family, version: d.version, scope: d.scope, symptom: d.symptom, root_cause: d.root_cause, causal_path: d.causal_path, affected_nodes: d.affected_nodes, evidence_refs: d.evidence_refs, metrics: d.metrics, confidence: d.confidence, severity: d.severity, required_additional_evidence: d.required_additional_evidence, falsifier: d.falsifier, suggested_optimization_passes: d.suggested_optimization_passes, risk_class: d.risk_class, diagnosis_hash: d.diagnosis_hash, snapshot_id: d.snapshot_id };
}

const pctLabel = (v) => (v === null || v === undefined ? null : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);

/** The executive summary: one row per evaluated candidate, with the exact claim each number supports. */
function executive({ snapshot, evaluations, candidates }) {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const verified = evaluations.filter((e) => e.status === 'VERIFIED');
  return {
    baseline: snapshot
      ? {
          label: 'Observed',
          known_cost_usd: snapshot.metrics.economics.total_known_cost_usd,
          cost_coverage: snapshot.metrics.economics.cost_coverage,
          cost_per_successful_outcome_usd: snapshot.metrics.economics.cost_per_successful_outcome_usd,
          cpso_unavailable_reasons: snapshot.metrics.economics.cpso.unavailable_reasons,
          p95_latency_ms: snapshot.metrics.latency.request.p95_ms,
          task_success_rate: snapshot.metrics.quality.task_success.rate,
          quality: snapshot.metrics.quality.score,
          failure_rate: snapshot.metrics.reliability.failure_rate,
          retry_amplification: snapshot.metrics.reliability.retry_amplification,
          evidence: snapshot.completeness,
        }
      : null,
    results: evaluations.map((e) => {
      const c = e.performance_comparison || {};
      return {
        evaluation_id: e.id,
        strategy: byId.get(e.candidate_plan_id)?.strategy || null,
        verdict: e.status,
        label: e.status === 'VERIFIED' ? 'Verified on evaluated workload' : 'Evaluated — not verified',
        scope: `${e.sample_count} replayed case(s)${snapshot ? ` of ${snapshot.metrics.samples.logical_requests} logical requests in the baseline` : ''} — not the whole workload`,
        evaluated_cost_change: pctLabel(c.deltas_pct?.cost ?? null),
        evaluated_cpso_change: pctLabel(c.deltas_pct?.cost_per_successful_outcome ?? null),
        evaluated_p95_change: pctLabel(c.deltas_pct?.p95 ?? null),
        baseline: c.baseline || null,
        candidate: c.candidate || null,
        reason: e.rejection_reason,
        production_realized_result: 'NOT YET MEASURED',
      };
    }),
    headline: verified.length
      ? `${verified.length} candidate(s) VERIFIED on the evaluated workload under contract ${snapshot?.contract_hash?.slice(0, 12) ?? ''}. Production results are not yet measured.`
      : evaluations.length
        ? 'No candidate is verified yet. Rejected and incomplete results are shown with their reasons.'
        : 'No candidate has been replayed yet.',
    not_claimed: ['Diagnoses are not savings.', 'Candidates are not verified until replayed under the frozen contract.', 'Evaluated changes on replayed cases are not realized production savings.', 'Synthetic or internal evidence is not independent customer proof.'],
  };
}

export function buildReport({ run, contract, snapshot, diagnoses, candidates, evaluations }) {
  const s = snapshotOut(snapshot);
  const cands = candidates.map(candidateOut);
  const evals = evaluations.map(evaluationOut);
  return {
    run: { id: run.id, product_id: run.product_id, status: run.status, contract_hash: run.contract_hash, created_at: run.created_at },
    contract: contractOut(contract),
    baseline: s,
    diagnoses: diagnoses.map(diagnosisOut),
    candidates: cands,
    evaluations: evals,
    executive: executive({ snapshot: s, evaluations: evals, candidates: cands }),
    developer: {
      zevir: s ? { graph_count: s.metrics.evidence.graph_count, graph_set_hash: s.metrics.evidence.graph_set_hash, graphs_truncated: s.metrics.evidence.graphs_truncated, latency_status: s.latency_analysis?.status ?? null, projection: s.metrics.zevir_projection ?? null } : null,
      lineage: cands.map((c) => ({ candidate_id: c.id, diagnosis_id: c.diagnosis_id, pass: `${c.optimization_pass}@${c.pass_version}`, contract_hash: c.contract_hash, baseline_snapshot_id: c.baseline_snapshot_id, candidate_config_hash: c.candidate_config_hash, executable_status: c.executable_status, materializer: c.lineage.materializer_hints || null, rollback: c.lineage.rollback || null })),
    },
  };
}
