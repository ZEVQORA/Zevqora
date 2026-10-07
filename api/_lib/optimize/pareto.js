/**
 * Pareto frontier and decision policies (vNext Part 2B).
 *
 * Only VERIFIED plans are compared: hard constraints were already applied by
 * the frozen contract. A dominates B when A is no worse on every dimension and
 * strictly better on at least one. If any dimension is unknown for either
 * plan the comparison is INCOMPLETE and neither dominates: unknown never makes
 * a plan better or worse.
 *
 *   FRONTIER      not dominated, every comparison complete
 *   INCOMPARABLE  not dominated, but at least one comparison incomplete
 *   DOMINATED     some plan dominates it (named in dominated_by)
 *
 * A decision policy selects from FRONTIER plans only, by an explicit
 * lexicographic rule. There is no weighted score.
 */
import { sha256Json } from '../product/hashing.js';
import { RISK } from './transformations.js';

export const PARETO_DIMENSIONS = Object.freeze([
  { key: 'cpso_usd', better: 'min', label: 'Cost per successful outcome' },
  { key: 'p95_ms', better: 'min', label: 'p95 latency' },
  { key: 'task_success', better: 'max', label: 'Task success' },
  { key: 'quality', better: 'max', label: 'Quality' },
  { key: 'failure_rate', better: 'min', label: 'Replay failure rate' },
  { key: 'provider_concentration', better: 'min', label: 'Provider concentration' },
  { key: 'risk', better: 'min', label: 'Risk' },
  { key: 'implementation_complexity', better: 'min', label: 'Implementation complexity' },
  { key: 'rollback_complexity', better: 'min', label: 'Rollback complexity' },
]);

const known = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));
const EPS = 1e-12;

/** The comparison point of a VERIFIED plan (from its stored evaluation metrics). */
export function paretoPoint(plan) {
  const m = plan.verified_effects || {};
  return {
    id: plan.id,
    plan_hash: plan.plan_hash,
    name: plan.name,
    values: { cpso_usd: m.cpso_usd ?? null, p95_ms: m.p95_ms ?? null, task_success: m.task_success ?? null, quality: m.quality ?? null, failure_rate: m.failure_rate ?? null, provider_concentration: m.provider_concentration ?? null, risk: RISK[plan.risk_class] ?? null, implementation_complexity: plan.implementation_complexity ?? null, rollback_complexity: plan.rollback_complexity ?? null },
  };
}

/** { a_dominates, b_dominates, incomplete, unknown_dimensions, better, worse } */
export function compare(a, b) {
  const better = [];
  const worse = [];
  const unknown = [];
  for (const d of PARETO_DIMENSIONS) {
    const x = a.values[d.key];
    const y = b.values[d.key];
    if (!known(x) || !known(y)) {
      unknown.push(d.key);
      continue;
    }
    const diff = d.better === 'min' ? Number(y) - Number(x) : Number(x) - Number(y);
    if (diff > EPS) better.push(d.key);
    else if (diff < -EPS) worse.push(d.key);
  }
  const incomplete = unknown.length > 0;
  return { incomplete, unknown_dimensions: unknown, better, worse, a_dominates: !incomplete && !worse.length && better.length > 0, b_dominates: !incomplete && !better.length && worse.length > 0 };
}

/**
 * Frontier over VERIFIED plans. Plans that are not VERIFIED are refused
 * (never silently skipped into a frontier). Deterministic: input order free.
 */
export function paretoFrontier(plans) {
  const bad = plans.filter((p) => p.verdict !== 'VERIFIED');
  if (bad.length) throw new Error(`Only VERIFIED plans enter the Pareto frontier (${bad.map((p) => `${p.name}: ${p.verdict ?? 'no verdict'}`).join('; ')}).`);
  const points = plans.map(paretoPoint).sort((a, b) => a.plan_hash.localeCompare(b.plan_hash));
  const unknownOf = (p) => PARETO_DIMENSIONS.filter((d) => !known(p.values[d.key])).map((d) => d.key);
  const name = (h) => points.find((x) => x.plan_hash === h)?.name;
  const states = points.map((p) => {
    const missing = unknownOf(p);
    if (missing.length) {
      // Its own evidence is incomplete: it is compared with nobody, and nobody is compared with it.
      return { plan_hash: p.plan_hash, id: p.id, name: p.name, values: p.values, frontier_state: 'INCOMPARABLE', dominated_by: [], dominates: [], incomplete_comparisons: points.filter((q) => q !== p).map((q) => ({ plan_hash: q.plan_hash, unknown: missing })), frontier_reason: `Comparison incomplete: ${missing.join(', ')} unknown for this plan. Unknown is not better or worse, so it is not ranked and not eligible for selection.` };
    }
    const dominatedBy = [];
    const dominates = [];
    for (const q of points) {
      if (q === p || unknownOf(q).length) continue;
      const c = compare(p, q);
      if (c.a_dominates) dominates.push(q.plan_hash);
      else if (c.b_dominates) dominatedBy.push(q.plan_hash);
    }
    const state = dominatedBy.length ? 'DOMINATED' : 'FRONTIER';
    const complete = points.filter((q) => !unknownOf(q).length);
    const reason =
      state === 'DOMINATED'
        ? `Dominated by ${dominatedBy.map(name).join(', ')}: no better on any compared dimension and worse on at least one.`
        : complete.length === 1
          ? 'The only VERIFIED plan with complete evidence.'
          : `No VERIFIED plan is at least as good on every dimension${dominates.length ? `; it dominates ${dominates.map(name).join(', ')}` : ''}.`;
    return { plan_hash: p.plan_hash, id: p.id, name: p.name, values: p.values, frontier_state: state, dominated_by: dominatedBy, dominates, incomplete_comparisons: [], frontier_reason: reason };
  });
  const body = { dimensions: PARETO_DIMENSIONS.map((d) => d.key), points: states.map((s) => ({ plan_hash: s.plan_hash, values: s.values, frontier_state: s.frontier_state, dominated_by: s.dominated_by })) };
  return { states, frontier: states.filter((s) => s.frontier_state === 'FRONTIER').map((s) => s.plan_hash), hash: sha256Json(body) };
}

// ---- decision policies ------------------------------------------------------------------
export const POLICIES = Object.freeze({
  MARGIN_FIRST: { rule: 'lowest verified cost per successful outcome, then lower p95, then lower implementation complexity', order: [['cpso_usd', 'min'], ['p95_ms', 'min'], ['implementation_complexity', 'min']] },
  LATENCY_FIRST: { rule: 'lowest verified p95 latency, then lower cost per successful outcome, then lower replay failure rate', order: [['p95_ms', 'min'], ['cpso_usd', 'min'], ['failure_rate', 'min']] },
  RELIABILITY_FIRST: { rule: 'highest verified task success, then lower replay failure rate, then lower p95, then lower cost per successful outcome', order: [['task_success', 'max'], ['failure_rate', 'min'], ['p95_ms', 'min'], ['cpso_usd', 'min']] },
  BALANCED: { rule: 'among plans that regress nothing against the baseline (cost per successful outcome, p95, task success, quality, failure rate): lowest risk, then lowest implementation + rollback complexity, then lower cost per successful outcome, then lower p95', order: [['risk', 'min'], ['complexity', 'min'], ['cpso_usd', 'min'], ['p95_ms', 'min']] },
  CUSTOM_CONSTRAINTS: { rule: 'plans within your stated limits, then ranked by your chosen objective', order: null },
});
const CUSTOM_KEYS = ['max_cpso_usd', 'max_p95_ms', 'min_task_success', 'max_risk', 'max_implementation_complexity', 'objective'];

export class PolicyError extends Error {}

export function normalizePolicy(policy, params = {}) {
  if (!POLICIES[policy]) throw new PolicyError(`Unknown decision policy '${policy}'. Use one of ${Object.keys(POLICIES).join(', ')}.`);
  if (policy !== 'CUSTOM_CONSTRAINTS') return { policy, params: {} };
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new PolicyError('Custom constraints must be an object.');
  for (const k of Object.keys(params)) if (!CUSTOM_KEYS.includes(k)) throw new PolicyError(`Unknown constraint '${k}'.`);
  const out = { objective: params.objective || 'MARGIN_FIRST' };
  if (!['MARGIN_FIRST', 'LATENCY_FIRST', 'RELIABILITY_FIRST'].includes(out.objective)) throw new PolicyError('objective must be MARGIN_FIRST, LATENCY_FIRST or RELIABILITY_FIRST.');
  for (const k of ['max_cpso_usd', 'max_p95_ms', 'min_task_success', 'max_implementation_complexity']) {
    if (params[k] === undefined || params[k] === null) continue;
    const n = Number(params[k]);
    if (!Number.isFinite(n) || n < 0) throw new PolicyError(`${k} must be a non-negative number.`);
    out[k] = n;
  }
  if (params.max_risk !== undefined && params.max_risk !== null) {
    if (!(params.max_risk in RISK)) throw new PolicyError('max_risk must be low, medium or high.');
    out.max_risk = params.max_risk;
  }
  return { policy, params: out };
}

const valueOf = (s, key) => (key === 'complexity' ? s.values.implementation_complexity + s.values.rollback_complexity : s.values[key]);

function rank(list, order) {
  return [...list].sort((a, b) => {
    for (const [key, dir] of order) {
      const x = valueOf(a, key);
      const y = valueOf(b, key);
      if (!known(x) && !known(y)) continue;
      if (!known(x)) return 1;
      if (!known(y)) return -1;
      if (Math.abs(x - y) > EPS) return dir === 'min' ? x - y : y - x;
    }
    return a.plan_hash.localeCompare(b.plan_hash);
  });
}

/**
 * Applies a policy to a computed frontier. `baseline` = the evaluation set's
 * baseline values (cpso_usd, p95_ms, task_success, quality, failure_rate).
 * Returns { outcome, selected (plan_hash|null), explanation, decision_hash }.
 */
export function applyPolicy({ frontier, policy, params, baseline }) {
  const { policy: p, params: prm } = normalizePolicy(policy, params);
  const eligible = frontier.states.filter((s) => s.frontier_state === 'FRONTIER');
  const excluded = frontier.states.filter((s) => s.frontier_state !== 'FRONTIER').map((s) => ({ plan_hash: s.plan_hash, name: s.name, reason: s.frontier_reason }));
  let pool = eligible;
  let order = POLICIES[p].order;
  let note = null;
  if (p === 'BALANCED') {
    const regress = (s) => {
      const out = [];
      if (known(baseline.cpso_usd) && known(s.values.cpso_usd) && s.values.cpso_usd > baseline.cpso_usd + EPS) out.push('cost per successful outcome');
      if (known(baseline.p95_ms) && known(s.values.p95_ms) && s.values.p95_ms > baseline.p95_ms + EPS) out.push('p95');
      if (known(baseline.task_success) && known(s.values.task_success) && s.values.task_success < baseline.task_success - EPS) out.push('task success');
      if (known(baseline.quality) && known(s.values.quality) && s.values.quality < baseline.quality - EPS) out.push('quality');
      if (known(baseline.failure_rate) && known(s.values.failure_rate) && s.values.failure_rate > baseline.failure_rate + EPS) out.push('failure rate');
      return out;
    };
    const noRegret = eligible.filter((s) => !regress(s).length);
    for (const s of eligible.filter((x) => regress(x).length)) excluded.push({ plan_hash: s.plan_hash, name: s.name, reason: `regresses ${regress(s).join(', ')} against the baseline` });
    pool = noRegret;
  }
  if (p === 'CUSTOM_CONSTRAINTS') {
    order = POLICIES[prm.objective].order;
    const fails = (s) => {
      const out = [];
      if (prm.max_cpso_usd !== undefined && !(known(s.values.cpso_usd) && s.values.cpso_usd <= prm.max_cpso_usd + EPS)) out.push(`cost per successful outcome above ${prm.max_cpso_usd}`);
      if (prm.max_p95_ms !== undefined && !(known(s.values.p95_ms) && s.values.p95_ms <= prm.max_p95_ms + EPS)) out.push(`p95 above ${prm.max_p95_ms} ms`);
      if (prm.min_task_success !== undefined && !(known(s.values.task_success) && s.values.task_success >= prm.min_task_success - EPS)) out.push(`task success below ${prm.min_task_success}`);
      if (prm.max_risk !== undefined && !(s.values.risk <= RISK[prm.max_risk])) out.push(`risk above ${prm.max_risk}`);
      if (prm.max_implementation_complexity !== undefined && !(s.values.implementation_complexity <= prm.max_implementation_complexity)) out.push(`implementation complexity above ${prm.max_implementation_complexity}`);
      return out;
    };
    for (const s of eligible.filter((x) => fails(x).length)) excluded.push({ plan_hash: s.plan_hash, name: s.name, reason: fails(s).join('; ') });
    pool = eligible.filter((x) => !fails(x).length);
    note = `objective ${prm.objective}: ${POLICIES[prm.objective].rule}`;
  }
  const ranked = rank(pool, order);
  const selected = ranked[0] || null;
  const dims = order.map(([k]) => k);
  const tradeoffs = selected
    ? eligible
        .filter((s) => s.plan_hash !== selected.plan_hash)
        .map((s) => {
          const c = compare({ values: selected.values }, { values: s.values });
          return { versus: s.name, plan_hash: s.plan_hash, selected_better_on: c.better, selected_worse_on: c.worse };
        })
    : [];
  const explanation = {
    policy: p,
    params: prm,
    rule: POLICIES[p].rule + (note ? ` (${note})` : ''),
    candidates: eligible.length,
    eligible_after_policy: pool.length,
    ranking: ranked.map((s, i) => ({ position: i + 1, plan_hash: s.plan_hash, name: s.name, keys: Object.fromEntries(dims.map((k) => [k, valueOf(s, k)])) })),
    excluded,
    selected: selected ? { plan_hash: selected.plan_hash, name: selected.name, values: selected.values } : null,
    why: selected ? `${selected.name} ranks first under ${p}: ${POLICIES[p].rule}.` : pool.length === 0 && eligible.length ? 'No frontier plan satisfies this policy.' : 'There is no VERIFIED plan on a complete Pareto frontier to select.',
    tradeoffs,
    hard_gates: 'Every candidate passed every required gate of the frozen Evaluation Contract; a policy can only choose among them.',
  };
  return { outcome: selected ? 'SELECTED' : 'NO_ELIGIBLE_PLAN', selected: selected ? selected.plan_hash : null, explanation, decision_hash: sha256Json({ frontier_hash: frontier.hash, policy: p, params: prm, selected: selected ? selected.plan_hash : null }) };
}
