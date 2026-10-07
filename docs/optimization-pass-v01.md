# OptimizationPass v0.1

Code: `api/_lib/optimize/passes.js`. A pass turns one diagnosis into at most three
candidate plans, deterministically. Candidates are `engine_plans` rows with
lineage columns (017); there is no parallel plan system.

## Interface

```js
{
  id, version,
  applicability(diagnosis, ctx)     // { applicable, reasons }
  requiredEvidence(diagnosis, ctx)  // [{ key, present, detail }] — any missing ⇒ no candidate
  propose(diagnosis, ctx)           // engine_plans-shaped drafts
  expectedEffects(draft, diagnosis) // projected direction per metric, never a verified number
  riskClass(draft, diagnosis)
  protectedSlices(diagnosis, ctx)
  falsifier(draft, diagnosis)
  rollback(draft)
  materializerHints(draft)          // what a code change would touch
}
```

`generateCandidates(diagnoses, ctx)` runs each diagnosis's suggested passes,
records skipped passes with reasons, and stamps every candidate with:
`diagnosis_hash`, `optimization_pass`, `pass_version`, `contract_hash`,
`baseline_snapshot_id`, `executable_status`, `candidate_config_hash`
(sha256 of pass + version + diagnosis hash + contract hash + snapshot hash +
plan config), and `lineage` {expected effects, required evidence, protected
slices, falsifier, rollback, materializer hints, not-executable reason,
label `NOT VERIFIED — candidate only`}. Same evidence ⇒ same hash; a run stores
each hash once (unique index).

## Passes

| Pass | From | Candidate | Executable today |
|---|---|---|---|
| `redundant_call` | redundant_call | `exact_reuse` plan (existing `planExactReuse`, scoped to the diagnosis) | **Yes** — deterministic, no provider call |
| `model_provider` | model_overprovisioning | `model_substitution` to the cheaper candidate (existing `planModelSubstitution`); refused if the contract forbids the model/provider or no replayable non-protected samples exist | **Yes when platform compute is configured** (OpenRouter + `cloud_replay`); otherwise `NOT_EXECUTABLE` |
| `retry_amplification` | retry_amplification | `retry_policy` (cap attempts, non-retryable classes, jittered backoff) | `NEEDS_IMPLEMENTATION` |
| `context_memory` | context_amplification | `prompt_cache` (stable prefix) and/or `context_window_cap` | `NEEDS_IMPLEMENTATION` |

## Executability is enforced, not advisory

- A non-executable candidate is stored `status = 'BLOCKED'`; a DB CHECK forbids
  `executable_status <> 'EXECUTABLE'` with any other status.
- The run replay refuses it (`CANDIDATE_NOT_EXECUTABLE`) and the engine's own
  execute route refuses it (`PLAN_BLOCKED`). Tested: no execution row is created.
- Nothing is simulated: a candidate the engine cannot run has no verdict.
