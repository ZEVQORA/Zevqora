/**
 * Supabase's API caps each response at `max_rows` (1000 by default) and does
 * not raise an error. PGlite has no such cap, so this test puts one in front of
 * the real database: the evidence window, the replay trace set and the ZevIR
 * projection must still read every row, and the Command Center must not
 * silently undercount.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, restClient, seedWorkspace } from './helpers/pg';

const CAP = 1000;
const WS = 'a1111111-1111-4111-8111-111111111111';
const USER = 'a0000000-0000-4000-8000-00000000000a';
type Row = Record<string, unknown>;

/** A restClient whose every read returns at most CAP rows, exactly like PostgREST's max_rows. */
function capped(rest: ReturnType<typeof restClient>) {
  return {
    ...rest,
    from(table: string) {
      const q = rest.from(table) as unknown as Row & { then: (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => unknown };
      const then = q.then.bind(q);
      q.then = (resolve, reject) => then((res: unknown) => {
        const r = res as { data: unknown };
        return resolve(Array.isArray(r?.data) ? { ...r, data: r.data.slice(0, CAP) } : res);
      }, reject);
      return q as never;
    },
  };
}

let product: Row;
let admin: ReturnType<typeof capped>;

beforeAll(async () => {
  const db = await createDb();
  await seedWorkspace(db, { userId: USER, workspaceId: WS, slug: 'cap', role: 'owner' });
  const { rows } = await db.query<Row>(`insert into public.engine_products(workspace_id, name, root_path) values ($1, 'cap test', 'cap://x') returning *`, [WS]);
  product = rows[0];
  await db.query(`insert into public.engine_traces(product_id, workspace_id, request_id, "timestamp", provider, model, latency_ms, cost_usd, cost_source, output_text)
    select $1, $2, 'req-' || g, now() - (g || ' seconds')::interval, 'openai', 'gpt-4o', 500, 0.001, 'provider_reported', 'ok'
    from generate_series(1, 1200) g`, [product.id, WS]);
  admin = capped(restClient(db));
}, 60_000);

describe('reads behind a 1000-row API cap', () => {
  it('the cap is real in this test (a plain read stops at 1000)', async () => {
    const { data } = (await admin.from('engine_traces').select('id').eq('product_id', product.id)) as unknown as { data: Row[] };
    expect(data).toHaveLength(CAP);
  });

  it('the Verified Performance evidence window reads all 1200 traces and is not marked truncated', async () => {
    const { loadEvidence } = await import('../api/_lib/optimize/store.js');
    const ev = await loadEvidence(admin, product);
    expect(ev.traces).toHaveLength(1200);
    expect(ev.truncated).toBe(false);
  });
});
