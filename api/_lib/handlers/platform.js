/**
 * Platform compute for ZEVQORA Desktop.
 *
 * The desktop engine (local FastAPI) calls OpenRouter only through this proxy:
 *
 *   desktop → Bearer <Supabase access token> → /api/platform/chat/completions
 *           → authorization → plan + credit check → rate limit → OpenRouter
 *
 * The provider credential lives only in OPENROUTER_API_KEY on the server. It is
 * never returned, logged or embedded in the desktop binary. Every completion is
 * accounted against the billing owner's credit with the provider-reported cost,
 * idempotently keyed on the provider request id.
 */
import { randomUUID } from 'node:crypto';
import { on } from '../router.js';
import { ApiError, readJson, uuid } from '../http.js';
import { adminClient, accountStateForUser, loadPlan } from '../supabase.js';
import { requireUser, requireWorkspaceRole, requireProjectAccess, rateLimit } from '../auth.js';
import { forwardChatCompletion, openRouterConfigured } from '../openrouter.js';
import { loadPricing, normalizeModel, estimateCost } from '../pricing.js';
import { validateCompletionRequest, rpmForPlan } from '../platform-guard.js';

const WORKSPACE_HEADER = 'x-zevqora-workspace';
const PROJECT_HEADER = 'x-zevqora-project';

function headerUuid(request, name, label) {
  const raw = request.headers.get(name);
  if (!raw) return null;
  return uuid(raw.trim(), label);
}

/**
 * Resolves who is billed and under which plan. A workspace header bills the
 * workspace owner under the workspace's effective plan; without one the caller
 * is billed under their own account plan.
 */
async function resolveBilling(request, user, admin) {
  const workspaceId = headerUuid(request, WORKSPACE_HEADER, 'workspace');
  const projectId = headerUuid(request, PROJECT_HEADER, 'project');
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
      // A project implies its workspace; bill the workspace owner accordingly.
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

async function creditState(admin, billingUserId, plan) {
  const { data: credit } = await admin.from('credit_balances').select('included_usd,used_usd,period_end').eq('user_id', billingUserId).maybeSingle();
  const included = Number(credit?.included_usd ?? plan?.limits?.credits_usd ?? 5);
  const used = Number(credit?.used_usd ?? 0);
  return { included, used, remaining: Math.max(0, included - used), periodEnd: credit?.period_end || null };
}

async function cloudComputeEnabled(admin) {
  const { data: flag } = await admin.from('feature_flags').select('enabled').eq('key', 'cloud_replay').maybeSingle();
  return flag ? Boolean(flag.enabled) : true;
}

on('GET', '/api/platform/status', async ({ request }) => {
  const { user, admin } = await requireUser(request);
  const billing = await resolveBilling(request, user, admin);
  const [credits, enabled] = await Promise.all([creditState(admin, billing.billingUserId, billing.plan), cloudComputeEnabled(admin)]);
  return {
    configured: openRouterConfigured() && enabled,
    provider: 'openrouter',
    plan: { id: billing.planId, name: billing.plan?.name || billing.planId, limits: billing.plan?.limits || {} },
    credits: { included_usd: credits.included, used_usd: credits.used, remaining_usd: credits.remaining, period_end: credits.periodEnd },
    rate_limit_per_minute: rpmForPlan(billing.planId, billing.plan?.limits),
    workspace: billing.workspace,
    project: billing.project,
    billing_user_id: billing.billingUserId,
    is_billing_owner: billing.billingUserId === user.id,
    user: { id: user.id, email: user.email || null },
    time: new Date().toISOString(),
  };
});

/** Public list prices so the desktop engine can budget replays before it spends. */
on('GET', '/api/platform/pricing', async ({ request }) => {
  await requireUser(request);
  const admin = adminClient();
  const rows = await loadPricing(admin);
  const models = {};
  let newest = null;
  for (const row of rows.values()) {
    models[row.model] = {
      provider: row.provider,
      tier: row.tier,
      input_per_million: Number(row.input_per_million),
      output_per_million: Number(row.output_per_million),
      cached_input_per_million: row.cached_input_per_million === null || row.cached_input_per_million === undefined ? null : Number(row.cached_input_per_million),
    };
    if (row.retrieved_at && (!newest || row.retrieved_at > newest)) newest = row.retrieved_at;
  }
  return { version: `model_pricing@${newest ? String(newest).slice(0, 10) : 'snapshot'}`, retrieved_at: newest, source: 'zevqora_platform_model_pricing', models };
});

on('POST', '/api/platform/chat/completions', async ({ request }) => {
  const { user, admin } = await requireUser(request);
  const billing = await resolveBilling(request, user, admin);
  rateLimit(`platform:${user.id}`, { limit: rpmForPlan(billing.planId, billing.plan?.limits), windowMs: 60_000 });

  if (!(await cloudComputeEnabled(admin))) throw new ApiError(503, 'Platform compute is temporarily disabled.', 'FEATURE_DISABLED');
  if (!openRouterConfigured()) throw new ApiError(503, 'Platform compute is not configured on this deployment yet. Add a local OpenRouter key in Desktop settings to run replays now.', 'PROVIDER_NOT_CONFIGURED');

  const { payload, totalChars } = validateCompletionRequest(await readJson(request, { maxBytes: 2_000_000 }));

  const credits = await creditState(admin, billing.billingUserId, billing.plan);
  if (credits.remaining <= 0) {
    throw new ApiError(402, 'Zev credit for this billing period is used up. Upgrade the plan or wait for the reset.', 'INSUFFICIENT_CREDITS', {
      remaining_usd: credits.remaining,
      included_usd: credits.included,
      plan: billing.planId,
      billing_owner: billing.billingUserId === user.id ? 'you' : 'workspace owner',
    });
  }
  const pricing = await loadPricing(admin);
  const key = normalizeModel(null, payload.model).key;
  const estimate = estimateCost(pricing, key, { input: Math.ceil(totalChars / 4), output: payload.max_tokens });
  if (estimate && estimate.cost > credits.remaining) {
    throw new ApiError(402, 'This request could exceed the remaining Zev credit.', 'INSUFFICIENT_CREDITS', {
      estimated_usd: estimate.cost,
      remaining_usd: credits.remaining,
      plan: billing.planId,
    });
  }

  const { body, latencyMs, attempt } = await forwardChatCompletion(payload, { timeoutMs: 90_000 });
  const usage = body.usage || {};
  const cost = Number.isFinite(usage.cost) ? Number(usage.cost) : null;
  const requestId = `platform:${body.id || randomUUID()}`;
  const metadata = {
    provider: 'openrouter',
    model: body.model || payload.model,
    requested_model: payload.model,
    input_tokens: Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null,
    output_tokens: Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null,
    latency_ms: latencyMs,
    caller_user_id: user.id,
    source: 'desktop_platform_proxy',
    cost_source: cost === null ? 'unavailable' : 'provider_reported',
  };

  let remainingAfter = credits.remaining;
  const amount = cost === null ? 0 : Number(cost.toFixed(6));
  const { data: left, error: creditError } = await admin.rpc('consume_credits', {
    p_user: billing.billingUserId,
    p_workspace: billing.workspace?.id || null,
    p_project: billing.project?.id || null,
    p_operation: 'platform_completion',
    p_amount: amount,
    p_request_id: requestId,
    p_metadata: metadata,
  });
  if (creditError) {
    if (/INSUFFICIENT_CREDITS/.test(creditError.message || '')) {
      // The provider already did the work; record the overdraft honestly
      // rather than dropping the usage. Later requests are refused by the
      // pre-check above.
      await admin.rpc('adjust_credits', {
        p_user: billing.billingUserId,
        p_delta_included: 0,
        p_delta_used: amount,
        p_kind: 'consume',
        p_reason: 'platform_completion overdraft',
        p_actor: user.id,
        p_metadata: { ...metadata, request_id: requestId, overdraft: true },
      });
      await admin.from('usage_events').insert({
        workspace_id: billing.workspace?.id || null,
        project_id: billing.project?.id || null,
        user_id: billing.billingUserId,
        operation: 'platform_completion',
        credits_usd: amount,
        request_id: requestId,
        provider: 'openrouter',
        model: metadata.model,
        metadata: { ...metadata, overdraft: true },
      });
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
    model: body.model || payload.model,
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
    zevqora: {
      cost_usd: cost,
      cost_source: cost === null ? 'unavailable' : 'provider_reported',
      credits_remaining_usd: remainingAfter,
      plan: billing.planId,
      workspace_id: billing.workspace?.id || null,
      project_id: billing.project?.id || null,
      billing_user_id: billing.billingUserId,
      latency_ms: latencyMs,
      attempt,
      request_id: requestId,
    },
  };
});
