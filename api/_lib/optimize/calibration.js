/**
 * Calibration replay (vNext Part 2B).
 *
 * A cheap, bounded replay of a plan on a deterministic sample of the search's
 * evaluation set, to decide whether the plan deserves full-replay budget. It is
 * NEVER a verdict: outcomes are PROMISING / UNPROMISING / INCOMPLETE /
 * FAILED_HARD_GATE and every row is labelled "CALIBRATION — NOT VERIFIED".
 *
 * Sampling is outcome-blind and seeded: units are ordered by
 * sha256(seed, plan hash, unit) and taken in that order, so round 2 extends
 * round 1 and nothing is chosen by looking at results. A unit is a whole cache
 * key group (a cache hit is only reproducible with the request that filled
 * it) or a single case. Protected cases are kept when the contract requires
 * them; two unchanged cases check the passthrough path.
 *
 * Early rejection is sound: a plan is rejected only when the FULL replay could
 * not pass a hard gate whatever the unsampled cases do. Unchanged cases are
 * known exactly (they are the recorded baseline); unsampled changed cases are
 * bounded between "all fail" and "all pass".
 */
import { sha256Json } from '../product/hashing.js';
import { cacheKey, streamOrder } from './replay-model.js';
import { normalizeRequirements } from './contract.js';
import { percentile } from './performance.js';

export const CALIBRATION_LABEL = 'CALIBRATION — NOT VERIFIED';
const UNCHANGED_QUOTA = 2;
/** A projection this close to a hard limit (or below it) earns a larger sample. */
export const NEAR_MARGIN = 0.02;
const scopeOf = (t) => t.symbol || t.workflow || 'unattributed';

/**
 * selectSample({ plan: { plan_hash, ordered, estimate }, rows, round, perPlan, rounds, seed, requirements })
 * → { ids, hash, units, affected_in_sample, protected_in_sample }
 */
export function selectSample({ plan, rows, round, perPlan, rounds = 2, seed, requirements }) {
  const req = normalizeRequirements(requirements);
  const sim = new Map(plan.estimate.simulation.map((s) => [s.id, s]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const cacheTx = plan.ordered.filter((t) => t.kind === 'exact_response_reuse');
  const unitOf = (r) => {
    const tx = cacheTx.find((t) => t.scope === scopeOf(r));
    const k = tx ? cacheKey(r) : null;
    return k ? `cache:${tx.hash}:${k}` : `case:${r.id}`;
  };
  const units = new Map();
  for (const r of rows) {
    const u = unitOf(r);
    if (!units.has(u)) units.set(u, []);
    units.get(u).push(r.id);
  }
  const affectedUnits = [...units.entries()].filter(([, ids]) => ids.some((id) => sim.get(id)?.served_by)).map(([u, ids]) => ({ u, ids }));
  const rank = (u) => sha256Json({ seed, plan: plan.plan_hash, unit: u });
  affectedUnits.sort((a, b) => rank(a.u).localeCompare(rank(b.u)));
  const unchanged = rows.filter((r) => !sim.get(r.id)?.served_by && !r.protected).sort((a, b) => rank(`case:${a.id}`).localeCompare(rank(`case:${b.id}`)));
  const prot = req.protected.require_cases ? rows.filter((r) => r.protected).sort((a, b) => rank(`case:${a.id}`).localeCompare(rank(`case:${b.id}`))).slice(0, Math.max(1, req.protected.min_cases)) : [];

  // The per-plan cap is spread over the rounds: round r may use r/rounds of it (round 2 extends round 1).
  const cap = Math.max(UNCHANGED_QUOTA + 1, Math.ceil((perPlan * round) / rounds));
  const chosen = new Set(prot.map((r) => r.id));
  let affected = 0;
  for (const unit of affectedUnits) {
    if (chosen.size + unit.ids.length > cap - Math.min(UNCHANGED_QUOTA, unchanged.length) && affected > 0) break;
    unit.ids.forEach((id) => chosen.add(id));
    affected += unit.ids.filter((id) => sim.get(id)?.served_by).length;
  }
  for (const r of unchanged.slice(0, UNCHANGED_QUOTA)) if (chosen.size < cap) chosen.add(r.id);
  const ids = [...chosen].map((id) => byId.get(id)).filter(Boolean).sort(streamOrder).map((r) => r.id);
  return { ids, hash: sha256Json({ seed, plan_hash: plan.plan_hash, round, ids }), affected_in_sample: affected, affected_total: [...sim.values()].filter((s) => s.served_by).length, protected_in_sample: prot.length, units_remaining: affectedUnits.filter((x) => x.ids.some((id) => !chosen.has(id))).length };
}

const passedAll = (g) => Array.isArray(g) && g.length > 0 && g.every((r) => r.passed);

/**
 * Sound bounds for the full replay from a calibration result.
 * baselineGrades: Map(caseId → { score, passed }) for every evaluation case (recorded baseline).
 */
export function boundsAnalysis({ result, sampleIds, rows, simulation, baselineGrades, requirements, composition }) {
  const req = normalizeRequirements(requirements);
  const sim = new Map(simulation.map((s) => [s.id, s]));
  const sampled = new Map((result.cases || []).map((c) => [c.baseline_trace_id, c]));
  const n = rows.length;
  let succKnown = 0;
  let succUnknown = 0;
  let qKnown = 0;
  let qUnknown = 0;
  // Pass rate / mean score of the CHANGED cases that were sampled: the projection for unsampled changed cases.
  const changedSampled = [...sampled.values()].filter((c) => sim.get(c.baseline_trace_id)?.served_by);
  const passRate = changedSampled.length ? changedSampled.filter((c) => passedAll(c.candidate_grader)).length / changedSampled.length : null;
  const meanScore = changedSampled.length ? changedSampled.reduce((a, c) => a + (c.candidate_score ?? 0), 0) / changedSampled.length : null;
  for (const r of rows) {
    const c = sampled.get(r.id);
    if (c) {
      if (passedAll(c.candidate_grader)) succKnown += 1;
      qKnown += c.candidate_score ?? 0;
      continue;
    }
    if (!sim.get(r.id)?.served_by) {
      const b = baselineGrades.get(r.id);
      if (b?.passed) succKnown += 1;
      qKnown += b?.score ?? 0;
      continue;
    }
    succUnknown += 1;
    qUnknown += 1;
  }
  const bq = [...baselineGrades.values()];
  const baseQuality = bq.length ? bq.reduce((a, g) => a + (g.score ?? 0), 0) / bq.length : null;
  const baseSuccess = bq.length ? bq.filter((g) => g.passed).length / bq.length : null;
  const b = {
    cases: n,
    unknown_cases: succUnknown,
    task_success: { lo: n ? succKnown / n : null, hi: n ? (succKnown + succUnknown) / n : null, projected: n && passRate !== null ? (succKnown + succUnknown * passRate) / n : null, baseline: baseSuccess, floor: req.min_task_success_rate },
    quality: { lo: n ? qKnown / n : null, hi: n ? (qKnown + qUnknown) / n : null, projected: n && meanScore !== null ? (qKnown + qUnknown * meanScore) / n : null, baseline: baseQuality, floor: req.quality_floor, tolerance: req.quality_tolerance },
  };
  const certain = [];
  const uncertain = [];
  const near = [];
  const check = (name, m, limit) => {
    if (limit === null || limit === undefined || m.hi === null) return;
    if (m.hi < limit - 1e-12) certain.push(`${name}: at most ${m.hi.toFixed(3)} even if every unsampled changed case passes; limit ${limit.toFixed(3)}`);
    else if (m.lo < limit - 1e-12) {
      uncertain.push(`${name}: between ${m.lo.toFixed(3)} and ${m.hi.toFixed(3)}; limit ${limit.toFixed(3)}`);
      // Near the boundary: projecting the sampled changed cases onto the unsampled ones lands within NEAR_MARGIN of the limit (or below it).
      if (m.projected === null || m.projected < limit + NEAR_MARGIN) near.push(`${name}: projected ${m.projected === null ? 'unknown' : m.projected.toFixed(3)} vs limit ${limit.toFixed(3)}`);
    }
  };
  check('task_success_floor', b.task_success, req.min_task_success_rate);
  check('task_success_non_regression', b.task_success, baseSuccess === null ? null : baseSuccess - req.task_success_tolerance);
  check('quality_floor', b.quality, req.quality_floor);
  check('non_inferiority', b.quality, baseQuality === null ? null : baseQuality - req.quality_tolerance);
  // Protected cases and per-transformation slices.
  for (const c of sampled.values()) if (c.protected && !passedAll(c.candidate_grader)) certain.push(`protected_slice: protected case ${c.case_id} failed`);
  for (const tx of composition) {
    const servedIds = simulation.filter((s) => s.served_by === tx.hash).map((s) => s.id);
    if (!servedIds.length) continue;
    let hi = 0;
    let base = 0;
    for (const id of servedIds) {
      const c = sampled.get(id);
      hi += c ? c.candidate_score ?? 0 : 1;
      base += baselineGrades.get(id)?.score ?? 0;
    }
    const limit = base / servedIds.length - req.quality_tolerance;
    if (hi / servedIds.length < limit - 1e-12) certain.push(`transformation_slice:${tx.kind}:${tx.scope}: at most ${(hi / servedIds.length).toFixed(3)} on its ${servedIds.length} case(s); baseline ${(base / servedIds.length).toFixed(3)}`);
  }
  for (const g of result.gates || []) if (g.name === 'model_allowlist' && g.outcome === 'failed') certain.push('model_allowlist: candidate model not allowed by the contract');
  return { ...b, certain_failures: certain, uncertain, near_boundary: near };
}

const sum = (xs) => xs.reduce((a, v) => a + v, 0);

/**
 * Calibration outcome and the next action (adaptive replay budget):
 *   hard failure                 → FAILED_HARD_GATE, stop
 *   no improvement on the sample → UNPROMISING, stop
 *   missing evidence             → INCOMPLETE, stop
 *   promising, projection near a hard limit → larger sample next round (if rounds remain), else full replay
 *   promising, projection clear              → full replay (it decides the unsampled cases)
 */
export function decideCalibration({ result, execution, sample, bounds, round, maxRounds }) {
  const samples = Array.isArray(execution.sample_results) ? execution.sample_results : [];
  const cases = result.cases || [];
  const reasons = [];
  const bc = cases.map((c) => c.baseline_cost_usd);
  const cc = cases.map((c) => c.candidate_cost_usd);
  const costKnown = cases.length > 0 && bc.every((v) => v !== null) && cc.every((v) => v !== null);
  const costDelta = costKnown ? sum(cc) - sum(bc) : null;
  const bp95 = percentile(cases.map((c) => c.baseline_latency_ms), 95);
  const cp95 = percentile(cases.map((c) => c.candidate_latency_ms), 95);
  const metrics = { cases: cases.length, affected_in_sample: sample.affected_in_sample, cost_delta_usd: costDelta, baseline_p95_ms: bp95, candidate_p95_ms: cp95, failures: samples.filter((s) => s.status !== 'succeeded').length, label: CALIBRATION_LABEL };

  if (bounds.certain_failures.length) return { outcome: 'FAILED_HARD_GATE', next: 'stop', reasons: bounds.certain_failures, metrics };
  if (execution.status !== 'SUCCEEDED' || metrics.failures) return { outcome: 'INCOMPLETE', next: 'stop', reasons: [`calibration execution ${execution.status}${execution.error_detail ? `: ${execution.error_detail}` : ''}`], metrics };
  if (!sample.affected_in_sample) return { outcome: 'INCOMPLETE', next: 'stop', reasons: ['no changed case in the calibration sample'], metrics };
  const cheaper = costDelta !== null && costDelta < 0;
  const faster = bp95 !== null && cp95 !== null && cp95 < bp95;
  if (costDelta === null && !faster) return { outcome: 'INCOMPLETE', next: 'stop', reasons: ['cost unknown on the sample and no measured latency gain'], metrics };
  if (!cheaper && !faster) return { outcome: 'UNPROMISING', next: 'stop', reasons: ['no cost or p95 improvement on the calibration sample'], metrics };
  reasons.push(`${cheaper ? `cost ${costDelta.toFixed(6)} USD on the sample` : 'cost not lower'}; ${faster ? `p95 ${cp95} ms vs ${bp95} ms` : 'p95 not lower'}`);
  if (bounds.near_boundary.length && round < maxRounds && sample.units_remaining > 0) return { outcome: 'PROMISING', next: 'increase_sample', reasons: [...reasons, 'near a contract boundary, so the sample grows: ' + bounds.near_boundary.join('; ')], metrics };
  if (bounds.near_boundary.length) return { outcome: 'PROMISING', next: 'full_replay', reasons: [...reasons, `still near a boundary after ${round} round(s); the full replay decides: ${bounds.near_boundary.join('; ')}`], metrics };
  if (bounds.uncertain.length) return { outcome: 'PROMISING', next: 'full_replay', reasons: [...reasons, `projection clear of every hard limit by at least ${NEAR_MARGIN}; the full replay decides the unsampled cases`], metrics };
  return { outcome: 'PROMISING', next: 'full_replay', reasons: [...reasons, 'clear of every hard bound even if all unsampled changed cases fail'], metrics };
}
