# Bad-Day Replay v0.1

Code: `api/_lib/optimize/badday.js`, run in `search-store.js#runBadDay`.
Tables: `bad_day_profiles`, `bad_day_results` (018).

A deterministic fault overlay on a VERIFIED plan's own full-replay results and
on the recorded baseline — inside the bounded replay system only. **No provider
call, no production traffic.** Label: `BAD-DAY REPLAY`. A simulation over
replayed cases is not a production guarantee, and the report says so.

## Profile

`{ version, scenario, parameters, scope: 'workload', seed, required_capabilities, profile_hash }`.
Parameters are validated against ranges; the hash is order-independent; the
same profile is stored once per product.

| Scenario | Parameters | Effect |
|---|---|---|
| PROVIDER_RATE_LIMIT | rate (0.2), retry_after_ms (500) | each provider attempt fails with probability `rate`; retries follow the workload's observed policy |
| PROVIDER_TIMEOUT | rate (0.1), timeout_ms (30 000) | a failed attempt costs `timeout_ms`; retries as above |
| MODEL_LATENCY_MULTIPLIER | multiplier (2) | provider-path latency × multiplier |
| CACHE_MISS | rate (1) | cache/lookup hits miss and fall through to the next path |
| TOOL_TIMEOUT, TOOL_ERROR, RETRIEVAL_SLOWDOWN | — | **UNSUPPORTED**: the harness does not replay tool calls or retrieval; nothing is simulated |

Draws: `sha256(seed, profile hash, case, attempt)` → [0, 1). Same profile, same bad day.

## Observed policy (never invented)

- retry ceiling = highest attempt number observed in the workload;
- cost and latency of a failed attempt = the mean of observed failed attempts
  of that class (rate-limit / timeout), else **unknown** — then the bad-day cost
  or p95 is unknown, not $0 / 0 ms;
- a CACHE_MISS that falls through to a substituted model whose answer was never
  produced in the normal replay has unknown outcome and cost.

## Verdict (separate from the normal verdict)

Gates on the plan's bad-day metrics under the same contract:
task-success floor, quality floor (failed requests score 0), latency (absolute
budget, or the regression limit against the **baseline under the same
scenario**), failure rate (contract maximum, or no worse than the baseline
under the same scenario), cost evidence. Same decision rule
(missing → INCOMPLETE, failed → REJECTED, else VERIFIED).

Output: normal vs bad-day vs baseline-bad-day cost, p95, task success, failure
rate, retry amplification, fallback usage, CPSO; and a statement such as
"Verified for the normal evaluation workload, but not resilient under provider
429 on 20% of attempts, retry after 500 ms: bad_day_task_success_floor failed.
The normal verdict is unchanged."

The normal verdict, plan status and frontier are never modified by a bad-day result.
