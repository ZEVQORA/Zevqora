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
import { on } from '../router.js';
import { readJson, uuid } from '../http.js';
import { adminClient } from '../supabase.js';
import { requireUser } from '../auth.js';
import { openRouterConfigured } from '../openrouter.js';
import { loadPricing } from '../pricing.js';
import { rpmForPlan } from '../platform-guard.js';
import { resolveBilling, creditState, cloudComputeEnabled, completeForUser } from '../platform-compute.js';

const WORKSPACE_HEADER = 'x-zevqora-workspace';
const PROJECT_HEADER = 'x-zevqora-project';

function headerUuid(request, name, label) {
  const raw = request.headers.get(name);
  if (!raw) return null;
  return uuid(raw.trim(), label);
}

on('GET', '/api/platform/status', async ({ request }) => {
  const { user, admin } = await requireUser(request);
  const billing = await resolveBilling({ admin, user, workspaceId: headerUuid(request, WORKSPACE_HEADER, 'workspace'), projectId: headerUuid(request, PROJECT_HEADER, 'project') });
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
  const payload = await readJson(request, { maxBytes: 2_000_000 });
  return completeForUser({ admin, user, workspaceId: headerUuid(request, WORKSPACE_HEADER, 'workspace'), projectId: headerUuid(request, PROJECT_HEADER, 'project'), payload, operation: 'platform_completion', extraMeta: { source: 'desktop_platform_proxy' } });
});
