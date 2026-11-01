/**
 * PostgREST silently caps each response (1000 rows by default, configurable
 * lower). fetchPaged must read every row up to `max`, and report truncation
 * honestly — including when the server cap is smaller than a page.
 */
import { describe, expect, it } from 'vitest';
import { fetchPaged } from '../api/_lib/paging.js';

/** A fake table of `total` rows behind a server that returns at most `cap` rows per request. */
function server(total: number, cap: number, { withCount = true } = {}) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  let calls = 0;
  const build = async (from: number, to: number) => {
    calls += 1;
    const end = Math.min(to + 1, from + cap, total);
    return { data: rows.slice(from, end), error: null, count: withCount ? total : undefined };
  };
  return { build, calls: () => calls };
}

describe('fetchPaged', () => {
  it('reads past the default 1000-row cap', async () => {
    const s = server(2500, 1000);
    const r = await fetchPaged(s.build, { max: 5000 });
    expect(r.rows).toHaveLength(2500);
    expect(r.truncated).toBe(false);
    expect(new Set(r.rows.map((x) => x.id)).size).toBe(2500);
  });

  it('reports truncation when the table is larger than max', async () => {
    const r = await fetchPaged(server(7000, 1000).build, { max: 5000 });
    expect(r.rows).toHaveLength(5000);
    expect(r.truncated).toBe(true);
    expect(r.total).toBe(7000);
  });

  it('is not fooled by a server cap smaller than a page when the query asks for a count', async () => {
    const r = await fetchPaged(server(1800, 300).build, { max: 5000 });
    expect(r.rows).toHaveLength(1800);
    expect(r.truncated).toBe(false);
  });

  it('stops on an empty table without looping', async () => {
    const s = server(0, 1000);
    const r = await fetchPaged(s.build, { max: 5000 });
    expect(r).toMatchObject({ rows: [], truncated: false });
    expect(s.calls()).toBe(1);
  });

  it('without a count, exactly max rows is treated as possibly truncated', async () => {
    const r = await fetchPaged(server(5000, 1000, { withCount: false }).build, { max: 5000 });
    expect(r.rows).toHaveLength(5000);
    expect(r.truncated).toBe(true);
  });
});
