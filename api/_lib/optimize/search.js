/**
 * Bounded, deterministic plan search (vNext Part 2B).
 *
 *   1. collect pass proposals for the top diagnoses (bounded)
 *   2. canonicalize and merge identical transformations
 *   3. single-transformation plans
 *   4. bounded pairs, then bounded triples built only from compatible pairs
 *   5. conflicts recorded (CONFLICTED), never resolved silently
 *   6. dedupe by plan hash
 *   7. first-order estimates (search prioritisation only — never evidence)
 *   8. sound pruning: redundant compositions, plans that change nothing, and
 *      plans dominated by an output-equivalent plan
 *
 * No unbounded Cartesian product: pairs and triples stop at
 * `max_generated_plans` and the truncation is reported with counts.
 */
import { sha256Json } from '../product/hashing.js';
import { estimateCost, normalizeModel } from '../pricing.js';
import { estimateSampleCost } from '../product/strategies.js';
import { buildRuleSet, canonicalTransformation, compose, mergeTransformations, pairCompatibility, planExecutable, planHash, planName, RISK } from './transformations.js';
import { finalRows, SEARCH_PASSES } from './passes-intelligence.js';
import { responseCache, streamOrder, validatedLookup } from './replay-model.js';
import { stableSum } from './performance.js';

export const SEARCH_VERSION = 'search_v1';

/** Hard ceilings a request can never exceed (validated against the runtime: one stage call ≤ 60 s). */
export const HARD_BOUNDS = Object.freeze({ max_diagnoses: 12, max_proposals_per_pass: 3, max_transformations: 32, max_transformations_per_plan: 3, max_generated_plans: 96, max_calibration_plans: 16, max_calibration_samples_per_plan: 16, max_calibration_samples_total: 300, calibration_rounds: 2, max_full_replay_plans: 8, max_evaluation_set: 100, max_replay_samples_total: 600, max_provider_spend_usd: 5, max_wall_clock_ms: 3_600_000 });
export const DEFAULT_BOUNDS = Object.freeze({ max_diagnoses: 8, max_proposals_per_pass: 3, max_transformations: 24, max_transformations_per_plan: 3, max_generated_plans: 64, max_calibration_plans: 12, max_calibration_samples_per_plan: 10, max_calibration_samples_total: 180, calibration_rounds: 2, max_full_replay_plans: 5, max_evaluation_set: 60, max_replay_samples_total: 300, max_provider_spend_usd: 1, max_wall_clock_ms: 1_800_000 });

export class SearchError extends Error {
  constructor(message, code = 'SEARCH_INVALID') {
    super(message);
    this.code = code;
  }
}

/** Unknown keys are refused; every value must be within (0, hard ceiling]. */
export function normalizeBounds(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SearchError('bounds must be an object.');
  const out = { ...DEFAULT_BOUNDS };
  for (const [k, v] of Object.entries(raw)) {
    if (!(k in HARD_BOUNDS)) throw new SearchError(`Unknown search bound '${k}'.`);
    const n = Number(v);
    const integer = k !== 'max_provider_spend_usd';
    if (!Number.isFinite(n) || n < (k === 'max_provider_spend_usd' ? 0 : 1) || n > HARD_BOUNDS[k] || (integer && !Number.isInteger(n))) throw new SearchError(`${k} must be ${integer ? 'an integer ' : ''}between ${k === 'max_provider_spend_usd' ? 0 : 1} and ${HARD_BOUNDS[k]}.`);
    out[k] = n;
  }
  return out;
}

const known = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));
const seededRank = (seed, id) => sha256Json({ seed, id });
const r10 = (v) => (v === null ? null : Number(Number(v).toFixed(10)));

// ---- evaluation set ----------------------------------------------------------------
/**
 * The frozen evaluation set W of a search: final attempts that can be judged
 * (recorded output, a gradable expectation, known cost, known latency).
 * Exclusions are listed with reasons; above `max` a seeded, outcome-blind
 * selection keeps every protected case first. Deterministic.
 */
export function evaluationSet(traces, { max, seed }) {
  const finals = finalRows(traces);
  const excluded = [];
  const eligible = [];
  for (const t of finals) {
    const reasons = [];
    if (t.output_text === null || t.output_text === undefined) reasons.push('no_recorded_output');
    if (t.expected_output === null || t.expected_output === undefined || t.expected_output === '') reasons.push('outcome_unknown');
    if (!known(t.cost_usd)) reasons.push('cost_unknown');
    if (!known(t.latency_ms)) reasons.push('latency_unknown');
    if (reasons.length) excluded.push({ trace_id: t.id, request_id: t.request_id, reasons });
    else eligible.push(t);
  }
  let chosen = eligible;
  let sampled = false;
  if (eligible.length > max) {
    sampled = true;
    const prot = eligible.filter((t) => t.protected).sort((a, b) => seededRank(seed, a.id).localeCompare(seededRank(seed, b.id)));
    const rest = eligible.filter((t) => !t.protected).sort((a, b) => seededRank(seed, a.id).localeCompare(seededRank(seed, b.id)));
    chosen = [...prot, ...rest].slice(0, max);
  }
  const ids = [...chosen].sort(streamOrder).map((t) => t.id);
  const body = { ids, protected_ids: chosen.filter((t) => t.protected).map((t) => t.id).sort(), excluded, final_requests: finals.length, eligible: eligible.length, sampled, max, seed };
  return { ...body, coverage: finals.length ? Number((eligible.length / finals.length).toFixed(6)) : null, hash: sha256Json(body) };
}

// ---- proposals -----------------------------------------------------------------------
const SEVERITY = { high: 2, medium: 1, low: 0 };
const EXEC_ORDER = { EXECUTABLE: 0, NOT_EXECUTABLE: 1, NEEDS_IMPLEMENTATION: 2 };

export function collectTransformations(diagnoses, ctx, bounds) {
  const ranked = [...diagnoses].sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity] || b.confidence - a.confidence || a.diagnosis_hash.localeCompare(b.diagnosis_hash));
  const considered = ranked.slice(0, bounds.max_diagnoses);
  const notes = { diagnoses_total: diagnoses.length, diagnoses_considered: considered.length, diagnoses_not_considered: ranked.slice(bounds.max_diagnoses).map((d) => ({ family: d.family, scope: d.scope, reason: `max_diagnoses = ${bounds.max_diagnoses}` })), proposals_dropped: [], passes_skipped: [] };
  const raw = [];
  for (const d of considered) {
    for (const pass of SEARCH_PASSES) {
      const app = pass.applicability(d, ctx);
      if (!app.applicable) continue;
      const drafts = pass.transformations(d, ctx);
      if (drafts.length > bounds.max_proposals_per_pass) notes.proposals_dropped.push({ pass: pass.id, diagnosis: `${d.family}:${d.scope}`, dropped: drafts.length - bounds.max_proposals_per_pass, reason: `max_proposals_per_pass = ${bounds.max_proposals_per_pass}` });
      for (const draft of drafts.slice(0, bounds.max_proposals_per_pass)) raw.push(canonicalTransformation(draft));
    }
    if (!(d.suggested_optimization_passes || []).length && !raw.some((t) => t.diagnosis_hashes.includes(d.diagnosis_hash))) notes.passes_skipped.push({ diagnosis: `${d.family}:${d.scope}`, reason: 'diagnosis only: no pass proposes a safe generic change for it' });
  }
  const merged = mergeTransformations(raw).sort((a, b) => EXEC_ORDER[a.executable_status] - EXEC_ORDER[b.executable_status] || a.hash.localeCompare(b.hash));
  if (merged.length > bounds.max_transformations) notes.proposals_dropped.push({ pass: '*', dropped: merged.length - bounds.max_transformations, reason: `max_transformations = ${bounds.max_transformations}` });
  return { transformations: merged.slice(0, bounds.max_transformations), notes, considered };
}

// ---- first-order estimates (prioritisation only) ---------------------------------------
const scopeOf = (t) => t.symbol || t.workflow || 'unattributed';

/**
 * Which path would serve each evaluation case under the plan, in composition
 * order — the same decision rules the replay uses (replay-model.js). Returns
 * per-case { id, path, served_by, output_source }.
 */
export function servingSimulation(ordered, rows, history) {
  const caches = new Map(ordered.filter((t) => t.kind === 'exact_response_reuse').map((t) => [t.hash, responseCache(t.config.ttl_ms ?? null)]));
  const lookups = new Map(ordered.filter((t) => t.kind === 'exact_lookup').map((t) => [t.hash, validatedLookup(history.filter((h) => scopeOf(h) === t.scope && !h.protected), { minValidated: t.config.min_validated || 1 })]));
  const out = [];
  for (const row of [...rows].sort(streamOrder)) {
    let served = null;
    const writeBack = [];
    for (const tx of ordered) {
      if (tx.kind === 'exact_lookup' && scopeOf(row) === tx.scope) {
        const d = lookups.get(tx.hash).decide(row);
        if (d.hit) {
          served = { path: 'lookup_hit', served_by: tx.hash, output_source: `lookup:${d.source_trace_id}` };
          break;
        }
      } else if (tx.kind === 'exact_response_reuse' && scopeOf(row) === tx.scope) {
        const d = caches.get(tx.hash).decide(row);
        if (d.hit) {
          served = { path: 'cache_hit', served_by: tx.hash, output_source: d.entry.output_source };
          break;
        }
        if (d.eligible) writeBack.push(caches.get(tx.hash));
      } else if (tx.kind === 'model_substitution' && tx.affected_trace_ids.includes(row.id)) {
        served = { path: 'model_call', served_by: tx.hash, output_source: `model:${tx.config.to}:${row.id}` };
        break;
      }
    }
    if (!served) served = { path: 'baseline_passthrough', served_by: null, output_source: `baseline:${row.id}` };
    for (const c of writeBack) c.write(row, { output_source: served.output_source });
    out.push({ id: row.id, ...served });
  }
  return out;
}

const est = (value, { source, method, coverage = null, confidence, assumptions = [] }) => ({ value, unknown: value === null, label: 'ESTIMATED', source, method, coverage, confidence, assumptions });

/** First-order effects of a plan on the evaluation set. Unknown stays unknown (null). */
export function estimatePlan(ordered, rows, ctx) {
  const sim = servingSimulation(ordered, rows, ctx.history);
  const byId = new Map(rows.map((t) => [t.id, t]));
  const baselineCost = stableSum(rows.map((t) => t.cost_usd));
  const costs = [];
  let unknownCost = 0;
  let calls = 0;
  let tokensIn = 0;
  let tokensKnown = true;
  let replayCost = 0;
  let replayCostKnown = true;
  const providers = new Map();
  for (const s of sim) {
    const t = byId.get(s.id);
    if (s.path === 'cache_hit' || s.path === 'lookup_hit') {
      costs.push(0);
      continue;
    }
    calls += 1;
    if (s.path === 'baseline_passthrough') {
      costs.push(Number(t.cost_usd));
      const p = (t.provider || 'unknown').toLowerCase();
      providers.set(p, (providers.get(p) || 0) + 1);
      if (known(t.input_tokens)) tokensIn += Number(t.input_tokens);
      else tokensKnown = false;
      continue;
    }
    const tx = ordered.find((x) => x.hash === s.served_by);
    const to = tx.config.to;
    const key = normalizeModel(null, to).key;
    const e = estimateCost(ctx.pricing, key, { input: Number(t.input_tokens || 0), output: Number(t.output_tokens || 0), cached: Number(t.cached_input_tokens || 0) });
    if (e && known(t.input_tokens) && known(t.output_tokens)) costs.push(e.cost);
    else unknownCost += 1;
    const replay = estimateSampleCost(ctx.pricing, to, t, { maxOutputTokens: tx.config.max_tokens });
    if (replay === null) replayCostKnown = false;
    else replayCost += replay;
    const p = String(to).split('/')[0];
    providers.set(p, (providers.get(p) || 0) + 1);
    if (known(t.input_tokens)) tokensIn += Number(t.input_tokens);
    else tokensKnown = false;
  }
  const cost = unknownCost ? null : r10(stableSum(costs));
  const hhi = calls ? r10([...providers.values()].reduce((a, n) => a + (n / calls) ** 2, 0)) : 0;
  const served = {};
  for (const s of sim) if (s.served_by) served[s.served_by] = (served[s.served_by] || 0) + 1;
  return {
    simulation: sim,
    signature: sha256Json(sim.map((s) => [s.id, s.path, s.output_source])),
    served_counts: Object.fromEntries(ordered.map((t) => [t.hash, served[t.hash] || 0])),
    effects: {
      cost_usd: est(cost, { source: 'recorded baseline costs; list prices for substituted calls', method: 'serving simulation over the evaluation set', coverage: rows.length ? (rows.length - unknownCost) / rows.length : null, confidence: unknownCost ? 'low' : ordered.some((t) => t.kind === 'model_substitution') ? 'medium' : 'high', assumptions: ['cache and lookup hits cost nothing', 'substituted calls use the same token counts as the baseline'] }),
      cost_change_usd: est(cost === null ? null : r10(cost - baselineCost), { source: 'estimate − recorded baseline', method: 'difference', confidence: unknownCost ? 'low' : 'medium' }),
      provider_calls: est(calls, { source: 'serving simulation', method: 'count of requests that still reach a provider', coverage: 1, confidence: 'high' }),
      provider_calls_removed: est(rows.length - calls, { source: 'serving simulation', method: 'evaluation cases answered by a cache or lookup', coverage: 1, confidence: 'high' }),
      input_tokens_sent: est(tokensKnown ? tokensIn : null, { source: 'recorded token counts', method: 'sum over requests that reach a provider', confidence: tokensKnown ? 'high' : 'low' }),
      p95_latency_ms: est(null, { source: 'none', method: 'not estimated', confidence: 'none', assumptions: ['cache/lookup latency and substituted-model latency are not known before a replay: UNKNOWN, not 0 ms'] }),
      cost_per_successful_outcome_usd: est(null, { source: 'none', method: 'needs graded outcomes', confidence: 'none', assumptions: ['task success is not estimated; a replay grades it'] }),
      task_success: est(null, { source: 'none', method: 'needs a replay', confidence: 'none' }),
      retry_amplification: est(null, { source: 'none', method: 'not modelled in estimates (see Bad-Day Replay)', confidence: 'none' }),
      provider_concentration: est(hhi, { source: 'serving simulation', method: 'Herfindahl index of provider calls (0 = none, 1 = one provider)', confidence: 'high' }),
      replay_cost_usd: est(replayCostKnown ? r10(replayCost) : null, { source: 'list prices + 25% padding', method: 'upper bound on provider spend for one full replay', confidence: replayCostKnown ? 'medium' : 'none' }),
    },
  };
}

// ---- generation ----------------------------------------------------------------------
function buildPlan(list, { ruleSet, contractHash, snapshotHash }) {
  const c = compose(list, ruleSet);
  const exec = planExecutable(c.ordered);
  const missing = [...new Set(c.ordered.flatMap((t) => t.missing_evidence))].sort();
  const status = !c.compatibility.compatible ? 'CONFLICTED' : missing.length ? 'NEEDS_EVIDENCE' : exec.status !== 'EXECUTABLE' ? 'BLOCKED' : 'PROPOSED';
  return {
    plan_hash: planHash({ contractHash, snapshotHash, transformations: c.ordered }),
    name: planName(c.ordered),
    ordered: c.ordered,
    compatibility: c.compatibility,
    conflict_reasons: c.compatibility.conflicts.map((x) => x.reason),
    risk_class: c.risk_class,
    implementation_complexity: c.implementation_complexity,
    rollback_complexity: c.rollback_complexity,
    executable_status: exec.status,
    blocked_reasons: exec.reasons,
    status,
    status_reasons: status === 'CONFLICTED' ? c.compatibility.conflicts.map((x) => x.reason) : status === 'NEEDS_EVIDENCE' ? missing.map((m) => `missing evidence: ${m}`) : status === 'BLOCKED' ? exec.reasons : [],
    missing_evidence: missing,
    source_diagnosis_hashes: [...new Set(c.ordered.flatMap((t) => t.diagnosis_hashes))].sort(),
  };
}

/**
 * Generates, estimates and prunes plans. ctx = pass context + { history, pricing }.
 * Returns { plans, transformations, generation }.
 */
export function generatePlans({ diagnoses, ctx, bounds, contractHash, snapshotHash, evaluation, rows }) {
  const { transformations, notes } = collectTransformations(diagnoses, ctx, bounds);
  const ruleSet = buildRuleSet(SEARCH_PASSES);
  const keyArgs = { ruleSet, contractHash, snapshotHash };
  const plans = new Map();
  let attempted = 0;
  let truncated = 0;
  const add = (list) => {
    if (plans.size >= bounds.max_generated_plans) {
      truncated += 1;
      return null;
    }
    attempted += 1;
    const p = buildPlan(list, keyArgs);
    if (!plans.has(p.plan_hash)) plans.set(p.plan_hash, p);
    return p;
  };
  for (const t of transformations) add([t]);
  // Compositions only among transformations that are, or could be, executable with evidence present;
  // blocked-by-design kinds stay single plans (they could never be replayed together).
  const composable = transformations.filter((t) => t.executable_status !== 'NEEDS_IMPLEMENTATION' && !t.missing_evidence.length);
  const compatiblePair = new Map();
  if (bounds.max_transformations_per_plan >= 2) {
    for (let i = 0; i < composable.length; i += 1) {
      for (let j = i + 1; j < composable.length; j += 1) {
        const r = pairCompatibility(composable[i], composable[j], ruleSet);
        compatiblePair.set(`${i}|${j}`, r.compatible);
        add([composable[i], composable[j]]);
      }
    }
  }
  if (bounds.max_transformations_per_plan >= 3) {
    for (let i = 0; i < composable.length; i += 1) for (let j = i + 1; j < composable.length; j += 1) for (let k = j + 1; k < composable.length; k += 1) {
      if (compatiblePair.get(`${i}|${j}`) && compatiblePair.get(`${i}|${k}`) && compatiblePair.get(`${j}|${k}`)) add([composable[i], composable[j], composable[k]]);
    }
  }
  const list = [...plans.values()].sort((a, b) => a.plan_hash.localeCompare(b.plan_hash));

  // Estimates for every plan whose transformations could run.
  for (const p of list) {
    if (p.status === 'CONFLICTED' || p.status === 'NEEDS_EVIDENCE' || p.executable_status === 'NEEDS_IMPLEMENTATION') {
      p.estimate = null;
      continue;
    }
    p.estimate = estimatePlan(p.ordered, rows, ctx);
  }
  // Sound pruning, only among PROPOSED plans.
  const proposed = list.filter((p) => p.status === 'PROPOSED');
  for (const p of proposed) {
    const idle = Object.entries(p.estimate.served_counts).filter(([, n]) => n === 0).map(([h]) => p.ordered.find((t) => t.hash === h));
    if (idle.length === p.ordered.length) {
      p.status = 'PRUNED';
      p.status_reasons = ['Changes no request of the evaluation set: nothing to evaluate.'];
    } else if (idle.length) {
      p.status = 'PRUNED';
      p.status_reasons = idle.map((t) => `Redundant composition: ${t.label} (${t.scope}) would serve no request after the earlier changes.`);
    }
  }
  const live = proposed.filter((p) => p.status === 'PROPOSED');
  for (const b of live) {
    // Prunable only when the comparison is valid: identical serving (same path and same answer source on
    // every case) makes quality, task success, cost and latency identical, so only risk and complexity differ.
    const dominator = live.find((a) => a !== b && a.status === 'PROPOSED' && a.estimate.signature === b.estimate.signature && RISK[a.risk_class] <= RISK[b.risk_class] && a.implementation_complexity <= b.implementation_complexity && a.rollback_complexity <= b.rollback_complexity && (RISK[a.risk_class] < RISK[b.risk_class] || a.implementation_complexity < b.implementation_complexity || a.rollback_complexity < b.rollback_complexity));
    if (dominator) {
      b.status = 'PRUNED';
      b.status_reasons = [`Dominated before replay by '${dominator.name}': it serves every request the same way (same answers, same cost) with lower risk or complexity.`];
      b.pruned_by = dominator.plan_hash;
    }
  }
  // Priority for calibration: largest estimated known saving first, unknown savings last; then risk, complexity, hash.
  for (const p of list) p.priority = p.estimate && p.estimate.effects.cost_change_usd.value !== null ? r10(-p.estimate.effects.cost_change_usd.value) : null;
  for (const p of list) if (p.status === 'PROPOSED') p.status = 'CALIBRATION_READY';

  const counts = {};
  for (const p of list) counts[p.status] = (counts[p.status] || 0) + 1;
  return {
    plans: list,
    transformations,
    generation: { ...notes, transformations: transformations.length, attempted, generated: list.length, truncated, truncation_note: truncated ? `${truncated} composition(s) not generated: max_generated_plans = ${bounds.max_generated_plans}.` : null, counts, evaluation_set: { size: evaluation.ids.length, coverage: evaluation.coverage, excluded: evaluation.excluded.length, sampled: evaluation.sampled } },
  };
}

/** Calibration order: executable plans by estimated saving (known first), then lower risk, lower complexity, hash. */
export function calibrationOrder(plans) {
  return [...plans].sort((a, b) => (a.priority === null) - (b.priority === null) || (b.priority ?? 0) - (a.priority ?? 0) || RISK[a.risk_class] - RISK[b.risk_class] || a.implementation_complexity - b.implementation_complexity || a.plan_hash.localeCompare(b.plan_hash));
}

/** The deterministic identity of a search (same inputs → same search, same plans). */
export function searchHash({ contractHash, snapshotHash, diagnoses, bounds, seed }) {
  return sha256Json({ version: SEARCH_VERSION, contract_hash: contractHash, snapshot_hash: snapshotHash, diagnoses: diagnoses.map((d) => d.diagnosis_hash).sort(), passes: SEARCH_PASSES.map((p) => `${p.id}@${p.version}`), bounds, seed });
}
