-- The ingest upsert targets (project_id, event_key). PostgREST cannot use a
-- partial unique index for ON CONFLICT inference, so the de-duplication key
-- becomes a full unique index. event_key is always populated by the API.
drop index if exists public.telemetry_events_key_uidx;
create unique index if not exists telemetry_events_key_uidx on public.telemetry_events(project_id, event_key);
