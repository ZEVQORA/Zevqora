-- ZevIR Part 1: the canonical execution graph, in shadow mode.
--
-- ZevIR is ZEVQORA's internal representation of an AI execution: which task
-- called which function, model, tool or retriever, what served it, what it
-- produced, and the evidence every node came from. Part 1 only observes and
-- stores: nothing in the proof loop (plans, executions, gates, evaluations,
-- billing) reads these tables.
--
-- One graph = one execution trace. Engine traces project one graph per
-- engine_traces row; external OpenTelemetry GenAI / OpenInference batches
-- project one graph per trace_id. Stable keys and ids are deterministic, so a
-- rebuild rewrites the same rows instead of adding new ones.
--
-- Additive. Does not touch engine_* tables. No raw prompt or output is stored
-- (see docs/zevir-security.md). Browser roles get SELECT on graph rows of their
-- workspaces and nothing else; every write goes through service-role code via
-- public.zevir_persist_graphs.
--
-- Rollback: supabase/rollback/016_zevir_part1.rollback.sql.

-- ---------------------------------------------------------------- ingest runs
create table if not exists public.zevir_ingest_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid references public.engine_products(id) on delete set null,
  source_kind text not null check (source_kind in ('zevqora_engine', 'otel_genai', 'openinference')),
  source_version text,
  adapter_version text not null,
  schema_version text not null check (schema_version = 'zevir.v0.1'),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('running', 'succeeded', 'partial', 'failed')),
  received_count integer not null default 0 check (received_count >= 0),
  accepted_count integer not null default 0 check (accepted_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  error_code text,
  error_detail text check (error_detail is null or char_length(error_detail) <= 2000),
  result jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, idempotency_key)
);
create index if not exists zevir_ingest_runs_product_idx on public.zevir_ingest_runs(product_id, started_at desc);
create index if not exists zevir_ingest_runs_created_by_idx on public.zevir_ingest_runs(created_by);

-- --------------------------------------------------------------------- graphs
create table if not exists public.zevir_graphs (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  product_id uuid references public.engine_products(id) on delete cascade,
  schema_version text not null check (schema_version = 'zevir.v0.1'),
  adapter_version text not null,
  source_kind text not null check (source_kind in ('zevqora_engine', 'otel_genai', 'openinference')),
  source_version text,
  graph_key text not null check (char_length(graph_key) between 1 and 400),
  source_trace_id text,
  root_node_id uuid,
  status text not null check (status in ('complete', 'incomplete')),
  node_count integer not null check (node_count between 0 and 5000),
  edge_count integer not null check (edge_count between 0 and 20000),
  graph_hash text not null check (graph_hash ~ '^[0-9a-f]{64}$'),
  completeness jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  capture_started_at timestamptz,
  capture_ended_at timestamptz,
  ingest_run_id uuid references public.zevir_ingest_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, source_kind, graph_key),
  -- Target of the composite foreign keys below: a child row can only point at
  -- a graph of its own workspace.
  unique (id, workspace_id)
);
create index if not exists zevir_graphs_product_idx on public.zevir_graphs(product_id, updated_at desc);
create index if not exists zevir_graphs_workspace_idx on public.zevir_graphs(workspace_id, updated_at desc);
create index if not exists zevir_graphs_source_trace_idx on public.zevir_graphs(workspace_id, source_trace_id);
create index if not exists zevir_graphs_project_idx on public.zevir_graphs(project_id);
create index if not exists zevir_graphs_ingest_run_idx on public.zevir_graphs(ingest_run_id);

-- ---------------------------------------------------------------------- nodes
create table if not exists public.zevir_nodes (
  id uuid primary key,
  graph_id uuid not null,
  workspace_id uuid not null,
  stable_key text not null check (stable_key ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('Task', 'ModelCall', 'Agent', 'ToolCall', 'Retrieval', 'Function', 'Runtime', 'Outcome')),
  name text check (name is null or char_length(name) <= 300),
  operation text check (operation is null or operation ~ '^[a-z_]{1,40}$'),
  started_at timestamptz,
  ended_at timestamptz,
  duration_ms double precision check (duration_ms is null or duration_ms >= 0),
  status text check (status is null or status in ('ok', 'error', 'unset')),
  -- Unknown cost is NULL, never 0. A known cost must say where it came from.
  cost_usd double precision check (cost_usd is null or cost_usd >= 0),
  cost_source text check (cost_source is null or cost_source in ('provider_reported', 'pricing_snapshot_estimate', 'imported_external')),
  latency_ms double precision check (latency_ms is null or latency_ms >= 0),
  ttft_ms double precision check (ttft_ms is null or ttft_ms >= 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  cached_input_tokens integer check (cached_input_tokens is null or cached_input_tokens >= 0),
  reasoning_tokens integer check (reasoning_tokens is null or reasoning_tokens >= 0),
  task_success double precision check (task_success is null or task_success between 0 and 1),
  trust_class text check (trust_class is null or trust_class ~ '^[a-z_]{1,40}$'),
  data_sensitivity text check (data_sensitivity is null or data_sensitivity ~ '^[a-z_]{1,40}$'),
  action_risk text check (action_risk is null or action_risk ~ '^[a-z_]{1,40}$'),
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  created_at timestamptz not null default now(),
  constraint zevir_nodes_cost_provenance check (cost_usd is null or cost_source is not null),
  constraint zevir_nodes_operation_model_only check (operation is null or kind = 'ModelCall'),
  constraint zevir_nodes_graph_fk foreign key (graph_id, workspace_id) references public.zevir_graphs(id, workspace_id) on delete cascade,
  unique (graph_id, stable_key),
  unique (graph_id, workspace_id, id)
);
create index if not exists zevir_nodes_workspace_key_idx on public.zevir_nodes(workspace_id, stable_key);
create index if not exists zevir_nodes_graph_kind_idx on public.zevir_nodes(graph_id, kind);

-- ---------------------------------------------------------------------- edges
create table if not exists public.zevir_edges (
  id uuid primary key,
  graph_id uuid not null,
  workspace_id uuid not null,
  source_node_id uuid not null,
  target_node_id uuid not null,
  kind text not null check (kind in ('CALLS', 'USES', 'DEPENDS_ON', 'RETRIEVES', 'PROVIDES_CONTEXT', 'ROUTES_TO', 'SERVED_BY', 'REPLACES', 'PRODUCES', 'EVALUATED_BY', 'LOCATED_AT')),
  ordinal integer check (ordinal is null or ordinal >= 0),
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  created_at timestamptz not null default now(),
  -- Both endpoints must exist, in this graph, in this workspace.
  constraint zevir_edges_graph_fk foreign key (graph_id, workspace_id) references public.zevir_graphs(id, workspace_id) on delete cascade,
  constraint zevir_edges_source_fk foreign key (graph_id, workspace_id, source_node_id) references public.zevir_nodes(graph_id, workspace_id, id) on delete cascade,
  constraint zevir_edges_target_fk foreign key (graph_id, workspace_id, target_node_id) references public.zevir_nodes(graph_id, workspace_id, id) on delete cascade
);
-- Adjacency, and one edge per (source, kind, target).
create unique index if not exists zevir_edges_out_idx on public.zevir_edges(graph_id, source_node_id, kind, target_node_id);
create index if not exists zevir_edges_in_idx on public.zevir_edges(graph_id, target_node_id, kind);
create index if not exists zevir_edges_workspace_idx on public.zevir_edges(workspace_id);

-- -------------------------------------------------------------- evidence refs
create table if not exists public.zevir_evidence_refs (
  id uuid primary key,
  graph_id uuid not null,
  node_id uuid,
  workspace_id uuid not null,
  source_kind text not null check (source_kind in ('zevqora_engine', 'otel_genai', 'openinference')),
  source_id text,
  source_trace_id text,
  source_span_id text,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  adapter_version text not null,
  schema_version text not null check (schema_version = 'zevir.v0.1'),
  locator jsonb not null default '{}'::jsonb check (jsonb_typeof(locator) = 'object'),
  content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  redaction_state text not null check (redaction_state in ('not_captured', 'hashed_only', 'redacted')),
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  constraint zevir_evidence_graph_fk foreign key (graph_id, workspace_id) references public.zevir_graphs(id, workspace_id) on delete cascade,
  constraint zevir_evidence_node_fk foreign key (graph_id, workspace_id, node_id) references public.zevir_nodes(graph_id, workspace_id, id) on delete cascade
);
create index if not exists zevir_evidence_graph_node_idx on public.zevir_evidence_refs(graph_id, node_id);
create index if not exists zevir_evidence_source_idx on public.zevir_evidence_refs(workspace_id, source_kind, source_trace_id, source_span_id);
create index if not exists zevir_evidence_workspace_idx on public.zevir_evidence_refs(workspace_id);

-- ------------------------------------------------------------ access control
alter table public.zevir_graphs enable row level security;
alter table public.zevir_nodes enable row level security;
alter table public.zevir_edges enable row level security;
alter table public.zevir_evidence_refs enable row level security;
alter table public.zevir_ingest_runs enable row level security;

revoke all on public.zevir_graphs, public.zevir_nodes, public.zevir_edges, public.zevir_evidence_refs, public.zevir_ingest_runs from anon, authenticated;
grant select on public.zevir_graphs, public.zevir_nodes, public.zevir_edges, public.zevir_evidence_refs to authenticated;
grant all on public.zevir_graphs, public.zevir_nodes, public.zevir_edges, public.zevir_evidence_refs, public.zevir_ingest_runs to service_role;

do $$
declare t text;
begin
  foreach t in array array['zevir_graphs', 'zevir_nodes', 'zevir_edges', 'zevir_evidence_refs'] loop
    execute format('drop policy if exists %I on public.%I', t || '_member_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id, (select auth.uid())))', t || '_member_select', t);
  end loop;
end $$;
-- zevir_ingest_runs: RLS on, no policy, no client grant — server-only.

-- ---------------------------------------------------------------- persistence
-- Writes a batch of canonical graphs atomically. Each element:
--   { id, workspace_id, product_id, project_id, schema_version, adapter_version,
--     source_kind, source_version, graph_key, source_trace_id, root_node_id,
--     status, graph_hash, completeness, summary, capture_started_at,
--     capture_ended_at, ingest_run_id, require_superset,
--     nodes: [...], edges: [...], evidence: [...] }
-- Returns [{ id, graph_key, outcome }] with outcome created | replaced |
-- unchanged | conflict. "conflict" means an external trace was already stored
-- with nodes this batch does not contain; it is left untouched.
create or replace function public.zevir_persist_graphs(p_graphs jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  g jsonb;
  v_id uuid;
  v_ws uuid;
  v_product uuid;
  v_existing record;
  v_outcome text;
  v_nodes int;
  v_edges int;
  v_out jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_graphs) <> 'array' then raise exception 'ZEVIR_BAD_PAYLOAD: expected an array of graphs' using errcode = '22023'; end if;
  if jsonb_array_length(p_graphs) > 200 then raise exception 'ZEVIR_BATCH_TOO_LARGE: at most 200 graphs per call' using errcode = '22023'; end if;

  for g in select value from jsonb_array_elements(p_graphs) loop
    v_id := (g->>'id')::uuid;
    v_ws := (g->>'workspace_id')::uuid;
    v_product := nullif(g->>'product_id', '')::uuid;

    if v_product is not null and not exists (select 1 from public.engine_products p where p.id = v_product and p.workspace_id = v_ws) then
      raise exception 'ZEVIR_PRODUCT_WORKSPACE_MISMATCH: product % is not in workspace %', v_product, v_ws using errcode = '23514';
    end if;

    select id, workspace_id, graph_hash into v_existing from public.zevir_graphs where id = v_id for update;
    if found then
      if v_existing.workspace_id <> v_ws then
        raise exception 'ZEVIR_WORKSPACE_MISMATCH: graph % belongs to another workspace', v_id using errcode = '23514';
      end if;
      if v_existing.graph_hash = g->>'graph_hash' then
        v_out := v_out || jsonb_build_object('id', v_id, 'graph_key', g->>'graph_key', 'outcome', 'unchanged');
        continue;
      end if;
      if coalesce((g->>'require_superset')::boolean, false) and exists (
        select 1 from public.zevir_nodes n
        where n.graph_id = v_id
          and not exists (select 1 from jsonb_array_elements(g->'nodes') x where x->>'stable_key' = n.stable_key)
      ) then
        v_out := v_out || jsonb_build_object('id', v_id, 'graph_key', g->>'graph_key', 'outcome', 'conflict');
        continue;
      end if;
      v_outcome := 'replaced';
      delete from public.zevir_nodes where graph_id = v_id; -- cascades to edges and evidence
      delete from public.zevir_evidence_refs where graph_id = v_id;
      update public.zevir_graphs set
        project_id = nullif(g->>'project_id', '')::uuid,
        product_id = v_product,
        schema_version = g->>'schema_version',
        adapter_version = g->>'adapter_version',
        source_version = g->>'source_version',
        source_trace_id = g->>'source_trace_id',
        root_node_id = nullif(g->>'root_node_id', '')::uuid,
        status = g->>'status',
        node_count = jsonb_array_length(g->'nodes'),
        edge_count = jsonb_array_length(g->'edges'),
        graph_hash = g->>'graph_hash',
        completeness = coalesce(g->'completeness', '{}'::jsonb),
        summary = coalesce(g->'summary', '{}'::jsonb),
        capture_started_at = (g->>'capture_started_at')::timestamptz,
        capture_ended_at = (g->>'capture_ended_at')::timestamptz,
        ingest_run_id = nullif(g->>'ingest_run_id', '')::uuid,
        updated_at = now()
      where id = v_id;
    else
      v_outcome := 'created';
      insert into public.zevir_graphs (id, workspace_id, project_id, product_id, schema_version, adapter_version, source_kind, source_version, graph_key, source_trace_id, root_node_id, status, node_count, edge_count, graph_hash, completeness, summary, capture_started_at, capture_ended_at, ingest_run_id)
      values (v_id, v_ws, nullif(g->>'project_id', '')::uuid, v_product, g->>'schema_version', g->>'adapter_version', g->>'source_kind', g->>'source_version', g->>'graph_key', g->>'source_trace_id', nullif(g->>'root_node_id', '')::uuid, g->>'status', jsonb_array_length(g->'nodes'), jsonb_array_length(g->'edges'), g->>'graph_hash', coalesce(g->'completeness', '{}'::jsonb), coalesce(g->'summary', '{}'::jsonb), (g->>'capture_started_at')::timestamptz, (g->>'capture_ended_at')::timestamptz, nullif(g->>'ingest_run_id', '')::uuid);
    end if;

    insert into public.zevir_nodes (id, graph_id, workspace_id, stable_key, kind, name, operation, started_at, ended_at, duration_ms, status, cost_usd, cost_source, latency_ms, ttft_ms, input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, task_success, trust_class, data_sensitivity, action_risk, attributes)
    select x.id, v_id, v_ws, x.stable_key, x.kind, x.name, x.operation, x.started_at, x.ended_at, x.duration_ms, x.status, x.cost_usd, x.cost_source, x.latency_ms, x.ttft_ms, x.input_tokens, x.output_tokens, x.cached_input_tokens, x.reasoning_tokens, x.task_success, x.trust_class, x.data_sensitivity, x.action_risk, coalesce(x.attributes, '{}'::jsonb)
    from jsonb_to_recordset(g->'nodes') as x(id uuid, stable_key text, kind text, name text, operation text, started_at timestamptz, ended_at timestamptz, duration_ms double precision, status text, cost_usd double precision, cost_source text, latency_ms double precision, ttft_ms double precision, input_tokens integer, output_tokens integer, cached_input_tokens integer, reasoning_tokens integer, task_success double precision, trust_class text, data_sensitivity text, action_risk text, attributes jsonb);

    insert into public.zevir_edges (id, graph_id, workspace_id, source_node_id, target_node_id, kind, ordinal, attributes)
    select x.id, v_id, v_ws, x.source_node_id, x.target_node_id, x.kind, x.ordinal, coalesce(x.attributes, '{}'::jsonb)
    from jsonb_to_recordset(g->'edges') as x(id uuid, source_node_id uuid, target_node_id uuid, kind text, ordinal integer, attributes jsonb);

    insert into public.zevir_evidence_refs (id, graph_id, node_id, workspace_id, source_kind, source_id, source_trace_id, source_span_id, source_hash, adapter_version, schema_version, locator, content_hash, redaction_state, captured_at)
    select x.id, v_id, x.node_id, v_ws, x.source_kind, x.source_id, x.source_trace_id, x.source_span_id, x.source_hash, x.adapter_version, x.schema_version, coalesce(x.locator, '{}'::jsonb), x.content_hash, x.redaction_state, x.captured_at
    from jsonb_to_recordset(g->'evidence') as x(id uuid, node_id uuid, source_kind text, source_id text, source_trace_id text, source_span_id text, source_hash text, adapter_version text, schema_version text, locator jsonb, content_hash text, redaction_state text, captured_at timestamptz);

    -- Invariants the database can check by itself.
    select count(*) into v_nodes from public.zevir_nodes where graph_id = v_id;
    select count(*) into v_edges from public.zevir_edges where graph_id = v_id;
    if v_nodes <> jsonb_array_length(g->'nodes') or v_edges <> jsonb_array_length(g->'edges') then
      raise exception 'ZEVIR_COUNT_MISMATCH: graph % stored % nodes / % edges', v_id, v_nodes, v_edges using errcode = '23514';
    end if;
    if exists (select 1 from public.zevir_nodes n where n.graph_id = v_id and not exists (select 1 from public.zevir_evidence_refs e where e.graph_id = v_id and e.node_id = n.id)) then
      raise exception 'ZEVIR_PROVENANCE_MISSING: every node of graph % needs an evidence reference', v_id using errcode = '23514';
    end if;
    if (g->>'root_node_id') is not null and not exists (select 1 from public.zevir_nodes n where n.graph_id = v_id and n.id = (g->>'root_node_id')::uuid) then
      raise exception 'ZEVIR_ROOT_MISSING: root node of graph % is not in the graph', v_id using errcode = '23514';
    end if;

    v_out := v_out || jsonb_build_object('id', v_id, 'graph_key', g->>'graph_key', 'outcome', v_outcome);
  end loop;
  return v_out;
end;
$$;

-- Removes engine projections whose source trace no longer exists.
create or replace function public.zevir_prune_graphs(p_workspace_id uuid, p_product_id uuid, p_source_kind text, p_keep jsonb)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare n integer;
begin
  if jsonb_typeof(p_keep) <> 'array' then raise exception 'ZEVIR_BAD_PAYLOAD: p_keep must be an array' using errcode = '22023'; end if;
  delete from public.zevir_graphs g
  where g.workspace_id = p_workspace_id and g.product_id = p_product_id and g.source_kind = p_source_kind
    and not exists (select 1 from jsonb_array_elements_text(p_keep) k where k.value::uuid = g.id);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Bounded neighborhood around one node. Depth ≤ 6, at most 500 nodes. When the
-- neighborhood is larger than p_max_nodes it reports overflow instead of
-- returning a silently truncated subgraph. Loops are allowed (no DAG rule).
create or replace function public.zevir_neighborhood(p_graph_id uuid, p_node_id uuid, p_depth integer, p_max_nodes integer, p_direction text default 'both')
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
  v_total integer;
begin
  if p_depth is null or p_depth < 0 or p_depth > 6 then raise exception 'ZEVIR_DEPTH_LIMIT: depth must be between 0 and 6' using errcode = '22023'; end if;
  if p_max_nodes is null or p_max_nodes < 1 or p_max_nodes > 500 then raise exception 'ZEVIR_NODE_LIMIT: max_nodes must be between 1 and 500' using errcode = '22023'; end if;
  if p_direction not in ('in', 'out', 'both') then raise exception 'ZEVIR_DIRECTION: direction must be in, out or both' using errcode = '22023'; end if;
  if not exists (select 1 from public.zevir_nodes where graph_id = p_graph_id and id = p_node_id) then
    return jsonb_build_object('found', false);
  end if;

  with recursive walk(node_id, depth) as (
    select p_node_id, 0
    union
    select case when e.source_node_id = w.node_id then e.target_node_id else e.source_node_id end, w.depth + 1
    from walk w
    join public.zevir_edges e on e.graph_id = p_graph_id
      and ((p_direction in ('out', 'both') and e.source_node_id = w.node_id)
        or (p_direction in ('in', 'both') and e.target_node_id = w.node_id))
    where w.depth < p_depth
  ), reached as (
    select node_id, min(depth) as depth from walk group by node_id
  )
  select array_agg(node_id order by depth, node_id), count(*) into v_ids, v_total from reached;

  if v_total > p_max_nodes then
    return jsonb_build_object('found', true, 'overflow', true, 'reached', v_total, 'max_nodes', p_max_nodes, 'depth', p_depth);
  end if;

  return jsonb_build_object(
    'found', true,
    'overflow', false,
    'depth', p_depth,
    'nodes', coalesce((select jsonb_agg(to_jsonb(n) order by array_position(v_ids, n.id)) from public.zevir_nodes n where n.graph_id = p_graph_id and n.id = any(v_ids)), '[]'::jsonb),
    'edges', coalesce((select jsonb_agg(to_jsonb(e) order by e.source_node_id, e.kind, e.target_node_id) from public.zevir_edges e where e.graph_id = p_graph_id and e.source_node_id = any(v_ids) and e.target_node_id = any(v_ids)), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.zevir_persist_graphs(jsonb) from public, anon, authenticated;
revoke all on function public.zevir_prune_graphs(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.zevir_neighborhood(uuid, uuid, integer, integer, text) from public, anon, authenticated;
grant execute on function public.zevir_persist_graphs(jsonb) to service_role;
grant execute on function public.zevir_prune_graphs(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.zevir_neighborhood(uuid, uuid, integer, integer, text) to service_role;

-- ------------------------------------------------------------- feature flag
insert into public.feature_flags (key, description, enabled)
values ('zevir_shadow', 'ZevIR shadow mode: project engine and external traces into canonical execution graphs. Observe-only; changes no decision.', false)
on conflict (key) do nothing;
