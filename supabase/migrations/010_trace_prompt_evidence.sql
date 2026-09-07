-- Baseline prompt evidence.
--
-- A replay is only a fair comparison if the candidate is asked the same
-- question the baseline was asked. Before this, only `input_text` was stored,
-- so a model-substitution replay sent the bare input with no instructions and
-- was graded for the wrong reason. These columns record the request that
-- produced `output_text` so it can be replayed verbatim.

alter table public.engine_traces
  add column if not exists system_prompt text,
  add column if not exists messages jsonb,
  add column if not exists system_prompt_hash text;

comment on column public.engine_traces.system_prompt is
  'System/developer instructions that produced output_text. Replayed verbatim; never inferred.';
comment on column public.engine_traces.messages is
  'The recorded request as an OpenAI-shaped message array, when the exporter provides one.';
comment on column public.engine_traces.system_prompt_hash is
  'sha256 of system_prompt. Part of task identity, so traces with different instructions never merge.';
