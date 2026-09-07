/**
 * Product engine on the platform — the same contract the desktop's local engine
 * exposes, so one product UI runs identically in the browser and in Electron.
 *
 *   /api/engine/products …            repositories connected from the browser
 *   /api/engine/products/:id/scan     call sites + findings the browser scanned locally
 *   /api/engine/products/:id/traces   imported execution evidence
 *   …/optimization/plans, /execute, /evaluations, /implementations, /agent/chat
 *
 * Every write is workspace-scoped and authorized by membership; model spend goes
 * through platform compute (server credential, credit accounting).
 */
import { randomUUID } from 'node:crypto';
import { on } from '../router.js';
import { ApiError, readJson, str, num, uuid } from '../http.js';
import { requireUser, requireWorkspaceRole, rateLimit } from '../auth.js';
import { openRouterConfigured } from '../openrouter.js';
import { loadPricing } from '../pricing.js';
import { resolveBilling, creditState, allowedCandidateModels, completeText, cloudComputeEnabled } from '../platform-compute.js';
import { deterministicUuid } from '../product/hashing.js';
import { classifyPath, containsSecretLikeValue, redactSecretLikeValues } from '../product/scanner.js';
import { parseTraces, diagnoseRuntimeEvidence, economics } from '../product/traces.js';
import { planExactReuse, planModelSubstitution, executionKeyFor } from '../product/strategies.js';
import { executePlan } from '../product/executor.js';
import { runEvaluation } from '../product/evaluator.js';
import { unifiedDiff } from '../product/diff.js';
import { runZev } from '../product/zev.js';

const VERSION = 'platform-engine-1.0';
const MAX_CALLS = 4000;
const MAX_FINDINGS = 4000;
const MAX_TRACES_PER_IMPORT = 5000;
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

// ---- helpers ----------------------------------------------------------------
async function loadProduct(admin, user, productId, minRole = 'member') {
  const id = uuid(productId, 'product');
  const { data: product } = await admin.from('engine_products').select('*').eq('id', id).maybeSingle();
  if (!product || product.archived_at) throw new ApiError(404, 'Product not found.', 'NOT_FOUND');
  const role = await requireWorkspaceRole(admin, product.workspace_id, user.id, minRole);
  return { product, role };
}

async function rows(admin, table, productId, order = 'created_at') {
  const q = admin.from(table).select('*').eq('product_id', productId);
  const { data, error } = order ? await q.order(order, { ascending: false }) : await q;
  if (error) throw error;
  return data || [];
}

function productOut(p) {
  return { id: p.id, name: p.name, root_path: p.root_path, monitoring_enabled: p.monitoring_enabled, created_at: p.created_at, last_scan_at: p.last_scan_at, source: p.source, workspace_id: p.workspace_id, project_id: p.project_id, files_scanned: p.files_scanned, skipped_sensitive_paths: p.skipped_sensitive_paths, detected_stack: p.detected_stack || [] };
}

function findingOut(f) {
  return { id: f.id, origin: f.origin, category: f.category, title: f.title, root_cause: f.root_cause, file_path: f.file_path, line: f.line, symbol: f.symbol, confidence: Number(f.confidence), risk: f.risk, evidence_status: f.evidence_status };
}

function callOut(c) {
  return { id: c.id, file_path: c.file_path, line: c.line, provider: c.provider, symbol: c.symbol, excerpt: c.excerpt };
}

function planOut(p) {
  return { ...p, sample_scope: p.sample_scope || [], baseline_config: p.baseline_config || {}, candidate_config: p.candidate_config || {}, required_evidence: p.required_evidence || [] };
}

function executionOut(e) {
  return { ...e, baseline_trace_ids: e.baseline_trace_ids || [], sample_results: e.sample_results || [], note: 'candidate measured cost / cost delta only — not VERIFIED SAVINGS. Evaluation gates decide.' };
}

function evaluationOut(e) {
  const { cases: _cases, gate_config: _gc, ...rest } = e;
  return { ...rest, gates: e.gates || [], note: 'Authoritative verification record. VERIFIED requires execution-proven candidate execution + all required gates.' };
}

/** Compatibility Experiment rows projected from evaluations (VERIFIED → eligible for a change). */
function experimentFromEvaluation(e) {
  const statusMap = { VERIFIED: 'VERIFIED', REJECTED: 'REJECTED', INCOMPLETE: 'NEEDS_EVIDENCE', FAILED: 'REJECTED' };
  return {
    id: e.id,
    product_id: e.product_id,
    finding_id: e.finding_id,
    status: statusMap[e.status] || 'NEEDS_EVIDENCE',
    sample_size: e.sample_count,
    baseline_cost_usd: e.baseline_cost_usd,
    candidate_cost_usd: e.candidate_cost_usd,
    verified_savings_usd: e.status === 'VERIFIED' && e.raw_cost_delta_usd !== null ? -Number(e.raw_cost_delta_usd) : null,
    baseline_quality: e.baseline_quality,
    candidate_quality: e.candidate_quality,
    baseline_latency_ms: e.baseline_latency_ms,
    candidate_latency_ms: e.candidate_latency_ms,
    gates: (e.gates || []).map((g) => ({ name: g.name, passed: g.outcome === 'passed' || (!g.required && g.outcome === 'informational'), detail: g.reason })),
    evidence_version: e.evidence_version,
    verification_source: e.verification_source,
    execution_proven: e.execution_proven,
    evaluation_run_id: e.id,
    candidate_execution_id: e.candidate_execution_id,
    created_at: e.created_at,
  };
}

function canonicalVerified(evaluations) {
  const seen = new Map();
  for (const e of evaluations.filter((x) => x.status === 'VERIFIED')) if (!seen.has(e.candidate_execution_id)) seen.set(e.candidate_execution_id, e);
  return [...seen.values()];
}

async function pricingAndModels(admin) {
  const pricing = await loadPricing(admin);
  const allowed = new Set(await allowedCandidateModels(admin));
  return { pricing, allowed };
}

// ---- health + platform status --------------------------------------------------
on('GET', '/api/engine/health', async ({ request }) => {
  await requireUser(request);
  const configured = openRouterConfigured();
  return { status: 'ok', version: VERSION, openrouter_configured: configured, provider_mode: configured ? 'platform' : 'none', platform_connected: true };
});

on('GET', '/api/engine/platform/status', async ({ request, query }) => {
  const { user, admin } = await requireUser(request);
  const workspaceId = query.get('workspace_id') ? uuid(query.get('workspace_id'), 'workspace') : null;
  const billing = await resolveBilling({ admin, user, workspaceId });
  const [credits, enabled, models, pricing] = await Promise.all([creditState(admin, billing.billingUserId, billing.plan), cloudComputeEnabled(admin), allowedCandidateModels(admin), loadPricing(admin)]);
  const configured = openRouterConfigured() && enabled;
  let newest = null;
  for (const row of pricing.values()) if (row.retrieved_at && (!newest || row.retrieved_at > newest)) newest = row.retrieved_at;
  return {
    mode: configured ? 'platform' : 'none',
    connected: true,
    base_url: null,
    user_id: user.id,
    email: user.email || null,
    workspace_id: billing.workspace?.id || null,
    project_id: null,
    plan: billing.planId,
    token_fingerprint: null,
    candidate_models: configured ? models : [],
    pricing_version: `model_pricing@${newest ? String(newest).slice(0, 10) : 'snapshot'}`,
    pricing_synced: true,
    pricing_models: pricing.size,
    credits: { included_usd: credits.included, used_usd: credits.used, remaining_usd: credits.remaining, period_end: credits.periodEnd },
    note: 'Model calls run on the ZEVQORA platform with the server credential and are charged to Zev credit.',
  };
});

// ---- products --------------------------------------------------------------------
on('GET', '/api/engine/products', async ({ request, query }) => {
  const { user, admin } = await requireUser(request);
  const workspaceId = uuid(query.get('workspace_id'), 'workspace');
  await requireWorkspaceRole(admin, workspaceId, user.id, 'viewer');
  const { data, error } = await admin.from('engine_products').select('*').eq('workspace_id', workspaceId).is('archived_at', null).order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(productOut);
});

on('POST', '/api/engine/products', async ({ request }) => {
  const { user, admin } = await requireUser(request);
  const body = await readJson(request);
  const workspaceId = uuid(body?.workspace_id, 'workspace');
  await requireWorkspaceRole(admin, workspaceId, user.id, 'member');
  rateLimit(`engine-product:${user.id}`, { limit: 20, windowMs: 60_000 });
  const rootPath = str(body?.root_path, { name: 'Repository path', required: true, max: 400 });
  const name = str(body?.name, { name: 'Product name', max: 120 }) || rootPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'AI product';
  const source = body?.source === 'desktop' ? 'desktop' : 'browser';
  const { data: existing } = await admin.from('engine_products').select('*').eq('workspace_id', workspaceId).eq('root_path', rootPath).is('archived_at', null).maybeSingle();
  if (existing) return productOut(existing);
  const { count } = await admin.from('engine_products').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).is('archived_at', null);
  if ((count || 0) >= 25) throw new ApiError(409, 'A workspace can hold up to 25 connected repositories.', 'LIMIT_REACHED');
  const { data, error } = await admin.from('engine_products').insert({ workspace_id: workspaceId, name, root_path: rootPath, source, created_by: user.id }).select('*').single();
  if (error) throw error;
  return productOut(data);
});

on('DELETE', '/api/engine/products/:id', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { product } = await loadProduct(admin, user, params.id, 'member');
  await admin.from('engine_products').update({ archived_at: new Date().toISOString() }).eq('id', product.id);
  return { ok: true, archived: true, product_id: product.id };
});

on('POST', '/api/engine/products/:id/monitoring', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { product } = await loadProduct(admin, user, params.id, 'member');
  const body = await readJson(request);
  const { data, error } = await admin.from('engine_products').update({ monitoring_enabled: Boolean(body?.enabled) }).eq('id', product.id).select('*').single();
  if (error) throw error;
  return productOut(data);
});

/** The browser scanned the folder locally; store call sites + findings (source never uploaded). */
on('POST', '/api/engine/products/:id/scan', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { product } = await loadProduct(admin, user, params.id, 'member');
  rateLimit(`engine-scan:${user.id}`, { limit: 30, windowMs: 60_000 });
  const body = await readJson(request, { maxBytes: 3_500_000 });
  const filesScanned = num(body?.files_scanned, { name: 'files_scanned', min: 0, max: 1_000_000, integer: true }) ?? 0;
  const skipped = num(body?.skipped_sensitive_paths, { name: 'skipped_sensitive_paths', min: 0, max: 1_000_000, integer: true }) ?? 0;
  const stack = Array.isArray(body?.detected_stack) ? [...new Set(body.detected_stack.map((s) => String(s).slice(0, 40)))].slice(0, 20) : [];
  const calls = Array.isArray(body?.ai_calls) ? body.ai_calls.slice(0, MAX_CALLS) : [];
  const findings = Array.isArray(body?.findings) ? body.findings.slice(0, MAX_FINDINGS) : [];
  const cleanCalls = calls.map((c) => {
    const file = str(c?.file_path, { name: 'file_path', required: true, max: 600 }).replace(/\\/g, '/');
    if (classifyPath(file) !== 'source') throw new ApiError(400, `Refusing call site in a non-source or sensitive path: ${file}`, 'VALIDATION');
    return { product_id: product.id, workspace_id: product.workspace_id, file_path: file, line: num(c?.line, { name: 'line', min: 1, max: 10_000_000, integer: true, required: true }), provider: str(c?.provider, { name: 'provider', required: true, max: 40 }), symbol: str(c?.symbol, { name: 'symbol', max: 300 }) || null, excerpt: redactSecretLikeValues(str(c?.excerpt, { name: 'excerpt', max: 500 })) };
  });
  const cleanFindings = findings.map((f) => {
    const file = str(f?.file_path, { name: 'file_path', required: true, max: 600 }).replace(/\\/g, '/');
    const category = str(f?.category, { name: 'category', required: true, max: 80, pattern: /^[a-z0-9_]+$/ });
    const line = num(f?.line, { name: 'line', min: 0, max: 10_000_000, integer: true, required: true });
    return { id: deterministicUuid(`zevqora:${product.id}:${file}:${line}:${category}`), product_id: product.id, workspace_id: product.workspace_id, origin: 'static_scan', category, title: str(f?.title, { name: 'title', required: true, max: 240 }), root_cause: str(f?.root_cause, { name: 'root_cause', required: true, max: 2000 }), file_path: file, line, symbol: str(f?.symbol, { name: 'symbol', max: 300 }) || null, confidence: Math.min(1, Math.max(0, Number(f?.confidence) || 0.5)), risk: ['low', 'medium', 'high'].includes(f?.risk) ? f.risk : 'medium', evidence_status: 'needs_evidence' };
  });
  const dedupedFindings = [...new Map(cleanFindings.map((f) => [f.id, f])).values()];

  // Keep evidence status of findings that were already verified/rejected.
  const { data: previous } = await admin.from('engine_findings').select('id,evidence_status').eq('product_id', product.id).eq('origin', 'static_scan');
  const statusById = new Map((previous || []).map((p) => [p.id, p.evidence_status]));
  for (const f of dedupedFindings) if (statusById.has(f.id) && ['verified', 'rejected', 'needs_evidence'].includes(statusById.get(f.id))) f.evidence_status = statusById.get(f.id);

  await admin.from('engine_ai_calls').delete().eq('product_id', product.id);
  await admin.from('engine_findings').delete().eq('product_id', product.id).eq('origin', 'static_scan');
  if (cleanCalls.length) {
    const { error } = await admin.from('engine_ai_calls').insert(cleanCalls);
    if (error) throw error;
  }
  if (dedupedFindings.length) {
    const { error } = await admin.from('engine_findings').insert(dedupedFindings);
    if (error) throw error;
  }
  const { data: updated, error: updateError } = await admin.from('engine_products').update({ files_scanned: filesScanned, skipped_sensitive_paths: skipped, detected_stack: stack, last_scan_at: new Date().toISOString() }).eq('id', product.id).select('*').single();
  if (updateError) throw updateError;
  const storedCalls = await rows(admin, 'engine_ai_calls', product.id, null);
  const storedFindings = await rows(admin, 'engine_findings', product.id);
  return { product: productOut(updated), files_scanned: filesScanned, ai_calls: storedCalls.map(callOut), findings: storedFindings.map(findingOut), detected_stack: stack, skipped_sensitive_paths: skipped };
});

on('GET', '/api/engine/products/:id/ai-calls', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { product } = await loadProduct(admin, user, params.id, 'viewer');
  return (await rows(admin, 'engine_ai_calls', product.id, null)).map(callOut).sort((a, b) => a.file_path.localeCompare(b.file_path) || a.line - b.line);
});

on('GET', '/api/engine/products/:id/findings', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { product } = await loadProduct(admin, user, params.id, 'viewer');
  return (await rows(admin, 'engine_findings', product.id)).map(findingOut);
});

on('GET', '/api/engine/products/:id/economics', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { product } = await loadProduct(admin, user, params.id, 'viewer');
  const [traces, evaluations] = await Promise.all([rows(admin, 'engine_traces', product.id), rows(admin, 'engine_evaluations', product.id)]);
  return economics(traces, canonicalVerified(evaluations));
});

// ---- traces ----------------------------------------------------------------------
on('POST', '/api/engine/products/:id/traces/import', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { product } = await loadProduct(admin, user, params.id, 'member');
  rateLimit(`engine-import:${user.id}`, { limit: 20, windowMs: 60_000 });
  const body = await readJson(request, { maxBytes: 3_800_000 });
  const { rows: parsed, errors } = parseTraces({ jsonl: body?.jsonl, traces: body?.traces });
  if (parsed.length > MAX_TRACES_PER_IMPORT) throw new ApiError(413, `Import at most ${MAX_TRACES_PER_IMPORT} traces per request.`, 'PAYLOAD_TOO_LARGE');
  const { data: existing } = await admin.from('engine_traces').select('request_id').eq('product_id', product.id);
  const seen = new Set((existing || []).map((r) => r.request_id));
  const fresh = [];
  for (const t of parsed) {
    if (seen.has(t.request_id)) continue;
    seen.add(t.request_id);
    fresh.push({ ...t, product_id: product.id, workspace_id: product.workspace_id });
  }
  for (let i = 0; i < fresh.length; i += 500) {
    const { error } = await admin.from('engine_traces').insert(fresh.slice(i, i + 500));
    if (error) throw error;
  }
  // Evidence-derived signals are recomputed from the full trace set.
  const all = await rows(admin, 'engine_traces', product.id);
  await admin.from('engine_findings').delete().eq('product_id', product.id).eq('origin', 'runtime_evidence');
  const signals = diagnoseRuntimeEvidence(all).map((f) => ({ ...f, id: randomUUID(), product_id: product.id, workspace_id: product.workspace_id }));
  if (signals.length) {
    const { error } = await admin.from('engine_findings').insert(signals);
    if (error) throw error;
  }
  return { imported: fresh.length, rejected: errors.length, errors: errors.slice(0, 5) };
});

on('DELETE', '/api/engine/products/:id/traces', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { product } = await loadProduct(admin, user, params.id, 'member');
  const { count } = await admin.from('engine_evaluations').select('id', { count: 'exact', head: true }).eq('product_id', product.id);
  if (count) throw new ApiError(409, 'Traces that evaluations were computed from are immutable evidence and cannot be deleted.', 'EVIDENCE_PINNED');
  await admin.from('engine_traces').delete().eq('product_id', product.id);
  await admin.from('engine_findings').delete().eq('product_id', product.id).eq('origin', 'runtime_evidence');
  return { ok: true };
});

// ---- plans / executions / evaluations -----------------------------------------------
on('POST', '/api/engine/products/:id/optimization/plans', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { product } = await loadProduct(admin, user, params.id, 'member');
  const body = await readJson(request);
  const strategy = body?.strategy ? str(body.strategy, { name: 'strategy', max: 40, pattern: /^(exact_reuse|model_substitution|bounded_routing)$/ }) : null;
  const candidateModel = str(body?.candidate_model, { name: 'candidate_model', max: 160 }) || null;
  const budget = num(body?.max_budget_usd, { name: 'max_budget_usd', min: 0, max: 1000 });
  let finding = null;
  if (body?.finding_id) {
    const { data } = await admin.from('engine_findings').select('*').eq('id', uuid(body.finding_id, 'finding')).eq('product_id', product.id).maybeSingle();
    if (!data) throw new ApiError(422, 'Finding not found for this product.', 'VALIDATION');
    finding = data;
  }
  const traces = await rows(admin, 'engine_traces', product.id);
  const { pricing, allowed } = await pricingAndModels(admin);
  const names = strategy ? [strategy] : ['exact_reuse', ...(candidateModel ? ['model_substitution'] : [])];
  const drafts = names.map((name) => {
    if (name === 'exact_reuse') return planExactReuse(traces, finding);
    if (name === 'model_substitution') return planModelSubstitution(traces, finding, { candidateModel, allowedModels: allowed, maxBudgetUsd: budget, pricing });
    return { strategy: 'bounded_routing', status: 'BLOCKED', finding_id: finding?.id || null, reason: 'Bounded routing is not available on the platform engine yet.', blocked_reason: 'strategy_unavailable', expected_mechanism: 'bounded_routing', risk: 'medium', fallback: 'retain_baseline', max_budget_usd: budget ?? 0, sample_scope: [], baseline_config: {}, candidate_config: {}, required_evidence: ['desktop_engine'], plan_version: 'plan_v1' };
  });
  const inserts = drafts.map((d) => ({ product_id: product.id, workspace_id: product.workspace_id, finding_id: d.finding_id, strategy: d.strategy, status: d.status, reason: d.reason, expected_mechanism: d.expected_mechanism, risk: d.risk, fallback: d.fallback, max_budget_usd: d.max_budget_usd, sample_scope: d.sample_scope, baseline_config: d.baseline_config, candidate_config: d.candidate_config, required_evidence: d.required_evidence, plan_version: d.plan_version, config_hash: d.config_hash || '', blocked_reason: d.blocked_reason || null }));
  const { data, error } = await admin.from('engine_plans').insert(inserts).select('*');
  if (error) throw error;
  return (data || []).map(planOut);
});

on('GET', '/api/engine/products/:id/optimization/plans', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { product } = await loadProduct(admin, user, params.id, 'viewer');
  return (await rows(admin, 'engine_plans', product.id)).map(planOut);
});

on('POST', '/api/engine/products/:id/optimization/plans/:planId/execute', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { product } = await loadProduct(admin, user, params.id, 'member');
  rateLimit(`engine-execute:${user.id}`, { limit: 6, windowMs: 60_000 });
  const body = await readJson(request);
  const { data: plan } = await admin.from('engine_plans').select('*').eq('id', uuid(params.planId, 'plan')).eq('product_id', product.id).maybeSingle();
  if (!plan) throw new ApiError(404, 'Candidate plan not found.', 'NOT_FOUND');
  if (plan.status === 'BLOCKED') throw new ApiError(422, plan.blocked_reason || 'Plan is BLOCKED and cannot execute.', 'PLAN_BLOCKED');
  if (!['READY', 'COMPLETED', 'FAILED', 'EXECUTING'].includes(plan.status)) throw new ApiError(422, `Plan status ${plan.status} is not executable.`, 'VALIDATION');
  const traces = await rows(admin, 'engine_traces', product.id);
  const key = executionKeyFor(planOut(plan), traces);
  if (!body?.force_rerun) {
    const { data: existing } = await admin.from('engine_executions').select('*').eq('execution_key', key).in('status', ['RUNNING', 'SUCCEEDED']).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (existing) return executionOut(existing);
  }
  const { pricing, allowed } = await pricingAndModels(admin);
  const billing = await resolveBilling({ admin, user, workspaceId: product.workspace_id, projectId: product.project_id });
  const complete = async (payload) => completeText({ admin, user, billing, payload, operation: 'replay', extraMeta: { product_id: product.id, plan_id: plan.id, strategy: plan.strategy } });

  const { data: running, error: insertError } = await admin.from('engine_executions').insert({ candidate_plan_id: plan.id, product_id: product.id, workspace_id: product.workspace_id, status: 'RUNNING', execution_key: key, requested_model: plan.candidate_config?.model || null, baseline_trace_ids: plan.sample_scope || [], sample_results: [], started_at: new Date().toISOString() }).select('*').single();
  if (insertError) throw insertError;
  await admin.from('engine_plans').update({ status: 'EXECUTING' }).eq('id', plan.id);
  let result;
  try {
    result = await executePlan({ plan: planOut(plan), traces, complete, pricing, allowedModels: allowed });
  } catch (error) {
    await admin.from('engine_executions').update({ status: 'FAILED', completed_at: new Date().toISOString(), error_category: 'unknown', error_detail: String(error?.message || error).slice(0, 500) }).eq('id', running.id);
    await admin.from('engine_plans').update({ status: 'FAILED' }).eq('id', plan.id);
    throw new ApiError(422, String(error?.message || error), 'EXECUTION_FAILED');
  }
  const { spent_usd: _spent, ...fields } = result;
  const { data: done, error: updateError } = await admin.from('engine_executions').update(fields).eq('id', running.id).select('*').single();
  if (updateError) throw updateError;
  await admin.from('engine_plans').update({ status: result.status === 'SUCCEEDED' ? 'COMPLETED' : 'FAILED' }).eq('id', plan.id);
  return executionOut(done);
});

on('GET', '/api/engine/products/:id/optimization/executions', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { product } = await loadProduct(admin, user, params.id, 'viewer');
  return (await rows(admin, 'engine_executions', product.id)).map(executionOut);
});

on('GET', '/api/engine/products/:id/optimization/executions/:executionId', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { product } = await loadProduct(admin, user, params.id, 'viewer');
  const { data } = await admin.from('engine_executions').select('*').eq('id', uuid(params.executionId, 'execution')).eq('product_id', product.id).maybeSingle();
  if (!data) throw new ApiError(404, 'Candidate execution not found.', 'NOT_FOUND');
  return executionOut(data);
});

on('POST', '/api/engine/products/:id/evaluations', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { product } = await loadProduct(admin, user, params.id, 'member');
  const body = await readJson(request);
  const { data: execution } = await admin.from('engine_executions').select('*').eq('id', uuid(body?.candidate_execution_id, 'execution')).eq('product_id', product.id).maybeSingle();
  if (!execution) throw new ApiError(422, 'CandidateExecution not found for this product.', 'VALIDATION');
  const { data: plan } = await admin.from('engine_plans').select('*').eq('id', execution.candidate_plan_id).maybeSingle();
  const findingId = body?.finding_id ? uuid(body.finding_id, 'finding') : plan?.finding_id || null;
  const traces = await rows(admin, 'engine_traces', product.id);
  let result;
  try {
    result = runEvaluation({ execution: executionOut(execution), plan: plan ? planOut(plan) : null, traces, gateConfig: body?.gate_config || {}, cases: Array.isArray(body?.cases) ? body.cases : null });
  } catch (error) {
    throw new ApiError(422, String(error?.message || error), 'VALIDATION');
  }
  const { data, error } = await admin.from('engine_evaluations').insert({ product_id: product.id, workspace_id: product.workspace_id, candidate_plan_id: execution.candidate_plan_id, candidate_execution_id: execution.id, finding_id: findingId, ...result }).select('*').single();
  if (error) throw error;
  if (findingId) await admin.from('engine_findings').update({ evidence_status: result.status === 'VERIFIED' ? 'verified' : result.status === 'REJECTED' ? 'rejected' : 'needs_evidence' }).eq('id', findingId);
  return evaluationOut(data);
});

on('GET', '/api/engine/products/:id/evaluations', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { product } = await loadProduct(admin, user, params.id, 'viewer');
  return (await rows(admin, 'engine_evaluations', product.id)).map(evaluationOut);
});

on('GET', '/api/engine/products/:id/evaluations/:evaluationId', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { product } = await loadProduct(admin, user, params.id, 'viewer');
  const { data } = await admin.from('engine_evaluations').select('*').eq('id', uuid(params.evaluationId, 'evaluation')).eq('product_id', product.id).maybeSingle();
  if (!data) throw new ApiError(404, 'Evaluation not found.', 'NOT_FOUND');
  return { ...evaluationOut(data), cases: data.cases || [] };
});

on('GET', '/api/engine/products/:id/experiments', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { product } = await loadProduct(admin, user, params.id, 'viewer');
  return (await rows(admin, 'engine_evaluations', product.id)).map(experimentFromEvaluation);
});

// ---- implementations (browser mode: diff only, no git) --------------------------------
function implementationOut(i) {
  const { replacement_text: _r, ...rest } = i;
  return rest;
}

on('GET', '/api/engine/products/:id/implementations', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { product } = await loadProduct(admin, user, params.id, 'viewer');
  return (await rows(admin, 'engine_implementations', product.id)).map(implementationOut);
});

on('POST', '/api/engine/products/:id/implementations/prepare', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { product } = await loadProduct(admin, user, params.id, 'member');
  rateLimit(`engine-prepare:${user.id}`, { limit: 6, windowMs: 60_000 });
  const body = await readJson(request, { maxBytes: 2_000_000 });
  const evaluationId = uuid(body?.experiment_id, 'experiment');
  const { data: evaluation } = await admin.from('engine_evaluations').select('*').eq('id', evaluationId).eq('product_id', product.id).maybeSingle();
  if (!evaluation) throw new ApiError(422, 'Experiment not found for this product.', 'VALIDATION');
  if (evaluation.status !== 'VERIFIED') throw new ApiError(422, 'Only a VERIFIED experiment is eligible for implementation preparation.', 'VALIDATION');
  if (!evaluation.execution_proven || evaluation.verification_source !== 'EXECUTION_EVALUATION') throw new ApiError(422, 'Evaluation is not execution-proven.', 'VALIDATION');
  if (!evaluation.finding_id) throw new ApiError(422, 'This experiment is not linked to a source finding.', 'VALIDATION');
  const { data: finding } = await admin.from('engine_findings').select('*').eq('id', evaluation.finding_id).maybeSingle();
  if (!finding) throw new ApiError(422, 'Linked finding not found.', 'VALIDATION');
  if (finding.origin !== 'static_scan' || finding.file_path === 'runtime evidence') throw new ApiError(422, 'This verified experiment is runtime-derived and has no safe source target. Ask Zev for an implementation plan instead of writing code automatically.', 'VALIDATION');
  const targetFile = str(body?.target_file, { name: 'target_file', required: true, max: 600 }).replace(/\\/g, '/');
  if (targetFile !== finding.file_path) throw new ApiError(422, 'target_file must be the file the finding points at.', 'VALIDATION');
  if (classifyPath(targetFile) !== 'source') throw new ApiError(422, 'The linked target file is not allowed by the safe source policy.', 'VALIDATION');
  const sourceText = typeof body?.source_text === 'string' ? body.source_text : '';
  if (!sourceText.trim()) throw new ApiError(422, 'Provide the current contents of the target file (read locally by the app).', 'VALIDATION');
  if (sourceText.length > 400_000) throw new ApiError(413, 'Target file is too large to rewrite safely.', 'PAYLOAD_TOO_LARGE');
  if (containsSecretLikeValue(sourceText)) throw new ApiError(422, 'Hardcoded secret-like material was detected in the target source file. ZEVQORA refuses to send or rewrite this file until the credential is removed/rotated and replaced with safe configuration.', 'VALIDATION');
  const instructions = str(body?.instructions, { name: 'instructions', max: 4000 }) || null;
  const model = str(body?.model, { name: 'model', max: 160 }) || DEFAULT_MODEL;

  const system = `You are the controlled implementation worker inside ZEVQORA.
Return JSON only with exactly this structure:
{
  "summary": "short review summary",
  "content": "the complete replacement contents of the target file"
}

Rules:
- Modify only the one target file supplied by ZEVQORA.
- Preserve unrelated behavior and public interfaces.
- Make the smallest implementation that reflects the verified experiment/finding.
- Keep a safe baseline/fallback path where the task requires one.
- Never add credentials, API keys, telemetry exfiltration, auto-deploy, or auto-merge logic.
- Never claim a saving inside source comments unless it is necessary; evidence belongs in ZEVQORA, not hard-coded marketing copy.
- Output must be valid JSON. Do not wrap it in Markdown.`;
  const userPayload = { target_file: targetFile, finding: { category: finding.category, title: finding.title, root_cause: finding.root_cause, symbol: finding.symbol }, verified_experiment: { id: evaluation.id, sample_size: evaluation.sample_count, baseline_cost_usd: evaluation.baseline_cost_usd, candidate_cost_usd: evaluation.candidate_cost_usd, baseline_quality: evaluation.baseline_quality, candidate_quality: evaluation.candidate_quality, evidence_version: evaluation.evidence_version }, user_instructions: instructions, current_file: sourceText };
  const billing = await resolveBilling({ admin, user, workspaceId: product.workspace_id, projectId: product.project_id });
  const res = await completeText({ admin, user, billing, payload: { model, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(userPayload) }], temperature: 0.1, max_tokens: 4096, response_format: { type: 'json_object' } }, operation: 'implementation', extraMeta: { product_id: product.id, evaluation_id: evaluation.id }, timeoutMs: 110_000 });
  let parsed;
  try {
    let candidate = (res.content || '').trim();
    if (candidate.startsWith('```')) candidate = candidate.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
  } catch {
    throw new ApiError(422, 'The model did not return the required JSON implementation object.', 'MODEL_OUTPUT');
  }
  if (typeof parsed.content !== 'string' || typeof parsed.summary !== 'string') throw new ApiError(422, "Implementation JSON must contain string fields 'summary' and 'content'.", 'MODEL_OUTPUT');
  if (!parsed.content.trim()) throw new ApiError(422, 'The proposed replacement was empty.', 'MODEL_OUTPUT');
  const diff = unifiedDiff(targetFile, sourceText, parsed.content);
  if (!diff.trim()) throw new ApiError(422, 'The generated implementation produced no source diff.', 'MODEL_OUTPUT');
  const implId = randomUUID();
  const branch = `zevqora/exp-${evaluation.id.replace(/-/g, '').slice(0, 8)}-${implId.replace(/-/g, '').slice(0, 6)}`;
  const { data, error } = await admin.from('engine_implementations').insert({ id: implId, product_id: product.id, workspace_id: product.workspace_id, experiment_id: evaluation.id, finding_id: finding.id, status: 'PREPARED_NO_TESTS', branch_name: branch, worktree_path: 'browser', target_file: targetFile, summary: parsed.summary.trim().slice(0, 4000), diff_text: diff, replacement_text: parsed.content, model: res.model || model, created_by: user.id }).select('*').single();
  if (error) throw error;
  return implementationOut(data);
});

on('POST', '/api/engine/products/:id/implementations/:implId/decision', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { product } = await loadProduct(admin, user, params.id, 'member');
  const body = await readJson(request);
  const { data: impl } = await admin.from('engine_implementations').select('*').eq('id', uuid(params.implId, 'implementation')).eq('product_id', product.id).maybeSingle();
  if (!impl) throw new ApiError(422, 'Implementation candidate not found for this product.', 'VALIDATION');
  const decision = body?.decision;
  let status;
  if (decision === 'reject') status = 'REJECTED';
  else if (decision === 'approve') {
    if (impl.status === 'TESTS_FAILED') throw new ApiError(422, 'A candidate whose tests failed cannot be approved for review. Fix or reject it.', 'VALIDATION');
    status = 'APPROVED_FOR_REVIEW';
  } else throw new ApiError(422, 'Decision must be approve or reject.', 'VALIDATION');
  const { data, error } = await admin.from('engine_implementations').update({ status, review_note: str(body?.note, { name: 'note', max: 2000 }) || null, reviewed_at: new Date().toISOString() }).eq('id', impl.id).select('*').single();
  if (error) throw error;
  return implementationOut(data);
});

on('GET', '/api/engine/products/:id/implementations/:implId/git-context', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { product } = await loadProduct(admin, user, params.id, 'viewer');
  const { data: impl } = await admin.from('engine_implementations').select('*').eq('id', uuid(params.implId, 'implementation')).eq('product_id', product.id).maybeSingle();
  if (!impl) throw new ApiError(404, 'Implementation candidate not found.', 'NOT_FOUND');
  return { implementation_id: impl.id, branch_name: impl.branch_name, worktree_path: impl.worktree_path, worktree_exists: false, remote_url: impl.remote_url, remote_host: null, default_branch: 'main', compare_url: null, pushed_at: impl.pushed_at, pr_url: impl.pr_url, status: impl.status, mode: 'browser' };
});

on('GET', '/api/engine/products/:id/implementations/:implId/patch', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { product } = await loadProduct(admin, user, params.id, 'viewer');
  const { data: impl } = await admin.from('engine_implementations').select('*').eq('id', uuid(params.implId, 'implementation')).eq('product_id', product.id).maybeSingle();
  if (!impl) throw new ApiError(404, 'Implementation candidate not found.', 'NOT_FOUND');
  return { diff: impl.diff_text, replacement: impl.replacement_text, target_file: impl.target_file, branch_name: impl.branch_name };
});

on('POST', '/api/engine/products/:id/implementations/:implId/push', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  await loadProduct(admin, user, params.id, 'member');
  throw new ApiError(422, 'Pushing a branch needs the local Git repository. Open this product in ZEVQORA Desktop, or download the patch and apply it with git apply.', 'DESKTOP_ONLY');
});

on('POST', '/api/engine/products/:id/implementations/:implId/pr-link', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const { product } = await loadProduct(admin, user, params.id, 'member');
  const body = await readJson(request);
  const url = str(body?.pr_url, { name: 'pr_url', required: true, max: 500 });
  if (!/^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\//.test(url)) throw new ApiError(422, 'Pull request URL must point at GitHub, GitLab or Bitbucket over HTTPS.', 'VALIDATION');
  const { data, error } = await admin.from('engine_implementations').update({ pr_url: url }).eq('id', uuid(params.implId, 'implementation')).eq('product_id', product.id).select('*').single();
  if (error) throw error;
  return implementationOut(data);
});

// ---- Zev ----------------------------------------------------------------------------
on('POST', '/api/engine/agent/chat', async ({ request }) => {
  const { user, admin } = await requireUser(request);
  rateLimit(`engine-chat:${user.id}`, { limit: 30, windowMs: 60_000 });
  const body = await readJson(request, { maxBytes: 200_000 });
  const history = Array.isArray(body?.messages) ? body.messages.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-16).map((m) => ({ role: m.role, content: m.content.slice(0, 8000) })) : [];
  if (!history.length) throw new ApiError(400, 'messages is required.', 'VALIDATION');
  let product = null;
  if (body?.product_id) product = (await loadProduct(admin, user, body.product_id, 'viewer')).product;
  const workspaceId = product?.workspace_id || (body?.workspace_id ? uuid(body.workspace_id, 'workspace') : null);
  if (!openRouterConfigured()) {
    return { message: 'Zev is ready, but platform compute is not configured on this deployment yet.', model: 'none', provider: 'none', tool_events: [], openrouter_configured: false };
  }
  const billing = await resolveBilling({ admin, user, workspaceId, projectId: product?.project_id || null });
  const complete = async (payload) => completeText({ admin, user, billing, payload, operation: 'zev_chat', extraMeta: { product_id: product?.id || null } });
  const ctx = {
    product: async () => productOut(product || {}),
    aiCalls: async () => (product ? rows(admin, 'engine_ai_calls', product.id, null) : []),
    findings: async () => (product ? (await rows(admin, 'engine_findings', product.id)).map(findingOut) : []),
    economics: async () => (product ? economics(await rows(admin, 'engine_traces', product.id), canonicalVerified(await rows(admin, 'engine_evaluations', product.id))) : { trace_count: 0 }),
    evaluations: async () => (product ? rows(admin, 'engine_evaluations', product.id) : []),
  };
  const requested = str(body?.model, { name: 'model', max: 160 }) || DEFAULT_MODEL;
  const model = requested === 'openrouter/auto' ? DEFAULT_MODEL : requested;
  const out = await runZev({ complete, ctx, history, model, productId: product?.id || null });
  return { ...out, provider: 'zevqora-platform', openrouter_configured: true };
});
