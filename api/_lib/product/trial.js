/**
 * A bounded design-partner evaluation of one authorized workload.
 *
 * Only the parts a person decides live here: who it is for, what data was
 * agreed, what success means, the recommendation, limitations and the next
 * decision. Baseline, requirements, experiments and verdicts are read from the
 * engine tables so the record can never disagree with the evidence.
 */

const FIXTURES = new Set(['representative', 'redacted', 'synthetic', 'production_sample']);
const STATUS = new Set(['planned', 'active', 'reported', 'closed']);
const DECISIONS = new Set(['undecided', 'adopt_candidate', 'extend_evaluation', 'stop']);

function text(value, name, max) {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`${name} must be text.`);
  const t = value.trim();
  if (t.length > max) throw new Error(`${name} is limited to ${max} characters.`);
  return t || undefined;
}

function list(value, name, { maxItems = 10, maxLen = 300 } = {}) {
  if (value === null || value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${name} must be a list.`);
  if (value.length > maxItems) throw new Error(`${name} is limited to ${maxItems} items.`);
  return value.map((v, i) => text(v, `${name}[${i}]`, maxLen)).filter(Boolean);
}

function oneOf(value, name, allowed) {
  if (value === null || value === undefined || value === '') return undefined;
  if (!allowed.has(value)) throw new Error(`${name} must be one of ${[...allowed].join(', ')}.`);
  return value;
}

/** Validate the human-authored parts of a trial. Unknown keys are dropped. */
export function sanitizeTrial(raw) {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('trial must be an object.');
  const out = {
    customer: text(raw.customer, 'customer', 120),
    workload: text(raw.workload, 'workload', 300),
    fixtures: oneOf(raw.fixtures, 'fixtures', FIXTURES),
    data_boundary_note: text(raw.data_boundary_note, 'data_boundary_note', 1000),
    success_criteria: list(raw.success_criteria, 'success_criteria'),
    recommendation: text(raw.recommendation, 'recommendation', 2000),
    limitations: list(raw.limitations, 'limitations'),
    next_decision: oneOf(raw.next_decision, 'next_decision', DECISIONS),
    next_decision_owner: text(raw.next_decision_owner, 'next_decision_owner', 120),
    next_decision_due: text(raw.next_decision_due, 'next_decision_due', 40),
    status: oneOf(raw.status, 'status', STATUS),
  };
  if (out.next_decision_due && Number.isNaN(Date.parse(out.next_decision_due))) throw new Error('next_decision_due must be a date.');
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

/**
 * Merge an update into the stored trial. The data-boundary confirmation is
 * stamped by the server (who and when), never taken from the client.
 */
export function mergeTrial(existing, update, { userId, confirmBoundary = false, now = new Date().toISOString() } = {}) {
  const next = { ...(existing || {}), ...sanitizeTrial(update), updated_at: now, updated_by: userId };
  if (!next.status) next.status = 'active';
  if (confirmBoundary) next.data_boundary_confirmed = { at: now, by: userId };
  return next;
}
