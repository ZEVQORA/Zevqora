# ZevIR security and privacy

## Tenancy

- Every ZevIR row carries `workspace_id`.
- **Cross-workspace edges are impossible by construction**: `zevir_nodes`,
  `zevir_edges` and `zevir_evidence_refs` reference their graph by
  `(graph_id, workspace_id)`, and edges reference both endpoints by
  `(graph_id, workspace_id, node_id)`. An endpoint in another graph or workspace
  is a foreign-key violation (tested).
- `zevir_persist_graphs` refuses a `product_id` from another workspace and an
  existing graph id owned by another workspace.
- Stable keys and row ids include the workspace id, so the same external trace
  ingested by two workspaces produces unrelated rows.

## Who can do what

| Role | graphs / nodes / edges / evidence | ingest runs | SQL functions |
|---|---|---|---|
| `anon` | nothing | nothing | nothing |
| `authenticated` | `SELECT`, RLS `is_workspace_member(workspace_id, auth.uid())` | nothing | nothing |
| `service_role` (server API) | all | all | `EXECUTE` |

- No client role has `INSERT/UPDATE/DELETE/TRUNCATE` on any ZevIR table (tested,
  and asserted for every public table by `supabase/tests/rls_privilege_check.sql`).
- `zevir_ingest_runs` has RLS on, no policy and no client grant (server-only).
- `zevir_persist_graphs`, `zevir_prune_graphs`, `zevir_neighborhood` are
  `SECURITY INVOKER`, `EXECUTE` revoked from `public, anon, authenticated`.
- The product UI reads through `/api/zevir/*`, not directly; the SELECT grant is
  what makes RLS the second line of defence.

## API authorization

- Every route calls `requireUser` (server-verified JWT, suspended users refused).
- `workspace_id` in an ingestion envelope is a claim: the server checks membership
  (`member` to write, `viewer` to read) before anything else.
- Graph, node, evidence, neighborhood and run reads resolve the graph's workspace
  and answer **404** to non-members, so ids cannot be probed.
- Build/ingest require the `member` role and the `zevir_shadow` flag; both are rate limited.

## Content privacy

Default and only mode in Part 1: **`capture_content = false`**. A request with
`capture_content: true` is refused (`422 CONTENT_CAPTURE_UNSUPPORTED`).

What is kept instead: sha256 digests and lengths of content, token counts, mime
types, provider/model, timing, cost with provenance, ids, structured metadata.

Defences in depth:
1. Adapters read content only to hash it; the engine adapter does not select raw
   text columns at all.
2. `sanitizeAttributes` (canonicalize.js) drops content keys and credential keys,
   redacts secret-shaped strings with the existing `redactSecrets` boundary
   (`api/_lib/sanitize.js`), caps strings at 512 chars, 64 keys, depth 4.
3. The node schema's `propertyNames` refuses `prompt, messages, content, input_text,
   output_text, system_prompt, raw_*, …` as attribute keys.
4. Tests assert that no fixture content marker reaches any graph or stored row.

Any future content capture must be an explicit, separately-reviewed change that
routes content through `sanitizeSample` (the existing sanitization boundary) and
adds a retention policy. It is not implemented.

Known limitation: a sha256 of short, low-entropy content (e.g. a one-word label)
can be confirmed by guessing. Digests are visible only to workspace members. A
keyed hash (HMAC with a per-workspace secret) is the follow-up if that matters.

## Cost correctness

- `cost_usd` NULL means unknown; `0` means a known zero. DB CHECK: a non-null
  cost requires `cost_source`. Summaries count unknown costs separately and report
  `known_total_usd: null` when nothing is known.
- ZevIR does not feed the proof loop, so it cannot change VERIFIED semantics.

## Abuse limits

| Limit | Value |
|---|---|
| Ingest body | 3 MB |
| Spans / traces per batch | 5000 / 200 |
| Nodes / edges per graph | 5000 / 20000 (DB CHECK) |
| Engine traces per projection | 5000 |
| Graphs per persist call | 100 (SQL refuses > 200) |
| Neighborhood depth / nodes | ≤ 6 / ≤ 500, overflow is an error |
| List page size | ≤ 500 |
| Rate | build 10/min, ingest 20/min per user |
