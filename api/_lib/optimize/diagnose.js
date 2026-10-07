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

// ---- F/G. structural families (vNext Part 2B) ----------------------------------------
// They fire only on Agent / ToolCall / Retrieval nodes, which engine-only
// workloads do not have, so the five families above are unaffected. Identity
// comes from the content-free digests ZevIR stores (arguments, queries,
// results, document ids); nothing here reads or infers content.
const attrs = (n) => (n.attributes && typeof n.attributes === 'object' ? n.attributes : {});
const digest = (d) => (d && typeof d === 'object' && typeof d.sha256 === 'string' ? d.sha256 : null);
const nodeRef = (g, n) => ({ graph_id: g.id, node_id: n.id, stable_key: n.stable_key, kind: n.kind, name: n.name });
const evidenceRef = (g, n) => ({ type: 'zevir_node', graph_id: g.id, graph_hash: g.graph_hash, node_id: n.id, stable_key: n.stable_key });
const timeOf = (n) => (n.started_at ? Date.parse(n.started_at) : Number.POSITIVE_INFINITY);
const durationOf = (n) => (known(n.duration_ms) ? Number(n.duration_ms) : known(n.latency_ms) ? Number(n.latency_ms) : null);

/** Ordered direct children of a node (CALLS / USES / RETRIEVES), by start time then edge ordinal then key. */
function childrenOf(g, nodeId) {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  return (g.edges || [])
    .filter((e) => e.source_node_id === nodeId && ['CALLS', 'USES', 'RETRIEVES'].includes(e.kind))
    .map((e) => ({ node: byId.get(e.target_node_id), ordinal: e.ordinal ?? 0 }))
    .filter((x) => x.node && x.node.kind !== 'Runtime' && x.node.kind !== 'Outcome')
    .sort((a, b) => timeOf(a.node) - timeOf(b.node) || a.ordinal - b.ordinal || String(a.node.stable_key).localeCompare(String(b.node.stable_key)))
    .map((x) => x.node);
}

/** Output digest of a step: tool result, retrieved documents, or the model's Outcome node. */
function outputDigest(g, n) {
  const a = attrs(n);
  if (n.kind === 'ToolCall') return digest(a.result_digest);
  if (n.kind === 'Retrieval') return digest(a.documents_digest);
  const outcome = (g.edges || []).find((e) => e.source_node_id === n.id && e.kind === 'PRODUCES');
  const o = outcome ? g.nodes.find((x) => x.id === outcome.target_node_id) : null;
  return o ? digest(attrs(o).output_digest) || digest(attrs(n).output_digest) : digest(a.output_digest);
}
const inputDigest = (n) => digest(attrs(n).arguments_digest) || digest(attrs(n).query_digest) || digest(attrs(n).input_digest);
const signature = (n) => `${n.kind}|${n.name || ''}|${inputDigest(n) || '?'}`;

/**
 * NO PROGRESS, structurally: a window of 1–3 consecutive steps that repeats
 * immediately with the same signatures (kind, name, input digest) AND the same
 * output digests. Returns the wasted (repeated) steps. Unknown digests never match.
 */
export function noProgressRepeats(g, steps) {
  const sig = steps.map((n) => (inputDigest(n) && outputDigest(g, n) ? `${signature(n)}=>${outputDigest(g, n)}` : null));
  const wasted = new Set();
  for (let w = 1; w <= 3; w += 1) {
    for (let i = 0; i + 2 * w <= steps.length; i += 1) {
      let same = true;
      for (let k = 0; k < w; k += 1) if (!sig[i + k] || sig[i + k] !== sig[i + w + k]) same = false;
      if (same) for (let k = 0; k < w; k += 1) wasted.add(i + w + k);
    }
  }
  return [...wasted].sort((a, b) => a - b).map((i) => steps[i]);
}

function agentWorkflow(ctx) {
  const byAgent = new Map();
  for (const g of ctx.graphs || []) {
    for (const agent of g.nodes.filter((n) => n.kind === 'Agent')) {
      const name = agent.name || attrs(agent).agent_name || 'agent';
      if (!byAgent.has(name)) byAgent.set(name, []);
      byAgent.get(name).push({ g, agent, steps: childrenOf(g, agent.id) });
    }
  }
  const out = [];
  for (const [name, runs] of [...byAgent.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const redundantTool = [];
    const changedState = [];
    const repeatedDecisions = [];
    const loops = [];
    for (const r of runs) {
      const seen = new Map();
      for (const n of r.steps) {
        const inD = inputDigest(n);
        if (!inD) continue;
        const key = `${n.kind}|${n.name || ''}|${inD}`;
        const prev = seen.get(key);
        const outD = outputDigest(r.g, n);
        if (prev && n.kind === 'ToolCall') {
          // Same tool, same arguments: redundant only if the result is provably unchanged.
          if (outD && prev.out && outD === prev.out) redundantTool.push({ r, n });
          else changedState.push({ r, n });
        }
        if (prev && n.kind === 'ModelCall' && outD && prev.out === outD) repeatedDecisions.push({ r, n });
        if (!prev) seen.set(key, { out: outD });
      }
      const wasted = noProgressRepeats(r.g, r.steps);
      if (wasted.length) loops.push({ r, wasted });
    }
    const stepCounts = runs.map((r) => r.steps.length);
    const median = percentile(stepCounts, 50);
    const excessive = runs.length >= 3 ? runs.filter((r) => r.steps.length > 2 * median) : [];
    if (!redundantTool.length && !loops.length && !repeatedDecisions.length && !excessive.length) continue;
    const wastedNodes = [...new Map([...redundantTool, ...repeatedDecisions].map((x) => [x.n.id, x]).concat(loops.flatMap((l) => l.wasted.map((n) => [n.id, { r: l.r, n }])))).values()];
    const lat = wastedNodes.map((x) => durationOf(x.n)).filter((v) => v !== null);
    const costs = wastedNodes.map((x) => x.n.cost_usd).filter(known);
    const refsNodes = [...runs.map((r) => ({ g: r.g, n: r.agent })), ...wastedNodes.map((x) => ({ g: x.r.g, n: x.n }))];
    const tools = {};
    for (const x of redundantTool) tools[x.n.name || 'tool'] = (tools[x.n.name || 'tool'] || 0) + 1;
    const patterns = [...(redundantTool.length ? ['repeated_tool_call'] : []), ...(loops.length ? ['no_progress_loop'] : []), ...(repeatedDecisions.length ? ['repeated_model_decision'] : []), ...(excessive.length ? ['excessive_steps'] : [])];
    out.push(
      finish({
        family: 'agent_workflow',
        product_id: ctx.product.id,
        scope: name,
        symptom: `Agent '${name}': ${redundantTool.length} repeated tool call(s) with unchanged arguments and result, ${loops.reduce((a, l) => a + l.wasted.length, 0)} step(s) in no-progress loops, ${repeatedDecisions.length} repeated identical model decision(s) over ${runs.length} run(s) (median ${median ?? 'unknown'} steps).`,
        causal_path: ['Agent run', ...patterns.map((p) => p.replace(/_/g, ' ')), 'extra steps executed and paid'],
        root_cause: 'The agent repeats work whose inputs and results did not change (structural evidence from digests). Whether the repeats are needed for correctness is NOT established; a change must be replayed.',
        metrics: { runs: runs.length, steps_p50: median, steps_p95: percentile(stepCounts, 95), patterns, repeated_tool_calls: redundantTool.length, changed_state_repeats: changedState.length, no_progress_loops: loops.length, wasted_steps: wastedNodes.length, wasted_known_latency_ms: lat.length ? stableSum(lat) : null, wasted_known_cost_usd: costs.length ? r6(stableSum(costs)) : null, wasted_cost_known_for: costs.length, tools, excessive_runs: excessive.length },
        affected_nodes: refsNodes.slice(0, MAX_REFS).map((x) => nodeRef(x.g, x.n)),
        evidence_refs: refsNodes.slice(0, MAX_REFS).map((x) => evidenceRef(x.g, x.n)),
        confidence: redundantTool.length || loops.length ? 0.8 : 0.6,
        severity: wastedNodes.length >= runs.length ? 'high' : wastedNodes.length ? 'medium' : 'low',
        required_additional_evidence: ['an agent replay harness to evaluate a guard or budget (not available: agent changes are proposed, not replayed)', ...(changedState.length ? [`${changedState.length} repeated call(s) changed result: not collapsible`] : [])],
        falsifier: 'Wrong if a repeated step is needed for correctness (e.g. polling for a state change the digests do not capture), so suppressing it lowers task success.',
        suggested_optimization_passes: ['agent_workflow', 'cache'],
        risk_class: 'medium',
      }),
    );
  }
  return out;
}

function retrievalRedundancy(ctx) {
  const byName = new Map();
  for (const g of ctx.graphs || []) {
    for (const n of g.nodes.filter((x) => x.kind === 'Retrieval')) {
      const name = n.name || 'retrieval';
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push({ g, n });
    }
  }
  const out = [];
  for (const [name, list] of [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const repeats = [];
    let duplicateChunks = 0;
    const byGraph = new Map();
    for (const x of list) {
      if (!byGraph.has(x.g.id)) byGraph.set(x.g.id, []);
      byGraph.get(x.g.id).push(x);
    }
    for (const rows of byGraph.values()) {
      const ordered = [...rows].sort((a, b) => timeOf(a.n) - timeOf(b.n) || String(a.n.stable_key).localeCompare(String(b.n.stable_key)));
      const queries = new Set();
      const docs = new Map();
      for (const x of ordered) {
        const q = digest(attrs(x.n).query_digest);
        if (q && queries.has(q)) repeats.push(x);
        if (q) queries.add(q);
        for (const d of attrs(x.n).document_refs || []) {
          if (!d || !d.id) continue;
          docs.set(d.id, (docs.get(d.id) || 0) + 1);
        }
      }
      for (const c of docs.values()) if (c > 1) duplicateChunks += c - 1;
    }
    const counts = list.map((x) => attrs(x.n).document_count).filter(known).map(Number);
    const p50k = percentile(counts, 50);
    const oversized = p50k !== null && p50k >= 8;
    const lats = list.map((x) => durationOf(x.n)).filter((v) => v !== null);
    const hotspot = ctx.latency?.hotspots?.find((h) => h.kind === 'Retrieval' && h.name === name) || null;
    const rerank = (ctx.graphs || []).flatMap((g) => g.nodes.filter((n) => n.kind === 'ModelCall' && n.operation === 'rerank' && byGraph.has(g.id)));
    if (!repeats.length && !duplicateChunks && !oversized) continue;
    const refs = [...list, ...repeats].slice(0, MAX_REFS);
    const signals = [...(repeats.length ? ['repeat_retrieval'] : []), ...(duplicateChunks ? ['duplicate_chunks'] : []), ...(oversized ? ['oversized_top_k'] : []), ...(hotspot && hotspot.mean_share_of_root !== null && hotspot.mean_share_of_root >= 0.4 ? ['retrieval_latency_hotspot'] : []), ...(rerank.length ? ['reranker_present'] : [])];
    out.push(
      finish({
        family: 'retrieval_redundancy',
        product_id: ctx.product.id,
        scope: name,
        symptom: `Retrieval '${name}': ${list.length} call(s), ${repeats.length} repeat(s) of a query already issued in the same task, ${duplicateChunks} duplicated chunk reference(s), median ${p50k ?? 'unknown'} documents per call; p95 ${percentile(lats, 95) ?? 'unknown'} ms.`,
        causal_path: ['Task', `Retrieval '${name}'`, ...signals.map((s) => s.replace(/_/g, ' ')), 'context assembled and billed'],
        root_cause: 'The same retrieval is repeated or the same chunks are fetched more than once (structural evidence from query digests and document ids). Whether any chunk is irrelevant is NOT established: that needs an evaluator, not a hash.',
        metrics: { retrievals: list.length, repeat_retrievals: repeats.length, query_repeat_rate: list.length ? r6(repeats.length / list.length) : null, duplicate_chunk_refs: duplicateChunks, documents_p50: p50k, documents_p95: percentile(counts, 95), signals, latency: { samples: lats.length, p50_ms: percentile(lats, 50), p95_ms: percentile(lats, 95), mean_share_of_root: hotspot ? hotspot.mean_share_of_root : null, critical_path_graphs: hotspot ? hotspot.critical_path_graphs : 0 }, rerank_calls: rerank.length, rerank_p95_ms: percentile(rerank.map(durationOf).filter((v) => v !== null), 95) },
        affected_nodes: refs.map((x) => nodeRef(x.g, x.n)),
        evidence_refs: refs.map((x) => evidenceRef(x.g, x.n)),
        confidence: repeats.length || duplicateChunks ? 0.8 : 0.5,
        severity: repeats.length >= list.length / 3 || (hotspot?.mean_share_of_root ?? 0) >= 0.4 ? 'high' : 'medium',
        required_additional_evidence: ['a retrieval replay harness to evaluate a lower top-k or deduplication (not available: retrieval changes are proposed, not replayed)', 'evaluator evidence before any chunk is called irrelevant'],
        falsifier: 'Wrong if the repeated retrievals return different documents at different times (fresh data) or if removing duplicated chunks lowers graded quality.',
        suggested_optimization_passes: ['retrieval', 'cache'],
        risk_class: 'medium',
      }),
    );
  }
  return out;
}

/**
 * All diagnoses for one snapshot. ctx = { product, snapshot, traces, graphs,
 * latency, requirements, pricing }. Deterministic: same evidence, same output.
 */
export function diagnose(ctx) {
  const full = { ...ctx, requirements: normalizeRequirements(ctx.requirements), index: nodeIndex(ctx.graphs || []), pricing: ctx.pricing || new Map() };
  return [...redundantCall(full), ...retryAmplification(full), ...contextAmplification(full), ...modelOverprovisioning(full), ...latencyCriticalPath(full), ...agentWorkflow(full), ...retrievalRedundancy(full)];
}
