/**
 * Evaluation Contract: the success criteria a team freezes BEFORE an
 * optimization result is known. A frozen contract is immutable; changing a
 * criterion means a new version that supersedes the old one.
 *
 * It maps onto the existing gate config (evaluator.js) and the project floor
 * (engine_products.evaluation_requirements) still applies on top of it, so a
 * contract can tighten the project's bar but never loosen it.
 */
import { sha256Json } from '../product/hashing.js';
import { normalizeGateConfig } from '../product/evaluator.js';

export const CONTRACT_SCHEMA = 'contract_v1';
export const REQUIRED_METRICS = Object.freeze(['cost', 'latency', 'quality', 'task_success', 'reliability', 'protected']);

/** Defaults are the strictest reasonable starting point; a team edits the draft before freezing. */
export const DEFAULT_REQUIREMENTS = Object.freeze({
  quality_floor: 0.95,
  quality_tolerance: 0,
  min_task_success_rate: null,
  task_success_tolerance: 0,
  latency: { require: true, max_p95_ms: null, max_regression_pct: 20 },
  protected: { require_cases: false, min_cases: 0 },
  cost: { require_evidence: true, min_coverage: 0.9, require_improvement: true, min_improvement_pct: 0 },
  evidence: { min_samples: 5, min_latency_samples: 20, min_outcome_coverage: 0.8 },
  required_metrics: ['cost', 'quality', 'latency'],
  reliability: { max_failure_rate: null, max_retry_rate: null },
  allowed_providers: null,
  allowed_models: null,
  policy: { no_protected_regression: true, require_data_boundary: false },
  dataset_version: null,
});

class ContractError extends Error {}
export { ContractError };

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function num(value, name, { min, max, integer = false, nullable = false }) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    throw new ContractError(`${name} is required.`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new ContractError(`${name} must be ${integer ? 'an integer ' : ''}between ${min} and ${max}.`);
  return n;
}

function list(value, name, pattern) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) throw new ContractError(`${name} must be a list or null.`);
  const out = [...new Set(value.map((v) => String(v).trim()).filter(Boolean))].sort();
  if (out.length > 50) throw new ContractError(`${name} holds at most 50 entries.`);
  for (const v of out) if (!pattern.test(v)) throw new ContractError(`${name} entry '${v.slice(0, 60)}' has an invalid format.`);
  return out.length ? out : null;
}

/**
 * Validates a requested requirement set into the canonical, fully-populated
 * shape. Unknown keys are refused so a typo can never silently drop a gate.
 */
export function normalizeRequirements(raw = {}) {
  if (!isObj(raw)) throw new ContractError('requirements must be an object.');
  const known = new Set(Object.keys(DEFAULT_REQUIREMENTS));
  for (const k of Object.keys(raw)) if (!known.has(k)) throw new ContractError(`Unknown contract field '${k}'.`);
  const d = DEFAULT_REQUIREMENTS;
  const pick = (k) => (raw[k] === undefined ? d[k] : raw[k]);
  const sub = (k) => {
    const v = raw[k] === undefined ? d[k] : raw[k];
    if (!isObj(v)) throw new ContractError(`${k} must be an object.`);
    for (const key of Object.keys(v)) if (!(key in d[k])) throw new ContractError(`Unknown contract field '${k}.${key}'.`);
    return { ...d[k], ...v };
  };
  const latency = sub('latency');
  const prot = sub('protected');
  const cost = sub('cost');
  const evidence = sub('evidence');
  const reliability = sub('reliability');
  const policy = sub('policy');
  const metrics = pick('required_metrics');
  if (!Array.isArray(metrics)) throw new ContractError('required_metrics must be a list.');
  const requiredMetrics = [...new Set(metrics.map(String))].sort();
  for (const m of requiredMetrics) if (!REQUIRED_METRICS.includes(m)) throw new ContractError(`required_metrics entry '${m}' must be one of ${REQUIRED_METRICS.join(', ')}.`);

  const out = {
    quality_floor: num(pick('quality_floor'), 'quality_floor', { min: 0.5, max: 1 }),
    quality_tolerance: num(pick('quality_tolerance'), 'quality_tolerance', { min: 0, max: 0.5 }),
    min_task_success_rate: num(pick('min_task_success_rate'), 'min_task_success_rate', { min: 0, max: 1, nullable: true }),
    task_success_tolerance: num(pick('task_success_tolerance'), 'task_success_tolerance', { min: 0, max: 0.5 }),
    latency: {
      require: Boolean(latency.require),
      max_p95_ms: num(latency.max_p95_ms, 'latency.max_p95_ms', { min: 1, max: 3_600_000, nullable: true }),
      max_regression_pct: num(latency.max_regression_pct, 'latency.max_regression_pct', { min: 0, max: 1000, nullable: true }),
    },
    protected: { require_cases: Boolean(prot.require_cases), min_cases: num(prot.min_cases, 'protected.min_cases', { min: 0, max: 10000, integer: true }) },
    cost: {
      require_evidence: Boolean(cost.require_evidence),
      min_coverage: num(cost.min_coverage, 'cost.min_coverage', { min: 0, max: 1 }),
      require_improvement: Boolean(cost.require_improvement),
      min_improvement_pct: num(cost.min_improvement_pct, 'cost.min_improvement_pct', { min: 0, max: 100 }),
    },
    evidence: {
      min_samples: num(evidence.min_samples, 'evidence.min_samples', { min: 3, max: 10000, integer: true }),
      min_latency_samples: num(evidence.min_latency_samples, 'evidence.min_latency_samples', { min: 1, max: 100000, integer: true }),
      min_outcome_coverage: num(evidence.min_outcome_coverage, 'evidence.min_outcome_coverage', { min: 0, max: 1 }),
    },
    required_metrics: requiredMetrics,
    reliability: {
      max_failure_rate: num(reliability.max_failure_rate, 'reliability.max_failure_rate', { min: 0, max: 1, nullable: true }),
      max_retry_rate: num(reliability.max_retry_rate, 'reliability.max_retry_rate', { min: 0, max: 1, nullable: true }),
    },
    allowed_providers: list(pick('allowed_providers'), 'allowed_providers', /^[a-z0-9._-]{1,60}$/),
    allowed_models: list(pick('allowed_models'), 'allowed_models', /^[A-Za-z0-9._:/-]{1,160}$/),
    policy: { no_protected_regression: Boolean(policy.no_protected_regression), require_data_boundary: Boolean(policy.require_data_boundary) },
    dataset_version: pick('dataset_version') === null ? null : String(pick('dataset_version')).trim().slice(0, 120) || null,
  };
  if (out.latency.require && out.latency.max_p95_ms === null && out.latency.max_regression_pct === null) throw new ContractError('A latency requirement needs latency.max_p95_ms or latency.max_regression_pct.');
  if (out.required_metrics.includes('task_success') && out.min_task_success_rate === null) throw new ContractError('task_success is required but min_task_success_rate is not set.');
  if (out.required_metrics.includes('protected') && !out.protected.require_cases) out.protected.require_cases = true;
  if (out.required_metrics.includes('latency')) out.latency.require = true;
  if (out.required_metrics.includes('cost')) out.cost.require_evidence = true;
  return out;
}

/**
 * Seeds a first draft from the project's existing floor so a team does not
 * start below what it already promised (evaluation_requirements, 014).
 */
export function requirementsFromProjectFloor(floor = {}) {
  const r = structuredClone(DEFAULT_REQUIREMENTS);
  if (typeof floor.quality_floor === 'number') r.quality_floor = Math.max(r.quality_floor, floor.quality_floor);
  if (typeof floor.min_samples === 'number') r.evidence = { ...r.evidence, min_samples: Math.max(r.evidence.min_samples, floor.min_samples) };
  if (typeof floor.max_latency_regression_pct === 'number') r.latency = { ...r.latency, max_regression_pct: Math.min(r.latency.max_regression_pct, floor.max_latency_regression_pct) };
  if (floor.require_protected_cases) r.protected = { ...r.protected, require_cases: true };
  if (floor.require_latency) r.latency = { ...r.latency, require: true };
  return normalizeRequirements(r);
}

/**
 * Hash over every decision-relevant field (the normalized requirements, the
 * product and the dataset version). Version numbers and timestamps are not
 * decisions, so two identical contracts have the same hash.
 */
export function contractHash(productId, requirements) {
  return sha256Json({ schema: CONTRACT_SCHEMA, product_id: productId, requirements: normalizeRequirements(requirements) });
}

/** The gate config the existing evaluator runs under for this contract. */
export function contractGateConfig(requirements) {
  const r = normalizeRequirements(requirements);
  return normalizeGateConfig({
    min_samples: r.evidence.min_samples,
    quality_floor: r.quality_floor,
    non_inferiority_tolerance: r.quality_tolerance,
    require_cost_improvement: r.cost.require_improvement,
    min_cost_improvement_pct: r.cost.min_improvement_pct,
    require_latency: r.latency.require && r.latency.max_regression_pct !== null,
    latency_informational: !r.latency.require,
    max_latency_regression_pct: r.latency.max_regression_pct ?? 10000,
    require_protected_cases: r.protected.require_cases,
    require_fallback: true,
  });
}

/** The fields a draft may change (everything decision-relevant); nothing may change after freezing. */
export function assertDraft(contract) {
  if (contract.status !== 'draft') throw new ContractError(`Contract v${contract.version} is ${contract.status} and cannot change. Create a new version.`);
}
