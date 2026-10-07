-- Rollback for 016_zevir_part1.sql.
--
-- ZevIR Part 1 is shadow-only: nothing in the proof loop, billing or routing
-- reads these tables, so dropping them loses only derived projections (they
-- can be rebuilt from engine_traces with scripts/zevir-backfill.mjs) and
-- external ingest history.
--
-- Before running: turn the flag off (it is removed below anyway) and deploy a
-- build that no longer calls the ZevIR routes, or accept that they answer 500
-- until the code is rolled back too.

begin;

drop function if exists public.zevir_neighborhood(uuid, uuid, integer, integer, text);
drop function if exists public.zevir_prune_graphs(uuid, uuid, text, jsonb);
drop function if exists public.zevir_persist_graphs(jsonb);

drop table if exists public.zevir_evidence_refs;
drop table if exists public.zevir_edges;
drop table if exists public.zevir_nodes;
drop table if exists public.zevir_graphs;
drop table if exists public.zevir_ingest_runs;

delete from public.feature_flags where key = 'zevir_shadow';

commit;
