# Local Serving-Cost Methodology

DUREM runs a local inference runtime. It has **no per-token public-cloud API price**, so no
per-token price is invented, imported, or implied anywhere in this evaluation. ZEVQORA's existing
`PricingSnapshot` path is **not used** for DUREM.

---

## 1. Raw measurements (recorded unconditionally, independent of any cost model)

These are facts about the run. They are recorded whether or not a dollar figure is ever computed, and
they are what the evaluation falls back to when economic inputs are unavailable.

| # | Measurement | Unit | Source |
|---|---|---|---|
| M1 | LLM chat calls | count / request | instrumented counter |
| M2 | Embedding calls | count / request | instrumented counter |
| M3 | Prompt (input) tokens | tokens / call | runtime `usage`, **if exposed** |
| M4 | Output tokens | tokens / call | runtime `usage`, **if exposed** |
| M5 | Inference runtime | seconds / call | wall time around the HTTP call to the runtime |
| M6 | End-to-end request latency | ms / request | existing `AssistantResponse.latency_ms` |
| M7 | CPU / GPU / NPU utilization | % | host sampler, **if measurable** |
| M8 | Power draw | W | wall meter or platform counter, **if measurable** |
| M9 | Model and runtime identity | string | `/v1/models` plus the recorded Lemonade version |

M3, M4, M7 and M8 are marked conditional deliberately. If the runtime does not report a `usage` block,
or the host exposes no power telemetry, the corresponding value is recorded as **`null` meaning
"not reported"** — never as `0`. This mirrors the rule already enforced in
`app/providers/models.py`, where `input_tokens` is nullable precisely so an unmeasured call cannot be
priced as free.

### 1.1 M5 is not M6

`AssistantResponse.latency_ms` measures the whole request: SQLite conversation and history reads,
retrieval scoring over every candidate row, JSON serialization, and message writes, as well as
inference. Treating it as inference time would let a candidate that merely made a database query
faster appear to have reduced model work.

M5 is therefore measured **separately**, as the summed wall time of the HTTP calls to the runtime.
The primary metric is built on M5. M6 is recorded and gated (it is what a user actually feels) but is
not the cost basis.

---

## 2. The explicit local serving-cost model

Used **only** when all four inputs below are supplied by the operator. None is estimated, defaulted,
or inferred.

```
energy_cost           = incremental_kW * runtime_hours * electricity_price_per_kWh

hardware_amortization = (hardware_cost / documented_useful_compute_hours) * runtime_hours

local_serving_cost    = energy_cost + hardware_amortization
```

### 2.1 Required inputs

| Input | Symbol | Must be supplied as | Recorded as |
|---|---|---|---|
| Incremental power draw under inference load, above host idle | `incremental_kW` | a measurement, with the method stated | assumption |
| Electricity price | `electricity_price_per_kWh` | the operator's actual tariff, currency stated | assumption |
| Hardware acquisition cost | `hardware_cost` | purchase price, currency stated | assumption |
| Documented useful compute hours | `documented_useful_compute_hours` | with the depreciation basis stated | assumption |

Every one of these is published in the evidence pack as a **stated assumption**, with its value, its
source, and its units. A reviewer who disagrees with any of them can recompute the result, because
`runtime_hours` — the measured quantity — is published separately from the constants.

### 2.2 `incremental_kW`, not total draw

Energy is charged against the **increment over host idle**, not the machine's total draw. A local-first
deployment runs the host regardless; the assistant's marginal cost is the additional power its
inference causes. Using total draw would attribute the whole machine's baseload to DUREM and inflate
every figure, including the savings.

### 2.3 The linearity proviso — and why it must be tested, not assumed

Both terms are linear in `runtime_hours`, so:

```
local_serving_cost = runtime_hours * (incremental_kW * electricity_price
                                      + hardware_cost / useful_compute_hours)
                   = runtime_hours * k
```

If `k` is identical across the baseline and candidate arms, then

```
reduction in local_serving_cost  ==  reduction in runtime_hours
```

and the percentage is independent of all four economic constants. That is a strong result: it means
the headline percentage does not depend on the operator's electricity tariff or purchase price.

**But `k` is constant only if `incremental_kW` is unchanged between arms.** It is not automatically
unchanged. `incremental_kW` can differ if a candidate:

- substitutes a different model or quantization with a different memory and compute profile;
- shifts work between CPU, GPU and NPU;
- changes batch or concurrency behaviour, altering utilization at a given wall-clock second;
- replaces generation with retrieval or cache lookups that draw materially less power per second.

The last one is the common case, and it makes the runtime proxy **conservative**: work replaced by a
cheap lookup draws less power per second than generation, so a runtime-based percentage understates
the true energy saving rather than overstating it.

**Rule for this evaluation:** any candidate that changes the model, the quantization, or the
accelerator path **invalidates the linearity proviso**. For such a candidate, either `incremental_kW`
is re-measured on both arms, or the result is reported as a runtime reduction only, with no
serving-cost percentage. This is decided by the nature of the candidate, not by the size of its
result.

---

## 3. Fallback metric — `COMPUTE COST PROXY / RUNTIME REDUCTION`

When the four inputs in 2.1 are unavailable — which is the state at preparation time — **no dollar
figure is produced and none is estimated.**

The reported metric is:

```
PRIMARY   compute_cost_proxy = total inference runtime seconds (sum of M5 across the replay set)
```

reported as a percentage reduction, with these supporting counters reported alongside and never
merged into it:

```
SUPPORTING  total LLM chat calls        (M1)
SUPPORTING  total embedding calls       (M2)
SUPPORTING  total prompt tokens         (M3, if exposed)
SUPPORTING  total output tokens         (M4, if exposed)
SUPPORTING  mean / p95 request latency  (M6)
```

The claim language for this metric is a reduction in *the defined local serving-cost/compute metric*,
never a dollar saving and never a cost percentage attributed to money.

### 3.1 If runtime cannot be measured representatively

Under option (C) of `PREREGISTRATION.md` section 4 — no adequate measurement host — M5 is
**unusable**, because a swap-bound host measures its storage subsystem rather than the model. In that
case the primary metric degrades further, to runtime-independent counters only:

```
PRIMARY   work_avoided = total LLM chat calls + total embedding calls   (M1 + M2)
```

reported per request and in total, with token counts as support. This is a defensible *work-avoided*
result. It is **not** a serving-cost result and must never be presented as one, and the latency gate
becomes informational (`PREREGISTRATION.md` section 6.1).

---

## 4. Representing this inside ZEVQORA without laundering units

`ARCHITECTURE_INSPECTION.md` section 3.2 records the hazard: `evaluate_gates()` compares
`baseline_cost` and `candidate_cost` as bare floats and would happily compare seconds, while
`Trace.cost_usd`, `EconomicsOut.observed_cost_usd` and `Experiment.verified_savings_usd` all assert
dollars.

**Writing runtime seconds into a `*_usd` field is forbidden.** It would reproduce the exact defect
this repository already fixed in `be36506`, where unmeasured model calls were priced as `$0.00`, and
it would make `verified_savings_usd` a number that looks like money and is not.

The required shape of the eventual change, to be reviewed on its own before implementation:

1. **A new `CostSource` member** — `LOCAL_SERVING_MODEL` — distinguishing a locally-modelled serving
   cost from a provider-reported dollar, a snapshot estimate, and an imported external figure.
2. **A named unit on the metric.** The compute metric carries its unit (`seconds`, `calls`) explicitly
   rather than inheriting the `_usd` suffix by position.
3. **A local cost model object** holding the four assumptions of section 2.1, versioned and hashed the
   way `PricingSnapshot` is, and **refusing to produce a figure when any input is absent** — the same
   contract as `PricingSnapshot.estimate_cost()` raising `PricingUnavailableError` rather than
   defaulting to zero.
4. **`verified_savings_usd` stays `None`** for this evidence identity for as long as the fallback
   metric is in use. A runtime reduction is not a dollar saving, and the field that means dollars
   must stay empty until dollars are actually computed.

None of this is implemented yet. It is specified here so that the cost representation is reviewed
before it is built, rather than discovered afterwards inside a result.

---

## 5. Statistical treatment

- The replay set is executed **3 times** per arm (`n_repeats = 3`, `PREREGISTRATION.md` section 8).
- The point estimate is the reduction computed on the **summed** metric across the full replay set,
  using the per-repeat means for each case.
- Uncertainty is reported across repeats. With `n = 3` a normal-theory confidence interval is not
  credible, so the reported interval is the **observed range across the three repeats** (min, max),
  labelled as such — not a CI, and not dressed up as one.
- Per-category reductions are reported separately and are **descriptive**. A per-category figure is
  not promoted to a headline claim, since the set was not powered for per-category inference.
- The exact sample count (60), the workload distribution (`REPLAY_SET_DESIGN.md` section 3), and
  whether that distribution was measured or assumed are reported with every figure.
- Cases flagged **non-deterministic** are listed, and their contribution to the aggregate is reported
  both included and excluded, so a reviewer can see whether the result depends on them.
