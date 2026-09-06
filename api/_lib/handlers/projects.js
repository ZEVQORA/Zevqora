import { on } from '../router.js';
import { ApiError, readJson, str, num, uuid, slugify } from '../http.js';
import { requireUser, requireWorkspaceRole, requireProjectAccess, roleRank, rateLimit } from '../auth.js';
import { generateConnectionToken } from '../tokens.js';
import { workspacePlan } from './workspaces.js';

const SOURCE_KINDS = ['runtime', 'server', 'repository', 'github', 'manual'];

on('POST', '/api/workspaces/:id/projects', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const workspaceId = uuid(params.id, 'workspace');
  await requireWorkspaceRole(admin, workspaceId, user.id, 'member');
  const body = await readJson(request);
  const name = str(body?.name, { name: 'Project name', required: true, min: 2, max: 80 });
  const description = str(body?.description, { name: 'Description', max: 400 });
  const sourceKind = SOURCE_KINDS.includes(body?.source_kind) ? body.source_kind : 'runtime';
  const repoUrl = str(body?.repo_url, { name: 'Repository URL', max: 300 });
  if (repoUrl && !/^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[\w.-]+\/[\w.-]+/.test(repoUrl)) throw new ApiError(400, 'Repository URL must be an https GitHub, GitLab or Bitbucket URL.', 'VALIDATION');

  const { plan } = await workspacePlan(admin, workspaceId);
  const limit = plan.limits?.projects;
  const { count } = await admin.from('projects').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).is('archived_at', null);
  if (limit !== null && limit !== undefined && (count || 0) >= limit) {
    throw new ApiError(402, `The ${plan.name} plan includes ${limit} project${limit === 1 ? '' : 's'}. Upgrade to add more.`, 'PLAN_LIMIT', { limit: 'projects', plan: plan.id });
  }
  let slug = slugify(name, 'project');
  const { data: clash } = await admin.from('projects').select('id').eq('workspace_id', workspaceId).eq('slug', slug).limit(1);
  if (clash?.length) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  const { data: project, error } = await admin
    .from('projects')
    .insert({ workspace_id: workspaceId, name, slug, description, source_kind: sourceKind, repo_url: repoUrl || null, created_by: user.id })
    .select('*')
    .single();
  if (error) throw error;
  return { project };
});

on('PATCH', '/api/projects/:id', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const projectId = uuid(params.id, 'project');
  const { project } = await requireProjectAccess(admin, projectId, user.id, 'member');
  const body = await readJson(request);
  const update = {};
  if (body.name !== undefined) update.name = str(body.name, { name: 'Project name', required: true, min: 2, max: 80 });
  if (body.description !== undefined) update.description = str(body.description, { name: 'Description', max: 400 });
  if (body.repo_url !== undefined) {
    const repoUrl = str(body.repo_url, { name: 'Repository URL', max: 300 });
    if (repoUrl && !/^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[\w.-]+\/[\w.-]+/.test(repoUrl)) throw new ApiError(400, 'Repository URL must be an https GitHub, GitLab or Bitbucket URL.', 'VALIDATION');
    update.repo_url = repoUrl || null;
  }
  if (body.settings !== undefined) {
    const s = body.settings && typeof body.settings === 'object' ? body.settings : {};
    const clean = { ...(project.settings || {}) };
    if (s.quality_gate !== undefined) clean.quality_gate = num(s.quality_gate, { name: 'Quality gate', min: 0.5, max: 1, required: true });
    if (s.max_latency_regression_pct !== undefined) clean.max_latency_regression_pct = num(s.max_latency_regression_pct, { name: 'Latency regression', min: 0, max: 500, required: true });
    update.settings = clean;
  }
  if (body.archived !== undefined) {
    if (roleRank(await requireWorkspaceRole(admin, project.workspace_id, user.id, 'admin')) < 3) throw new ApiError(403, 'Admin role required.', 'FORBIDDEN');
    update.archived_at = body.archived ? new Date().toISOString() : null;
  }
  if (!Object.keys(update).length) throw new ApiError(400, 'Nothing to update.', 'VALIDATION');
  const { data, error } = await admin.from('projects').update(update).eq('id', projectId).select('*').single();
  if (error) throw error;
  return { project: data };
});

/** Archive, never destroy: evidence attached to a project must survive. */
on('DELETE', '/api/projects/:id', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const projectId = uuid(params.id, 'project');
  const { project } = await requireProjectAccess(admin, projectId, user.id, 'admin');
  await admin.from('projects').update({ archived_at: new Date().toISOString() }).eq('id', projectId);
  await admin.from('connections').update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_by: user.id }).eq('project_id', projectId).eq('status', 'active');
  await admin.from('connection_secrets').delete().in('connection_id', (await admin.from('connections').select('id').eq('project_id', projectId)).data?.map((c) => c.id) || []);
  return { ok: true, archived: true, project_id: project.id };
});

const CONNECTION_KINDS = ['server_telemetry', 'runtime_api', 'repository', 'github'];

on('POST', '/api/projects/:id/connections', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const projectId = uuid(params.id, 'project');
  const { project } = await requireProjectAccess(admin, projectId, user.id, 'member');
  rateLimit(`conn-create:${user.id}`, { limit: 10, windowMs: 60_000 });
  const body = await readJson(request);
  const kind = CONNECTION_KINDS.includes(body?.kind) ? body.kind : null;
  if (!kind) throw new ApiError(400, 'Connection kind is invalid.', 'VALIDATION');
  const name = str(body?.name, { name: 'Connection name', required: true, min: 2, max: 80 });
  const captureSamples = Boolean(body?.capture_samples);

  if (kind === 'github') throw new ApiError(409, 'The GitHub App connection is coming soon. Use a repository connection with the ZEVQORA desktop engine in the meantime.', 'COMING_SOON');

  const { data: flags } = await admin.from('feature_flags').select('key,enabled').eq('key', 'runtime_telemetry').maybeSingle();
  if ((kind === 'server_telemetry' || kind === 'runtime_api') && flags && !flags.enabled) throw new ApiError(503, 'Runtime telemetry is temporarily disabled.', 'FEATURE_DISABLED');

  const { count } = await admin.from('connections').select('id', { count: 'exact', head: true }).eq('project_id', projectId).eq('status', 'active');
  if ((count || 0) >= 10) throw new ApiError(409, 'A project can hold up to 10 active connections.', 'LIMIT_REACHED');

  if (kind === 'repository') {
    const { data: connection, error } = await admin
      .from('connections')
      .insert({ workspace_id: project.workspace_id, project_id: projectId, kind, name, status: 'pending', scopes: ['engine:publish'], created_by: user.id, metadata: { instructions: 'Open this project in ZEVQORA Desktop and connect the local repository. The desktop engine scans code locally; only findings and evidence are published here.' } })
      .select('*')
      .single();
    if (error) throw error;
    return { connection, token: null };
  }

  const { token, prefix, last4, hash } = generateConnectionToken();
  const { data: connection, error } = await admin
    .from('connections')
    .insert({
      workspace_id: project.workspace_id,
      project_id: projectId,
      kind,
      name,
      status: 'active',
      token_prefix: prefix,
      token_last4: last4,
      scopes: ['telemetry:write'],
      created_by: user.id,
      metadata: { capture_samples: captureSamples, sdk: 'http' },
    })
    .select('*')
    .single();
  if (error) throw error;
  const { error: secretError } = await admin.from('connection_secrets').insert({ connection_id: connection.id, token_hash: hash });
  if (secretError) throw secretError;
  // The token is returned exactly once. It is never stored or displayed again.
  return { connection, token };
});

on('PATCH', '/api/connections/:id', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const connectionId = uuid(params.id, 'connection');
  const { data: connection } = await admin.from('connections').select('*').eq('id', connectionId).maybeSingle();
  if (!connection) throw new ApiError(404, 'Connection not found.', 'NOT_FOUND');
  await requireWorkspaceRole(admin, connection.workspace_id, user.id, 'member');
  const body = await readJson(request);
  const update = {};
  if (body.name !== undefined) update.name = str(body.name, { name: 'Connection name', required: true, min: 2, max: 80 });
  if (body.capture_samples !== undefined) update.metadata = { ...(connection.metadata || {}), capture_samples: Boolean(body.capture_samples) };
  if (!Object.keys(update).length) throw new ApiError(400, 'Nothing to update.', 'VALIDATION');
  const { data, error } = await admin.from('connections').update(update).eq('id', connectionId).select('*').single();
  if (error) throw error;
  return { connection: data };
});

on('DELETE', '/api/connections/:id', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const connectionId = uuid(params.id, 'connection');
  const { data: connection } = await admin.from('connections').select('*').eq('id', connectionId).maybeSingle();
  if (!connection) throw new ApiError(404, 'Connection not found.', 'NOT_FOUND');
  const role = await requireWorkspaceRole(admin, connection.workspace_id, user.id, 'member');
  if (connection.created_by !== user.id && roleRank(role) < roleRank('admin')) throw new ApiError(403, 'Only the creator or a workspace admin can revoke this connection.', 'FORBIDDEN');
  await admin.from('connections').update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_by: user.id }).eq('id', connectionId);
  await admin.from('connection_secrets').delete().eq('connection_id', connectionId);
  return { ok: true };
});

on('POST', '/api/connections/:id/rotate', async ({ request, params }) => {
  const { user, admin } = await requireUser(request);
  const connectionId = uuid(params.id, 'connection');
  const { data: connection } = await admin.from('connections').select('*').eq('id', connectionId).maybeSingle();
  if (!connection) throw new ApiError(404, 'Connection not found.', 'NOT_FOUND');
  if (connection.status !== 'active' || !['server_telemetry', 'runtime_api'].includes(connection.kind)) throw new ApiError(409, 'Only active telemetry connections can be rotated.', 'INVALID_STATE');
  const role = await requireWorkspaceRole(admin, connection.workspace_id, user.id, 'member');
  if (connection.created_by !== user.id && roleRank(role) < roleRank('admin')) throw new ApiError(403, 'Only the creator or a workspace admin can rotate this token.', 'FORBIDDEN');
  const { token, prefix, last4, hash } = generateConnectionToken();
  const { error } = await admin.from('connection_secrets').upsert({ connection_id: connectionId, token_hash: hash, rotated_at: new Date().toISOString() }, { onConflict: 'connection_id' });
  if (error) throw error;
  const { data } = await admin.from('connections').update({ token_prefix: prefix, token_last4: last4 }).eq('id', connectionId).select('*').single();
  return { connection: data, token };
});

const WINDOWS = { '1h': 1, '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };

on('GET', '/api/projects/:id/runtime', async ({ request, params, query }) => {
  const { user, admin } = await requireUser(request);
  const projectId = uuid(params.id, 'project');
  const { project } = await requireProjectAccess(admin, projectId, user.id, 'viewer');
  const hours = WINDOWS[query.get('window')] || 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const [rollup, rate, daily, { data: connections }, { data: recent }, { count: opportunities }] = await Promise.all([
    admin.rpc('telemetry_rollup', { p_projects: [projectId], p_since: since }),
    admin.rpc('telemetry_recent_rate', { p_projects: [projectId], p_window: '5 minutes' }),
    admin.rpc('telemetry_daily', { p_projects: [projectId], p_since: since }),
    admin.from('connections').select('id,kind,name,status,token_prefix,token_last4,scopes,permissions,metadata,created_at,last_used_at,last_seen_at,revoked_at,created_by').eq('project_id', projectId).order('created_at', { ascending: false }),
    admin.from('telemetry_events').select('id,trace_id,span_id,occurred_at,provider,model,operation,status,input_tokens,output_tokens,cached_input_tokens,latency_ms,cost_usd,cost_source,attempt,error_class,has_sample').eq('project_id', projectId).order('occurred_at', { ascending: false }).limit(50),
    admin.from('opportunities').select('id', { count: 'exact', head: true }).eq('project_id', projectId).in('status', ['open', 'testing']),
  ]);
  const rows = rollup.data || [];
  const totals = rows.reduce(
    (acc, r) => {
      acc.requests += Number(r.requests);
      acc.errors += Number(r.errors);
      acc.cost_usd += Number(r.cost_usd);
      acc.input_tokens += Number(r.input_tokens);
      acc.output_tokens += Number(r.output_tokens);
      acc.samples += Number(r.samples);
      if (r.last_seen && (!acc.last_seen || r.last_seen > acc.last_seen)) acc.last_seen = r.last_seen;
      return acc;
    },
    { requests: 0, errors: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0, samples: 0, last_seen: null },
  );
  const weightedP50 = rows.reduce((acc, r) => acc + (r.latency_p50_ms !== null ? Number(r.latency_p50_ms) * Number(r.requests) : 0), 0) / (totals.requests || 1);
  const maxP95 = rows.reduce((acc, r) => Math.max(acc, Number(r.latency_p95_ms || 0)), 0);
  return {
    project: { id: project.id, name: project.name, slug: project.slug, settings: project.settings },
    window_hours: hours,
    totals: { ...totals, latency_p50_ms: totals.requests ? weightedP50 : null, latency_p95_ms: totals.requests ? maxP95 : null, requests_per_min_5m: Number(rate.data?.[0]?.requests || 0) / 5, errors_5m: Number(rate.data?.[0]?.errors || 0) },
    providers: rows.reduce((acc, r) => {
      const p = acc.find((x) => x.provider === r.provider) || (acc.push({ provider: r.provider, requests: 0, cost_usd: 0, errors: 0 }), acc[acc.length - 1]);
      p.requests += Number(r.requests);
      p.cost_usd += Number(r.cost_usd);
      p.errors += Number(r.errors);
      return acc;
    }, []),
    models: rows.map((r) => ({ model: r.model, provider: r.provider, requests: Number(r.requests), errors: Number(r.errors), cost_usd: Number(r.cost_usd), input_tokens: Number(r.input_tokens), output_tokens: Number(r.output_tokens), latency_p50_ms: r.latency_p50_ms !== null ? Number(r.latency_p50_ms) : null, latency_p95_ms: r.latency_p95_ms !== null ? Number(r.latency_p95_ms) : null, samples: Number(r.samples) })).sort((a, b) => b.cost_usd - a.cost_usd),
    daily: (daily.data || []).map((d) => ({ day: d.day, requests: Number(d.requests), errors: Number(d.errors), cost_usd: Number(d.cost_usd) })),
    connections: connections || [],
    recent: recent || [],
    open_opportunities: opportunities || 0,
  };
});
