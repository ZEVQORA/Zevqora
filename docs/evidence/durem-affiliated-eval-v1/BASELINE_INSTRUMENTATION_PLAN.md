# Baseline Instrumentation Plan

**Status:** plan only. **No instrumentation code has been written, and no DUREM branch has been
created.** This document is submitted for review before any code is added.

**Governing rule:** DUREM's behaviour must not change before the baseline is captured. Every probe
below is observation-only, and the argument for why is made per-probe in section 4.

---

## 1. What is missing today

From `ARCHITECTURE_INSPECTION.md` section 3:

| Gap | Consequence for measurement |
|---|---|
| 3.3 — `lemonade.py` discards the `usage` block | no prompt or output token counts (M3, M4) |
| 3.4 — `latency_ms` is whole-request wall time | no isolated inference runtime (M5); IO savings would be miscredited as inference savings |
| 3.5 — no call counters | LLM and embedding call counts (M1, M2) must be inferred from `method` and `route_method`, and the policy repair retry is invisible — `method == "llm"` for both the one-call and two-call paths |
| — | no retrieved-ID capture; only cited IDs survive into the response, so ACL and lifecycle leaks into the prompt are unobservable |

The last one matters most for safety. DUREM's `_normalize()` already intersects cited IDs with
retrieved IDs, so a restricted document that entered the prompt but was not cited would leave no trace
in the response. Gates G5, G7 and G8 need the retrieved set, or they test the citation filter instead
of the retrieval boundary.

---

## 2. Where the probes go

DUREM branch `nero/eval-instrumentation-v1`, from `7536b80f2d234f29f77870c70bab1da63c8ce306`.

| # | Probe | File | Mechanism |
|---|---|---|---|
| P1 | Per-call runtime record: model, endpoint, wall time, `usage` if present, HTTP status, attempt | `app/lemonade.py` — `chat()` | append a record to a context-local list around the existing HTTP call; return value unchanged |
| P2 | Per-call embedding record: model, wall time, input count, `usage` if present, success/failure | `app/lemonade.py` — `embeddings()` | same shape as P1 |
| P3 | Retrieved ID capture: rule IDs, chunk IDs, responsibility IDs, and document IDs behind the chunks | `app/retrieval.py` — after each of the three retrieval functions returns | read the returned dataclass lists; no query change |
| P4 | Context size: character and, where available, token length of the assembled policy prompt | `app/assistant_engine.py` — after `_policy_prompt()` | measure the returned string |
| P5 | Path markers: repair-retry fired, embedding degraded to lexical-only, classifier fallback taken, empty-response fallback taken | the existing `except` and fallback branches | set a flag in the context-local record inside branches that already exist |
| P6 | Route detail: `route`, `route_method`, `classifier_invoked`, `safety_override`, `confidence`, `signals` | already present on `AssistantResponse` | no code change; read from the response |
| P7 | Collector attach/detach and JSONL emission | new `app/eval_probe.py` | `contextvars.ContextVar` holding one record per request |

`AssistantResponse` is **not** extended. Adding fields would change the API contract, the persisted
`response_json`, and therefore `_previous_route()`'s input on subsequent turns. The collector writes
to a separate JSONL sink keyed by request ID.

---

## 3. Captured record (one per case execution)

```
case_id, repeat_index, request_id
route, route_method, classifier_invoked, safety_override, route_confidence, route_signals
method                         rule_engine | llm | chat_llm | safety_fallback | memory | mock
answer_type, decision, confidence
deterministic_rule_used        bool, and the rule ID if so
retrieval_invoked              bool
retrieved_rule_ids[]           P3
retrieved_chunk_ids[]          P3
retrieved_document_ids[]       P3
retrieved_responsibility_ids[] P3
cited_source_ids[]             from the response source cards
embedding_invoked              bool
embedding_succeeded            bool          <- P5; distinguishes a real skip from a silent failure
llm_calls[]                    per call: model, endpoint, wall_ms, prompt_tokens, output_tokens, http_status, attempt
llm_call_count                 M1
embedding_call_count           M2
prompt_tokens_total            M3, null if the runtime does not report usage
output_tokens_total            M4, null if the runtime does not report usage
inference_runtime_ms           M5, sum of llm_calls[].wall_ms plus embedding wall time
request_latency_ms             M6, the existing AssistantResponse.latency_ms
context_chars                  P4
repair_retry_fired             P5
embedding_degraded             P5
classifier_fallback            P5
empty_response_fallback        P5
error                          null, or the exception type and message
host_sample                    M7/M8 if available: CPU %, GPU %, package power, sampled around the call
```

`prompt_tokens_total` and `output_tokens_total` are `null` when the runtime reports no `usage` block.
They are never `0` — the distinction is the same one `app/providers/models.py` already enforces, and
collapsing it would let an unmeasured call be counted as free.

---

## 4. Behaviour-neutrality argument

Each probe must be neutral on its own; "it's just logging" is not an argument.

| Probe | Why behaviour is unchanged |
|---|---|
| P1, P2 | Reads fields already present on the parsed response object and the surrounding `perf_counter`. Return values, exceptions and control flow are untouched. `usage` is currently parsed and discarded; reading it adds no request field and does not alter the payload sent to the runtime. |
| P3 | Reads the dataclass lists the retrieval functions already return, after they return. No SQL, ordering, scoring, or limit changes. |
| P4 | Measures the length of a string that is already built and already sent. |
| P5 | Sets a boolean inside `except` and fallback branches that already exist and already produce their current outcome. No branch is added, removed, or reordered. |
| P6 | No code change. |
| P7 | A `ContextVar` write per call plus one JSONL append per request, both outside the model call. Cost is microseconds against a model call measured in seconds. |

### 4.1 Overhead is common-mode

The baseline and every candidate are both measured **with instrumentation present**. Any residual
overhead appears on both sides of the comparison and cancels in the percentage. The instrumentation
is never removed for one arm and kept for the other.

### 4.2 Proving neutrality before the baseline

Before the baseline is captured, on the instrumentation branch:

1. `pytest tests/` at the DUREM SHA, instrumented, must pass with results identical to the
   uninstrumented run. DUREM ships 565 lines of tests across `test_core`, `test_router_api`,
   `test_chat_mode`, `test_security` and `test_db`, including router-decision assertions.
2. A **differential replay**: the full 60-case set is executed against instrumented and uninstrumented
   builds in `DUREM_MOCK_MODE=true`, where the model is stubbed and both arms are fully deterministic.
   Every response field must be byte-identical. Mock mode is used **only** for this neutrality proof,
   never for measurement.
3. `git diff` against the frozen SHA is reviewed line by line and must touch only the files in
   section 2, adding no change to any conditional, threshold, prompt string, SQL statement, or return
   value.

If any of the three fails, the probe is redesigned. The baseline is not captured until all three pass.

---

## 5. Harness

A separate runner, in the ZEVQORA branch, that:

1. builds the frozen corpus into a scratch DUREM database (never the operator's real database);
2. creates the user fixtures;
3. executes each case through DUREM's public API in frozen order, seeding prior turns for `FOLLOWUP`
   cases so `_previous_route()` and `contextual_policy_query()` see real conversation state;
4. uses a **fresh conversation per case**, except `FOLLOWUP` cases, whose seed turns are part of the
   frozen case record — otherwise history bleed would make ordering significant and the run
   irreproducible;
5. collects the JSONL records from section 3;
6. repeats the whole pass 3 times;
7. emits ZEVQORA `TraceIn` records plus the raw per-case records.

### 5.1 Ordering and cache effects

Cases execute in frozen order in every repeat, so any warm-cache advantage falls identically on both
arms. A discard warm-up pass runs before repeat 1 and its measurements are dropped, so that first-load
model weights do not land in the baseline. Both facts are recorded in the run manifest.

---

## 6. Mapping into ZEVQORA

| ZEVQORA field | Source | Note |
|---|---|---|
| `request_id` | `case_id` + `repeat_index` | unique per `(product_id, request_id)`, so a re-import skips rather than duplicating |
| `symbol` / `workflow` | category code / `durem_policy` or `durem_chat` | |
| `provider` | `lemonade_local` | |
| `model` | `Qwen3-8B-GGUF` | from `/v1/models` |
| `input_tokens` / `output_tokens` | M3 / M4 | `null` when the runtime reports no usage |
| `latency_ms` | M6 | |
| `cost_usd` | **`null`** | there is no dollar cost; see `COST_METHODOLOGY.md` section 4 |
| `protected` | case `protected` flag | |
| `metadata` | the full section-3 record | including M5, M1, M2, and every path marker |

`cost_usd` stays `null` for the whole baseline. The compute metric travels in `metadata` under its own
explicit unit until the `LOCAL_SERVING_MODEL` cost source specified in `COST_METHODOLOGY.md` section 4
exists and has been reviewed.

---

## 7. Order of work, once the contract is frozen

1. Create `nero/eval-instrumentation-v1` on DUREM. Add P1–P7. Prove neutrality (4.2).
2. Build the corpus and the 60 cases. Hash both. Record the hashes in `PREREGISTRATION.md` section 14.
3. Freeze the preregistration. Commit. Record the freeze SHA.
4. Stand up the measurement host. Record Lemonade version, model files, quantization, and hardware.
5. Run the warm-up pass, discard it, then run 3 measured repeats.
6. Import into ZEVQORA under a new `product_id`. Finalize, so the traces become pinned.
7. **Stop and report the baseline before any diagnosis.**

Steps 4 and 2 are blocked on `PREREGISTRATION.md` sections 4 and 5 respectively.
