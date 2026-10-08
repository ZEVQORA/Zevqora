/**
 * Product event taxonomy `zevqora.product_event.v1` (vNext Part 3).
 *
 * One list, one version, one owner (first-party Postgres). Properties are an
 * allow-list of ids, counts and enums — never prompts, outputs, traces, code,
 * evaluation samples or free text. The database CHECK mirrors EVENTS.
 */
export const TAXONOMY_VERSION = 1;
export const TAXONOMY_NAME = 'zevqora.product_event.v1';

export const EVENTS = Object.freeze([
  'signup_started',
  'signup_completed',
  'workspace_created',
  'project_created',
  'evidence_connected',
  'trace_imported',
  'baseline_created',
  'contract_frozen',
  'diagnosis_viewed',
  'plan_search_started',
  'calibration_completed',
  'full_replay_completed',
  'verdict_verified',
  'verdict_rejected',
  'verdict_incomplete',
  'pareto_viewed',
  'plan_selected',
  'report_opened',
  'evaluation_requested',
]);

/** View events the browser may report (after a membership check). Everything else is server-emitted. */
export const CLIENT_EVENTS = Object.freeze(['diagnosis_viewed', 'pareto_viewed', 'report_opened']);

/** Allowed property keys per event; values must be numbers, booleans or short safe tokens. */
export const PROPERTIES = Object.freeze({
  signup_started: ['source'],
  signup_completed: ['provider'],
  workspace_created: [],
  project_created: ['source'],
  evidence_connected: ['source_kind'],
  trace_imported: ['imported', 'rejected', 'source_kind'],
  baseline_created: ['trace_count', 'completeness', 'reused'],
  contract_frozen: ['version'],
  diagnosis_viewed: ['family', 'surface'],
  plan_search_started: ['generated', 'reused'],
  calibration_completed: ['calibrated', 'rejected'],
  full_replay_completed: ['replayed', 'verified', 'rejected', 'incomplete'],
  verdict_verified: ['stage', 'strategy'],
  verdict_rejected: ['stage', 'strategy'],
  verdict_incomplete: ['stage', 'strategy'],
  pareto_viewed: ['frontier', 'surface'],
  plan_selected: ['policy', 'outcome'],
  report_opened: ['view', 'surface'],
  evaluation_requested: ['ai_spend_band'],
});

const TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;

/** Keeps only allow-listed keys with safe scalar values. Unknown keys are dropped, never stored. */
export function cleanProperties(event, input) {
  const allowed = PROPERTIES[event] || [];
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const key of allowed) {
    const v = input[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = Math.round(v * 1e6) / 1e6;
    else if (typeof v === 'boolean') out[key] = v;
    else if (typeof v === 'string' && TOKEN.test(v)) out[key] = v;
  }
  return out;
}

/** The funnel shown to admins, in order. Each step lists the events that satisfy it. */
export const FUNNEL = Object.freeze([
  { key: 'visitor', label: 'Visitor', source: 'site_events' },
  { key: 'signup', label: 'Signup', events: ['signup_completed'] },
  { key: 'workspace', label: 'Workspace', events: ['workspace_created'] },
  { key: 'evidence', label: 'Evidence connected', events: ['evidence_connected', 'trace_imported'] },
  { key: 'baseline', label: 'Baseline', events: ['baseline_created'] },
  { key: 'search', label: 'Optimization search', events: ['plan_search_started'] },
  { key: 'replay', label: 'Replay', events: ['full_replay_completed'] },
  { key: 'verdict', label: 'Verdict', events: ['verdict_verified', 'verdict_rejected', 'verdict_incomplete'] },
  { key: 'evidence_viewed', label: 'Evidence viewed', events: ['report_opened'] },
]);
