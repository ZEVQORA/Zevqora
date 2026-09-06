import { on } from '../router.js';
import { ApiError, readJson, uuid } from '../http.js';
import { requireUser, requireProjectAccess, rateLimit } from '../auth.js';
import { loadPricing } from '../pricing.js';
import { analyzeEvents } from '../engine/analysis.js';
import { workspacePlan } from './workspaces.js';

const MAX_EVENTS = 5000;
const COOLDOWN_MS = 45_000;
const PRESERVED_STATUSES = new Set(['testing', 'verified', 'rejected', 'dismissed']);

on('POST', '/api/projects/:id/analyze', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const projectId = uuid(params.id, 'project');
  const { project } = await requireProjectAccess(admin, projectId, user.id, 'member');
  rateLimit(`analyze:${user.id}`, { limit: 10, windowMs: 60_000 });

  const { data: last } = await admin.from('analysis_runs').select('created_at,status').eq('project_id', projectId).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (last && Date.now() - new Date(last.created_at).getTime() < COOLDOWN_MS) throw new ApiError(429, 'An analysis just ran for this project. Wait a moment before running again.', 'COOLDOWN');

  const { plan } = await workspacePlan(admin, project.workspace_id);
  const retention = Number(plan.limits?.telemetry_retention_days) || 30;
  const windowDays = Math.min(30, retention);
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: run, error: runError } = await admin
    .from('analysis_runs')
    .insert({ workspace_id: project.workspace_id, project_id: projectId, status: 'running', trigger: 'manual', window_start: since, window_end: new Date().toISOString(), created_by: user.id })
    .select('*')
    .single();
  if (runError) throw runError;

  try {
    const { data: events, error } = await admin
      .from('telemetry_events')
      .select('id,occurred_at,provider,model,operation,status,input_tokens,output_tokens,cached_input_tokens,latency_ms,cost_usd,cost_source,prompt_hash,output_hash,attempt,error_class,has_sample')
      .eq('project_id', projectId)
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .limit(MAX_EVENTS);
    if (error) throw error;
    const pricing = await loadPricing(admin);
    const normalized = (events || []).map((e) => ({
      ...e,
      provider_key: e.provider,
      model_key: e.model,
      cost_usd: e.cost_usd === null ? null : Number(e.cost_usd),
      latency_ms: e.latency_ms === null ? null : Number(e.latency_ms),
    }));
    const result = analyzeEvents(normalized, pricing, { windowDays, retentionNote: `Window bounded to ${windowDays} days by the ${plan.name} plan retention.` });

    const { data: existing } = await admin.from('opportunities').select('id,fingerprint,status').eq('project_id', projectId);
    const existingByFp = new Map((existing || []).map((o) => [o.fingerprint, o]));
    const upserts = result.opportunities.map((o) => {
      const prev = existingByFp.get(o.fingerprint);
      return {
        ...(prev ? { id: prev.id } : {}),
        workspace_id: project.workspace_id,
        project_id: projectId,
        analysis_run_id: run.id,
        origin: 'runtime_telemetry',
        ...o,
        status: prev && PRESERVED_STATUSES.has(prev.status) ? prev.status : o.candidate_strategy === 'context_reduction' || o.candidate_strategy === 'retry_policy' ? 'open' : 'open',
      };
    });
    let saved = [];
    if (upserts.length) {
      const { data, error: upsertError } = await admin.from('opportunities').upsert(upserts, { onConflict: 'project_id,fingerprint' }).select('*');
      if (upsertError) throw upsertError;
      saved = data || [];
    }
    // Opportunities that no longer reproduce are closed, never deleted.
    const currentFps = new Set(result.opportunities.map((o) => o.fingerprint));
    const stale = (existing || []).filter((o) => o.status === 'open' && !currentFps.has(o.fingerprint));
    if (stale.length) await admin.from('opportunities').update({ status: 'dismissed', evidence: { note: 'Not reproduced by the latest analysis.' } }).in('id', stale.map((o) => o.id));

    const { data: completed } = await admin
      .from('analysis_runs')
      .update({ status: 'completed', events_analyzed: normalized.length, opportunities_found: result.opportunities.length, summary: result.summary, completed_at: new Date().toISOString() })
      .eq('id', run.id)
      .select('*')
      .single();
    return { run: completed, opportunities: saved, summary: result.summary, events_analyzed: normalized.length };
  } catch (error) {
    await admin.from('analysis_runs').update({ status: 'failed', error: String(error?.message || error).slice(0, 300), completed_at: new Date().toISOString() }).eq('id', run.id);
    throw error;
  }
});

on('PATCH', '/api/opportunities/:id', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const opportunityId = uuid(params.id, 'opportunity');
  const { data: opp } = await admin.from('opportunities').select('id,project_id,status').eq('id', opportunityId).maybeSingle();
  if (!opp) throw new ApiError(404, 'Opportunity not found.', 'NOT_FOUND');
  await requireProjectAccess(admin, opp.project_id, user.id, 'member');
  const body = await readJson(request);
  const status = body?.status === 'dismissed' ? 'dismissed' : body?.status === 'open' ? 'open' : null;
  if (!status) throw new ApiError(400, 'Status must be open or dismissed.', 'VALIDATION');
  if (['testing', 'verified', 'rejected'].includes(opp.status) && status === 'dismissed') throw new ApiError(409, 'Opportunities with experiment evidence cannot be dismissed.', 'INVALID_STATE');
  const { data, error } = await admin.from('opportunities').update({ status }).eq('id', opportunityId).select('*').single();
  if (error) throw error;
  return { opportunity: data };
});
