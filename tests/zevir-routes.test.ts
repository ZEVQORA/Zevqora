/**
 * ZevIR routes end to end: the real router and handlers over the real
 * migration (PGlite), with only the JWT check mocked. Covers the feature
 * flag, membership checks, idempotent builds and ingests, the trace-import
 * shadow hook, cross-workspace denial and the neighborhood limits.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApiError } from '../api/_lib/http.js';
import { createDb, restClient, seedWorkspace } from './helpers/pg';

const USER_A = 'a0000000-0000-4000-8000-00000000000a';
const USER_B = 'b0000000-0000-4000-8000-00000000000b';
const VIEWER = 'c0000000-0000-4000-8000-00000000000c';
const WS_A = 'a1111111-1111-4111-8111-111111111111';
const WS_B = 'b2222222-2222-4222-8222-222222222222';
const PRODUCT_A = 'a3333333-3333-4333-8333-333333333333';

const RANK: Record<string, number> = { viewer: 1, member: 2, admin: 3, owner: 4 };
const state: { db: PGlite | null; rest: ReturnType<typeof restClient> | null; user: string } = { db: null, rest: null, user: USER_A };

vi.mock('../api/_lib/auth.js', () => ({
  requireUser: async () => ({ user: { id: state.user, email: null }, admin: state.rest }),
  requireWorkspaceRole: async (_admin: unknown, ws: string, uid: string, min = 'viewer') => {
    const r = await state.db!.query<{ role: string }>('select role::text from public.workspace_members where workspace_id = $1 and user_id = $2', [ws, uid]);
    const role = r.rows[0]?.role;
    if (!role) throw new ApiError(404, 'Workspace not found.', 'NOT_FOUND');
    if (RANK[role] < RANK[min]) throw new ApiError(403, `This action requires the ${min} role.`, 'FORBIDDEN');
    return role;
  },
  rateLimit: () => undefined,
  rateLimitRequest: () => undefined,
  roleRank: (r: string) => RANK[r] || 0,
}));

let dispatch: (req: Request) => Promise<Response>;
const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'zevir', name), 'utf8'));

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await dispatch(new Request(`https://x.test${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
}
const as = (user: string) => {
  state.user = user;
};
const count = async (sql: string, params: unknown[] = []) => (await state.db!.query<{ n: number }>(sql, params)).rows[0].n;

async function insertTrace(requestId: string, over: Record<string, unknown> = {}) {
  await state.db!.query(
    `insert into public.engine_traces(product_id, workspace_id, request_id, "timestamp", symbol, workflow, provider, model, input_text, output_text, input_hash, output_hash, input_tokens, output_tokens, latency_ms, cost_usd, cost_source)
     values ($1, $2, $3, $4, 'classify', 'support', 'openai', 'gpt-4o', 'RAW-IN', 'RAW-OUT', $5, $6, 10, 2, 120, $7, $8)`,
    [PRODUCT_A, WS_A, requestId, '2026-09-01T10:00:00Z', 'a'.repeat(64), 'b'.repeat(64), over.cost_usd ?? null, over.cost_usd === undefined || over.cost_usd === null ? null : 'provider_reported'],
  );
}

/** An OTLP trace whose root calls `n` children: a neighborhood of n+2 nodes around the Task. */
function wideTrace(n: number) {
  const trace = 'f'.repeat(31) + '1';
  const spans = [{ traceId: trace, spanId: 'e'.repeat(16), name: 'root', startTimeUnixNano: '1759831200000000000', endTimeUnixNano: '1759831201000000000', attributes: [] as unknown[] }];
  for (let i = 0; i < n; i += 1) spans.push({ traceId: trace, spanId: (i + 1).toString(16).padStart(16, '0'), parentSpanId: 'e'.repeat(16), name: `step ${i}`, startTimeUnixNano: String(1759831200000000000n + BigInt(i)), endTimeUnixNano: '1759831200900000000', attributes: [] } as never);
  return { resourceSpans: [{ resource: { attributes: [] }, scopeSpans: [{ scope: { name: 't' }, spans }] }] };
}

beforeAll(async () => {
  state.db = await createDb();
  state.rest = restClient(state.db);
  await seedWorkspace(state.db, { userId: USER_A, workspaceId: WS_A, slug: 'alpha' });
  await seedWorkspace(state.db, { userId: USER_B, workspaceId: WS_B, slug: 'bravo' });
  await state.db.query('insert into auth.users(id) values ($1)', [VIEWER]);
  await state.db.query(`insert into public.workspace_members(workspace_id, user_id, role) values ($1, $2, 'viewer')`, [WS_A, VIEWER]);
  await state.db.query(`insert into public.engine_products(id, workspace_id, name, root_path) values ($1, $2, 'support', 'workload://support')`, [PRODUCT_A, WS_A]);
  for (const r of ['r1', 'r2', 'r3']) await insertTrace(r, { cost_usd: r === 'r1' ? 0.002 : null });
  ({ dispatch } = await import('../api/_lib/router.js'));
  await import('../api/_lib/handlers/engine.js');
  await import('../api/_lib/handlers/zevir.js');
}, 120_000);

const envelope = (payload: unknown, over: Record<string, unknown> = {}) => ({ schema_version: 'zevir.v0.1', workspace_id: WS_A, product_id: PRODUCT_A, source_kind: 'otel_genai', payload, ...over });

describe('shadow-mode flag', () => {
  it('is off by default: build and ingest refuse, reads still answer', async () => {
    as(USER_A);
    expect((await call('POST', `/api/engine/products/${PRODUCT_A}/zevir/build`)).body.code).toBe('ZEVIR_DISABLED');
    expect((await call('POST', '/api/zevir/ingest', envelope(fixture('otel-genai.json')))).body.code).toBe('ZEVIR_DISABLED');
    const read = await call('GET', `/api/engine/products/${PRODUCT_A}/zevir`);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ enabled: false, graphs: [], latest_run: null });
    expect(await count('select count(*)::int n from public.zevir_graphs')).toBe(0);
  });

  it('can be enabled for one workspace through workspace_overrides', async () => {
    await state.db!.query(`update public.feature_flags set workspace_overrides = $1 where key = 'zevir_shadow'`, [JSON.stringify({ [WS_A]: true })]);
    expect((await call('GET', `/api/engine/products/${PRODUCT_A}/zevir`)).body.enabled).toBe(true);
  });
});

describe('engine projection', () => {
  it('builds one graph per engine trace, without raw content', async () => {
    as(USER_A);
    const res = await call('POST', `/api/engine/products/${PRODUCT_A}/zevir/build`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reused: false, shadow: true, run: { status: 'succeeded', source_kind: 'zevqora_engine', received_count: 3, accepted_count: 3, schema_version: 'zevir.v0.1', adapter_version: 'zevir-engine/0.1.0', result: { counts: { created: 3, replaced: 0, unchanged: 0, conflict: 0 }, pruned: 0 } } });
    expect(await count('select count(*)::int n from public.zevir_graphs where product_id = $1', [PRODUCT_A])).toBe(3);
    const dump = await state.db!.query(`select (select json_agg(n) from public.zevir_nodes n)::text a, (select json_agg(e) from public.zevir_evidence_refs e)::text b`);
    expect(JSON.stringify(dump.rows)).not.toMatch(/RAW-/);
  });

  it('is idempotent: rebuilding the same evidence reuses the run and writes nothing', async () => {
    const before = await count('select count(*)::int n from public.zevir_nodes');
    const first = await call('POST', `/api/engine/products/${PRODUCT_A}/zevir/build`);
    expect(first.body.reused).toBe(true);
    expect(await count('select count(*)::int n from public.zevir_nodes')).toBe(before);
    expect(await count('select count(*)::int n from public.zevir_ingest_runs')).toBe(1);
  });

  it('adds new traces and prunes deleted ones on the next build', async () => {
    await insertTrace('r4');
    await state.db!.query(`delete from public.engine_traces where request_id = 'r3'`);
    const res = await call('POST', `/api/engine/products/${PRODUCT_A}/zevir/build`);
    expect(res.body.run.result).toMatchObject({ counts: { created: 1, unchanged: 2 }, pruned: 1 });
    const keys = (await state.db!.query<{ source_trace_id: string }>('select source_trace_id from public.zevir_graphs where product_id = $1 order by 1', [PRODUCT_A])).rows.map((r) => r.source_trace_id);
    expect(keys).toEqual(['r1', 'r2', 'r4']);
  });

  it('keeps known and unknown cost apart in graph summaries', async () => {
    const res = await call('GET', `/api/engine/products/${PRODUCT_A}/zevir`);
    const costs = Object.fromEntries(res.body.graphs.map((g: { source_trace_id: string; summary: { cost: unknown } }) => [g.source_trace_id, g.summary.cost]));
    expect(costs.r1).toEqual({ known: 1, unknown: 0, known_total_usd: 0.002, complete: true });
    expect(costs.r2).toEqual({ known: 0, unknown: 1, known_total_usd: null, complete: false });
  });

  it('refuses a viewer', async () => {
    as(VIEWER);
    expect((await call('POST', `/api/engine/products/${PRODUCT_A}/zevir/build`)).status).toBe(403);
    expect((await call('GET', `/api/engine/products/${PRODUCT_A}/zevir`)).status).toBe(200);
  });

  it('projects freshly imported traces through the import hook when enabled', async () => {
    as(USER_A);
    const jsonl = [{ request_id: 'hook-1', symbol: 'classify', workflow: 'support', provider: 'openai', model: 'gpt-4o', input_text: 'RAW-HOOK', output_text: 'x', latency_ms: 10, input_tokens: 1, output_tokens: 1 }].map((t) => JSON.stringify(t)).join('\n');
    const res = await call('POST', `/api/engine/products/${PRODUCT_A}/traces/import`, { traces: [], jsonl });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ imported: 1, rejected: 0, zevir: { status: 'succeeded' } });
    expect(await count(`select count(*)::int n from public.zevir_graphs where source_trace_id = 'hook-1'`)).toBe(1);
  });
});

describe('external ingestion', () => {
  it('ingests an OTel GenAI batch, once', async () => {
    as(USER_A);
    const body = envelope(fixture('otel-genai.json'));
    const first = await call('POST', '/api/zevir/ingest', body);
    expect(first.status).toBe(200);
    expect(first.body.run).toMatchObject({ status: 'succeeded', source_kind: 'otel_genai', received_count: 2, accepted_count: 2, rejected_count: 0, source_version: null, result: { span_count: 6, counts: { created: 2 } } });
    const nodes = await count(`select count(*)::int n from public.zevir_nodes n join public.zevir_graphs g on g.id = n.graph_id where g.source_kind = 'otel_genai'`);
    const again = await call('POST', '/api/zevir/ingest', body);
    expect(again.body).toMatchObject({ reused: true, run: { id: first.body.run.id } });
    expect(await count(`select count(*)::int n from public.zevir_nodes n join public.zevir_graphs g on g.id = n.graph_id where g.source_kind = 'otel_genai'`)).toBe(nodes);
    const stored = await state.db!.query<{ source_version: string }>(`select distinct source_version from public.zevir_graphs where source_kind = 'otel_genai' and source_version is not null`);
    expect(stored.rows.map((r) => r.source_version)).toEqual(['1.37.0']);
  });

  it('ingests an OpenInference batch', async () => {
    const res = await call('POST', '/api/zevir/ingest', envelope(fixture('openinference.json'), { source_kind: 'openinference', source_version: 'openinference-semconv 0.1' }));
    expect(res.body.run).toMatchObject({ status: 'succeeded', accepted_count: 1, adapter_version: 'zevir-openinference/0.1.0' });
  });

  it('honours an Idempotency-Key and refuses it for a different payload', async () => {
    const key = { 'idempotency-key': 'batch-0001' };
    const one = await call('POST', '/api/zevir/ingest', envelope(wideTrace(3)), key);
    expect(one.status).toBe(200);
    const two = await call('POST', '/api/zevir/ingest', envelope(wideTrace(4)), key);
    expect(two).toMatchObject({ status: 422, body: { code: 'IDEMPOTENCY_KEY_REUSED' } });
  });

  it('refuses raw content capture', async () => {
    const res = await call('POST', '/api/zevir/ingest', { ...envelope(fixture('otel-genai.json')), capture_content: true });
    expect(res).toMatchObject({ status: 422, body: { code: 'CONTENT_CAPTURE_UNSUPPORTED' } });
  });

  it('re-checks the claimed workspace server-side', async () => {
    const res = await call('POST', '/api/zevir/ingest', envelope(fixture('otel-genai.json'), { workspace_id: WS_B, product_id: null }));
    expect(res.status).toBe(404);
    const foreignProduct = await call('POST', '/api/zevir/ingest', envelope(fixture('otel-genai.json'), { product_id: '00000000-0000-4000-8000-000000000999' }));
    expect(foreignProduct.status).toBe(404);
  });

  it('rejects a payload that is not a span batch, and records the failed run', async () => {
    const res = await call('POST', '/api/zevir/ingest', envelope({ hello: 'world' }));
    expect(res).toMatchObject({ status: 422, body: { code: 'BAD_PAYLOAD' } });
    expect(await count(`select count(*)::int n from public.zevir_ingest_runs where status = 'failed' and error_code = 'BAD_PAYLOAD'`)).toBe(1);
  });

  it('rejects a malformed envelope', async () => {
    const res = await call('POST', '/api/zevir/ingest', { ...envelope({}), source_kind: 'zevqora_engine' });
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION' } });
  });
});

describe('reads', () => {
  let graphId: string;
  let taskId: string;
  beforeAll(async () => {
    as(USER_A);
    await call('POST', '/api/zevir/ingest', envelope(wideTrace(600)));
    const g = await state.db!.query<{ id: string; root_node_id: string }>(`select id, root_node_id from public.zevir_graphs where source_trace_id = $1`, ['f'.repeat(31) + '1']);
    graphId = g.rows[0].id;
    taskId = g.rows[0].root_node_id;
  });

  it('serves graph, nodes, edges, evidence and node detail to members', async () => {
    as(USER_A);
    const g = await call('GET', `/api/zevir/graphs/${graphId}`);
    expect(g.body).toMatchObject({ id: graphId, schema_version: 'zevir.v0.1', node_count: 602, status: 'complete', summary: { node_counts: { Task: 1, Function: 601 } } });
    expect(g.body.graph_hash).toMatch(/^[0-9a-f]{64}$/);
    const nodes = await call('GET', `/api/zevir/graphs/${graphId}/nodes?kind=Task`);
    expect(nodes.body.map((n: { id: string }) => n.id)).toEqual([taskId]);
    expect((await call('GET', `/api/zevir/graphs/${graphId}/edges?limit=5`)).body).toHaveLength(5);
    const ev = await call('GET', `/api/zevir/graphs/${graphId}/evidence?node_id=${taskId}`);
    expect(ev.body[0]).toMatchObject({ node_id: taskId, source_kind: 'otel_genai', source_trace_id: 'f'.repeat(31) + '1' });
    const detail = await call('GET', `/api/zevir/graphs/${graphId}/nodes/${taskId}`);
    expect(detail.body.outgoing).toHaveLength(1);
    expect((await call('GET', `/api/zevir/graphs?workspace_id=${WS_A}&source_kind=openinference`)).body).toHaveLength(1);
  });

  it('bounds the neighborhood', async () => {
    const root = (await call('GET', `/api/zevir/graphs/${graphId}/nodes/${taskId}`)).body.outgoing[0].target_node_id;
    expect((await call('GET', `/api/zevir/graphs/${graphId}/nodes/${taskId}/neighborhood?depth=1`)).body.nodes).toHaveLength(2);
    const tooBig = await call('GET', `/api/zevir/graphs/${graphId}/nodes/${root}/neighborhood?depth=1&max_nodes=500`);
    expect(tooBig).toMatchObject({ status: 422, body: { code: 'NEIGHBORHOOD_TOO_LARGE', details: { reached: 602, max_nodes: 500 } } });
    expect((await call('GET', `/api/zevir/graphs/${graphId}/nodes/${taskId}/neighborhood?depth=7`)).status).toBe(400);
    expect((await call('GET', `/api/zevir/graphs/${graphId}/nodes/${taskId}/neighborhood?max_nodes=501`)).status).toBe(400);
    expect((await call('GET', `/api/zevir/graphs/${graphId}/nodes?limit=501`)).status).toBe(400);
  });

  it('denies another workspace every graph read with a 404', async () => {
    as(USER_B);
    for (const path of [`/api/zevir/graphs/${graphId}`, `/api/zevir/graphs/${graphId}/nodes`, `/api/zevir/graphs/${graphId}/edges`, `/api/zevir/graphs/${graphId}/evidence`, `/api/zevir/graphs/${graphId}/nodes/${taskId}`, `/api/zevir/graphs/${graphId}/nodes/${taskId}/neighborhood`, `/api/zevir/graphs?workspace_id=${WS_A}`, `/api/engine/products/${PRODUCT_A}/zevir`]) {
      const res = await call('GET', path);
      expect([path, res.status]).toEqual([path, 404]);
    }
    const run = (await state.db!.query<{ id: string }>('select id from public.zevir_ingest_runs limit 1')).rows[0].id;
    expect((await call('GET', `/api/zevir/ingest-runs/${run}`)).status).toBe(404);
    expect((await call('POST', `/api/engine/products/${PRODUCT_A}/zevir/build`)).status).toBe(404);
  });
});
