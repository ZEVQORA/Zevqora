/**
 * Optimization Intelligence read model (vNext Part 2B): plan explanations and
 * the search report, for two audiences.
 *
 * Claim labels (verbatim in the UI):
 *   ESTIMATED   first-order effect used to prioritise search; never evidence
 *   CALIBRATED  measured on a calibration sample; never a verdict
 *   EVALUATED   replayed on the evaluation set under the frozen contract
 *   VERIFIED    evaluated AND every required gate passed
 *   BAD-DAY REPLAY  simulated faults over replayed cases; not a production guarantee
 *   Realized production result: NOT YET MEASURED
 *
 * No raw prompt or output is ever included: evaluation cases are reduced to
 * ids, flags, scores, costs and latencies.
 */
import { caseOut } from './report.js';
import { POLICIES } from './pareto.js';

const STAGE = { PROPOSED: 'Proposed', BLOCKED: 'Blocked', NEEDS_EVIDENCE: 'Needs evidence', CONFLICTED: 'Conflicted', PRUNED: 'Pruned', CALIBRATION_READY: 'Waiting for calibration', CALIBRATING: 'Calibrating', CALIBRATION_REJECTED: 'Rejected in calibration', FULL_REPLAY_READY: 'Promoted to full replay', REPLAYING: 'Replaying', REJECTED: 'Rejected', INCOMPLETE: 'Incomplete', VERIFIED: 'Verified (dominated)', PARETO_FRONTIER: 'Verified · Pareto frontier', SELECTED: 'Selected' };
const pct = (a, b) => (a === null || b === null || a === undefined || b === undefined || Number(a) === 0 ? null : ((Number(b) - Number(a)) / Number(a)) * 100);

function stripEstimate(e) {
  if (!e || !e.label || e.label === 'NOT ESTIMATED') return e || null;
  const { simulation, signature: _signature, ...rest } = e;
  return { ...rest, simulated_cases: simulation ? simulation.length : 0, paths: simulation ? simulation.reduce((a, s) => ({ ...a, [s.path]: (a[s.path] || 0) + 1 }), {}) : {} };
}

/** Answers, for one plan, every question a reviewer asks before trusting it. */
export function explainPlan(plan, { diagnoses = [], calibrations = [], badDays = [], decision = null, search = null }) {
  const byId = new Map(diagnoses.map((d) => [d.id, d]));
  const src = (plan.source_diagnosis_ids || []).map((id) => byId.get(id)).filter(Boolean);
  const cal = [...calibrations].sort((a, b) => a.round - b.round);
  const st = plan.replay_state || {};
  const sel = decision && decision.selected_plan_id === plan.id ? decision : null;
  return {
    why_generated: src.length ? src.map((d) => `${d.family} (${d.scope}): ${d.symptom}`) : ['proposed by a pass from the run’s diagnoses'],
    supporting_diagnoses: src.map((d) => ({ id: d.id, family: d.family, scope: d.scope, diagnosis_hash: d.diagnosis_hash, severity: d.severity, confidence: d.confidence })),
    zevir_nodes_changed: [...new Map(plan.pass_instances.flatMap((p) => p.affected_nodes || []).map((n) => [n.stable_key, n])).values()].slice(0, 20),
    passes_composed: plan.pass_instances.map((p) => `${p.label} — ${p.pass}@${p.pass_version} (${p.layer})`),
    composition_order: plan.pass_instances.map((p) => p.label),
    conflicts_checked: plan.compatibility_result.compatible ? (plan.compatibility_result.dependencies.length ? plan.compatibility_result.dependencies.map((d) => `${d.kinds.join(' → ')}: ${d.note}`) : ['independent changes (no shared call site, node or request)']) : plan.conflict_reasons,
    missing_evidence: plan.missing_evidence,
    why_calibration: plan.status === 'CALIBRATION_READY' && st.not_calibrated ? `Not calibrated: ${st.not_calibrated}` : cal.length ? `Executable and not pruned; ranked by estimated saving (priority ${plan.priority ?? 'unknown'}).` : ['BLOCKED', 'CONFLICTED', 'NEEDS_EVIDENCE', 'PRUNED'].includes(plan.status) ? `Did not enter calibration: ${(st.status_reasons || st.blocked_reasons || []).join('; ') || STAGE[plan.status]}` : null,
    why_more_budget: cal.length > 1 ? cal.slice(0, -1).map((c) => `round ${c.round}: ${c.reasons.join('; ')}`) : null,
    calibration: cal.map((c) => ({ round: c.round, outcome: c.outcome, label: c.label, sample_size: c.sample_size, sample_hash: c.sample_hash, reasons: c.reasons })),
    why_rejected: plan.status === 'CALIBRATION_REJECTED' ? cal.at(-1)?.reasons || [] : plan.verdict === 'REJECTED' || plan.verdict === 'INCOMPLETE' ? [st.rejection_reason] : null,
    why_dominated: plan.frontier_state === 'DOMINATED' || plan.frontier_state === 'INCOMPARABLE' ? plan.dominance_state?.frontier_reason : null,
    why_frontier: plan.frontier_state === 'FRONTIER' ? plan.dominance_state?.frontier_reason : null,
    why_selected: sel ? sel.explanation.why : null,
    falsifiers: plan.pass_instances.map((p) => `${p.label}: ${p.falsifier}`),
    rollback: plan.rollback,
    not_proven: [
      plan.verdict === 'VERIFIED' ? 'Verified on the replayed evaluation set only; the realized production result is NOT YET MEASURED.' : 'Nothing about this plan is verified.',
      ...(search?.evaluation_set?.sampled ? [`The evaluation set is a seeded selection of ${search.evaluation_set.ids.length} of ${search.evaluation_set.eligible} eligible requests.`] : []),
      ...plan.pass_instances.filter((p) => p.path_latency_note).map((p) => p.path_latency_note),
      'Cache and lookup hit latency is in-process replay time; a production cache adds a lookup that was not measured.',
      ...(badDays.length ? [] : ['No Bad-Day Replay has been run for this plan.']),
    ],
  };
}

export function planOut(plan, ctx = {}) {
  return {
    id: plan.id,
    name: plan.name,
    plan_hash: plan.plan_hash,
    status: plan.status,
    stage: STAGE[plan.status] || plan.status,
    executable_status: plan.executable_status,
    passes: plan.pass_instances.map((p) => ({ transformation_hash: p.transformation_hash, kind: p.kind, label: p.label, layer: p.layer, scope: p.scope, pass: p.pass, pass_version: p.pass_version, executable_status: p.executable_status, not_executable_reason: p.not_executable_reason, affected_requests: p.affected_trace_count, affected_in_evaluation_set: (p.affected_trace_ids || []).length, settings: p.settings, config: p.config, metadata: p.metadata, risk_class: p.risk_class, required_evidence: p.required_evidence })),
    affected_node_count: new Set(plan.pass_instances.flatMap((p) => (p.affected_nodes || []).map((n) => n.stable_key))).size,
    estimated_effects: stripEstimate(plan.estimated_effects),
    calibrated_effects: plan.observed_calibration_effects || null,
    evaluated_effects: plan.replay_state?.metrics || null,
    verified_effects: plan.verified_effects || null,
    risk_class: plan.risk_class,
    implementation_complexity: plan.implementation_complexity,
    rollback_complexity: plan.rollback_complexity,
    compatibility: plan.compatibility_result,
    conflict_reasons: plan.conflict_reasons,
    missing_evidence: plan.missing_evidence,
    evidence_completeness: plan.missing_evidence.length ? 'incomplete' : 'complete',
    replay_budget: plan.replay_budget,
    verdict: plan.verdict,
    evaluation_id: plan.evaluation_id,
    frontier_state: plan.frontier_state,
    dominance_state: plan.dominance_state,
    materializer_hints: plan.materializer_hints,
    rollback: plan.rollback,
    explanation: explainPlan(plan, ctx),
    bad_day: (ctx.badDays || []).map(badDayOut),
  };
}

export function badDayOut(r) {
  return { id: r.id, plan_id: r.plan_id, profile_id: r.profile_id, profile_hash: r.profile_hash, label: r.label, normal_verdict: r.normal_verdict, bad_day_verdict: r.bad_day_verdict, gates: r.gates, metrics: r.metrics, result_hash: r.result_hash, created_at: r.created_at };
}

export function searchOut(s) {
  return s && { id: s.id, run_id: s.run_id, status: s.status, search_version: s.search_version, search_hash: s.search_hash, seed: s.seed, bounds: s.bounds, contract_hash: s.contract_hash, snapshot_hash: s.snapshot_hash, evaluation_set: { size: s.evaluation_set.ids.length, eligible: s.evaluation_set.eligible, final_requests: s.evaluation_set.final_requests, coverage: s.evaluation_set.coverage, sampled: s.evaluation_set.sampled, excluded: s.evaluation_set.excluded, protected: s.evaluation_set.protected_ids.length, hash: s.evaluation_set_hash }, generation: s.generation, spend: s.spend, budget_report: s.budget_report, frontier: s.frontier, frontier_hash: s.frontier_hash, cancelled_at: s.cancelled_at, created_at: s.created_at, completed_at: s.completed_at };
}

export function counts(plans, calibrations) {
  const n = (st) => plans.filter((p) => st.includes(p.status)).length;
  const calibratedPlans = new Set(calibrations.map((c) => c.plan_id)).size;
  return {
    generated: plans.length,
    blocked: n(['BLOCKED']),
    needs_evidence: n(['NEEDS_EVIDENCE']),
    conflicted: n(['CONFLICTED']),
    pruned: n(['PRUNED']),
    waiting_for_calibration: n(['CALIBRATION_READY', 'CALIBRATING']),
    calibrated: calibratedPlans,
    calibration_rejected: n(['CALIBRATION_REJECTED']),
    full_replay_ready: n(['FULL_REPLAY_READY', 'REPLAYING']),
    fully_replayed: plans.filter((p) => p.verdict).length,
    verified: plans.filter((p) => p.verdict === 'VERIFIED').length,
    rejected: plans.filter((p) => p.verdict === 'REJECTED').length + n(['CALIBRATION_REJECTED']),
    incomplete: n(['INCOMPLETE']),
    frontier: plans.filter((p) => p.frontier_state === 'FRONTIER').length,
    selected: n(['SELECTED']),
  };
}

/** The report for one search (executive + developer). */
export function searchReport({ search, plans, calibrations, decisions, badDays, evaluations, diagnoses }) {
  const decision = decisions[0] || null;
  const calBy = new Map();
  for (const c of calibrations) {
    if (!calBy.has(c.plan_id)) calBy.set(c.plan_id, []);
    calBy.get(c.plan_id).push(c);
  }
  const badBy = new Map();
  for (const r of badDays) {
    if (!badBy.has(r.plan_id)) badBy.set(r.plan_id, []);
    badBy.get(r.plan_id).push(r);
  }
  const out = plans.map((p) => planOut(p, { diagnoses, calibrations: calBy.get(p.id) || [], badDays: badBy.get(p.id) || [], decision, search }));
  const c = counts(plans, calibrations);
  const selected = decision?.selected_plan_id ? out.find((p) => p.id === decision.selected_plan_id) : null;
  const m = selected?.verified_effects || null;
  const headline = `${c.generated} plans generated · ${c.calibrated} calibrated · ${c.fully_replayed} fully replayed · ${c.verified} verified · ${c.frontier} non-dominated${selected ? ` · 1 selected for ${decision.policy}` : ''}`;
  const evalById = new Map(evaluations.map((e) => [e.id, e]));
  return {
    search: searchOut(search),
    counts: c,
    plans: out,
    decisions: decisions.map((d) => ({ id: d.id, policy: d.policy, params: d.policy_params, outcome: d.outcome, selected_plan_id: d.selected_plan_id, explanation: d.explanation, decision_hash: d.decision_hash, frontier_hash: d.frontier_hash, created_at: d.created_at })),
    executive: {
      headline,
      what_was_wrong: diagnoses.slice(0, 8).map((d) => ({ family: d.family, scope: d.scope, symptom: d.symptom, severity: d.severity })),
      considered: c,
      frontier: out.filter((p) => p.frontier_state === 'FRONTIER').map((p) => ({ id: p.id, name: p.name, cpso_usd: p.verified_effects?.cpso_usd ?? null, p95_ms: p.verified_effects?.p95_ms ?? null, task_success: p.verified_effects?.task_success ?? null, risk_class: p.risk_class })),
      recommendation: selected
        ? {
            plan_id: selected.id,
            name: selected.name,
            policy: decision.policy,
            policy_rule: POLICIES[decision.policy]?.rule,
            label: 'VERIFIED on the evaluation set',
            evaluated_cpso_change_pct: pct(m.baseline.cpso_usd, m.cpso_usd),
            evaluated_cost_change_pct: pct(m.baseline.cost_usd, m.cost_usd),
            evaluated_p95_change_pct: pct(m.baseline.p95_ms, m.p95_ms),
            task_success_change_pp: m.baseline.task_success === null || m.task_success === null ? null : (m.task_success - m.baseline.task_success) * 100,
            quality_change: m.baseline.quality === null || m.quality === null ? null : m.quality - m.baseline.quality,
            protected_preserved: true,
            why: decision.explanation.why,
            realized_production_result: 'NOT YET MEASURED',
          }
        : null,
      evidence: { evaluation_set: searchOut(search).evaluation_set, label: search.evaluation_set.sampled ? 'seeded selection of the eligible requests' : 'every eligible request in the evidence window' },
      budget: search.budget_report || null,
      realized_production_result: 'NOT YET MEASURED',
      not_claimed: ['Estimates are not evidence; calibration is not a verdict.', 'VERIFIED means every required gate of the frozen contract passed on the replayed evaluation set — not that production will save the same.', 'Bad-Day Replay is a simulation over replayed cases, not a production guarantee.', 'Blocked plans have no result: nothing about them is measured.'],
    },
    developer: {
      plans: out
        .filter((p) => p.verdict || calBy.has(p.id))
        .map((p) => {
          const ev = p.evaluation_id ? evalById.get(p.evaluation_id) : null;
          return {
            id: p.id,
            name: p.name,
            plan_hash: p.plan_hash,
            source_diagnoses: p.explanation.supporting_diagnoses,
            zevir_path: p.explanation.zevir_nodes_changed,
            composition_order: p.passes.map((x) => ({ label: x.label, kind: x.kind, layer: x.layer, scope: x.scope, transformation_hash: x.transformation_hash })),
            config_changes: p.passes.map((x) => ({ label: x.label, settings: x.settings })),
            calibration: (calBy.get(p.id) || []).map((x) => ({ round: x.round, outcome: x.outcome, sample_size: x.sample_size, sample_hash: x.sample_hash, sample_ids: x.sample_ids })),
            full_replay: ev ? { evaluation_id: ev.id, status: ev.status, sample_count: ev.sample_count, gates: ev.gates, cases: (ev.cases || []).map(caseOut), evidence_version: ev.evidence_version } : null,
            pareto: p.dominance_state,
            bad_day: p.bad_day,
            implementation: p.materializer_hints,
            rollback: p.rollback,
            falsifiers: p.explanation.falsifiers,
          };
        }),
    },
  };
}
