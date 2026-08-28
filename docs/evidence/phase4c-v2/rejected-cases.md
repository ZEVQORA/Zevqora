# Phase 4C rejected-case diagnosis (sanitized)

> Internal dogfooding. Not external/customer evidence.

> Phase 4C measured 42.01% raw cost reduction, but the candidate was REJECTED by the configured verification gates. This is not verified savings.

## Authoritative rejection

- `evaluations.jsonl.rejection_reason`: `Failed gates: quality_floor`
- **Only failed gate:** `quality_floor`
- threshold: `0.95`
- measured: `0.87`
- reason: `candidate_quality=0.87; floor=0.95.`

All other gates passed (evidence_completeness, minimum_samples, non_inferiority, protected_slice, cost_improvement, latency_regression, fallback, execution_success).

## Cases with candidate_score < 1.0 (aggregate quality contributors)

Raw prompts/outputs are omitted. Only case IDs, scores, grader names, structured details, and route metadata are listed.

### `bnd-015` — BOUNDED_MODEL_REQUIRED

- baseline_score: `1.0`
- candidate_score: `0.0`
- failure_class: `candidate_capability`
- final_route: `cheap_bounded`
- cost_source: `provider_reported`
- resolved_model: `google/gemini-2.5-flash-lite`
- output_hash: `930e42d52bd8b7be59dd4b2c57eb82e8ef1558012f4ff6176b75d3935b03d9ea`
- grader `field_accuracy` v1.0.0: score=0.0 passed=False details=`{"error": "object_required"}`

### `cpx-002` — COMPLEX_MODEL_REQUIRED

- baseline_score: `0.0`
- candidate_score: `0.0`
- failure_class: `candidate_capability`
- final_route: `baseline_strong`
- cost_source: `provider_reported`
- resolved_model: `openai/gpt-4o-mini`
- output_hash: `1c34f88707b55e6104c4eb20e71ffa3d33e414b71ef689a15fad0640d0ac58cb`
- grader `classification` v1.0.0: score=0.0 passed=False details=`{"predicted": "verified", "expected": "incomplete", "strict": true}`

### `cpx-004` — COMPLEX_MODEL_REQUIRED

- baseline_score: `0.0`
- candidate_score: `0.0`
- failure_class: `candidate_capability`
- final_route: `baseline_strong`
- cost_source: `provider_reported`
- resolved_model: `openai/gpt-4o-mini`
- output_hash: `c0cbff04cc90f5b4cd53a53533285f7d741f24a5279f746b8370ad0f2c982f3e`
- grader `classification` v1.0.0: score=0.0 passed=False details=`{"predicted": "include", "expected": "exclude", "strict": true}`

### `cpx-005` — COMPLEX_MODEL_REQUIRED

- baseline_score: `0.5`
- candidate_score: `0.5`
- failure_class: `candidate_capability`
- final_route: `baseline_strong`
- cost_source: `provider_reported`
- resolved_model: `openai/gpt-4o-mini`
- output_hash: `78f07165057ce64f828d90e0d493f1f0fb1ac778d67d85b97359df69d3c4cc6d`
- grader `required_facts` v1.1.0: score=0.5 passed=False details=`{"found": ["internal dogfooding"], "missing": ["not customer proof"], "semantics": "1.1.0"}`

### `cpx-006` — COMPLEX_MODEL_REQUIRED

- baseline_score: `0.0`
- candidate_score: `0.0`
- failure_class: `candidate_capability`
- final_route: `baseline_strong`
- cost_source: `provider_reported`
- resolved_model: `openai/gpt-4o-mini`
- output_hash: `b1d8a366ca1df9e510253d0aadf198db33fdf53e9a5645f86e4b53d1675cf38c`
- grader `classification` v1.0.0: score=0.0 passed=False details=`{"predicted": "same_run", "expected": "new_run_identity", "strict": true}`

### `cpx-008` — COMPLEX_MODEL_REQUIRED

- baseline_score: `0.0`
- candidate_score: `0.0`
- failure_class: `candidate_capability`
- final_route: `baseline_strong`
- cost_source: `provider_reported`
- resolved_model: `openai/gpt-4o-mini`
- output_hash: `d90ee9ccf6bea1d2942a7b21319338198dec2a746f8a0d0771621f00da2e0864`
- grader `classification` v1.0.0: score=0.0 passed=False details=`{"predicted": "drop", "expected": "yes_prevents_verified", "strict": true}`

### `det-001` — DETERMINISTIC_ELIGIBLE

- baseline_score: `0.0`
- candidate_score: `0.0`
- failure_class: `evidence_issue`
- final_route: `deterministic`
- cost_source: `deterministic_no_provider`
- resolved_model: `None`
- output_hash: `ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d`
- grader `exact_match` v1.0.0: score=0.0 passed=False details=`{"mode": "text", "trim": true, "case_insensitive": false}`

