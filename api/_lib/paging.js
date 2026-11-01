/**
 * Bounded paging over PostgREST.
 *
 * Supabase caps every response at its `max_rows` (1000 by default) without an
 * error, so a single `.limit(5000)` silently returns at most 1000 rows. Read in
 * pages instead, stop at `max`, and say whether the result was truncated.
 *
 * `build(from, to)` must return a fresh query with `.range(from, to)` applied
 * (supabase-js builders are single-use). Select with `{ count: 'exact' }` so the
 * total is known: then truncation is detected even if the server's row cap is
 * smaller than a page.
 */
export const PAGE_SIZE = 1000;

export async function fetchPaged(build, { max, pageSize = PAGE_SIZE } = {}) {
  const rows = [];
  let total = null;
  for (let from = 0; from < max; ) {
    const to = Math.min(from + pageSize, max) - 1;
    const { data, error, count } = await build(from, to);
    if (error) throw error;
    if (typeof count === 'number') total = count;
    const page = data || [];
    rows.push(...page);
    if (!page.length) break;
    if (total !== null ? rows.length >= Math.min(total, max) : page.length < to - from + 1) break;
    // Continue right after what actually arrived (the server may cap a page below pageSize).
    from += page.length;
  }
  const truncated = total !== null ? total > rows.length : rows.length >= max;
  return { rows, truncated, total };
}
