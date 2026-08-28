# Candidate D — evidence pack (sanitized)

## Classification

**Internal dogfooding. Not external/customer evidence.**

Candidate D (`bounded_routing_v1.2.0`) on frozen `zev_dogfood_v2` is **VERIFIED**.

Measured raw cost reduction: **12.3196%** (not a 45% requirement).

Phase 4C REJECTED run `d5ff5d0f-99b5-468a-9bd6-3fd14faaf6df` remains immutable historical evidence.

## Identity

| Key | Value |
|-----|-------|
| Run ID | `c08c52f4-5f29-439c-8ea9-a15dc42058a5` |
| Evidence hash | `df38bfa239fa668feef717da26897de79789e16b3b65ef462253256fa22d5f4d` |
| Git SHA | `c3969e5453159ba7acbd36c5030c2416c070b021` |
| Dataset | zev_dogfood_v2 / 2.0.0 / `b7db3921b8641a6b65883b4427852b50b2b3baccc95aa757eb440e0fcb1fafa7` |
| Policy | bounded_routing_v1.2.0 |
| Baseline | `openai/gpt-4o-mini` |
| Cheap / strong | google/gemini-2.5-flash-lite / openai/gpt-4o-mini |

## Metrics

| Metric | Value |
|--------|-------|
| Status | **VERIFIED** |
| Baseline quality | 0.59 |
| Candidate quality | 0.97 |
| Quality delta | 0.38 |
| Quality floor (0.95) | PASS |
| Protected | 1.0 |
| Baseline cost | 0.00098055 |
| Candidate cost | 0.00085975 |
| Savings % | 12.3196 |
| Routes | {'deterministic': 20, 'cheap_bounded': 15, 'baseline_strong': 15} |
| Fallback | 0 |

## Cost calculation

```
(0.00098055 - 0.00085975) / 0.00098055 * 100 = 12.3196
```

## Bootstrap 95%

{
  "sufficient": true,
  "n": 50,
  "seed": 42,
  "resamples": 2000,
  "mean_cost_diff": -2.416e-06,
  "ci95_cost_diff_low": -6.926e-06,
  "ci95_cost_diff_high": 2.177e-06,
  "ci95_percent_savings_low": -11.0148,
  "ci95_percent_savings_high": 34.6365
}

## Gates

All required gates: see `gate-results.json`.

## Pack files

- PREREGISTRATION.md
- README.md (this file)
- manifest.sanitized.json
- metrics.json
- gate-results.json
- checksums.sha256
