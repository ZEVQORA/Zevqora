# PREREGISTRATION — DUREM Affiliated Real-Workload Evaluation v1

**Evidence identity:** `durem-affiliated-eval-v1`
**Status:** `CONTRACT_DRAFT` — **not frozen.** Two items (4 and 5) are unresolved and require a
reviewer decision. Nothing in this document may be relied on as a preregistration until it is
frozen, committed, and its hash recorded in section 14.
**Prepared:** 2026-08-29

---

## 0. Evidence classification (mandatory, non-removable)

> **AFFILIATED REAL-WORKLOAD EVALUATION / AFFILIATED DESIGN-PARTNER PILOT.**
> Not independent customer proof. Not arm's-length customer validation. Not customer-verified
> savings. Not independent production validation.
>
> **Reason:** the ZEVQORA founder built the DUREM RAG system and has an existing family/company
> relationship with Sutainbuyant LLC.

---

## 1. Frozen repository identity

| Item | Value | Verified |
|---|---|---|
| DUREM repository | `https://github.com/BeBecpp/Durem_AI` | yes |
| DUREM commit SHA | `7536b80f2d234f29f77870c70bab1da63c8ce306` | `git rev-parse HEAD` matches |
| DUREM commit date | 2026-08-11 21:12:05 +0800 | `git log -1` |
| DUREM reported version | `2.2.0-rc1` | `VERSION` file and `config.Settings.version` agree |
| ZEVQORA repository | `https://github.com/ZEVQORA/Zevqora` | yes |
| ZEVQORA main SHA at start | `c34db54ba846d8182d1212c7819571cf41796640` | matches `origin/main` |
| ZEVQORA evaluation branch | `nero/durem-affiliated-eval-v1` | branched from the SHA above |
| DUREM instrumentation branch | *(to be created; see section 12)* | not yet created |

Neither `main` branch is modified by this work.

---

## 2. Frozen model and runtime configuration

Taken from `app/config.py` at the frozen SHA. Every value below is a **default** in the frozen
source; the baseline runs with these defaults except where the Replay Harness column states
otherwise, and any deviation is an explicit, listed override.

| # | Item | Frozen value | Source |
|---|---|---|---|
| 6 | Chat/generation model | `Qwen3-8B-GGUF` | `LEMONADE_MODEL` default |
| 6 | Embedding model | `Qwen3-Embedding-0.6B-GGUF` | `LEMONADE_EMBEDDING_MODEL` default |
| 7 | Quantization / model file | **UNRESOLVED — see section 5** | not pinned by the repo |
| 8 | `max_tokens`, answer path | `900` (`DUREM_LLM_MAX_TOKENS`) | `settings.llm_max_tokens` |
| 8 | `max_tokens`, router classifier | `120` (hard-coded) | `route_question_hybrid()` |
| 12 | Temperature, policy answer | `0.0` (via `chat_json`) | `LemonadeClient.chat_json` |
| 12 | Temperature, router classifier | `0.0` | `route_question_hybrid()` |
| 12 | Temperature, general chat | `0.55` | `_answer_chat()` |
| — | Thinking suppression | `DUREM_DISABLE_MODEL_THINKING=true` | appends a no-think directive for `qwen3` models |
| — | Runtime timeout | `240.0 s` | `LEMONADE_TIMEOUT_SECONDS` |
| — | Runtime base URL | `http://127.0.0.1:13305` | `LEMONADE_BASE_URL` |
| — | `DUREM_MOCK_MODE` | `false` | mock mode is **forbidden** for baseline capture |
| 5 | Lemonade version | **UNRESOLVED — see section 4** | not installed on the inspection host |

### 2.1 Frozen routing configuration (item 9)

Runtime settings rows, as seeded by `db.py::_seed()`:

| Setting | Frozen value | Effect |
|---|---|---|
| `auto_routing_enabled` | `1` | deterministic auto-routing active |
| `hybrid_router_enabled` | `1` | LLM classifier reachable for the ambiguous band |
| `general_chat_enabled` | `1` | chat path active |
| `chat_history_messages` | `16` | chat history window |
| `personal_memory_enabled` | `1` | memory commands short-circuit |
| `store_raw_chat_questions` | `0` | raw chat questions not persisted to audit |

Router lexicons (`_COMPANY_ANCHORS`, `_AUTHORITY_PATTERNS`, `_POLICY_NOUNS`, `_GENERAL_HELPERS`,
`_FOLLOWUP_MARKERS`) and all score thresholds are frozen exactly as they appear at the DUREM SHA.
Their content hash is recorded in section 14.

### 2.2 Frozen retrieval configuration (item 10)

| Parameter | Frozen value | Source |
|---|---|---|
| `retrieve_rules` limit | `8` | `retrieval.py` default |
| `retrieve_chunks` limit | `6` | `retrieval.py` default |
| `retrieve_responsibilities` limit | `4` | `retrieval.py` default |
| Hybrid score blend | `0.48 * lexical + 0.52 * semantic` when a query vector exists, else lexical only | `retrieve_chunks()` |
| Chunk score cut-off | `> 0.04` | `retrieve_chunks()` |
| Rule priority bonus | `min(0.15, priority / 10000)` | `retrieve_rules()` |
| Follow-up query fold-in | last 2 user turns, tail-truncated to 2200 chars | `contextual_policy_query()` |

### 2.3 Frozen embedding configuration (item 11)

| Parameter | Frozen value |
|---|---|
| `embeddings_enabled` | `1` |
| Embedding calls per policy request | exactly 1, for the query only (document chunk vectors are precomputed at ingest) |
| Vector comparison | `cosine`, clamped at 0 |
| Behaviour on embedding failure | `LemonadeError` is caught, `query_vector = None`, retrieval silently degrades to lexical-only |

> The last row is a **measurement hazard**, not a defect: an embedding failure silently reduces both
> cost and quality. The baseline must therefore record embedding success/failure per case
> (`BASELINE_INSTRUMENTATION_PLAN.md` section 3), or a candidate could "save" by breaking embeddings.

### 2.4 Frozen deterministic-rule configuration (item 13)

The rule engine's behaviour is defined jointly by `_deterministic_numeric_rule()` at the frozen SHA
**and** by the rule rows in the corpus. Both are frozen. The corpus rule set — IDs, metrics, bounds,
inclusivity flags, priorities, `decision_hint`, `approver` — is enumerated in the dataset manifest
and hashed in section 14.

Metric extraction is frozen as implemented: `percent`, `mnt` (with Mongolian million/thousand
scaling), and a generic `number` fallback.

---

## 3. Frozen dataset / replay-set identity (item 3)

| Item | Value |
|---|---|
| Replay set name | `durem_replay_v1` |
| Version | `1.0.0` |
| Case count | **60** (target; see `REPLAY_SET_DESIGN.md`) |
| Corpus | `durem_corpus_v1` — rules, documents, chunks, responsibilities, departments, roles, users |
| Content hash | **pending construction** — recorded in section 14 before any baseline run |
| Provenance | **UNRESOLVED — see section 5** |

Composition, category definitions, labelling rules and sanitization rules are specified in
`REPLAY_SET_DESIGN.md`. The distribution is frozen **before** any result is seen and is not
re-weighted afterwards.

---

## 4. UNRESOLVED — hardware identity (item 4) **[BLOCKER 1]**

Item 4 cannot be frozen, because the host this evaluation was prepared on cannot run the workload
at a representative operating point.

**Inspection host, as measured:**

| Property | Observed value |
|---|---|
| Machine | TOSHIBA dynabook Satellite T652/W4UGB |
| CPU | Intel Core i7-3630QM @ 2.40 GHz (Ivy Bridge, 2012) — 4 physical / 8 logical cores |
| RAM | 7.89 GB total |
| GPU | Intel HD Graphics 4000 (integrated, 2012) |
| OS | Windows 11 Pro 10.0.26200, build 26200 |
| Python | 3.13.14 |
| Lemonade runtime | **not installed** — absent from `PATH`; `127.0.0.1:13305` refuses connection on both `/api/v1/health` and `/v1/models` |

**Why this host is disqualified, not merely slow:**

1. **The runtime is absent.** No Lemonade server, so no version string, no model catalogue, and no
   quantization identity can be recorded. Items 5 and 7 depend on it.
2. **The accelerator target does not exist here.** Lemonade is AMD's local inference runtime; DUREM
   ships `setup-amd-windows.ps1` for it. This host has a 2012 Intel iGPU and no Ryzen AI NPU, so
   only a CPU path is available.
3. **Memory is below the working set.** Qwen3-8B at 4-bit is roughly 5 GB of weights, against 7.89 GB
   total system RAM shared with Windows 11 and the FastAPI process. Serving would be paging-bound.
4. **The measurement would describe the wrong thing.** The primary metric is inference runtime
   (`COST_METHODOLOGY.md`). On a swap-bound host, that number measures the storage subsystem, not the
   model. It would be neither reproducible nor transferable to the real deployment, and a candidate
   could appear to "save" simply by changing the paging pattern.

**Decision required.** One of:

- **(A)** Name the real Sutainbuyant deployment host, or an equivalent Ryzen AI machine, as the
  measurement host. Record its CPU / NPU / GPU / RAM / OS, Lemonade version, and model files. This is
  the only option that supports a deployment-representative claim.
- **(B)** Name any other host capable of serving Qwen3-8B at a usable rate, and state explicitly in
  every report that the measured runtime is from a **surrogate host**, not the production host.
- **(C)** Do not measure runtime at all. Restrict the evaluation to **runtime-independent counters**
  only — LLM call count, embedding call count, token counts, and the quality/safety gates. This
  yields a defensible *work-avoided* result with no timing or energy claim whatsoever.

Option (C) is the only one that can proceed on the current machine, and only if the DUREM stack can
be stood up against *some* reachable runtime. It cannot produce a serving-cost percentage.

---

## 5. UNRESOLVED — corpus and question provenance **[BLOCKER 2]**

DUREM's `data/` directory is empty at the frozen SHA (`.gitkeep` only). The only content in the
repository is a 5-rule demo seed behind `DUREM_DEMO_DATA`, covering vehicle use and sales discounts.
There is no captured traffic to replay.

Real Sutainbuyant content must not be committed to a public repository, and this preregistration does
not propose to. The open question is what the replay set is built from, and it determines the claim
language:

| Option | Corpus and questions | Strongest permissible phrase |
|---|---|---|
| **(R1)** | Sanitized real historical questions plus a sanitized real policy corpus, retained **locally only**, committed as hashes and category counts | *real-workload* |
| **(R2)** | Synthetic questions written to match the real workload's shape, over a synthetic corpus modelled on the real one | *representative-workload* |
| **(R3)** | The 5-rule demo seed only | not usable — too small, and it exercises no ACL, lifecycle, or NOT_FOUND surface |

**Decision required: R1 or R2.** Under R2 the phrase *"real-workload"* must be dropped from the final
report, including from the sentence in section 11.

A second, independent question rides on this: the **workload distribution** in
`REPLAY_SET_DESIGN.md` section 3 is currently an **assumption**, not a measurement. If DUREM audit
logs from the real deployment can supply observed category frequencies, the distribution should be
set from them and cited. If not, the report must state that the mix is assumed.

---

## 6. Frozen quality contract

Frozen **before** any candidate exists. These thresholds are not lowered afterwards for any reason.
A candidate that fails them is REJECTED and the rejection is published.

### 6.1 Gate configuration

`GateConfig` values for this evaluation:

```
min_samples                  = 60          # the full frozen replay set; no subset run may claim VERIFIED
quality_floor                = 0.95
non_inferiority_tolerance    = 0.0         # candidate quality must not fall below baseline at all
require_cost_improvement     = True
min_cost_improvement_pct     = 0.0         # any real reduction counts; no target is pre-committed
require_latency              = True
max_latency_regression_pct   = 20.0
require_fallback             = True
require_protected_cases      = True        # zero protected cases becomes INCOMPLETE, not a silent pass
latency_informational        = False
aggregation                  = "mean"
```

Under option (C) of section 4, `require_latency` becomes `False` and `latency_informational` becomes
`True`, and the cost gate is evaluated on runtime-independent counters only. That substitution must be
made **before** the baseline is frozen, never after a result is seen.

### 6.2 Per-case correctness gates

Every case carries the checks that apply to it. All are deterministic; **no LLM judge is used.**

| # | Gate | Definition | Failure is |
|---|---|---|---|
| G1 | **Routing correctness** | observed `route` equals the case's expected route | quality failure |
| G2 | **Safety-override correctness** | for cases labelled `expect_safety_override`, `safety_override == True` and `route == "policy"` | **protected** |
| G3 | **Deterministic rule correctness** | `method == "rule_engine"`, and `decision` and cited rule ID exactly match the expected pair | **protected** |
| G4 | **Grounding — correct source** | the expected trusted source ID appears in the response's source cards | quality failure |
| G5 | **Grounding — no invented source** | every cited source ID is a member of the retrieved ID set for that request | **protected** |
| G6 | **NOT_FOUND safety** | for unsupported-question cases, `answer_type == "NOT_FOUND"` and zero source cards | **protected** |
| G7 | **ACL / privacy** | no restricted document ID appears in the retrieved set, the prompt, the source cards, or the answer text | **protected** |
| G8 | **Document lifecycle** | no archived or not-yet-effective document ID appears in the retrieved set or the source cards | **protected** |
| G9 | **General answer quality** | for chat cases, required-facts / task-correctness grader passes | quality failure |
| G10 | **Execution completeness** | the case produced a well-formed response with no unhandled error and no silent degradation | hard failure |

G5, G7 and G8 are checked against the **retrieved** ID set, not only the cited set, because DUREM's
`_normalize()` already filters cited IDs. Checking only citations would test the filter rather than
the retrieval boundary, and would score a context leak as a pass.

### 6.3 Protected slice

Cases labelled protected are those under G2, G3, G5, G6, G7, G8. **Every protected case must pass.
One protected failure rejects the candidate**, regardless of measured savings.

### 6.4 Silent-failure detectors (execution completeness)

A case is a G10 failure, not a pass, if any of these is observed:

- `method == "safety_fallback"` where the baseline reached `llm` or `rule_engine` for that case;
- the policy-path repair retry fired (structured output rejected on the first attempt);
- an embedding call failed and retrieval silently degraded to lexical-only;
- the router classifier failed and a `fallback:classifier_unavailable` decision was taken;
- an empty model response was substituted with the canned fallback string.

Each of these is a real DUREM code path that **reduces cost while degrading behaviour**. They are
recorded per case in the baseline and re-checked in the candidate. A candidate whose savings come
from any of them is REJECTED.

---

## 7. Frozen economic / compute metric

Defined in full in `COST_METHODOLOGY.md`. In summary:

- **Primary metric:** `local_serving_cost`, computed by the explicit local model — **only if** the
  hardware price, useful-compute-hours, incremental power draw and electricity price are supplied.
- **Fallback metric, used when those inputs are absent:** `COMPUTE COST PROXY / RUNTIME REDUCTION`.
  No dollar figure is produced, and none is estimated.
- **Supporting raw counters, always recorded:** LLM call count, embedding call count, prompt tokens,
  output tokens, inference runtime, per-request latency, and runtime/model identity.

No per-token cloud price is applied to DUREM under any circumstance.

---

## 8. Baseline protocol

1. Stand up the frozen DUREM SHA with the frozen configuration on the agreed measurement host.
2. Confirm `DUREM_MOCK_MODE=false` and that the runtime answers `/v1/models`. Record the response.
3. Load the frozen corpus. Record its content hash.
4. Execute all 60 cases in frozen order, recording every field in
   `BASELINE_INSTRUMENTATION_PLAN.md` section 3.
5. Repeat the full pass **3 times** (`n_repeats = 3`). Runtime is a noisy measurement on any host;
   a single pass cannot separate a real change from scheduling noise. Correctness fields are asserted
   to be identical across repeats at `temperature=0.0`; any case that varies is flagged
   **non-deterministic** and reported, not silently averaged.
6. Import the traces into ZEVQORA under a new `product_id` for this evidence identity.
7. Finalize. From that point the baseline traces are pinned by `app/evidence/protection.py` and
   cannot be rewritten or deleted.

**No candidate is generated until step 7 completes.**

---

## 9. Diagnosis and candidate protocol

Diagnosis runs only against the frozen baseline. Hypotheses are not hardcoded in advance, and the
following are recorded as **explicitly excluded** because DUREM already implements them — claiming
them would be double-counting an existing optimization:

- deterministic routing that avoids a classifier call on high-confidence questions;
- the deterministic numeric rule engine that answers exact-threshold questions with zero LLM calls;
- the zero-evidence short-circuit that returns `NOT_FOUND` without calling the model;
- suppressed model thinking (`/no_think`), already on by default.

Candidates are generated **one at a time**. Each carries: exact hypothesis, files and configuration
changed, expected mechanism, expected risk, and rollback path. The first candidate does not combine
unrelated optimizations.

---

## 10. Acceptance rule

A candidate is **VERIFIED** only if **every required frozen gate passes** — the nine ZEVQORA gates in
section 6.1 and the per-case contract in section 6.2, including 100% of the protected slice.

Otherwise it is **REJECTED**, and the rejection is preserved and published with its failed cases.

Explicitly forbidden after results are seen:

- lowering `quality_floor`, `non_inferiority_tolerance`, or any threshold in section 6;
- editing the replay set, the corpus, or the workload distribution;
- dropping, re-labelling, or re-running individual cases into the same run identity;
- re-classifying a protected case as unprotected;
- reporting a subset of cases as if it were the full run;
- targeting any particular percentage.

**No percentage target is set.** The measured reduction is reported as it lands, including if it is
small, zero, or negative.

---

## 11. Permitted claim language

After a VERIFIED run, and only then:

> "In an affiliated real-workload evaluation of Sutainbuyant LLC's DUREM internal assistant, ZEVQORA
> measured a X% reduction in the defined local serving-cost/compute metric while all preregistered
> quality and protected-behavior gates passed."

Immediately followed, in the same context, by:

> "The founder built DUREM and has an existing relationship with Sutainbuyant, so this is affiliated
> evaluation evidence rather than independent customer validation."

Constraints on X:
- X is reported with its exact sample count, workload distribution, and per-category breakdown;
- X carries an uncertainty interval computed across the 3 repeats where statistically appropriate;
- if section 5 resolves to **R2**, *"real-workload"* becomes *"representative-workload"*;
- if section 4 resolves to **(B)**, the sentence must state that the host was a surrogate;
- if section 4 resolves to **(C)**, X is **not** a serving-cost percentage and must be described as a
  reduction in the named counter (for example, "in LLM calls per request"), with no timing or energy claim.

The sentence "ZEVQORA saves X% for AI companies" is forbidden in all cases.

---

## 12. DUREM instrumentation branch

Instrumentation is **observation-only** and lands on a separate DUREM branch,
`nero/eval-instrumentation-v1`, branched from `7536b80f2d234f29f77870c70bab1da63c8ce306`.
It does not alter routing, retrieval, ranking, prompts, thresholds, or answers. The
behaviour-neutrality argument is made per-probe in `BASELINE_INSTRUMENTATION_PLAN.md` section 4.

The baseline is captured **with instrumentation present on both arms**, so any residual overhead is
common-mode and cancels in the comparison.

---

## 13. Out of scope

No employee private data, internal confidential documents, secrets, API keys, session tokens, or raw
sensitive prompts enter this repository. Sensitive fixtures are retained locally and represented here
only by content hashes and aggregate counts.

---

## 14. Freeze record

To be completed at the moment of freezing. Until every row is filled, the status at the top of this
document stays `CONTRACT_DRAFT`.

| Item | Value |
|---|---|
| DUREM SHA | `7536b80f2d234f29f77870c70bab1da63c8ce306` |
| ZEVQORA branch SHA at freeze | *(pending)* |
| DUREM instrumentation branch SHA | *(pending)* |
| Replay set `durem_replay_v1` hash | *(pending)* |
| Corpus `durem_corpus_v1` hash | *(pending)* |
| Router lexicon + threshold hash | *(pending)* |
| Rule-set hash | *(pending)* |
| Gate config hash | *(pending)* |
| Measurement host identity | *(pending — blocker 1)* |
| Lemonade version | *(pending — blocker 1)* |
| Model file / quantization | *(pending — blocker 1)* |
| Corpus provenance R1 or R2 | *(pending — blocker 2)* |
| Frozen at (UTC) | *(pending)* |

## 15. Reviewer signoff

| Role | Name | Decision | Date | Signature / commit |
|---|---|---|---|---|
| Preparer | | | | |
| Reviewer — contract freeze | | approve / reject | | |
| Reviewer — blocker 1 (host) | | option A / B / C | | |
| Reviewer — blocker 2 (corpus) | | option R1 / R2 | | |
| Reviewer — baseline finalization | | | | |
| Reviewer — candidate verdict | | | | |
