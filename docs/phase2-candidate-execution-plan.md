# Phase 2 — Candidate execution plan

Branch: `nero/backend-v0.2-proof-engine`  
Depends on: Phase 1 provider + telemetry + Alembic bootstrap

## A. What current Experiment assumes

`run_experiment` (`app/experiments/service.py`) assumes Trace rows already contain:

- `expected_output`
- baseline `output_text` / `cost_usd` / `latency_ms`
- **pre-filled** `candidate_output` / `candidate_cost_usd` / optional `candidate_latency_ms`

It compares those fields and may emit `VERIFIED` / `REJECTED` / `NEEDS_EVIDENCE`.

This path does **not** call a provider and does **not** execute an optimization strategy.

Internal label: **`LEGACY_CANDIDATE_EVIDENCE`** — not execution-proven.

## B. Where candidate_* fields are supplied today

1. **JSONL / API import** (`evidence/service.py` → `TraceIn.candidate_*`) — user/external evidence.
2. **Manual / scripted population** of Trace rows before calling `/experiments/run`.
3. No production path currently generates candidate fields via the Phase 1 provider layer.

Imported costs default to `cost_source=imported_external`.

## C. What Phase 2 must generate automatically

For each eligible Finding / evidence set:

1. **CandidatePlan** — deterministic strategy plan (exact_reuse or model_substitution).
2. **CandidateExecution** — measured run that produces:
   - candidate output
   - token usage (0 for exact reuse)
   - cost + `cost_source` + `pricing_version`
   - latency
   - provider request ID when a provider call occurred
   - provenance hashes linking baseline evidence → plan → execution

Strategies must **never** mark themselves VERIFIED. Phase 3 owns evaluation gates.

## D. Coexistence with legacy experiment API

- Keep `/experiments/run` unchanged for desktop compatibility.
- Document and label legacy results as `LEGACY_CANDIDATE_EVIDENCE` / `execution_proven=false`.
- Optional internal bridge can project a SUCCEEDED CandidateExecution into Trace `candidate_*` fields with `execution_proven=true` metadata — still **not** auto-VERIFIED.
- New APIs live under `/optimization/*` and are the source of truth for execution-proven candidate evidence.

## Phase 2 non-goals

- Eval framework v2 / VERIFIED savings claims
- Dogfood benchmark
- RAG / embeddings
- LLM-generated plans
- Unlimited or agent-invented paid model IDs
