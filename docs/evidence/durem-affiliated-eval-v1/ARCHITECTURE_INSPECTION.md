# Phase A — Architecture Inspection (observed repo truth)

Inspection only. No code in either repository was modified to produce this document.

- **DUREM** read at `7536b80f2d234f29f77870c70bab1da63c8ce306` (verified: `git rev-parse HEAD` matches; `VERSION` = `2.2.0-rc1`)
- **ZEVQORA** read at `c34db54ba846d8182d1212c7819571cf41796640` (verified: matches `origin/main`)

---

## 1. DUREM — request lifecycle as actually implemented

Entry point is `app/assistant_engine.py::answer()`. The observed order of operations:

```
answer(request, user)
 |- _ensure_conversation()                     sqlite
 |- _load_history()                            sqlite, up to 48 messages
 |- handle_memory_command()                    -> short-circuits to CHAT, 0 LLM calls
 |- _previous_route(history)                   last assistant route
 |- route_question_hybrid(...)                 <- ROUTING DECISION
 \- _answer_chat(...) | _answer_policy(...)
```

### 1.1 Router — `app/assistant_router.py`

The router is a genuine two-stage hybrid. `_deterministic_decision()` runs first and, when it
returns a decision, **no model is invoked at all**:

| Condition | Route | `route_method` | LLM call |
|---|---|---|---|
| `mode` in `{can_i, how_to, who, policy}` | policy | `explicit` | no |
| `looks_like_policy_followup()` | policy | `followup` | no |
| `mode == chat` and `policy_score >= 5` or `company_authority_pair` | policy (**safety override**) | `deterministic` | no |
| `mode == chat` and (`policy_score == 0` or `chat_score >= 3`) | chat | `explicit` | no |
| `auto_routing_enabled != "1"` | policy | `fallback` | no |
| `policy_score >= 5` or `company_authority_pair` | policy | `deterministic` | no |
| `chat_score >= 2` and `policy_score <= 1` | chat | `deterministic` | no |
| `policy_score == 0` and `chat_score == 0` | chat | `deterministic` | no |
| **otherwise (ambiguous)** | falls through | `llm_classifier` | **yes, 1 call** |

Only the final ambiguous band reaches `LemonadeClient().chat(..., temperature=0.0, max_tokens=120)`.

Scoring in `analyze_route()` is a bilingual (Mongolian/English) keyword-and-regex scorer over four
lexicons: `_COMPANY_ANCHORS`, `_AUTHORITY_PATTERNS`, `_POLICY_NOUNS`, `_GENERAL_HELPERS`.

**The safety asymmetry is explicit and deliberate**, and must be preserved by any candidate:

- a classifier answering `chat` with `policy_score > 0` and `confidence < 0.72` is **upgraded to policy**;
- on classifier failure (`LemonadeError` / parse / validation), `policy_score >= 2` falls back to **policy**;
- the stated in-source rationale is that a false `policy` degrades safely to `NOT_FOUND`, whereas a
  false `chat` can fabricate organizational authority.

### 1.2 Policy path — `_answer_policy()`

```
retrieval_query = contextual_policy_query(...)       # folds in <=2 prior user turns on follow-ups
rules            = retrieve_rules(query, user)       # lexical only, <=8
chunks           = await retrieve_chunks(query,user) # lexical + optional embedding, <=6  <- 1 embedding call
responsibilities = retrieve_responsibilities(query)  # lexical only, <=4
 |
 |- _deterministic_numeric_rule(...)  -> RULE ENGINE, 0 LLM calls, method="rule_engine"
 |- no rules AND no chunks AND no resp -> NOT_FOUND,  0 LLM calls, method="safety_fallback"
 \- else                               -> chat_json(POLICY_SYSTEM_PROMPT, ...)  1 LLM call
      \- on schema failure             -> one repair retry                      +1 LLM call
           \- on second failure        -> NOT_FOUND, method="safety_fallback"
```

Notable: **the embedding call in `retrieve_chunks()` happens before the deterministic rule check**,
so an exact-threshold question that never reaches the LLM still pays one embedding.

### 1.3 Deterministic rule engine

`_deterministic_numeric_rule()` extracts `percent`, `mnt` (with Mongolian scale words for million and
thousand) and a generic `number` from the question, then selects active rules whose `metric` matches
and whose `[min,max]` band contains the value, honouring `min_inclusive` / `max_inclusive`. Highest
`(priority, score)` wins. It fires only for `decision_hint` in `{ALLOWED, DENIED, APPROVAL_REQUIRED}`
and only for `mode` in `{auto, chat, can_i, policy}`.

Bands in the demo seed are adjacent and half-open (`0-5` incl/incl, `5-10` excl/incl, `10+` excl) —
boundary values are therefore a real correctness surface and must be represented in the replay set.

### 1.4 Grounding and source validation — `_normalize()`

This is DUREM's strongest existing guarantee, and it is **already enforced deterministically in code**,
not by the model:

1. `answer_type == "CHAT"` on the policy path is rewritten to `NOT_FOUND`.
2. `source_*_ids` are **intersected with the IDs actually retrieved** — invented IDs are dropped.
3. If, after that filter, a non-`NOT_FOUND` answer has **no** surviving source, it is rewritten to `NOT_FOUND`.
4. `APPROVAL_REQUIRED` with an empty approver borrows the approver from a cited rule; if still empty, `NOT_FOUND`.
5. `answer_type != DECISION` forces `decision = NOT_FOUND`.

`_source_cards()` then re-resolves IDs against the retrieved maps, so a source card cannot exist for a
document that was not retrieved. Confidence is derived, not model-claimed: `NOT_FOUND` gives `unknown`,
any rule source gives `confirmed`, otherwise `partial`.

### 1.5 ACL and document lifecycle

Enforced in SQL, at retrieval time, in `app/retrieval.py`:

- `retrieve_chunks()` — `d.status='active'`, `effective_from <= date('now')`, `effective_to >= date('now')`,
  plus `_document_access_clause()`: admins see all, others see `visibility='all'` or a department match.
- `retrieve_rules()` — `r.active=1` plus the same document-lifecycle join, plus `_scope_matches()` on
  `role_scope` and `department_scope`.

**Consequence for this evaluation:** restricted or archived material is excluded *before* it can enter
the prompt. An ACL failure is therefore a leak into context, which is why the instrumentation plan
captures retrieved IDs and not only cited IDs (`BASELINE_INSTRUMENTATION_PLAN.md` section 3).

### 1.6 Local runtime client — `app/lemonade.py`

OpenAI-compatible HTTP against `LEMONADE_BASE_URL` (default `http://127.0.0.1:13305`), with
`trust_env=False` on every client (no proxy egress). `config.py::llm_endpoint_is_local` refuses
non-loopback / non-private endpoints and deliberately does not DNS-resolve hostnames.

Two calls exist: `chat()` to `/v1/chat/completions`, and `embeddings()` to `/v1/embeddings`.

**`DUREM_DISABLE_MODEL_THINKING=true` (the default)** appends a no-think directive to the last user
message when the model name contains `qwen3`. This materially affects output-token counts and must be
frozen as part of the configuration.

> **Measurement gap (see 3.3):** `chat()` returns only `data["choices"][0]["message"]["content"]`.
> The `usage` block is parsed and discarded. `embeddings()` likewise returns only vectors.
> **DUREM currently emits no token counts.**

---

## 2. ZEVQORA — evidence machinery as actually implemented

### 2.1 Evidence and trace model

`Trace` rows are the unit of baseline evidence (`app/evidence/service.py::import_traces`), keyed
uniquely by `(product_id, request_id)` — a re-POST skips rather than duplicates, so a 5-sample file
cannot satisfy a 10-sample gate.

`ReplayableRequestSnapshot` (`app/evidence/replay.py`, `capture_version="replay_v1"`) is the
provider-independent frozen request: messages, tools, temperature, max_tokens, response_format. It
excludes credentials and hashes canonically via `sha256_json`.

### 2.2 Cost provenance — the part that matters most here

`app/providers/models.py` is explicit that **unknown is not zero**:

- `LLMUsage.input_tokens` / `output_tokens` are **nullable on purpose**;
- `CostBreakdown.cost_usd` is `None` when unavailable, never a fake `0.0`;
- `PricingSnapshot.estimate_cost()` **raises `PricingUnavailableError`** if either token count is `None`;
- `resolve_cost()` distinguishes a provider-reported `$0.00` (explicit) from a placeholder zero.

`CostSource` currently admits `provider_reported`, `pricing_snapshot_estimate`, `imported_external`,
`deterministic_reuse`, and `deterministic_no_provider`. **There is no local-serving-cost member.**

### 2.3 Gates — `app/evals/gates.py`

Nine gates. `decide_status()`: any required `MISSING` gives `INCOMPLETE`; any required `FAILED` gives
`REJECTED`; otherwise `VERIFIED`.

| Gate | Required by default | Semantics |
|---|---|---|
| `evidence_completeness` | yes | all required evidence present |
| `minimum_samples` | yes | `sample_count >= min_samples` |
| `quality_floor` | yes | `candidate_quality >= quality_floor` |
| `non_inferiority` | yes | `candidate >= baseline - tolerance` |
| `protected_slice` | yes *(when cases exist)* | zero protected failures |
| `cost_improvement` | configurable | `candidate_cost < baseline_cost` (plus optional minimum %) |
| `latency_regression` | configurable | `candidate <= baseline * (1 + pct/100)` |
| `fallback` | configurable | plan declares fallback metadata |
| `execution_success` | yes | succeeded AND proven AND `case_errors == 0` |

`protected_slice` reports `INFORMATIONAL` — explicitly *not* an affirmative pass — when zero protected
cases were evaluated, unless `require_protected_cases=True` makes that `MISSING`.

Graders (`app/evals/graders.py`) are deterministic only — **no LLM judge**: `exact_match`,
`classification`, `json_schema`, `field_accuracy`, `required_facts`, `tool_selection`, `tool_arguments`.

### 2.4 Immutability

`app/evidence/protection.py` pins any `Trace` referenced by a finalized `EvaluationRun`
(`INCOMPLETE|VERIFIED|REJECTED|FAILED|CANCELLED`) or by a `CandidateExecution`; pinned traces are
refused rather than cascade-deleted. `app/evidence/canonical.py` selects exactly one canonical
VERIFIED run per `candidate_execution_id`, so re-evaluations cannot triple-count savings.

This machinery is what makes a frozen baseline meaningful, and it is why the baseline must be imported
and finalized **before** any candidate is generated.

---

## 3. Integration gaps between the two repositories

These are findings, not yet work. Each is a prerequisite for a measurable baseline.

### 3.1 ZEVQORA has no local-runtime provider

`app/providers/factory.py::get_provider()` resolves only `openrouter` and `mock`; anything else raises
`KeyError`. Executing against DUREM's Lemonade endpoint requires a new adapter implementing
`LLMProvider.complete()` over an OpenAI-compatible local base URL.

### 3.2 ZEVQORA's cost abstraction is USD-per-token only

`PricingSnapshot` prices `tokens * rate / 1e6`. DUREM has no per-token price, and there is no
`CostSource` member representing a local serving-cost model.

> **This must not be worked around by writing runtime seconds into a `*_usd` field.**
> The gate arithmetic in `evaluate_gates()` is unit-agnostic and would happily compare seconds, but
> `Trace.cost_usd`, `EconomicsOut.observed_cost_usd` and `verified_savings_usd` all assert dollars.
> Pushing a different unit through them is exactly the class of defect this repository already fixed in
> `be36506` (unmeasured calls priced as `$0.00`). The correct change is an explicit, separately-named
> local cost source — specified in `COST_METHODOLOGY.md` section 4.

### 3.3 DUREM discards token usage

`lemonade.py::chat()` and `embeddings()` drop the runtime's `usage` block. Prompt and output token
counts — items 3 and 4 of the required raw measurements — are currently unobtainable without a
behaviour-neutral instrumentation change on a separate DUREM branch.

### 3.4 DUREM has no per-call runtime timing

`AssistantResponse.latency_ms` is **end-to-end wall time for the whole request**
(`time.perf_counter()` in `answer()`), including SQLite reads and writes and retrieval scoring. It is
not the runtime's inference time. Attributing whole-request latency to the model would credit IO
savings as inference savings.

### 3.5 No LLM or embedding call counter exists

Call counts must be reconstructed today from `route_method`, `classifier_invoked` and `method`. There
is no direct counter, and the policy-path repair retry (a second LLM call) is not distinguishable in
`AssistantResponse` — `method` is `"llm"` for both the one-call and the two-call path.
