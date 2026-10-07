/**
 * Executes one candidate plan: idempotent on (plan config, baseline evidence),
 * budgeted, provider spend through platform compute. Shared by
 * POST /api/engine/products/:id/optimization/plans/:planId/execute and the
 * Optimization Run replay, so both use exactly the same path.
 */
import { ApiError } from '../http.js';
import { loadPricing } from '../pricing.js';
import { allowedCandidateModels, completeText, resolveBilling } from '../platform-compute.js';
import { executionKeyFor } from './strategies.js';
import { executePlan } from './executor.js';

export function normalizePlan(p) {
  return { ...p, sample_scope: p.sample_scope || [], baseline_config: p.baseline_config || {}, candidate_config: p.candidate_config || {}, required_evidence: p.required_evidence || [] };
}

/** Returns { execution, reused }. `extra` adds columns to the execution row (e.g. run lineage). */
export async function runPlanExecution({ admin, user, product, plan, traces, forceRerun = false, extra = {} }) {
  if (plan.status === 'BLOCKED') throw new ApiError(422, plan.blocked_reason || 'Plan is BLOCKED and cannot execute.', 'PLAN_BLOCKED');
  if (!['READY', 'COMPLETED', 'FAILED', 'EXECUTING'].includes(plan.status)) throw new ApiError(422, `Plan status ${plan.status} is not executable.`, 'VALIDATION');
  const normalized = normalizePlan(plan);
  const key = executionKeyFor(normalized, traces);
  if (!forceRerun) {
    const { data: existing } = await admin.from('engine_executions').select('*').eq('execution_key', key).in('status', ['RUNNING', 'SUCCEEDED']).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (existing) return { execution: existing, reused: true };
  }
  const pricing = await loadPricing(admin);
  const allowed = new Set(await allowedCandidateModels(admin));
  const billing = await resolveBilling({ admin, user, workspaceId: product.workspace_id, projectId: product.project_id });
  const complete = async (payload) => completeText({ admin, user, billing, payload, operation: 'replay', extraMeta: { product_id: product.id, plan_id: plan.id, strategy: plan.strategy } });

  const { data: running, error: insertError } = await admin.from('engine_executions').insert({ candidate_plan_id: plan.id, product_id: product.id, workspace_id: product.workspace_id, status: 'RUNNING', execution_key: key, requested_model: plan.candidate_config?.model || null, baseline_trace_ids: plan.sample_scope || [], sample_results: [], started_at: new Date().toISOString(), ...extra }).select('*').single();
  if (insertError) throw insertError;
  await admin.from('engine_plans').update({ status: 'EXECUTING' }).eq('id', plan.id);
  let result;
  try {
    result = await executePlan({ plan: normalized, traces, complete, pricing, allowedModels: allowed });
  } catch (error) {
    await admin.from('engine_executions').update({ status: 'FAILED', completed_at: new Date().toISOString(), error_category: 'unknown', error_detail: String(error?.message || error).slice(0, 500) }).eq('id', running.id);
    await admin.from('engine_plans').update({ status: 'FAILED' }).eq('id', plan.id);
    throw new ApiError(422, String(error?.message || error), 'EXECUTION_FAILED');
  }
  const { spent_usd: _spent, ...fields } = result;
  const { data: done, error: updateError } = await admin.from('engine_executions').update(fields).eq('id', running.id).select('*').single();
  if (updateError) throw updateError;
  await admin.from('engine_plans').update({ status: result.status === 'SUCCEEDED' ? 'COMPLETED' : 'FAILED' }).eq('id', plan.id);
  return { execution: done, reused: false };
}
