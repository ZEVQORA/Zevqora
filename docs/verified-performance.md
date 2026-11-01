# Verified Performance

What a workload's recorded evidence actually shows. Code:
`api/_lib/optimize/performance.js` (`performanceSnapshot`). Persisted per run in
`performance_snapshots` with a `snapshot_hash`.

## Rules

- Computed only from evidence present, over a bounded window (newest 5000 traces;
  truncation is reported as missing evidence).
- **Unknown stays unknown.** Missing cost is `null`, never $0. A known $0 (e.g. a
  rate-limited call that was not billed) is a known cost. Missing latency is
  `null`, never 0 ms. Missing task outcome is neither success nor failure.
- No projected or monthly figure exists in this layer.
- Deterministic: same evidence → same snapshot hash, independent of row order
  (sums are order-independent; percentiles are nearest-rank).

## Inputs and their meaning

| Concept | Source |
|---|---|
| Logical request | `metadata.logical_request_id` (or `request_group_id`); else the trace itself |
| Attempt number | `attempt` (≥1); attempts implied by a number but not recorded are counted as executed with **unknown** cost |
| Call error | `metadata.status = 'error'`, `metadata.error_type` / `error_category`; a recorded output means no error; neither → unknown |
| Task outcome | `metadata.task_success` / `metadata.outcome` (reported); else a deterministic grade of the recorded output against `expected_output` (existing graders — the evaluation boundary); else unknown |
| Quality | graded score (as above), else `metadata.quality_score`, else unknown |
| Fallback | `metadata.fallback` / `fallback_used`; field never present → unknown |
| Cost basis | `pricing_snapshot_estimate` → estimated; provider/imported → observed |

Raw output text is read only inside the graders; only scores leave the module.

## Formulas

- **Executed attempts** = Σ over requests of max(recorded rows, highest attempt number).
- **Cost coverage** = priced attempts / executed attempts.
- **Total known cost** = Σ known costs (a lower bound when coverage < 1).
- **Wasted attempt known cost** = Σ known cost of non-final attempts.
- **Cost per logical request** = mean cost of requests whose every attempt is priced,
  only if that share ≥ contract `cost.min_coverage`.
- **Cost per successful outcome (CPSO)**:
  population = requests with a known outcome **and** fully priced attempts;
  CPSO = Σ population cost / successes in population.
  Available only if outcome coverage (known-outcome / all requests) ≥ `evidence.min_outcome_coverage`,
  numerator coverage (population / known-outcome) ≥ `cost.min_coverage`, and successes > 0.
  Otherwise `null` with the exact reasons. Zero successes is "undefined", not ∞ or 0.
- **Percentiles** (nearest rank): sort ascending, value at rank ⌈p/100 · n⌉. Reported as
  p50/p95/p99 for request latency (sum of a request's attempts, only when all are timed
  and recorded), attempt latency, and TTFT. `low_evidence` when samples < `evidence.min_latency_samples`.
- **Reliability**: failure = the final attempt errored (execution failure; wrong answers are
  task-success facts). failure rate = failures / requests with known error status.
  retry rate = requests with >1 attempt / requests; retry amplification = executed attempts / requests.
  Timeouts / rate limits: one classified event per failed attempt (its own error, or the next
  attempt's `retry_reason` when the failed attempt was not recorded); `null` when there were
  failures or retries but nothing classified them.
- **Bad-day profile** (observed history, not simulation): p99/max request latency, worst
  attempts per request, five costliest and five slowest requests.
- **Evidence completeness**: for each `required_metrics` entry, a stated threshold; every
  shortfall is listed verbatim (e.g. `cost: coverage 35% < required 90%`).

## Evaluation (replay) metrics

`api/_lib/optimize/verdict.js` computes the same quantities on replayed cases for
baseline vs candidate: task success = cases where every grader passed / graded
cases; p50/p95 over case latencies; cost coverage per side; CPSO per side only with
full cost coverage and ≥1 success. These are **evaluated**, never realized.
