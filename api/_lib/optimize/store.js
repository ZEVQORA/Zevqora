/**
 * Optimization Run persistence and orchestration. Server-only (service role,
 * after the route checked workspace membership).
 *
 * Evidence discipline: a run's baseline snapshot hashes the evidence it was
 * computed from. Diagnoses and candidates recompute that evidence and refuse
 * to proceed if it changed (EVIDENCE_CHANGED → start a new run), so every
 * diagnosis and candidate is about exactly the baseline the user saw.
 */
import { ApiError } from '../http.js';
import { flagEnabledForWorkspace } from '../flags.js';
import { deterministicUuid } from '../product/hashing.js';
import { loadPricing } from '../pricing.js';
import { openRouterConfigured } from '../openrouter.js';
import { allowedCandidateModels, cloudComputeEnabled } from '../platform-compute.js';
import { runPlanExecution } from '../product/run-plan.js';
import { projectEngineProduct } from '../zevir/store.js';
import { contractHash, normalizeRequirements, requirementsFromProjectFloor, ContractError } from './contract.js';
import { performanceSnapshot, WINDOW_LIMIT } from './performance.js';
import { latencyAnalysis } from './latency.js';
import { diagnose } from './diagnose.js';
import { generateCandidates, EXECUTABLE } from './passes.js';
import { evaluateUnderContract } from './verdict.js';
import { DEMO_REQUIREMENTS, DEMO_ROOT, DEMO_V2_REQUIREMENTS, DEMO_V2_ROOT } from './demo.js';

export const FLAG = 'verified_optimization_vnext';
const MAX_GRAPHS = 200;

export async function optimizeEnabled(admin, workspaceId) {
  return flagEnabledForWorkspace(admin, FLAG, workspaceId);
}

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};
const contractErr = (fn) => {
  try {
    return fn();
  } catch (error) {
    if (error instanceof ContractError) throw new ApiError(422, error.message, 'CONTRACT_INVALID');
    throw error;
  }
};
function sqlError(error) {
  const m = String(error?.message || '');
  const code = m.match(/(CONTRACT_[A-Z_]+|RUN_[A-Z_]+)/)?.[1];
  if (code) return new ApiError(code === 'CONTRACT_NOT_FOUND' ? 404 : 409, m.slice(m.indexOf(code)).slice(0, 300), code);
  return error;
}

// ---- contracts ------------------------------------------------------------------
export function contractOut(c) {
  return c && { id: c.id, product_id: c.product_id, version: c.version, status: c.status, requirements: c.requirements, contract_hash: c.contract_hash, created_at: c.created_at, frozen_at: c.frozen_at, frozen_by: c.frozen_by, superseded_at: c.superseded_at, superseded_by: c.superseded_by };
}

export async function listContracts(admin, product) {
  return must(await admin.from('evaluation_contracts').select('*').eq('product_id', product.id).order('version', { ascending: false }).limit(20));
}

/** Creates the product's draft (version = latest + 1) or updates the existing draft. */
export async function saveDraft(admin, { product, user, requirements }) {
  const contracts = await listContracts(admin, product);
  const draft = contracts.find((c) => c.status === 'draft');
  // First draft: the project floor (014), or for the synthetic demo its suggested contract.
  const seed = () => (product.root_path === DEMO_ROOT ? normalizeRequirements(DEMO_REQUIREMENTS) : product.root_path === DEMO_V2_ROOT ? normalizeRequirements(DEMO_V2_REQUIREMENTS) : requirementsFromProjectFloor(product.evaluation_requirements || {}));
  const base = requirements ?? (draft ? draft.requirements : (contracts.find((c) => c.status === 'frozen')?.requirements ?? seed()));
  const normalized = contractErr(() => normalizeRequirements(base));
  const hash = contractHash(product.id, normalized);
  if (draft) {
    const { data, error } = await admin.from('evaluation_contracts').update({ requirements: normalized, contract_hash: hash, updated_at: new Date().toISOString() }).eq('id', draft.id).eq('status', 'draft').select('*').single();
    if (error) throw sqlError(error);
    return data;
  }
  const version = (contracts[0]?.version || 0) + 1;
  const { data, error } = await admin.from('evaluation_contracts').insert({ workspace_id: product.workspace_id, product_id: product.id, version, status: 'draft', requirements: normalized, contract_hash: hash, created_by: user.id }).select('*').single();
  if (error) throw sqlError(error);
  return data;
}

export async function freezeContract(admin, { product, contractId, user }) {
  const { data: c } = await admin.from('evaluation_contracts').select('*').eq('id', contractId).eq('product_id', product.id).maybeSingle();
  if (!c) throw new ApiError(404, 'Contract not found.', 'NOT_FOUND');
  if (c.status !== 'draft') throw new ApiError(409, `Contract v${c.version} is already ${c.status}; frozen contracts never change. Create a new version.`, 'CONTRACT_IMMUTABLE');
  // Re-derive the hash from the stored requirements: what is frozen is exactly what is hashed.
  const hash = contractHash(product.id, contractErr(() => normalizeRequirements(c.requirements)));
  if (hash !== c.contract_hash) throw new ApiError(409, 'Stored contract hash does not match its requirements.', 'CONTRACT_HASH_MISMATCH');
  const { data, error } = await admin.rpc('evaluation_contract_freeze', { p_contract_id: c.id, p_frozen_by: user.id, p_expected_hash: hash });
  if (error) throw sqlError(error);
  return data;
}

// ---- runs ------------------------------------------------------------------------
export async function createRun(admin, { product, user, contractId }) {
  const { data: c } = await admin.from('evaluation_contracts').select('*').eq('id', contractId).eq('product_id', product.id).maybeSingle();
  if (!c) throw new ApiError(404, 'Contract not found.', 'NOT_FOUND');
  if (c.status !== 'frozen') throw new ApiError(409, 'Freeze the Evaluation Contract before starting an Optimization Run.', 'RUN_CONTRACT_NOT_FROZEN');
  const { data, error } = await admin.from('optimization_runs').insert({ workspace_id: product.workspace_id, product_id: product.id, contract_id: c.id, contract_hash: c.contract_hash, created_by: user.id }).select('*').single();
  if (error) throw sqlError(error);
  return data;
}

export async function loadRunContext(admin, run) {
  const [{ data: contract }, { data: product }] = await Promise.all([
    admin.from('evaluation_contracts').select('*').eq('id', run.contract_id).maybeSingle(),
    admin.from('engine_products').select('*').eq('id', run.product_id).maybeSingle(),
  ]);
  if (!contract || !product) throw new ApiError(404, 'Run context not found.', 'NOT_FOUND');
  if (contract.contract_hash !== run.contract_hash) throw new ApiError(409, 'The run’s contract hash no longer matches.', 'RUN_CONTRACT_HASH');
  return { contract, product };
}

// ---- evidence ---------------------------------------------------------------------
const TRACE_COLUMNS = 'id,product_id,workspace_id,request_id,timestamp,symbol,workflow,provider,model,requested_model,response_model,input_text,output_text,expected_output,system_prompt,messages,system_prompt_hash,input_tokens,output_tokens,cached_input_tokens,reasoning_tokens,latency_ms,ttft_ms,cost_usd,cost_source,pricing_version,attempt,retry_reason,input_hash,output_hash,protected,metadata,created_at';

/**
 * Bounded evidence window: newest WINDOW_LIMIT traces + the product's latest
 * ZevIR graphs, in two reads. The v2 graph read (018) adds content-free node
 * attributes for the structural diagnoses; without 018 the 017 read is used and
 * those families simply find nothing. The snapshot hash covers graph hashes
 * only, so it is the same either way.
 */
export async function loadEvidence(admin, product) {
  const traces = must(await admin.from('engine_traces').select(TRACE_COLUMNS).eq('product_id', product.id).order('created_at', { ascending: false }).limit(WINDOW_LIMIT + 1));
  const truncated = traces.length > WINDOW_LIMIT;
  const window = traces.slice(0, WINDOW_LIMIT).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const args = { p_workspace_id: product.workspace_id, p_product_id: product.id, p_max_graphs: MAX_GRAPHS };
  let { data: set, error } = await admin.rpc('zevir_product_graph_set_v2', args);
  if (error && /zevir_product_graph_set_v2|does not exist|42883/.test(`${error.message} ${error.code}`)) ({ data: set, error } = await admin.rpc('zevir_product_graph_set', args));
  if (error) throw error;
  const graphs = (set?.graphs || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { traces: window, truncated, graphs, graphSummary: { count: graphs.length, hashes: graphs.map((g) => g.graph_hash), truncated: Boolean(set?.truncated), total: set?.total ?? graphs.length } };
}

function computeBaseline(evidence, contract) {
  const snapshot = performanceSnapshot(evidence.traces, contract.requirements, { graphs: evidence.graphSummary, truncated: evidence.truncated, contractHash: contract.contract_hash });
  const latency = latencyAnalysis(evidence.graphs, { retryLatencyMs: snapshot.reliability.retry_latency_ms, retriedRequests: snapshot.reliability.retried_requests });
  return { snapshot, latency };
}

export async function verifiedEvidence(admin, run, product, contract) {
  if (!run.baseline_snapshot_id) throw new ApiError(409, 'Build the baseline first.', 'BASELINE_REQUIRED');
  const { data: stored } = await admin.from('performance_snapshots').select('*').eq('id', run.baseline_snapshot_id).maybeSingle();
  if (!stored) throw new ApiError(409, 'Build the baseline first.', 'BASELINE_REQUIRED');
  const evidence = await loadEvidence(admin, product);
  const { snapshot, latency } = computeBaseline(evidence, contract);
  if (snapshot.snapshot_hash !== stored.snapshot_hash) throw new ApiError(409, 'The workload’s evidence changed since this run’s baseline. Start a new run so diagnoses and verdicts refer to the evidence you reviewed.', 'EVIDENCE_CHANGED');
  return { evidence, snapshot, latency, stored };
}

// ---- baseline ---------------------------------------------------------------------
export async function buildBaseline(admin, { run, user }) {
  const { contract, product } = await loadRunContext(admin, run);
  if (run.baseline_snapshot_id) {
    const { data } = await admin.from('performance_snapshots').select('*').eq('id', run.baseline_snapshot_id).maybeSingle();
    if (data) return { snapshot: data, reused: true };
  }
  // ZevIR is the structural evidence for diagnoses: project this product's traces first.
  let projection = null;
  try {
    const out = await projectEngineProduct({ admin, product, userId: user.id, prune: true });
    projection = { status: out.run.status, run_id: out.run.id };
  } catch (error) {
    projection = { status: 'failed', detail: String(error?.message || error).slice(0, 200) };
  }
  const evidence = await loadEvidence(admin, product);
  const { snapshot, latency } = computeBaseline(evidence, contract);
  const { snapshot_hash: hash, ...metrics } = snapshot;
  const { data, error } = await admin
    .from('performance_snapshots')
    .insert({ workspace_id: product.workspace_id, product_id: product.id, run_id: run.id, kind: 'baseline', contract_hash: contract.contract_hash, version: snapshot.version, metrics: { ...metrics, zevir_projection: projection }, latency_analysis: latency, completeness: snapshot.evidence.completeness, trace_count: evidence.traces.length, window_truncated: evidence.truncated, snapshot_hash: hash })
    .select('*')
    .single();
  if (error) throw sqlError(error);
  must(await admin.from('optimization_runs').update({ baseline_snapshot_id: data.id, updated_at: new Date().toISOString() }).eq('id', run.id).select('id').single());
  return { snapshot: data, reused: false };
}

// ---- diagnoses ---------------------------------------------------------------------
export async function runDiagnoses(admin, { run }) {
  const { contract, product } = await loadRunContext(admin, run);
  const { evidence, snapshot, latency, stored } = await verifiedEvidence(admin, run, product, contract);
  const pricing = await loadPricing(admin);
  const found = diagnose({ product, snapshot, traces: evidence.traces, graphs: evidence.graphs, latency, requirements: contract.requirements, pricing });
  const rows = found.map((d) => ({
    id: deterministicUuid(`zev.diagnosis:${run.id}:${d.diagnosis_hash}`),
    workspace_id: product.workspace_id,
    product_id: product.id,
    run_id: run.id,
    snapshot_id: stored.id,
    family: d.family,
    version: d.version,
    scope: d.scope,
    symptom: d.symptom,
    root_cause: d.root_cause,
    causal_path: d.causal_path,
    affected_nodes: d.affected_nodes,
    evidence_refs: d.evidence_refs,
    metrics: d.metrics,
    confidence: d.confidence,
    severity: d.severity,
    required_additional_evidence: d.required_additional_evidence,
    falsifier: d.falsifier,
    suggested_optimization_passes: d.suggested_optimization_passes,
    risk_class: d.risk_class,
    diagnosis_hash: d.diagnosis_hash,
  }));
  const existing = new Set(must(await admin.from('optimization_diagnoses').select('diagnosis_hash').eq('run_id', run.id)).map((r) => r.diagnosis_hash));
  const fresh = rows.filter((r) => !existing.has(r.diagnosis_hash));
  if (fresh.length) must(await admin.from('optimization_diagnoses').insert(fresh).select('id'));
  return listDiagnoses(admin, run);
}

export async function listDiagnoses(admin, run) {
  return must(await admin.from('optimization_diagnoses').select('*').eq('run_id', run.id).order('family', { ascending: true }).order('scope', { ascending: true }));
}

// ---- candidates ---------------------------------------------------------------------
export async function platformCompute(admin) {
  return openRouterConfigured() && (await cloudComputeEnabled(admin));
}

export async function generateRunCandidates(admin, { run }) {
  const { contract, product } = await loadRunContext(admin, run);
  const { evidence, stored } = await verifiedEvidence(admin, run, product, contract);
  const diagnoses = await listDiagnoses(admin, run);
  if (!diagnoses.length) return { candidates: await listCandidates(admin, run), skipped: [], note: 'No diagnoses: nothing to propose.' };
  const [pricing, allowed, compute] = await Promise.all([loadPricing(admin), allowedCandidateModels(admin), platformCompute(admin)]);
  const { candidates, skipped } = generateCandidates(diagnoses, {
    traces: evidence.traces,
    contract: { id: contract.id, hash: contract.contract_hash, requirements: normalizeRequirements(contract.requirements) },
    snapshot: { id: stored.id, snapshot_hash: stored.snapshot_hash },
    pricing,
    allowedModels: new Set(allowed),
    platformCompute: compute,
  });
  const idByHash = new Map(diagnoses.map((d) => [d.diagnosis_hash, d.id]));
  const have = new Set(must(await admin.from('engine_plans').select('candidate_config_hash').eq('run_id', run.id)).map((r) => r.candidate_config_hash));
  const inserts = candidates
    .filter((c) => !have.has(c.candidate_config_hash))
    .map((c) => ({
      product_id: product.id,
      workspace_id: product.workspace_id,
      finding_id: null,
      strategy: c.strategy,
      status: c.status,
      reason: c.reason,
      expected_mechanism: c.expected_mechanism,
      risk: c.risk,
      fallback: c.fallback,
      max_budget_usd: c.max_budget_usd ?? 0,
      sample_scope: c.sample_scope,
      baseline_config: c.baseline_config,
      candidate_config: c.candidate_config,
      required_evidence: c.required_evidence,
      plan_version: c.plan_version,
      config_hash: c.config_hash || '',
      blocked_reason: c.blocked_reason || null,
      run_id: run.id,
      diagnosis_id: idByHash.get(c.diagnosis_hash) || null,
      optimization_pass: c.optimization_pass,
      pass_version: c.pass_version,
      contract_hash: c.contract_hash,
      baseline_snapshot_id: c.baseline_snapshot_id,
      executable_status: c.executable_status,
      candidate_config_hash: c.candidate_config_hash,
      lineage: c.lineage,
    }));
  if (inserts.length) must(await admin.from('engine_plans').insert(inserts).select('id'));
  return { candidates: await listCandidates(admin, run), skipped };
}

export async function listCandidates(admin, run) {
  // Plan-search executions (vNext Part 2B) are materialized as 'execution_plan' rows; they are not Part 2A candidates.
  return must(await admin.from('engine_plans').select('*').eq('run_id', run.id).order('created_at', { ascending: true })).filter((p) => p.strategy !== 'execution_plan');
}

// ---- replay + verdict ------------------------------------------------------------------
/**
 * Runs one EXECUTABLE candidate through the engine's own execution path and
 * evaluates it under the run's frozen contract. The request carries no gate
 * configuration: thresholds come only from the contract and the project floor.
 */
export async function replayCandidate(admin, { run, planId, user }) {
  const { contract, product } = await loadRunContext(admin, run);
  const { data: plan } = await admin.from('engine_plans').select('*').eq('id', planId).eq('run_id', run.id).maybeSingle();
  if (!plan) throw new ApiError(404, 'Candidate not found in this run.', 'NOT_FOUND');
  if (plan.executable_status !== EXECUTABLE) throw new ApiError(422, `This candidate is ${plan.executable_status}: ${plan.lineage?.not_executable_reason || 'it cannot be replayed by the current engine'}`, 'CANDIDATE_NOT_EXECUTABLE');
  if (plan.contract_hash !== run.contract_hash) throw new ApiError(409, 'Candidate was generated under a different contract.', 'RUN_CONTRACT_HASH');
  await verifiedEvidence(admin, run, product, contract);
  const traces = must(await admin.from('engine_traces').select('*').eq('product_id', product.id));
  const { execution } = await runPlanExecution({ admin, user, product, plan, traces, extra: { run_id: run.id, contract_hash: run.contract_hash } });
  const { data: prior } = await admin.from('engine_evaluations').select('*').eq('candidate_execution_id', execution.id).eq('run_id', run.id).eq('contract_hash', run.contract_hash).limit(1).maybeSingle();
  if (prior) return { evaluation: prior, execution, reused: true };
  const normalizedPlan = { ...plan, sample_scope: plan.sample_scope || [], baseline_config: plan.baseline_config || {}, candidate_config: plan.candidate_config || {} };
  const result = evaluateUnderContract({ execution: { ...execution, baseline_trace_ids: execution.baseline_trace_ids || [], sample_results: execution.sample_results || [] }, plan: normalizedPlan, traces, contract, projectRequirements: product.evaluation_requirements || {} });
  const { data: evaluation, error } = await admin
    .from('engine_evaluations')
    .insert({ product_id: product.id, workspace_id: product.workspace_id, candidate_plan_id: plan.id, candidate_execution_id: execution.id, finding_id: null, ...result, run_id: run.id })
    .select('*')
    .single();
  if (error) throw error;
  must(await admin.from('optimization_runs').update({ status: 'evaluated', updated_at: new Date().toISOString() }).eq('id', run.id).select('id').single());
  return { evaluation, execution, reused: false };
}
