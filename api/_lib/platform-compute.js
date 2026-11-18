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
import { loadPricing, estimateCost } from './pricing.js';
import { validateCompletionRequest, rpmForPlan } from './platform-guard.js';

export const DEFAULT_PLATFORM_MODEL = 'openai/gpt-4o-mini';

/**
 * Model ids the desktop engine has always sent that are priced under another
 * id in model_pricing (same model on OpenRouter). Used for budgeting only; the
 * request is forwarded with the id the caller sent.
 */
const PRICE_ALIASES = {
  'deepseek/deepseek-chat': 'deepseek/deepseek-chat-v3',
  'mistralai/mistral-small': 'mistralai/mistral-small-3.1',
};

/**
 * The model_pricing key a forwarded model is budgeted at, or null when it has
 * no price on record (SEC-04). Exact ids only: no prefix or family matching,
 * so a pricier variant cannot borrow a cheaper sibling's price.
 */
export function pricedModelKey(pricing, model) {
  const id = String(model || '').trim().toLowerCase();
  const key = pricing.has(id) ? id : PRICE_ALIASES[id] && pricing.has(PRICE_ALIASES[id]) ? PRICE_ALIASES[id] : null;
  if (!key || pricing.get(key)?.tier === 'embedding') return null;
  return key;
}

const HOLD_WINDOW_SECONDS = 900;
const holdBucket = (billingUserId) => `credit:hold:${billingUserId}`;
const micro = (usd) => Math.max(0, Math.ceil(Number(usd) * 1e6));

/**
 * Reserves `amountUsd` against what is left of the billing owner's credit in
 * the durable counter (migration 022). true = held, false = other in-flight
 * calls already hold the balance, null = the counter could not answer.
 */
export async function holdCredit(admin, billingUserId, amountUsd, remainingUsd) {
  try {
    const { data, error } = await admin.rpc('usage_budget_reserve', { p_bucket: holdBucket(billingUserId), p_amount_micro_usd: Math.max(1, micro(amountUsd)), p_limit_micro_usd: micro(remainingUsd), p_window_seconds: HOLD_WINDOW_SECONDS });
    return error || typeof data !== 'boolean' ? null : data;
  } catch {
    return null;
  }
}

/** Releases a hold. A failed release only keeps the hold until the window ends (conservative). */
export async function releaseCredit(admin, billingUserId, amountUsd) {
  try {
    await admin.rpc('usage_budget_reserve', { p_bucket: holdBucket(billingUserId), p_amount_micro_usd: -Math.max(1, micro(amountUsd)), p_limit_micro_usd: 0, p_window_seconds: HOLD_WINDOW_SECONDS });
  } catch {
    // best effort
  }
}

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
  // SEC-04: `openrouter/auto` may route to any model at any price, so it runs on the default model instead.
  if (clean.model.toLowerCase() === 'openrouter/auto') clean.model = DEFAULT_PLATFORM_MODEL;
  const credits = await creditState(admin, billing.billingUserId, billing.plan);
  if (credits.remaining <= 0) {
    throw new ApiError(402, 'Zev credit for this billing period is used up. Upgrade the plan or wait for the reset.', 'INSUFFICIENT_CREDITS', { remaining_usd: credits.remaining, included_usd: credits.included, plan: billing.planId, billing_owner: billing.billingUserId === user.id ? 'you' : 'workspace owner' });
  }
  const pricing = await loadPricing(admin);
  // SEC-04: only models with a price on record can be budgeted, so only those are forwarded.
  const priceKey = pricedModelKey(pricing, clean.model);
  if (!priceKey) throw new ApiError(400, `The model ${clean.model} is not available through platform compute. Choose a model listed in /api/platform/pricing.`, 'MODEL_NOT_ALLOWED', { model: clean.model });
  const estimate = estimateCost(pricing, priceKey, { input: Math.ceil(totalChars / 4), output: clean.max_tokens });
  if (estimate.cost > credits.remaining) {
    throw new ApiError(402, 'This request could exceed the remaining Zev credit.', 'INSUFFICIENT_CREDITS', { estimated_usd: estimate.cost, remaining_usd: credits.remaining, plan: billing.planId });
  }

  // SEC-04: hold the worst case while the call is in flight, so concurrent calls cannot all pass the same balance check.
  const hold = await holdCredit(admin, billing.billingUserId, estimate.cost, credits.remaining);
  if (hold === null) throw new ApiError(503, 'Credit checks are unavailable right now, so no request was sent to the provider.', 'BUDGET_UNAVAILABLE');
  if (hold === false) throw new ApiError(402, 'Other requests in flight already hold the remaining Zev credit. Retry when they finish.', 'INSUFFICIENT_CREDITS', { estimated_usd: estimate.cost, remaining_usd: credits.remaining, plan: billing.planId });

  let forwarded;
  try {
    forwarded = await forwardChatCompletion(clean, { timeoutMs });
  } finally {
    await releaseCredit(admin, billing.billingUserId, estimate.cost);
  }
  const { body, latencyMs, attempt } = forwarded;
  const usage = body.usage || {};
  const reported = Number.isFinite(usage.cost) ? Number(usage.cost) : null;
  // SEC-04: a response without a provider cost is charged at the list-price estimate of its actual usage, never at zero.
  const estimatedCost = reported === null ? estimateCost(pricing, priceKey, { input: Number(usage.prompt_tokens) || Math.ceil(totalChars / 4), output: Number(usage.completion_tokens) || clean.max_tokens }).cost : null;
  const cost = reported ?? estimatedCost;
  const costSource = reported !== null ? 'provider_reported' : 'pricing_snapshot_estimate';
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
    cost_source: costSource,
    ...extraMeta,
  };
  const amount = Number(cost.toFixed(6));
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
    zevqora: { cost_usd: cost, cost_source: costSource, credits_remaining_usd: remainingAfter, plan: billing.planId, workspace_id: billing.workspace?.id || null, project_id: billing.project?.id || null, billing_user_id: billing.billingUserId, latency_ms: latencyMs, attempt, request_id: requestId },
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
