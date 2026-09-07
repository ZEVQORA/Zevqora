/**
 * Platform compute: one accounted model call on behalf of a signed-in user.
 *
 * Every place the platform spends on a user's behalf (the desktop proxy, web
 * replays, Zev on the web, patch generation) goes through `completeForUser`:
 * resolve who is billed → plan + Zev credit → rate limit → OpenRouter with the
 * server credential → charge the provider-reported cost idempotently.
 */
import { randomUUID } from 'node:crypto';
import { ApiError } from './http.js';
import { accountStateForUser, loadPlan } from './supabase.js';
import { requireWorkspaceRole, requireProjectAccess, rateLimit } from './auth.js';
import { forwardChatCompletion, openRouterConfigured } from './openrouter.js';
import { loadPricing, normalizeModel, estimateCost } from './pricing.js';
import { validateCompletionRequest, rpmForPlan } from './platform-guard.js';

/**
 * Resolves who is billed and under which plan. A workspace bills its owner under
 * the workspace's effective plan; without one the caller's own account plan applies.
 */
export async function resolveBilling({ admin, user, workspaceId = null, projectId = null }) {
  let billingUserId = user.id;
  let planId = 'free';
  let plan = null;
  let workspace = null;
  let project = null;

  if (workspaceId) {
    const role = await requireWorkspaceRole(admin, workspaceId, user.id, 'member');
    const { data: ws } = await admin.from('workspaces').select('id,name,slug,owner_id,plan_override').eq('id', workspaceId).single();
    const { data: effective } = await admin.rpc('workspace_plan', { ws: workspaceId });
    planId = effective || 'free';
    plan = await loadPlan(admin, planId);
    billingUserId = ws.owner_id;
    workspace = { id: ws.id, name: ws.name, slug: ws.slug, role };
  } else {
    const account = await accountStateForUser(user.id);
    planId = account.plan;
    plan = await loadPlan(admin, planId);
  }

  if (projectId) {
    const access = await requireProjectAccess(admin, projectId, user.id, 'member');
    if (workspaceId && access.project.workspace_id !== workspaceId) throw new ApiError(400, 'Project does not belong to the workspace.', 'VALIDATION');
    project = { id: access.project.id, name: access.project.name, workspace_id: access.project.workspace_id };
    if (!workspaceId) {
      const { data: ws } = await admin.from('workspaces').select('id,name,slug,owner_id').eq('id', access.project.workspace_id).single();
      const { data: effective } = await admin.rpc('workspace_plan', { ws: ws.id });
      planId = effective || 'free';
      plan = await loadPlan(admin, planId);
      billingUserId = ws.owner_id;
      workspace = { id: ws.id, name: ws.name, slug: ws.slug, role: access.role };
    }
  }
  return { billingUserId, planId, plan, workspace, project };
}

export async function creditState(admin, billingUserId, plan) {
  const { data: credit } = await admin.from('credit_balances').select('included_usd,used_usd,period_end').eq('user_id', billingUserId).maybeSingle();
  const included = Number(credit?.included_usd ?? plan?.limits?.credits_usd ?? 5);
  const used = Number(credit?.used_usd ?? 0);
  return { included, used, remaining: Math.max(0, included - used), periodEnd: credit?.period_end || null };
}

export async function cloudComputeEnabled(admin) {
  const { data: flag } = await admin.from('feature_flags').select('enabled').eq('key', 'cloud_replay').maybeSingle();
  return flag ? Boolean(flag.enabled) : true;
}

/** Candidate models the platform can replay on: priced, non-embedding rows. */
export async function allowedCandidateModels(admin) {
  const pricing = await loadPricing(admin);
  const out = [];
  for (const row of pricing.values()) if (row.tier !== 'embedding') out.push(row.model);
  return out.sort();
}

/**
 * One accounted completion. `payload` is the raw OpenRouter-shaped request
 * (validated and bounded here). Returns the normalized provider body plus the
 * `zevqora` accounting block. Throws ApiError on refusal.
 */
export async function completeForUser({ admin, user, workspaceId = null, projectId = null, payload, operation = 'platform_completion', extraMeta = {}, timeoutMs = 90_000, billing: presolved = null }) {
  const billing = presolved || (await resolveBilling({ admin, user, workspaceId, projectId }));
  rateLimit(`platform:${user.id}`, { limit: rpmForPlan(billing.planId, billing.plan?.limits), windowMs: 60_000 });
  if (!(await cloudComputeEnabled(admin))) throw new ApiError(503, 'Platform compute is temporarily disabled.', 'FEATURE_DISABLED');
  if (!openRouterConfigured()) throw new ApiError(503, 'Platform compute is not configured on this deployment yet.', 'PROVIDER_NOT_CONFIGURED');

  const { payload: clean, totalChars } = validateCompletionRequest(payload);
  const credits = await creditState(admin, billing.billingUserId, billing.plan);
  if (credits.remaining <= 0) {
    throw new ApiError(402, 'Zev credit for this billing period is used up. Upgrade the plan or wait for the reset.', 'INSUFFICIENT_CREDITS', { remaining_usd: credits.remaining, included_usd: credits.included, plan: billing.planId, billing_owner: billing.billingUserId === user.id ? 'you' : 'workspace owner' });
  }
  const pricing = await loadPricing(admin);
  const estimate = estimateCost(pricing, normalizeModel(null, clean.model).key, { input: Math.ceil(totalChars / 4), output: clean.max_tokens });
  if (estimate && estimate.cost > credits.remaining) {
    throw new ApiError(402, 'This request could exceed the remaining Zev credit.', 'INSUFFICIENT_CREDITS', { estimated_usd: estimate.cost, remaining_usd: credits.remaining, plan: billing.planId });
  }

  const { body, latencyMs, attempt } = await forwardChatCompletion(clean, { timeoutMs });
  const usage = body.usage || {};
  const cost = Number.isFinite(usage.cost) ? Number(usage.cost) : null;
  const requestId = `platform:${body.id || randomUUID()}`;
  const metadata = {
    provider: 'openrouter',
    model: body.model || clean.model,
    requested_model: clean.model,
    input_tokens: Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null,
    output_tokens: Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null,
    latency_ms: latencyMs,
    caller_user_id: user.id,
    source: operation,
    cost_source: cost === null ? 'unavailable' : 'provider_reported',
    ...extraMeta,
  };
  const amount = cost === null ? 0 : Number(cost.toFixed(6));
  let remainingAfter = credits.remaining;
  const { data: left, error: creditError } = await admin.rpc('consume_credits', {
    p_user: billing.billingUserId,
    p_workspace: billing.workspace?.id || null,
    p_project: billing.project?.id || null,
    p_operation: operation,
    p_amount: amount,
    p_request_id: requestId,
    p_metadata: metadata,
  });
  if (creditError) {
    if (/INSUFFICIENT_CREDITS/.test(creditError.message || '')) {
      // The provider already did the work: record the overdraft rather than dropping it.
      await admin.rpc('adjust_credits', { p_user: billing.billingUserId, p_delta_included: 0, p_delta_used: amount, p_kind: 'consume', p_reason: `${operation} overdraft`, p_actor: user.id, p_metadata: { ...metadata, request_id: requestId, overdraft: true } });
      await admin.from('usage_events').insert({ workspace_id: billing.workspace?.id || null, project_id: billing.project?.id || null, user_id: billing.billingUserId, operation, credits_usd: amount, request_id: requestId, provider: 'openrouter', model: metadata.model, metadata: { ...metadata, overdraft: true } });
      remainingAfter = 0;
    } else {
      throw creditError;
    }
  } else if (left !== null && left !== undefined) {
    remainingAfter = Math.max(0, Number(left));
  }

  return {
    id: body.id || null,
    object: body.object || 'chat.completion',
    created: body.created || Math.floor(Date.now() / 1000),
    model: body.model || clean.model,
    choices: Array.isArray(body.choices) ? body.choices : [],
    usage: {
      prompt_tokens: usage.prompt_tokens ?? null,
      completion_tokens: usage.completion_tokens ?? null,
      total_tokens: usage.total_tokens ?? null,
      prompt_tokens_details: usage.prompt_tokens_details || undefined,
      completion_tokens_details: usage.completion_tokens_details || undefined,
      cost: cost ?? undefined,
    },
    system_fingerprint: body.system_fingerprint || undefined,
    zevqora: { cost_usd: cost, cost_source: cost === null ? 'unavailable' : 'provider_reported', credits_remaining_usd: remainingAfter, plan: billing.planId, workspace_id: billing.workspace?.id || null, project_id: billing.project?.id || null, billing_user_id: billing.billingUserId, latency_ms: latencyMs, attempt, request_id: requestId },
  };
}

/** Flattened helper for engine code: text + accounting fields. */
export async function completeText(args) {
  const res = await completeForUser(args);
  const choice = res.choices?.[0];
  const content = typeof choice?.message?.content === 'string' ? choice.message.content : null;
  return {
    content,
    toolCalls: Array.isArray(choice?.message?.tool_calls) ? choice.message.tool_calls : [],
    finishReason: choice?.finish_reason || null,
    model: res.model,
    requestId: res.id,
    latencyMs: res.zevqora.latency_ms,
    inputTokens: res.usage.prompt_tokens,
    outputTokens: res.usage.completion_tokens,
    cachedInputTokens: Number(res.usage?.prompt_tokens_details?.cached_tokens || 0),
    cost: res.zevqora.cost_usd,
    creditsRemaining: res.zevqora.credits_remaining_usd,
  };
}
