/**
 * Canonical optimization transformations and plan composition.
 *
 * A transformation is one concrete change a pass proposes (reuse answers for
 * `classify_ticket` for one hour; route `openai/gpt-4o` to a smaller model;
 * guard an agent loop). An execution plan is a set of 1–3 transformations in
 * a deterministic composition order.
 *
 * Identity is decision-relevant data only: a transformation hash covers its
 * kind, scope, the settings it changes, its executor config and the pass
 * version; a plan hash covers the contract, the baseline snapshot and the
 * sorted transformation hashes. Proposal order never changes either.
 *
 * Compatibility is deterministic and never silently resolved: two
 * transformations that change the same setting differently conflict; two that
 * touch the same call site or ZevIR node must have a composition rule
 * declared by their passes (`compositionRules`), otherwise they conflict.
 */
import { sha256Json } from '../product/hashing.js';

export const TRANSFORMATION_VERSION = 'tx_v1';
export const PLAN_SCHEMA = 'execution_plan_v1';

/** Outer → inner. A request crosses the layers in this order. */
export const LAYERS = Object.freeze(['agent_control', 'interceptor', 'context', 'model_routing', 'transport']);

export const KINDS = Object.freeze({
  agent_step_budget: { layer: 'agent_control', rank: 0, label: 'Agent step budget' },
  agent_loop_guard: { layer: 'agent_control', rank: 1, label: 'No-progress loop guard' },
  repeated_tool_suppression: { layer: 'agent_control', rank: 2, label: 'Reuse unchanged tool results' },
  tool_result_cache: { layer: 'agent_control', rank: 3, label: 'Tool-result cache' },
  planning_step_collapse: { layer: 'agent_control', rank: 4, label: 'Collapse repeated planning step' },
  parallelization_hint: { layer: 'agent_control', rank: 5, label: 'Parallelize independent steps' },
  exact_lookup: { layer: 'interceptor', rank: 0, label: 'Validated exact lookup' },
  deterministic_rule: { layer: 'interceptor', rank: 1, label: 'Deterministic rule' },
  exact_response_reuse: { layer: 'interceptor', rank: 2, label: 'Exact-response cache' },
  retrieval_result_cache: { layer: 'context', rank: 0, label: 'Retrieval-result cache' },
  retrieval_dedupe: { layer: 'context', rank: 1, label: 'Deduplicate retrieved chunks' },
  retrieval_top_k: { layer: 'context', rank: 2, label: 'Lower retrieval top-k' },
  reranker_skip: { layer: 'context', rank: 3, label: 'Skip reranker' },
  parallel_retrieval: { layer: 'context', rank: 4, label: 'Parallel retrieval' },
  context_window_cap: { layer: 'context', rank: 5, label: 'Cap conversation history' },
  app_prefix_cache: { layer: 'context', rank: 6, label: 'Application prefix cache' },
  provider_prompt_cache: { layer: 'context', rank: 7, label: 'Provider prompt caching' },
  model_substitution: { layer: 'model_routing', rank: 0, label: 'Smaller model' },
  retry_policy: { layer: 'transport', rank: 0, label: 'Bounded retry policy' },
});

/** The only kinds the replay harness can execute today. */
export const EXECUTABLE_KINDS = Object.freeze(['exact_response_reuse', 'exact_lookup', 'model_substitution']);

export const RISK = Object.freeze({ low: 0, medium: 1, high: 2 });
const RISK_NAMES = ['low', 'medium', 'high'];
export const riskName = (n) => RISK_NAMES[Math.max(0, Math.min(2, n))];

const sortedUnique = (xs) => [...new Set(xs.filter((x) => x !== null && x !== undefined).map(String))].sort();

export function transformationHash(t) {
  return sha256Json({ schema: TRANSFORMATION_VERSION, kind: t.kind, scope: t.scope, settings: t.settings, config: t.config, pass: t.pass, pass_version: t.pass_version });
}

/**
 * Builds the canonical form of a pass proposal. Unknown kinds are refused so a
 * typo can never produce an unclassified change.
 */
export function canonicalTransformation(raw) {
  const kind = KINDS[raw.kind];
  if (!kind) throw new Error(`Unknown transformation kind '${raw.kind}'.`);
  const t = {
    kind: raw.kind,
    layer: kind.layer,
    label: raw.label || kind.label,
    scope: String(raw.scope),
    call_site: raw.call_site ? String(raw.call_site) : String(raw.scope),
    settings: raw.settings || {},
    config: raw.config || {},
    pass: raw.pass,
    pass_version: raw.pass_version,
    sources: (raw.sources || []).map((s) => ({ pass: s.pass, pass_version: s.pass_version, diagnosis_hash: s.diagnosis_hash, diagnosis_family: s.diagnosis_family })),
    diagnosis_hashes: sortedUnique(raw.diagnosis_hashes || []),
    executable_status: raw.executable_status,
    not_executable_reason: raw.not_executable_reason ?? null,
    affected_trace_ids: sortedUnique(raw.affected_trace_ids || []),
    affected_nodes: [...(raw.affected_nodes || [])].sort((a, b) => String(a.stable_key).localeCompare(String(b.stable_key))).slice(0, 50),
    risk_class: raw.risk_class,
    implementation_complexity: raw.implementation_complexity,
    rollback_complexity: raw.rollback_complexity,
    required_evidence: raw.required_evidence || [],
    missing_evidence: (raw.required_evidence || []).filter((e) => !e.present).map((e) => e.key),
    expected_effects: raw.expected_effects || {},
    protected_slices: raw.protected_slices || [],
    falsifier: raw.falsifier,
    rollback: raw.rollback,
    materializer_hints: raw.materializer_hints || null,
    metadata: raw.metadata || {},
  };
  if (!RISK_NAMES.includes(t.risk_class)) throw new Error(`Transformation ${t.kind} has no risk class.`);
  if (!t.falsifier || !t.rollback) throw new Error(`Transformation ${t.kind} must declare a falsifier and a rollback.`);
  if (!(t.implementation_complexity >= 1 && t.implementation_complexity <= 5) || !(t.rollback_complexity >= 1 && t.rollback_complexity <= 5)) throw new Error(`Transformation ${t.kind} complexity must be 1–5.`);
  if (!['EXECUTABLE', 'NOT_EXECUTABLE', 'NEEDS_IMPLEMENTATION'].includes(t.executable_status)) throw new Error(`Transformation ${t.kind} has no executable status.`);
  if (t.executable_status === 'EXECUTABLE' && !EXECUTABLE_KINDS.includes(t.kind)) throw new Error(`Transformation ${t.kind} cannot be executable: the replay harness has no executor for it.`);
  t.hash = transformationHash(t);
  return t;
}

/** Same canonical change proposed by two passes or two diagnoses → one transformation with merged lineage. */
export function mergeTransformations(list) {
  const byHash = new Map();
  for (const t of list) {
    const prev = byHash.get(t.hash);
    if (!prev) {
      byHash.set(t.hash, { ...t, sources: [...t.sources] });
      continue;
    }
    const seen = new Set(prev.sources.map((s) => `${s.pass}|${s.diagnosis_hash}`));
    for (const s of t.sources) if (!seen.has(`${s.pass}|${s.diagnosis_hash}`)) prev.sources.push(s);
    prev.diagnosis_hashes = sortedUnique([...prev.diagnosis_hashes, ...t.diagnosis_hashes]);
    prev.affected_trace_ids = sortedUnique([...prev.affected_trace_ids, ...t.affected_trace_ids]);
  }
  return [...byHash.values()].map((t) => ({ ...t, sources: [...t.sources].sort((a, b) => `${a.pass}|${a.diagnosis_hash}`.localeCompare(`${b.pass}|${b.diagnosis_hash}`)) })).sort((a, b) => a.hash.localeCompare(b.hash));
}

// ---- compatibility --------------------------------------------------------------
const pairKey = (a, b) => [a, b].sort().join('+');

/**
 * Collects the composition rules and explicit conflicts declared by passes.
 * rules: [{ kinds: [a, b], order: [first, second], note, escalates }]
 * conflicts: [{ kinds: [a, b], reason }]
 */
export function buildRuleSet(passes) {
  const rules = new Map();
  const conflicts = new Map();
  for (const p of passes) {
    for (const r of p.compositionRules ? p.compositionRules() : []) rules.set(pairKey(r.kinds[0], r.kinds[1]), r);
    for (const c of p.conflictsWith ? p.conflictsWith() : []) conflicts.set(pairKey(c.kinds[0], c.kinds[1]), c);
  }
  return { rules, conflicts };
}

function overlap(a, b) {
  if (a.call_site === b.call_site) return { overlaps: true, why: `same call site '${a.call_site}'` };
  const nodes = new Set(a.affected_nodes.map((n) => n.stable_key));
  const shared = b.affected_nodes.filter((n) => nodes.has(n.stable_key)).map((n) => n.stable_key);
  if (shared.length) return { overlaps: true, why: `${shared.length} shared ZevIR node(s)`, nodes: shared };
  const traces = new Set(a.affected_trace_ids);
  const sharedTraces = b.affected_trace_ids.filter((id) => traces.has(id));
  if (sharedTraces.length) return { overlaps: true, why: `${sharedTraces.length} shared request(s)` };
  return { overlaps: false };
}

/** Pairwise compatibility. Deterministic; never resolves a conflict silently. */
export function pairCompatibility(a, b, ruleSet) {
  if (a.hash === b.hash) return { compatible: false, reason: 'duplicate transformation' };
  const sharedFields = Object.keys(a.settings).filter((k) => k in b.settings);
  const clashing = sharedFields.filter((k) => JSON.stringify(a.settings[k]) !== JSON.stringify(b.settings[k]));
  if (clashing.length) return { compatible: false, reason: `both set ${clashing.join(', ')} to different values`, shared_fields: clashing };
  const ov = overlap(a, b);
  if (!ov.overlaps) return { compatible: true, independent: true, shared_fields: sharedFields };
  const key = pairKey(a.kind, b.kind);
  const conflict = ruleSet.conflicts.get(key);
  if (conflict) return { compatible: false, reason: `${conflict.reason} (${ov.why})`, shared_fields: sharedFields };
  if (a.kind === b.kind) return { compatible: false, reason: `two ${a.kind} transformations on the same path (${ov.why}); no rule composes them`, shared_fields: sharedFields };
  const rule = ruleSet.rules.get(key);
  if (!rule) return { compatible: false, reason: `no declared composition rule for ${a.kind} + ${b.kind} (${ov.why})`, shared_fields: sharedFields };
  return { compatible: true, independent: false, rule, overlap: ov, shared_fields: sharedFields };
}

/** Deterministic composition order: outer layer first, then the kind's rank in its layer, then scope, then hash. */
export function compositionSort(list) {
  return [...list].sort((a, b) => LAYERS.indexOf(a.layer) - LAYERS.indexOf(b.layer) || KINDS[a.kind].rank - KINDS[b.kind].rank || a.scope.localeCompare(b.scope) || a.hash.localeCompare(b.hash));
}

/**
 * Composes transformations into a plan shape. Returns the compatibility result
 * ({ compatible, conflicts, dependencies, composition_order, affected_nodes,
 * shared_fields, risk_escalation }) and the aggregate risk / complexity.
 */
export function compose(list, ruleSet) {
  const ordered = compositionSort(list);
  const conflicts = [];
  const dependencies = [];
  const shared = new Set();
  let escalate = false;
  const escalationReasons = [];
  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      const a = ordered[i];
      const b = ordered[j];
      const r = pairCompatibility(a, b, ruleSet);
      (r.shared_fields || []).forEach((f) => shared.add(f));
      if (!r.compatible) {
        conflicts.push({ a: a.hash, b: b.hash, kinds: [a.kind, b.kind], reason: r.reason });
        continue;
      }
      if (r.rule) {
        const [first] = r.rule.order;
        const before = first === a.kind ? a : b;
        const after = before === a ? b : a;
        dependencies.push({ before: before.hash, after: after.hash, kinds: [before.kind, after.kind], note: r.rule.note });
        if (ordered.indexOf(before) > ordered.indexOf(after)) conflicts.push({ a: a.hash, b: b.hash, kinds: [a.kind, b.kind], reason: `declared order ${before.kind} → ${after.kind} contradicts the layer order` });
        if (r.rule.escalates) {
          escalate = true;
          escalationReasons.push(`${a.kind} + ${b.kind}: ${r.rule.note}`);
        }
      }
    }
  }
  if (ordered.length >= 3) {
    escalate = true;
    escalationReasons.push('three changes shipped together');
  }
  const baseRisk = Math.max(...ordered.map((t) => RISK[t.risk_class]));
  const risk = riskName(baseRisk + (escalate && ordered.length > 1 ? 1 : 0));
  const nodes = new Map();
  for (const t of ordered) for (const n of t.affected_nodes) if (!nodes.has(n.stable_key)) nodes.set(n.stable_key, n);
  return {
    ordered,
    compatibility: {
      compatible: conflicts.length === 0,
      conflicts,
      dependencies,
      composition_order: ordered.map((t) => t.hash),
      affected_nodes: [...nodes.values()].slice(0, 50),
      shared_fields: [...shared].sort(),
      risk_escalation: { from: riskName(baseRisk), to: risk, reasons: escalationReasons },
    },
    risk_class: risk,
    implementation_complexity: ordered.reduce((a, t) => a + t.implementation_complexity, 0),
    rollback_complexity: Math.min(5, Math.max(...ordered.map((t) => t.rollback_complexity)) + (ordered.length > 1 ? 1 : 0)),
  };
}

/** Plan identity: contract + baseline + the SET of transformations (order-free). */
export function planHash({ contractHash, snapshotHash, transformations }) {
  return sha256Json({ schema: PLAN_SCHEMA, contract_hash: contractHash, baseline_snapshot_hash: snapshotHash, transformations: transformations.map((t) => t.hash).sort() });
}

export function planName(ordered) {
  return ordered.map((t) => `${t.label} · ${t.scope}`).join(' + ');
}

/** Executability of a plan: every transformation must be executable; one blocked part blocks the whole plan. */
export function planExecutable(ordered) {
  if (ordered.every((t) => t.executable_status === 'EXECUTABLE')) return { status: 'EXECUTABLE', reasons: [] };
  const blocked = ordered.filter((t) => t.executable_status !== 'EXECUTABLE');
  const status = blocked.some((t) => t.executable_status === 'NEEDS_IMPLEMENTATION') ? 'NEEDS_IMPLEMENTATION' : 'NOT_EXECUTABLE';
  const reasons = blocked.map((t) => `${t.label} (${t.scope}): ${t.not_executable_reason || t.executable_status}`);
  if (blocked.length < ordered.length) reasons.push('A plan is never partly executed: the executable parts are not run on their own under this plan.');
  return { status, reasons };
}
