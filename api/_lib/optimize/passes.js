/**
 * OptimizationPass v0.1. A pass turns one diagnosis into at most a few
 * candidate plans. It is deterministic and declares, for every candidate,
 * what it expects, what would falsify it, how to roll it back and whether
 * the current replay engine can actually execute it.
 *
 *   id, version
 *   applicability(diagnosis, ctx)      → { applicable, reasons }
 *   requiredEvidence(diagnosis, ctx)   → [{ key, present, detail }]
 *   propose(diagnosis, ctx)            → plan drafts (engine_plans shape)
 *   expectedEffects(draft, diagnosis)  → projected direction per metric (never a verified number)
 *   riskClass(draft, diagnosis)        → low | medium | high
 *   protectedSlices(diagnosis, ctx)    → what must not regress
 *   falsifier(draft, diagnosis)        → what result proves the candidate wrong
 *   rollback(draft)                    → how to undo it
 *   materializerHints(draft)           → what a code change would touch
 *
 * Only exact_reuse and model_substitution are executable by today's engine.
 * Anything else is NEEDS_IMPLEMENTATION and is stored BLOCKED, never run.
 */
import { sha256Json } from '../product/hashing.js';
import { configHash, PLAN_VERSION, planExactReuse, planModelSubstitution } from '../product/strategies.js';
import { normalizeModel } from '../pricing.js';

export const EXECUTABLE = 'EXECUTABLE';
export const NOT_EXECUTABLE = 'NOT_EXECUTABLE';
export const NEEDS_IMPLEMENTATION = 'NEEDS_IMPLEMENTATION';
export const MAX_CANDIDATES_PER_DIAGNOSIS = 3;

const scoped = (traces, scope) => traces.filter((t) => (t.symbol || t.workflow || 'unattributed') === scope);

/** A plan that the replay engine cannot run: stored BLOCKED with the reason, so the execute route refuses it. */
function implementationDraft(strategy, diagnosis, { mechanism, candidateConfig, requiredEvidence, risk }) {
  const draft = {
    strategy,
    status: 'BLOCKED',
    finding_id: null,
    reason: `${mechanism} This change cannot be replayed by the current engine; it needs an implementation before it can be evaluated.`,
    blocked_reason: 'needs_implementation',
    expected_mechanism: mechanism,
    risk,
    fallback: 'retain_baseline',
    max_budget_usd: 0,
    sample_scope: [],
    baseline_config: { diagnosis_hash: diagnosis.diagnosis_hash },
    candidate_config: candidateConfig,
    required_evidence: requiredEvidence,
    plan_version: PLAN_VERSION,
  };
  draft.config_hash = configHash(draft);
  return draft;
}

export const redundantCallPass = {
  id: 'redundant_call',
  version: '0.1.0',
  families: ['redundant_call'],
  applicability(d) {
    if (d.family !== 'redundant_call') return { applicable: false, reasons: ['only applies to redundant_call diagnoses'] };
    if (!d.metrics.reusable_groups) return { applicable: false, reasons: ['every repeated group is protected, side-effecting or uses tools'] };
    return { applicable: true, reasons: [] };
  },
  requiredEvidence(d, ctx) {
    const rows = scoped(ctx.traces, d.scope);
    return [
      { key: 'repeated_equivalent_runtime_traces', present: d.metrics.groups > 0, detail: `${d.metrics.groups} group(s)` },
      { key: 'recorded_outputs', present: rows.some((t) => t.output_text), detail: 'a reused answer needs a recorded output' },
      { key: 'non_protected', present: d.metrics.reusable_groups > 0, detail: `${d.metrics.reusable_groups} reusable group(s)` },
    ];
  },
  propose(d, ctx) {
    const draft = planExactReuse(scoped(ctx.traces, d.scope), { id: null, symbol: d.scope });
    return [draft];
  },
  expectedEffects(draft, d) {
    return { cost: { direction: 'decrease', basis: 'projected', note: `at most the duplicate known cost observed (${d.metrics.duplicate_known_cost_usd ?? 'unknown'} USD)` }, latency: { direction: 'decrease', basis: 'projected' }, quality: { direction: 'unchanged_required', basis: 'replay decides' } };
  },
  riskClass: () => 'low',
  protectedSlices: () => ['protected cases are excluded from reuse and must still pass'],
  falsifier: (draft, d) => d.falsifier,
  rollback: () => 'Disable the reuse cache; every request goes to the provider again (the baseline path).',
  materializerHints: (draft, d) => ({ kind: 'cache_layer', target: d.scope, notes: 'Key the cache on the identity fields in baseline_config.identity_fields; never cache protected or side-effecting calls.' }),
};

export const modelProviderPass = {
  id: 'model_provider',
  version: '0.1.0',
  families: ['model_overprovisioning'],
  candidateModel(d) {
    return d.metrics.candidate_model || null;
  },
  applicability(d, ctx) {
    if (!this.families.includes(d.family)) return { applicable: false, reasons: ['only applies to model_overprovisioning'] };
    const candidate = this.candidateModel(d);
    if (!candidate) return { applicable: false, reasons: ['no cheaper supported candidate model is known for this diagnosis'] };
    const allowedModels = ctx.contract.requirements.allowed_models;
    const allowedProviders = ctx.contract.requirements.allowed_providers;
    if (allowedModels && !allowedModels.includes(candidate)) return { applicable: false, reasons: [`the frozen contract does not allow ${candidate}`] };
    if (allowedProviders && !allowedProviders.includes(candidate.split('/')[0])) return { applicable: false, reasons: [`the frozen contract does not allow provider ${candidate.split('/')[0]}`] };
    return { applicable: true, reasons: [] };
  },
  requiredEvidence(d, ctx) {
    const candidate = this.candidateModel(d);
    const rows = this.rows(d, ctx);
    return [
      { key: 'replayable_baseline_samples', present: rows.length > 0, detail: `${rows.length} non-protected trace(s) with recorded input` },
      { key: 'allowlisted_candidate_model', present: Boolean(candidate && ctx.allowedModels.has(candidate)), detail: candidate || 'none' },
    ];
  },
  rows(d, ctx) {
    return ctx.traces.filter((t) => !t.protected && (t.input_text || t.expected_output) && normalizeModel(t.provider, t.model || t.requested_model).key === d.scope);
  },
  propose(d, ctx) {
    const candidate = this.candidateModel(d);
    return [planModelSubstitution(this.rows(d, ctx), null, { candidateModel: candidate, allowedModels: ctx.allowedModels, maxBudgetUsd: null, pricing: ctx.pricing })];
  },
  expectedEffects: () => ({ cost: { direction: 'decrease', basis: 'projected from list prices' }, latency: { direction: 'unknown', basis: 'replay measures it' }, quality: { direction: 'unknown', basis: 'replay decides; a smaller model is NOT assumed safe' } }),
  riskClass: () => 'medium',
  protectedSlices: () => ['protected traces are never sent to the candidate model; they keep the baseline model'],
  falsifier: (draft, d) => d.falsifier,
  rollback: (draft) => `Route the workload back to its current model (${draft.baseline_config?.baseline_hashes ? Object.values(draft.baseline_config.baseline_hashes)[0]?.model || 'baseline' : 'baseline'}).`,
  materializerHints: (draft) => ({ kind: 'model_config', target: 'model id in the call site', notes: `Change the model to ${draft.candidate_config?.model || 'the candidate'} behind a flag, keep the baseline as fallback.` }),
};

export const retryAmplificationPass = {
  id: 'retry_amplification',
  version: '0.1.0',
  families: ['retry_amplification'],
  applicability(d) {
    if (d.family !== 'retry_amplification') return { applicable: false, reasons: ['only applies to retry_amplification'] };
    return d.metrics.amplification >= 1.05 ? { applicable: true, reasons: [] } : { applicable: false, reasons: ['amplification below 1.05'] };
  },
  requiredEvidence(d) {
    return [
      { key: 'retry_reasons', present: Object.keys(d.metrics.retry_reasons || {}).length > 0, detail: 'which failures are retried decides which can be made non-retryable' },
      { key: 'retried_requests', present: d.metrics.retried_requests > 0, detail: `${d.metrics.retried_requests} request(s)` },
    ];
  },
  propose(d) {
    const permanent = Object.keys(d.metrics.failure_classes || {}).filter((c) => /4\d\d|invalid|auth|validation|bad_request|content/i.test(c));
    return [
      implementationDraft('retry_policy', d, {
        mechanism: 'Bound retries: stop retrying permanent failures, cap attempts and back off with jitter on transient ones.',
        candidateConfig: { max_attempts: 2, backoff: 'exponential_jitter', non_retryable_classes: permanent, retry_on: Object.keys(d.metrics.retry_reasons || {}).sort() },
        requiredEvidence: ['retry_reasons', 'failure_classes', 'post-change success rate'],
        risk: 'medium',
      }),
    ];
  },
  expectedEffects: (draft, d) => ({ cost: { direction: 'decrease', basis: 'projected', note: `bounded by retry known cost ${d.metrics.retry_known_cost_usd ?? 'unknown'} USD` }, latency: { direction: 'decrease', basis: 'projected' }, task_success: { direction: 'may_decrease', basis: 'fewer retries can lose recoverable requests; must be measured' } }),
  riskClass: () => 'medium',
  protectedSlices: () => ['requests whose retry currently recovers a protected case'],
  falsifier: () => 'Wrong if task success or protected-case success drops after retries are bounded.',
  rollback: () => 'Restore the previous retry policy (attempt cap and retry classes).',
  materializerHints: (draft) => ({ kind: 'retry_policy', target: 'client retry configuration', notes: JSON.stringify(draft.candidate_config) }),
};

export const contextMemoryPass = {
  id: 'context_memory',
  version: '0.1.0',
  families: ['context_amplification'],
  applicability(d) {
    if (d.family !== 'context_amplification') return { applicable: false, reasons: ['only applies to context_amplification'] };
    return { applicable: true, reasons: [] };
  },
  requiredEvidence(d) {
    return [{ key: 'input_token_counts', present: d.metrics.calls >= 3, detail: `${d.metrics.calls} call(s) with input token counts` }];
  },
  propose(d) {
    const out = [];
    if (d.metrics.signals.includes('uncached_stable_prefix')) out.push(implementationDraft('prompt_cache', d, { mechanism: 'Mark the stable instruction prefix as cacheable with the provider so repeated prefixes are billed at the cached-input rate.', candidateConfig: { cache: 'provider_prompt_cache', prefix: 'system_prompt' }, requiredEvidence: ['stable prefix hash', 'provider cache support', 'cached_input_tokens after change'], risk: 'low' }));
    if (d.metrics.signals.includes('conversation_growth') || d.metrics.signals.includes('oversized_input')) out.push(implementationDraft('context_window_cap', d, { mechanism: 'Cap or summarize conversation history beyond a fixed window instead of resending it in full.', candidateConfig: { history: 'window_or_summary', window_turns: 6 }, requiredEvidence: ['graded replay with the capped context'], risk: 'medium' }));
    return out;
  },
  expectedEffects: (draft) => (draft.strategy === 'prompt_cache' ? { cost: { direction: 'decrease', basis: 'projected from cached-input pricing' }, latency: { direction: 'decrease_or_unchanged', basis: 'projected' }, quality: { direction: 'unchanged_expected', basis: 'same tokens, cached' } } : { cost: { direction: 'decrease', basis: 'projected' }, quality: { direction: 'unknown', basis: 'removing context can lose information; replay decides' } }),
  riskClass: (draft) => draft.risk,
  protectedSlices: () => ['cases whose answer depends on early conversation turns'],
  falsifier: (draft) => (draft.strategy === 'prompt_cache' ? 'Wrong if cached_input_tokens stay near zero after the change (the prefix is not actually stable).' : 'Wrong if graded quality or task success drops with the capped context.'),
  rollback: (draft) => (draft.strategy === 'prompt_cache' ? 'Remove the cache markers.' : 'Send the full history again.'),
  materializerHints: (draft) => ({ kind: draft.strategy, target: 'prompt assembly', notes: JSON.stringify(draft.candidate_config) }),
};

export const PASSES = Object.freeze([redundantCallPass, modelProviderPass, retryAmplificationPass, contextMemoryPass]);
export const passById = (id) => PASSES.find((p) => p.id === id) || null;

/** Lineage-bound identity of a candidate: same evidence and contract → same hash. */
export function candidateConfigHash({ pass, diagnosis, contractHash, snapshotHash, draft }) {
  return sha256Json({ pass: pass.id, pass_version: pass.version, diagnosis_hash: diagnosis.diagnosis_hash, contract_hash: contractHash, baseline_snapshot_hash: snapshotHash, strategy: draft.strategy, config_hash: draft.config_hash, candidate_config: draft.candidate_config, sample_scope: draft.sample_scope });
}

function executableStatus(draft, ctx) {
  if (draft.blocked_reason === 'needs_implementation') return NEEDS_IMPLEMENTATION;
  if (draft.status !== 'READY') return NOT_EXECUTABLE;
  if (draft.strategy === 'exact_reuse') return EXECUTABLE;
  if (draft.strategy === 'model_substitution') return ctx.platformCompute ? EXECUTABLE : NOT_EXECUTABLE;
  return NOT_EXECUTABLE;
}

/**
 * Candidates for a set of diagnoses: each diagnosis → its suggested passes →
 * at most 3 drafts. ctx = { traces, contract: { id, hash, requirements },
 * snapshot: { id, snapshot_hash }, pricing, allowedModels, platformCompute }.
 * Returns { candidates, skipped }.
 */
export function generateCandidates(diagnoses, ctx) {
  const candidates = [];
  const skipped = [];
  for (const d of diagnoses) {
    let produced = 0;
    for (const passId of d.suggested_optimization_passes || []) {
      const pass = passById(passId);
      if (!pass) continue;
      const app = pass.applicability(d, ctx);
      if (!app.applicable) {
        skipped.push({ diagnosis_hash: d.diagnosis_hash, pass: pass.id, reasons: app.reasons });
        continue;
      }
      const evidence = pass.requiredEvidence(d, ctx);
      const missing = evidence.filter((e) => !e.present);
      if (missing.length) {
        skipped.push({ diagnosis_hash: d.diagnosis_hash, pass: pass.id, reasons: missing.map((e) => `missing evidence: ${e.key} (${e.detail})`) });
        continue;
      }
      for (const draft of pass.propose(d, ctx)) {
        if (produced >= MAX_CANDIDATES_PER_DIAGNOSIS) break;
        produced += 1;
        const status = executableStatus(draft, ctx);
        const lineage = {
          diagnosis_hash: d.diagnosis_hash,
          diagnosis_family: d.family,
          expected_effects: pass.expectedEffects(draft, d),
          required_evidence: evidence,
          protected_slices: pass.protectedSlices(d, ctx),
          falsifier: pass.falsifier(draft, d),
          rollback: pass.rollback(draft),
          materializer_hints: pass.materializerHints(draft, d),
          not_executable_reason: status === EXECUTABLE ? null : status === NEEDS_IMPLEMENTATION ? 'The replay engine cannot execute this change; it must be implemented first.' : draft.strategy === 'model_substitution' && draft.status === 'READY' ? 'Platform compute is not configured on this deployment.' : draft.blocked_reason || draft.reason,
          label: 'NOT VERIFIED — candidate only',
        };
        candidates.push({
          ...draft,
          // Candidates that cannot run are stored BLOCKED so no route can execute them by accident.
          status: status === EXECUTABLE ? draft.status : 'BLOCKED',
          blocked_reason: status === EXECUTABLE ? null : draft.blocked_reason || (status === NOT_EXECUTABLE ? 'not_executable' : 'needs_implementation'),
          optimization_pass: pass.id,
          pass_version: pass.version,
          contract_hash: ctx.contract.hash,
          baseline_snapshot_id: ctx.snapshot.id,
          executable_status: status,
          risk: pass.riskClass(draft, d),
          candidate_config_hash: candidateConfigHash({ pass, diagnosis: d, contractHash: ctx.contract.hash, snapshotHash: ctx.snapshot.snapshot_hash, draft }),
          lineage,
          diagnosis_hash: d.diagnosis_hash,
        });
      }
    }
  }
  return { candidates, skipped };
}

