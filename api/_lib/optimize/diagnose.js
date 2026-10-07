/**
 * Zev Diagnose v0.1 — deterministic, evidence-based diagnoses. No model is
 * called: a diagnosis exists only because recorded evidence satisfies a
 * stated rule, and every diagnosis says what would falsify it.
 *
 * Families: redundant_call (exact reuse), retry_amplification,
 * context_amplification, model_overprovisioning, latency_critical_path.
 *
 * Inputs never include raw content: identity comes from stored hashes,
 * size from token counts, structure and timing from ZevIR.
 */
import { sha256Json } from '../product/hashing.js';
import { cheaperCandidateFor, normalizeModel, tierOf } from '../pricing.js';
import { attemptNo, logicalKey, percentile, stableSum } from './performance.js';
import { normalizeRequirements } from './contract.js';

export const DIAGNOSE_VERSION = 'diag_v0.1';
const MAX_REFS = 50;
const meta = (t) => (t.metadata && typeof t.metadata === 'object' && !Array.isArray(t.metadata) ? t.metadata : {});
const known = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));
const sum = (rows, f) => stableSum(rows.map((r) => r[f]));
const r6 = (v) => (v === null ? null : Number(Number(v).toFixed(10)));
const scopeOf = (t) => t.symbol || t.workflow || 'unattributed';

/** Engine trace → its ZevIR ModelCall node, through the product's graph set. */
function nodeIndex(graphs) {
  const byRequest = new Map();
  for (const g of graphs) {
    if (g.source_kind !== 'zevqora_engine' || !g.source_trace_id) continue;
    const call = g.nodes.find((n) => n.kind === 'ModelCall');
    if (call) byRequest.set(g.source_trace_id, { graph_id: g.id, graph_hash: g.graph_hash, node_id: call.id, stable_key: call.stable_key, kind: call.kind, name: call.name });
  }
  return byRequest;
}

function refsFor(rows, index) {
  const sorted = [...rows].sort((a, b) => String(a.request_id).localeCompare(String(b.request_id)));
  const affected = [];
  const evidence = [];
  for (const t of sorted) {
    const node = index.get(t.request_id);
    if (node && affected.length < MAX_REFS) affected.push({ graph_id: node.graph_id, node_id: node.node_id, stable_key: node.stable_key, kind: node.kind, name: node.name });
    if (evidence.length < MAX_REFS) evidence.push({ type: 'engine_trace', id: t.id, request_id: t.request_id });
    if (node && evidence.length < MAX_REFS) evidence.push({ type: 'zevir_node', graph_id: node.graph_id, graph_hash: node.graph_hash, node_id: node.node_id, stable_key: node.stable_key });
  }
  return { affected_nodes: affected, evidence_refs: evidence, unprojected: sorted.filter((t) => !index.has(t.request_id)).length };
}

function finish(d) {
  const body = { version: DIAGNOSE_VERSION, ...d };
  return { ...body, diagnosis_hash: sha256Json(body) };
}

const severityByShare = (share) => (share === null ? 'low' : share >= 0.2 ? 'high' : share >= 0.05 ? 'medium' : 'low');

// ---- A. redundant call / exact reuse --------------------------------------------
/** Identity from stored hashes and behaviour-affecting metadata only. */
export function redundancyKey(t) {
  const m = meta(t);
  if (!t.input_hash) return null;
  return sha256Json({ input_hash: t.input_hash, system_prompt_hash: t.system_prompt_hash || m.system_prompt_hash || null, symbol: t.symbol || '', workflow: t.workflow || '', provider: (t.provider || '').toLowerCase(), model: t.model || t.requested_model || '', temperature: m.temperature ?? null, response_format: m.response_format ?? null, tool_schema_hash: m.tool_schema_hash ?? null, context_id: m.context_id || m.retrieval_context_id || null, model_config: m.model_config || m.generation_config || null });
}
const reuseBlocker = (t) => (t.protected ? 'protected' : meta(t).side_effects || meta(t).non_idempotent || meta(t).state_changing ? 'side_effects' : meta(t).tools_executed || meta(t).has_tool_calls ? 'tool_execution' : null);

function finalAttempts(traces) {
  const last = new Map();
  for (const t of traces) {
    const k = logicalKey(t);
    const prev = last.get(k);
    if (!prev || attemptNo(t) > attemptNo(prev)) last.set(k, t);
  }
  return [...last.values()];
}

function redundantCall(ctx) {
  const out = [];
  const finals = finalAttempts(ctx.traces);
  const totalKnown = finals.filter((t) => known(t.cost_usd));
  const totalCost = totalKnown.length ? sum(totalKnown, 'cost_usd') : null;
  const byScope = new Map();
  for (const t of finals) {
    const key = redundancyKey(t);
    if (!key) continue;
    const s = scopeOf(t);
    if (!byScope.has(s)) byScope.set(s, new Map());
    const groups = byScope.get(s);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  for (const [scope, groups] of [...byScope.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const repeated = [...groups.values()].filter((g) => g.length >= 2).map((g) => [...g].sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')) || String(a.request_id).localeCompare(String(b.request_id))));
    if (!repeated.length) continue;
    const duplicates = repeated.flatMap((g) => g.slice(1));
    const dupPriced = duplicates.filter((t) => known(t.cost_usd));
    const dupTimed = duplicates.filter((t) => known(t.latency_ms));
    const dupCost = dupPriced.length ? sum(dupPriced, 'cost_usd') : null;
    const blocked = repeated.filter((g) => g.some(reuseBlocker));
    const reusable = repeated.length - blocked.length;
    const share = dupCost !== null && totalCost ? dupCost / totalCost : null;
    const fullIdentity = duplicates.every((t) => t.system_prompt_hash || meta(t).system_prompt_hash);
    const refs = refsFor(repeated.flat(), ctx.index);
    out.push(
      finish({
        family: 'redundant_call',
        product_id: ctx.product.id,
        scope,
        symptom: `${duplicates.length} call(s) in '${scope}' repeat an earlier call with identical recorded input and configuration (${repeated.length} group(s)).`,
        causal_path: [`${scope}`, 'ModelCall issued again for an input already answered', 'provider paid again'],
        root_cause: 'Equivalent requests are sent to the provider again instead of reusing a validated earlier result.',
        metrics: { groups: repeated.length, duplicate_calls: duplicates.length, duplicate_known_cost_usd: r6(dupCost), duplicate_cost_known_for: dupPriced.length, duplicate_known_latency_ms: dupTimed.length ? sum(dupTimed, 'latency_ms') : null, share_of_known_cost: r6(share), reusable_groups: reusable, blocked_groups: blocked.length, blocked_reasons: [...new Set(blocked.flatMap((g) => g.map(reuseBlocker).filter(Boolean)))].sort() },
        affected_nodes: refs.affected_nodes,
        evidence_refs: refs.evidence_refs,
        confidence: fullIdentity ? 0.9 : 0.7,
        severity: share !== null ? severityByShare(share) : duplicates.length >= 5 ? 'medium' : 'low',
        required_additional_evidence: [...(fullIdentity ? [] : ['system prompt hash on every duplicate (identity currently relies on input hash + config)']), ...(refs.unprojected ? [`${refs.unprojected} trace(s) not yet projected into ZevIR`] : []), 'replay of reused outputs graded under the frozen contract'],
        falsifier: 'Reuse is wrong if a reused output fails the graders on any replayed case, or if the repeated inputs depend on context the hashes do not capture (time, user state, tool results).',
        suggested_optimization_passes: reusable ? ['redundant_call'] : [],
        risk_class: blocked.length ? 'high' : 'low',
      }),
    );
  }
  return out;
}

// ---- B. retry amplification -------------------------------------------------------
function retryAmplification(ctx) {
  const groups = new Map();
  for (const t of ctx.traces) {
    const k = logicalKey(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const requests = [...groups.values()];
  const executed = requests.reduce((a, rows) => a + Math.max(rows.length, Math.max(...rows.map(attemptNo))), 0);
  const retried = requests.filter((rows) => Math.max(rows.length, Math.max(...rows.map(attemptNo))) > 1);
  if (!retried.length) return [];
  const amplification = executed / requests.length;
  if (amplification < 1.05 && retried.length < 2) return [];
  const nonFinal = retried.flatMap((rows) => [...rows].sort((a, b) => attemptNo(a) - attemptNo(b)).slice(0, -1));
  const reasons = {};
  for (const t of ctx.traces) if (t.retry_reason) reasons[String(t.retry_reason)] = (reasons[String(t.retry_reason)] || 0) + 1;
  const classes = {};
  for (const t of nonFinal) {
    const c = String(meta(t).error_type || meta(t).error_category || 'unclassified');
    classes[c] = (classes[c] || 0) + 1;
  }
  const priced = nonFinal.filter((t) => known(t.cost_usd));
  const timed = nonFinal.filter((t) => known(t.latency_ms));
  const unrecorded = executed - ctx.traces.length;
  const refs = refsFor(retried.flat(), ctx.index);
  return [
    finish({
      family: 'retry_amplification',
      product_id: ctx.product.id,
      scope: 'workload',
      symptom: `${retried.length} of ${requests.length} logical requests needed more than one attempt; ${executed} attempts were executed for ${requests.length} requests (×${amplification.toFixed(2)}).`,
      causal_path: ['request', 'attempt fails', ...Object.keys(reasons).sort().slice(0, 3).map((r) => `retry (${r})`), 'additional provider call'],
      root_cause: 'Failed attempts are retried, so the workload pays and waits for calls that did not produce the result.',
      metrics: { logical_requests: requests.length, executed_attempts: executed, retried_requests: retried.length, amplification: r6(amplification), retry_reasons: reasons, failure_classes: classes, retry_known_cost_usd: priced.length ? r6(sum(priced, 'cost_usd')) : null, retry_cost_known_for: priced.length, retry_latency_ms: timed.length ? sum(timed, 'latency_ms') : null, unrecorded_attempts: unrecorded },
      affected_nodes: refs.affected_nodes,
      evidence_refs: refs.evidence_refs,
      confidence: Object.keys(reasons).length ? 0.85 : 0.65,
      severity: amplification >= 1.5 ? 'high' : amplification >= 1.2 ? 'medium' : 'low',
      required_additional_evidence: [...(unrecorded > 0 ? [`${unrecorded} earlier attempt(s) are implied by attempt numbers but not recorded; their cost is unknown`] : []), ...(Object.keys(reasons).length ? [] : ['retry reasons (retry_reason) to separate transient from permanent failures'])],
      falsifier: 'Not a real cost driver if the retried attempts are free (e.g. rejected before billing) or if retries recover failures that would otherwise lose the task.',
      suggested_optimization_passes: ['retry_amplification'],
      risk_class: 'medium',
    }),
  ];
}

// ---- C. context amplification -------------------------------------------------------
function contextAmplification(ctx) {
  const rows = finalAttempts(ctx.traces).filter((t) => known(t.input_tokens));
  if (rows.length < 3) return [];
  const inputs = rows.map((t) => Number(t.input_tokens));
  const medianIn = percentile(inputs, 50);
  const ratios = rows.filter((t) => known(t.output_tokens) && Number(t.output_tokens) > 0).map((t) => Number(t.input_tokens) / Number(t.output_tokens));
  const medianRatio = ratios.length ? percentile(ratios, 50) : null;
  const signals = [];
  if (medianRatio !== null && medianRatio >= 20 && medianIn >= 1000) signals.push({ signal: 'oversized_input', detail: `median input ${medianIn} tokens, median input/output ratio ${medianRatio.toFixed(1)}` });
  // Stable prefix: the same instructions (system prompt hash) re-sent uncached across many large calls.
  const byPrefix = new Map();
  for (const t of rows) {
    const h = t.system_prompt_hash || meta(t).system_prompt_hash;
    if (!h) continue;
    if (!byPrefix.has(h)) byPrefix.set(h, []);
    byPrefix.get(h).push(t);
  }
  const prefixRows = [];
  for (const [h, list] of [...byPrefix.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const uncached = list.filter((t) => !Number(t.cached_input_tokens));
    if (list.length >= 5 && uncached.length >= Math.ceil(list.length / 2) && percentile(list.map((t) => Number(t.input_tokens)), 50) >= 1024) {
      signals.push({ signal: 'uncached_stable_prefix', detail: `system prompt ${h.slice(0, 12)} sent in ${list.length} calls, ${uncached.length} without cached input tokens` });
      prefixRows.push(...list);
    }
  }
  // Growth within a conversation: input tokens rising turn after turn.
  const byConv = new Map();
  for (const t of rows) {
    const c = meta(t).conversation_id || meta(t).session_id;
    if (!c) continue;
    if (!byConv.has(c)) byConv.set(c, []);
    byConv.get(c).push(t);
  }
  const growing = [];
  for (const [c, list] of [...byConv.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
    const ordered = [...list].sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')) || String(a.request_id).localeCompare(String(b.request_id)));
    if (ordered.length >= 3 && ordered.every((t, i) => i === 0 || Number(t.input_tokens) > Number(ordered[i - 1].input_tokens))) growing.push({ conversation: c, rows: ordered });
  }
  if (growing.length) signals.push({ signal: 'conversation_growth', detail: `input tokens grow every turn in ${growing.length} conversation(s)` });
  if (!signals.length) return [];
  const evidenceRows = [...new Set([...prefixRows, ...growing.flatMap((g) => g.rows), ...(signals.some((s) => s.signal === 'oversized_input') ? rows : [])])];
  const refs = refsFor(evidenceRows, ctx.index);
  return [
    finish({
      family: 'context_amplification',
      product_id: ctx.product.id,
      scope: 'workload',
      symptom: signals.map((s) => s.detail).join('; '),
      causal_path: ['request', 'context assembled (instructions + history + retrieved material)', 'large input billed on every call'],
      root_cause: 'Input volume, not output, dominates these calls. This is a size observation from token counts; whether any of that context is unnecessary is NOT established.',
      metrics: { calls: rows.length, median_input_tokens: medianIn, median_input_output_ratio: medianRatio === null ? null : r6(medianRatio), signals: signals.map((s) => s.signal) },
      affected_nodes: refs.affected_nodes,
      evidence_refs: refs.evidence_refs,
      confidence: signals.length >= 2 ? 0.75 : 0.6,
      severity: medianIn >= 8000 ? 'high' : medianIn >= 2000 ? 'medium' : 'low',
      required_additional_evidence: ['which context segments are stable vs per-request (prefix/segment hashes)', 'a context change must be replayed and graded before any saving is claimed'],
      falsifier: 'Wrong if the large inputs are required task content (e.g. documents the answer depends on) and trimming them lowers graded quality.',
      suggested_optimization_passes: ['context_memory'],
      risk_class: 'medium',
    }),
  ];
}

// ---- D. model overprovisioning -------------------------------------------------------
function modelOverprovisioning(ctx) {
  const out = [];
  const byModel = new Map();
  for (const t of finalAttempts(ctx.traces)) {
    const key = normalizeModel(t.provider, t.model || t.requested_model).key;
    if (!key) continue;
    if (!byModel.has(key)) byModel.set(key, []);
    byModel.get(key).push(t);
  }
  for (const [model, rows] of [...byModel.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (tierOf(ctx.pricing, model) !== 'frontier' || rows.length < 5) continue;
    const outs = rows.filter((t) => known(t.output_tokens)).map((t) => Number(t.output_tokens));
    if (outs.length < Math.ceil(rows.length / 2)) continue;
    const p95Out = percentile(outs, 95);
    if (p95Out > 64) continue;
    const candidate = cheaperCandidateFor(ctx.pricing, model);
    if (!candidate) continue;
    const replayable = rows.filter((t) => !t.protected && t.input_hash);
    const refs = refsFor(rows, ctx.index);
    out.push(
      finish({
        family: 'model_overprovisioning',
        product_id: ctx.product.id,
        scope: model,
        symptom: `${rows.length} calls use frontier-tier ${model} for bounded output (p95 ${p95Out} output tokens).`,
        causal_path: ['bounded task (short output)', `frontier model ${model}`, 'frontier price per token'],
        root_cause: `A frontier model is used for work whose observed output is short and bounded. Whether ${candidate} keeps quality is NOT known until a replay is graded under the frozen contract.`,
        metrics: { model, calls: rows.length, p95_output_tokens: p95Out, candidate_model: candidate, replayable_samples: replayable.length, protected_excluded: rows.length - replayable.length },
        affected_nodes: refs.affected_nodes,
        evidence_refs: refs.evidence_refs,
        confidence: 0.5,
        severity: rows.length >= 50 ? 'high' : 'medium',
        required_additional_evidence: [`replay of representative cases on ${candidate}, graded under the frozen contract`, ...(replayable.length ? [] : ['non-protected traces with recorded input (none available to replay)'])],
        falsifier: `Wrong if ${candidate} fails the quality floor, task-success floor or any protected case on the same inputs.`,
        suggested_optimization_passes: ['model_provider'],
        risk_class: 'medium',
      }),
    );
  }
  return out;
}

// ---- E. latency critical path ----------------------------------------------------------
function latencyCriticalPath(ctx) {
  const lat = ctx.latency;
  const req = ctx.requirements;
  const p95 = ctx.snapshot.latency.request.p95_ms ?? ctx.snapshot.latency.attempt.p95_ms;
  if (!lat || !lat.hotspots.length || p95 === null) return [];
  const dominant = lat.hotspots.find((h) => h.mean_share_of_root !== null && h.mean_share_of_root >= 0.4) || null;
  const overBudget = req.latency.max_p95_ms !== null && p95 > req.latency.max_p95_ms;
  if (!dominant && !overBudget) return [];
  const top = dominant || lat.hotspots[0];
  const retryShare = lat.retry && lat.retry.added_latency_ms !== null && ctx.snapshot.latency.attempt.samples ? lat.retry.added_latency_ms : null;
  const samplePath = lat.sample_paths.find((p) => p.path.some((s) => s.stable_key === top.nodes[0]?.stable_key)) || lat.sample_paths[0] || null;
  return [
    finish({
      family: 'latency_critical_path',
      product_id: ctx.product.id,
      scope: top.class,
      symptom: `Workload p95 latency ${p95} ms${overBudget ? ` exceeds the contract budget of ${req.latency.max_p95_ms} ms` : ''}; ${top.kind} '${top.name}' has p95 ${top.p95_ms} ms${top.mean_share_of_root !== null ? ` and accounts for ${(top.mean_share_of_root * 100).toFixed(0)}% of observed root latency on the critical path` : ' (share of request latency unknown: no request-level timing)'}.`,
      causal_path: samplePath ? samplePath.path.map((s) => `${s.kind} ${s.name || ''} (${Math.round(s.self_ms)} ms on path)`.trim()) : [`${top.kind} ${top.name}`],
      root_cause: top.mean_share_of_root !== null ? `The critical path is dominated by ${top.kind} '${top.name}'.` : `${top.kind} '${top.name}' is the slowest observed step; its share of end-to-end latency cannot be computed without request timing.`,
      metrics: { workload_p95_ms: p95, hotspot: { class: top.class, p50_ms: top.p50_ms, p95_ms: top.p95_ms, samples: top.samples, critical_path_graphs: top.critical_path_graphs, mean_share_of_root: top.mean_share_of_root === null ? null : r6(top.mean_share_of_root) }, analysis_status: lat.status, retry_added_latency_ms: retryShare },
      affected_nodes: top.nodes.slice(0, MAX_REFS).map((n) => ({ ...n, kind: top.kind, name: top.name })),
      evidence_refs: top.nodes.slice(0, MAX_REFS).map((n) => ({ type: 'zevir_node', graph_id: n.graph_id, node_id: n.node_id, stable_key: n.stable_key })),
      confidence: lat.status === 'complete' ? 0.8 : lat.status === 'partial' ? 0.65 : 0.5,
      severity: overBudget ? 'high' : 'medium',
      required_additional_evidence: lat.status === 'complete' ? [] : ['request-level start/end timestamps (spans) to compute the critical path', ...lat.incomplete_reasons.slice(0, 2)],
      falsifier: `Wrong if removing or speeding up '${top.name}' does not reduce end-to-end p95 (the time is spent elsewhere or in parallel).`,
      // Diagnosis-only in v0.1: no generic transformation is safe to propose from a latency path alone.
      suggested_optimization_passes: [],
      risk_class: 'medium',
    }),
  ];
}

/**
 * All diagnoses for one snapshot. ctx = { product, snapshot, traces, graphs,
 * latency, requirements, pricing }. Deterministic: same evidence, same output.
 */
export function diagnose(ctx) {
  const full = { ...ctx, requirements: normalizeRequirements(ctx.requirements), index: nodeIndex(ctx.graphs || []), pricing: ctx.pricing || new Map() };
  return [...redundantCall(full), ...retryAmplification(full), ...contextAmplification(full), ...modelOverprovisioning(full), ...latencyCriticalPath(full)];
}
