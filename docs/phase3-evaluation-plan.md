# Phase 3 — Evaluation & verification plan

Branch: `nero/backend-v0.2-proof-engine`  
Depends on: Phase 2 CandidatePlan / CandidateExecution + real provider proof

## 1. Current legacy `run_experiment` behavior

`app/experiments/service.py` still evaluates **pre-filled** Trace fields:

- `expected_output`
- `candidate_output` / `candidate_cost_usd` / optional `candidate_latency_ms`
- baseline `cost_usd` / `output_text`

It may emit Experiment `status=VERIFIED` without any `CandidateExecution`.

Internal label: **`LEGACY_CANDIDATE_EVIDENCE`** (`execution_proven=false`).

## 2. How manual/imported candidate_* reaches VERIFIED today

1. Import JSONL / API with `candidate_*` populated (`imported_external` cost provenance).
2. Call `POST .../experiments/run`.
3. If gates pass → Experiment VERIFIED.
4. `prepare_implementation` currently accepts **any** Experiment with `status=VERIFIED`.

This is the credibility hole Phase 3 closes.

## 3. How CandidateExecution differs

Phase 2 produces measured samples with:

- `execution_proven=true`
- task / config fingerprints
- provider usage, cost_source, latency, provider_request_id
- immutable baseline_evidence_hash in execution identity

CandidateExecution never self-marks VERIFIED.

## 4. Authoritative Phase 3 verification flow

```
CandidateExecution (SUCCEEDED, execution-proven)
  → EvaluationRun + EvaluationCaseResult
  → deterministic graders (baseline + candidate vs same case spec)
  → verification gates v2
  → VERIFIED | REJECTED | INCOMPLETE | FAILED
```

Only **`EvaluationRun.status == VERIFIED`** with `verification_source=EXECUTION_EVALUATION` and `execution_proven=true` is authoritative proof.

Optional compatibility: project a linked Experiment row for UI, carrying `evaluation_run_id` + provenance flags. Authoritative truth remains EvaluationRun.

## 5. Compatibility for old experiment APIs

- Keep `POST/GET .../experiments*` for desktop compatibility.
- Legacy runs remain readable and may still write Experiment rows labeled `LEGACY_CANDIDATE_EVIDENCE`.
- Legacy VERIFIED **must not** unlock implementation preparation.

## 6. Implementation eligibility (breaking semantic strengthen)

`prepare_implementation` requires:

1. Linked authoritative EvaluationRun with `status=VERIFIED`
2. Linked SUCCEEDED CandidateExecution
3. `execution_proven=true`
4. Matching product / finding / plan provenance
5. Existing safe static-scan target + git rules

Error if only legacy Experiment VERIFIED exists:

> Legacy verification is not execution-proven and must be re-run through CandidateExecution + Evaluation.

## Gate / status semantics (summary)

| Status | Meaning |
|--------|---------|
| INCOMPLETE | Required evidence missing / sample count insufficient |
| REJECTED | Complete evidence, one or more required gates failed |
| FAILED | Evaluator system error |
| VERIFIED | All required gates passed on execution-proven evidence |

Missing evidence never passes. Unknown cost ≠ 0.
