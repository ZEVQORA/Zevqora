/**
 * Migration 016 against a disposable Postgres (PGlite): row-level security,
 * browser-role privileges, the invariants the schema itself enforces, the
 * atomic persistence function and the bounded neighborhood query.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asUser, createDb, migration, restClient, seedWorkspace } from './helpers/pg';
import { finalize, Gaps } from '../api/_lib/zevir/canonicalize.js';
import { graphRecord } from '../api/_lib/zevir/store.js';
import { otelGenAiToGraphs } from '../api/_lib/zevir/adapters/otel-genai.js';
import { engineTracesToGraphs } from '../api/_lib/zevir/adapters/engine.js';
import { sha256Json } from '../api/_lib/product/hashing.js';

const USER_A = 'a0000000-0000-4000-8000-00000000000a';
const USER_B = 'b0000000-0000-4000-8000-00000000000b';
const WS_A = 'a1111111-1111-4111-8111-111111111111';
const WS_B = 'b2222222-2222-4222-8222-222222222222';
const PRODUCT_A = 'a3333333-3333-4333-8333-333333333333';
const PRODUCT_B = 'b4444444-4444-4444-8444-444444444444';

let db: PGlite;
let rest: ReturnType<typeof restClient>;
type Rec = ReturnType<typeof graphRecord>;

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'zevir', name), 'utf8'));

async function persist(records: Rec[]) {
  const { data, error } = await rest.rpc('zevir_persist_graphs', { p_graphs: records });
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data as { id: string; outcome: string }[];
}

/** A star: one Task calling `n` Functions (to exercise the node budget). */
function star(n: number, traceId = 'star') {
  const ev = (span: string) => ({ source_id: span, source_trace_id: traceId, source_span_id: span, source_hash: sha256Json(span), locator: {} });
  const nodes = [{ ref: 'task', kind: 'Task', scope: { trace_id: traceId, span_id: null }, fields: { name: 'root' }, attributes: {}, evidence: [ev('task')] }];
  const edges = [];
  for (let i = 0; i < n; i += 1) {
    nodes.push({ ref: `f${i}`, kind: 'Function', scope: { trace_id: traceId, span_id: `f${i}` }, fields: { name: `f${i}` }, attributes: {}, evidence: [ev(`f${i}`)] });
    edges.push({ from: 'task', to: `f${i}`, kind: 'CALLS', ordinal: i });
  }
  // A loop back to the root: workflows may cycle.
  if (n) edges.push({ from: 'f0', to: 'task', kind: 'DEPENDS_ON' });
  return finalize({ source_kind: 'otel_genai', graph_key: `trace:${traceId}`, source_trace_id: traceId, root: 'task', nodes, edges, gaps: new Gaps() }, { workspaceId: WS_A });
}

function engineRecord(workspaceId: string, productId: string, requestId: string, over: Record<string, unknown> = {}) {
  const trace = { id: `${productId.slice(0, 8)}-0000-4000-8000-${requestId.padStart(12, '0').slice(-12)}`, request_id: requestId, timestamp: '2026-09-01T10:00:00Z', symbol: 'classify', workflow: 'support', provider: 'openai', model: 'gpt-4o', response_model: 'gpt-4o', input_tokens: 10, output_tokens: 2, latency_ms: 100, cost_usd: null, cost_source: null, input_hash: 'a'.repeat(64), output_hash: 'b'.repeat(64), protected: false, metadata: {}, ...over };
  const { graphs } = engineTracesToGraphs([trace], { product: { id: productId, workspace_id: workspaceId } });
  return graphRecord(graphs[0], { workspaceId, productId });
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (error) {
    return (error as { code?: string }).code || (error as Error).message;
  }
};

beforeAll(async () => {
  db = await createDb();
  rest = restClient(db);
  await seedWorkspace(db, { userId: USER_A, workspaceId: WS_A, slug: 'alpha' });
  await seedWorkspace(db, { userId: USER_B, workspaceId: WS_B, slug: 'bravo' });
  await db.query(`insert into public.engine_products(id, workspace_id, name, root_path) values ($1, $2, 'a', 'workload://a'), ($3, $4, 'b', 'workload://b')`, [PRODUCT_A, WS_A, PRODUCT_B, WS_B]);
  await persist([engineRecord(WS_A, PRODUCT_A, 'r1'), engineRecord(WS_B, PRODUCT_B, 'r1')]);
}, 120_000);

describe('persistence', () => {
  it('is idempotent: the same graph twice is written once', async () => {
    const rec = engineRecord(WS_A, PRODUCT_A, 'idem');
    expect((await persist([rec]))[0].outcome).toBe('created');
    const before = await db.query<{ n: number }>('select count(*)::int n from public.zevir_nodes where graph_id = $1', [rec.id]);
    expect((await persist([rec]))[0].outcome).toBe('unchanged');
    const reordered = { ...rec, nodes: [...rec.nodes].reverse(), edges: [...rec.edges].reverse(), evidence: [...rec.evidence].reverse() };
    expect((await persist([reordered]))[0].outcome).toBe('unchanged');
    const after = await db.query<{ n: number }>('select count(*)::int n from public.zevir_nodes where graph_id = $1', [rec.id]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    expect(before.rows[0].n).toBe(5);
  });

  it('replaces a changed engine projection in place, keeping node ids', async () => {
    const first = engineRecord(WS_A, PRODUCT_A, 'changes');
    await persist([first]);
    const changed = engineRecord(WS_A, PRODUCT_A, 'changes', { latency_ms: 250 });
    expect(changed.id).toBe(first.id);
    expect((await persist([changed]))[0].outcome).toBe('replaced');
    const ids = await db.query<{ id: string }>('select id from public.zevir_nodes where graph_id = $1 order by id', [first.id]);
    expect(ids.rows.map((r) => r.id)).toEqual(first.nodes.map((n) => n.id).sort());
  });

  it('stores unknown cost as NULL, never 0', async () => {
    const rec = engineRecord(WS_A, PRODUCT_A, 'nocost');
    await persist([rec]);
    const row = await db.query<{ cost_usd: number | null; cost_source: string | null }>(`select cost_usd, cost_source from public.zevir_nodes where graph_id = $1 and kind = 'ModelCall'`, [rec.id]);
    expect(row.rows[0]).toEqual({ cost_usd: null, cost_source: null });
    const g = await db.query<{ summary: { cost: unknown } }>('select summary from public.zevir_graphs where id = $1', [rec.id]);
    expect(g.rows[0].summary.cost).toEqual({ known: 0, unknown: 1, known_total_usd: null, complete: false });
  });

  it('refuses a node without provenance', async () => {
    const rec = engineRecord(WS_A, PRODUCT_A, 'noprov');
    const bad = { ...rec, graph_hash: 'e'.repeat(64), evidence: rec.evidence.slice(1) };
    expect(await code(persist([bad]))).toMatch(/ZEVIR_PROVENANCE_MISSING|23514/);
    const g = await db.query('select 1 from public.zevir_graphs where id = $1', [rec.id]);
    expect(g.rows).toHaveLength(0);
  });

  it('refuses a product from another workspace', async () => {
    const rec = { ...engineRecord(WS_A, PRODUCT_A, 'xprod'), product_id: PRODUCT_B };
    expect(await code(persist([rec]))).toMatch(/ZEVIR_PRODUCT_WORKSPACE_MISMATCH|23514/);
  });

  it('keeps a stored external trace when a later batch holds only part of it', async () => {
    const full = otelGenAiToGraphs(fixture('otel-genai.json'), { workspaceId: WS_A }).graphs[0];
    const rec = graphRecord(full, { workspaceId: WS_A, requireSuperset: true });
    expect((await persist([rec]))[0].outcome).toBe('created');
    const f = fixture('otel-genai.json');
    f.resourceSpans[0].scopeSpans[0].spans = f.resourceSpans[0].scopeSpans[0].spans.slice(0, 2);
    const part = otelGenAiToGraphs(f, { workspaceId: WS_A }).graphs.find((g: { graph_key: string }) => g.graph_key === full.graph_key);
    expect((await persist([graphRecord(part, { workspaceId: WS_A, requireSuperset: true })]))[0].outcome).toBe('conflict');
    const stored = await db.query<{ graph_hash: string }>('select graph_hash from public.zevir_graphs where id = $1', [rec.id]);
    expect(stored.rows[0].graph_hash).toBe(full.graph_hash);
  });
});

describe('schema-enforced invariants', () => {
  const graphRow = async () => (await db.query<{ id: string }>('select id from public.zevir_graphs where workspace_id = $1 limit 1', [WS_A])).rows[0].id;
  const asService = (sql: string, params: unknown[]) => db.transaction(async (tx) => {
    await tx.exec('set local role service_role');
    return tx.query(sql, params);
  });
  const insertNode = (gid: string, ws: string, kind = 'Function', extra = '') => asService(`insert into public.zevir_nodes(id, graph_id, workspace_id, stable_key, kind${extra ? ', cost_usd' : ''}) values (gen_random_uuid(), $1, $2, $3, $4${extra ? ', 0.5' : ''}) returning id`, [gid, ws, sha256Json(Math.random()), kind]);

  it('rejects a non-canonical node kind', async () => {
    expect(await code(insertNode(await graphRow(), WS_A, 'Network'))).toBe('23514');
    expect(await code(insertNode(await graphRow(), WS_A, 'Embedding'))).toBe('23514');
  });

  it('rejects a non-canonical edge kind', async () => {
    const gid = await graphRow();
    const [a, b] = (await db.query<{ id: string }>('select id from public.zevir_nodes where graph_id = $1 limit 2', [gid])).rows;
    expect(await code(asService(`insert into public.zevir_edges(id, graph_id, workspace_id, source_node_id, target_node_id, kind) values (gen_random_uuid(), $1, $2, $3, $4, 'NETWORK')`, [gid, WS_A, a.id, b.id]))).toBe('23514');
  });

  it('rejects a known cost without a cost source', async () => {
    expect(await code(insertNode(await graphRow(), WS_A, 'ModelCall', 'cost'))).toBe('23514');
  });

  it('makes a cross-workspace node impossible', async () => {
    expect(await code(insertNode(await graphRow(), WS_B))).toBe('23503');
  });

  it('makes a malformed or cross-graph / cross-workspace edge endpoint impossible', async () => {
    const gA = await graphRow();
    const gB = (await db.query<{ id: string }>('select id from public.zevir_graphs where workspace_id = $1 limit 1', [WS_B])).rows[0].id;
    const nA = (await db.query<{ id: string }>('select id from public.zevir_nodes where graph_id = $1 limit 1', [gA])).rows[0].id;
    const nB = (await db.query<{ id: string }>('select id from public.zevir_nodes where graph_id = $1 limit 1', [gB])).rows[0].id;
    const edge = (graph: string, ws: string, src: string, dst: string) => asService(`insert into public.zevir_edges(id, graph_id, workspace_id, source_node_id, target_node_id, kind) values (gen_random_uuid(), $1, $2, $3, $4, 'CALLS')`, [graph, ws, src, dst]);
    expect(await code(edge(gA, WS_A, nA, '00000000-0000-4000-8000-000000000000'))).toBe('23503');
    expect(await code(edge(gA, WS_A, nA, nB))).toBe('23503');
    expect(await code(edge(gA, WS_B, nA, nB))).toBe('23503');
    expect(await code(edge(gB, WS_B, nA, nB))).toBe('23503');
  });
});

describe('row-level security and privileges', () => {
  it('a member reads only their own workspace’s graphs, nodes, edges and evidence', async () => {
    const seen = await asUser(db, USER_A, async (tx) => {
      const out: Record<string, string[]> = {};
      for (const t of ['zevir_graphs', 'zevir_nodes', 'zevir_edges', 'zevir_evidence_refs']) out[t] = (await tx.query<{ workspace_id: string }>(`select distinct workspace_id from public.${t}`)).rows.map((r) => r.workspace_id);
      return out;
    });
    for (const t of Object.keys(seen)) expect(seen[t]).toEqual([WS_A]);
    const byId = await asUser(db, USER_A, (tx) => tx.query(`select id from public.zevir_graphs where workspace_id = $1`, [WS_B]));
    expect(byId.rows).toEqual([]);
  });

  it('anon reads nothing', async () => {
    expect(await code(asUser(db, null, (tx) => tx.query('select 1 from public.zevir_graphs')))).toBe('42501');
  });

  it('ingest runs are server-only', async () => {
    expect(await code(asUser(db, USER_A, (tx) => tx.query('select 1 from public.zevir_ingest_runs')))).toBe('42501');
  });

  it.each(['zevir_graphs', 'zevir_nodes', 'zevir_edges', 'zevir_evidence_refs', 'zevir_ingest_runs'])('an authenticated browser user cannot write %s', async (table) => {
    expect(await code(asUser(db, USER_A, (tx) => tx.query(`delete from public.${table} where workspace_id = $1`, [WS_A])))).toBe('42501');
    expect(await code(asUser(db, USER_A, (tx) => tx.query(`update public.${table} set workspace_id = workspace_id where workspace_id = $1`, [WS_A])))).toBe('42501');
    expect(await code(asUser(db, USER_A, (tx) => tx.query(`insert into public.${table}(id) values (gen_random_uuid())`)))).toBe('42501');
  });

  it('browser roles cannot call the ZevIR SQL functions', async () => {
    const rec = engineRecord(WS_A, PRODUCT_A, 'rpc');
    expect(await code(asUser(db, USER_A, (tx) => tx.query('select public.zevir_persist_graphs($1)', [JSON.stringify([rec])])))).toBe('42501');
    expect(await code(asUser(db, USER_A, (tx) => tx.query(`select public.zevir_neighborhood($1, $2, 1, 10, 'both')`, [rec.id, rec.root_node_id])))).toBe('42501');
    expect(await code(asUser(db, USER_A, (tx) => tx.query(`select public.zevir_prune_graphs($1, $2, 'zevqora_engine', '[]'::jsonb)`, [WS_A, PRODUCT_A])))).toBe('42501');
  });

  it('no browser role holds any write privilege on a ZevIR table', async () => {
    const r = await db.query<{ n: number }>(`select count(*)::int n from pg_class c join pg_namespace s on s.oid = c.relnamespace
      where s.nspname = 'public' and c.relname like 'zevir_%' and c.relkind = 'r'
        and (has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE') or has_table_privilege('authenticated', c.oid, 'DELETE') or has_table_privilege('authenticated', c.oid, 'TRUNCATE')
          or has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'))`);
    expect(r.rows[0].n).toBe(0);
  });
});

describe('neighborhood', () => {
  let rec: Rec;
  beforeAll(async () => {
    rec = graphRecord(star(600), { workspaceId: WS_A });
    await persist([rec]);
  });
  const hood = async (node: string, depth: number, max: number, direction = 'both') => {
    const { data, error } = await rest.rpc('zevir_neighborhood', { p_graph_id: rec.id, p_node_id: node, p_depth: depth, p_max_nodes: max, p_direction: direction });
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return data as { found: boolean; overflow: boolean; reached?: number; nodes?: { id: string }[]; edges?: unknown[] };
  };
  const leaf = () => rec.nodes.find((n) => n.name === 'f5')!.id;

  it('returns the bounded neighborhood with its edges, through loops', async () => {
    const out = await hood(leaf(), 1, 10);
    expect(out.overflow).toBe(false);
    expect(out.nodes!.map((n) => n.id).sort()).toEqual([leaf(), rec.root_node_id].sort());
    expect(out.edges).toHaveLength(1);
    const outward = await hood(leaf(), 3, 10, 'out');
    expect(outward.nodes).toHaveLength(1);
  });

  it('reports overflow instead of returning more than max_nodes', async () => {
    const out = await hood(rec.root_node_id!, 1, 500);
    expect(out).toMatchObject({ found: true, overflow: true, reached: 601, max_nodes: 500 });
    expect(out.nodes).toBeUndefined();
  });

  it('refuses depth over 6 and max_nodes over 500', async () => {
    expect(await code(hood(leaf(), 7, 10))).toMatch(/ZEVIR_DEPTH_LIMIT|22023/);
    expect(await code(hood(leaf(), 2, 501))).toMatch(/ZEVIR_NODE_LIMIT|22023/);
    expect(await code(hood(leaf(), 2, 10, 'sideways'))).toMatch(/ZEVIR_DIRECTION|22023/);
  });

  it('answers not-found for a node of another graph', async () => {
    const other = (await db.query<{ id: string }>('select id from public.zevir_nodes where workspace_id = $1 limit 1', [WS_B])).rows[0].id;
    expect((await hood(other, 1, 10)).found).toBe(false);
  });
});

describe('pruning', () => {
  it('removes engine projections whose trace is gone and nothing else', async () => {
    const keep = engineRecord(WS_A, PRODUCT_A, 'keep');
    const drop = engineRecord(WS_A, PRODUCT_A, 'drop');
    await persist([keep, drop]);
    const all = (await db.query<{ id: string }>(`select id from public.zevir_graphs where product_id = $1 and source_kind = 'zevqora_engine'`, [PRODUCT_A])).rows.map((r) => r.id);
    const { data } = await rest.rpc('zevir_prune_graphs', { p_workspace_id: WS_A, p_product_id: PRODUCT_A, p_source_kind: 'zevqora_engine', p_keep: all.filter((id) => id !== drop.id) });
    expect(data).toBe(1);
    const left = await db.query('select 1 from public.zevir_graphs where id = $1', [drop.id]);
    expect(left.rows).toHaveLength(0);
    const nodes = await db.query('select 1 from public.zevir_nodes where graph_id = $1', [drop.id]);
    expect(nodes.rows).toHaveLength(0);
    const other = await db.query(`select 1 from public.zevir_graphs where workspace_id = $1`, [WS_B]);
    expect(other.rows.length).toBeGreaterThan(0);
  });
});

describe('migration 016', () => {
  it('passes the documented production dry run and leaves nothing behind', async () => {
    const fresh = await createDb({ zevir: false });
    const wrapped = `do $dry$
begin
${migration('016_zevir_part1.sql')}
raise exception 'ZEVIR_DRY_RUN_OK';
end
$dry$;`;
    await expect(fresh.exec(wrapped)).rejects.toThrow('ZEVIR_DRY_RUN_OK');
    const left = await fresh.query<{ t: string | null; f: number }>(`select to_regclass('public.zevir_graphs')::text t, (select count(*)::int from public.feature_flags where key = 'zevir_shadow') f`);
    expect(left.rows[0]).toEqual({ t: null, f: 0 });
    await fresh.exec(migration('016_zevir_part1.sql'));
    await fresh.exec(migration('016_zevir_part1.sql'));
    expect((await fresh.query<{ n: number }>(`select count(*)::int n from information_schema.tables where table_name like 'zevir_%'`)).rows[0].n).toBe(5);
  }, 60_000);

  it('grants browser roles nothing beyond SELECT even under Supabase-style permissive default privileges', async () => {
    // Production's default ACLs (objects created by supabase_admin) grant anon/authenticated
    // everything on new tables and EXECUTE on new functions; 016 must not rely on 012's defaults.
    const fresh = await createDb({ zevir: false });
    await fresh.exec(`alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges in schema public grant execute on functions to anon, authenticated;`);
    await fresh.exec(migration('016_zevir_part1.sql'));
    const r = await fresh.query<{ relname: string; privs: string }>(`select c.relname, concat_ws(',',
        case when has_table_privilege('anon', c.oid, 'SELECT') then 'anon:select' end,
        case when has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE') then 'anon:write' end,
        case when has_table_privilege('authenticated', c.oid, 'SELECT') then 'auth:select' end,
        case when has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE') then 'auth:write' end) privs
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'zevir_%' and c.relkind = 'r' order by 1`);
    expect(Object.fromEntries(r.rows.map((x) => [x.relname, x.privs]))).toEqual({ zevir_edges: 'auth:select', zevir_evidence_refs: 'auth:select', zevir_graphs: 'auth:select', zevir_ingest_runs: '', zevir_nodes: 'auth:select' });
    const fns = await fresh.query<{ n: number }>(`select count(*)::int n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'zevir_%'
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))`);
    expect(fns.rows[0].n).toBe(0);
  }, 60_000);
});
