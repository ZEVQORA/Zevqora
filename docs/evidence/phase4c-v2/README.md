# Phase 4C — zev_dogfood_v2 evidence pack (sanitized)

## Classification

**Internal dogfooding. Not external/customer evidence.**

**Phase 4C measured 42.01% raw cost reduction, but the candidate was REJECTED by the configured verification gates. This is not verified savings.**

Do not cite this pack as VERIFIED savings, customer proof, or a passed quality claim.

## Authoritative rejection (exact)

| Field | Value |
|-------|-------|
| Failed gate | `quality_floor` (only failed gate) |
| Threshold | `0.95` |
| Measured | `0.87` |
| Reason | `candidate_quality=0.87; floor=0.95.` |
| `rejection_reason` | `Failed gates: quality_floor` |
| Protected / latency / execution | all **passed** |

Cases that contributed candidate scores &lt; 1.0 (see `rejected-cases.md`):

| Case | Cohort | Candidate score | Grader(s) | Failure class |
|------|--------|-----------------|-----------|---------------|
| det-001 | DETERMINISTIC_ELIGIBLE | 0.0 | exact_match | evidence_issue |
| bnd-015 | BOUNDED_MODEL_REQUIRED | 0.0 | field_accuracy | candidate_capability |
| cpx-002 | COMPLEX_MODEL_REQUIRED | 0.0 | classification | candidate_capability |
| cpx-004 | COMPLEX_MODEL_REQUIRED | 0.0 | classification | candidate_capability |
| cpx-005 | COMPLEX_MODEL_REQUIRED | 0.5 | required_facts | candidate_capability |
| cpx-006 | COMPLEX_MODEL_REQUIRED | 0.0 | classification | candidate_capability |
| cpx-008 | COMPLEX_MODEL_REQUIRED | 0.0 | classification | candidate_capability |

## Identity

| Key | Value |
|-----|-------|
| Benchmark run ID | `d5ff5d0f-99b5-468a-9bd6-3fd14faaf6df` |
| Evaluation run ID | `fef58cfc-f6b4-47a0-8031-a727e295eb91` |
| Candidate execution ID | `710fedc7-aa53-4cd0-b7e6-8d1e761edaf8` |
| Dataset | `zev_dogfood_v2` / `2.0.0` |
| Dataset hash | `b7db3921b8641a6b65883b4427852b50b2b3baccc95aa757eb440e0fcb1fafa7` |
| Git SHA (at run) | `b5b8854262558e226db265594caf3947ab95c890` |
| Benchmark version | `dogfood_v2` |
| Evidence hash | `3434d011f27e06d76c13c7e74fdc57f2e887ba12daa44e7fcb6b44641cfa1501` |
| Gate config hash | `bfaaf346596a1d1be345181b8d9bfa0591a638e053271ea5abcc7ff9cdb4cf98` |
| Grader config hash | `6b689ea082a80bd0cc8db1075e72c52a80076af2328ded8bac8fdac77debee7e` |
| Evaluation evidence version | `a8fcef1ce0576140179d119b8c161d1a99018b8a515995391724930ca9c62881` |

## Models / policy

| Role | Value |
|------|-------|
| Baseline | `openai/gpt-4o-mini` (model-first + hard safety) via OpenRouter |
| Candidate policy | `bounded_routing` / `bounded_routing_v1.1.0` |
| Tier 2 cheap | `google/gemini-2.5-flash-lite` |
| Tier 3 strong | `openai/gpt-4o-mini` |
| Pricing provenance | provider_reported costs on LLM paths; `deterministic_no_provider` on Tier 1 |

## Routing (final)

| Route | Count |
|-------|------:|
| deterministic | 20 |
| cheap_bounded | 15 |
| baseline_strong | 15 |
| fallback | 0 |

Provider call counts by model: `{'none/deterministic': 20, 'google/gemini-2.5-flash-lite': 15, 'openai/gpt-4o-mini': 15}`

## Cost (42.01% calculation)

```
baseline_total = 0.00098655
candidate_total = 0.0005721
absolute_reduction = baseline_total - candidate_total = 0.0004144500000000001
percent = absolute_reduction / baseline_total * 100 = 42.01
reported cost_savings_percent = 42.01
```

## Quality / protected / latency / execution

| Metric | Value |
|--------|-------|
| Baseline quality | 0.61 |
| Candidate quality | 0.87 |
| Quality delta | 0.26 |
| Non-inferiority | passed (candidate 0.87 ≥ baseline 0.61 − 0.0) |
| Protected pass rate | 1.0 |
| Latency gate | passed |
| Execution success | passed |

## Bootstrap (95%)

- mean cost diff CI: [-1.0603e-05, -6.066e-06]
- percent savings CI: [30.9364, 53.8638]

## Pack files

- `manifest.sanitized.json`
- `metrics.json`
- `gate-results.json`
- `rejected-cases.md`
- `checksums.sha256`

## Known limitations

- Internal dogfooding only; not customer or external validation.
- Status REJECTED: quality_floor failed; raw cost reduction is not verified savings.
- det-001 deterministic count mismatch (candidate output_hash recorded; expected 3, observed count 5) consistent with additive cross-case fixture seeding in shared product DB.
- Complex cohort quality 0.7; several classification/required_facts misses on both baseline and candidate.
- Model-first baseline fails deterministic exact-match by design.
- Stretch target 45% was not a gate and was not reached; not force-tuned.

## Immutability

This pack documents the existing full run `d5ff5d0f-99b5-468a-9bd6-3fd14faaf6df`. The raw local artifact under `desktop-app/backend/artifacts/benchmarks/d5ff5d0f-99b5-468a-9bd6-3fd14faaf6df/` remains gitignored and was not modified for this packaging step.
