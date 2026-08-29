# PREREGISTRATION — DUREM Affiliated Real-Workload Evaluation v1

**Evidence identity:** `durem-affiliated-eval-v1`
**Status:** `CONTRACT_DRAFT — DECISIONS RECORDED, AWAITING HOST DATA.` The three reviewer decisions
of 2026-08-29 are recorded in sections 4, 5 and 3. What remains before freezing is **data collection
on the measurement host**, not further judgement: the host identity, the runtime version, the model
files, the corpus hashes and the observed workload frequencies. Nothing in this document may be
relied on as a preregistration until every row of section 14 is filled and the freeze commit is made.
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
| Provenance | **R1 — sanitized real, retained locally** (section 5) |

Composition, category definitions, labelling rules and sanitization rules are specified in
`REPLAY_SET_DESIGN.md`. The distribution is frozen **before** any result is seen and is not
re-weighted afterwards.

### 3.1 Distribution provenance — **RESOLVED: hybrid observed/assumed**

**Reviewer decision, 2026-08-29.** Observed audit-log frequencies are used wherever the existing logs
can reliably support them; categories that cannot be reconstructed reliably keep a preregistered
stratified proportion, explicitly labelled as assumed. No missing frequency is inferred or fabricated.

`AUDIT_OBSERVABILITY.md` carries the schema analysis performed at the frozen DUREM SHA. Its result:

- **8 of 11 categories are directly observable** from `('assistant','answer')` rows — `CHAT`,
  `ROUTE-OBV`, `ROUTE-AMB`, `SAFETY`, `RULE`, `RAG`, `FOLLOWUP`, and `NOTFOUND` in aggregate. Each is a
  field equality on logged data, not an inference. `ROUTE-AMB` — the only category that always spends
  an extra classifier call, and therefore the one most able to distort a savings figure — is among
  them and will be counted exactly.
- **3 categories are unobservable** — `ACL`, `LIFECYCLE` and `SRCVAL`. All three are enforced by SQL
  filters at retrieval time or by silent ID intersection in `_normalize()`, so a correctly-blocked
  request leaves no audit record. This follows from DUREM enforcing them properly; it is not a logging
  defect. Their real-world frequency cannot be measured from these logs and will not be guessed.
- **`NOTFOUND` is observable in total but not by cause.** At least five distinct paths produce it and
  the audit row does not distinguish them.

The construction procedure, the validity conditions the observed window must satisfy, and the
conservative handling of the `NOTFOUND` decomposition are specified in `AUDIT_OBSERVABILITY.md`
section 4. Per that section, if the window fails any validity condition the **entire** distribution
reverts to the preregistered stratified mix and is reported as assumed — a marginal window is not
blended with assumptions to manufacture a stronger provenance claim.

The frozen table records, for every category: the count, whether it was `observed` or
`preregistered_assumption`, and — for observed rows — the time window and the raw sample count behind
it. It is written into section 14 **before** the baseline executes.

---

## 4. Hardware identity (item 4) — **RESOLVED: option (A), real deployment host**

**Reviewer decision, 2026-08-29: option (A).** The baseline runs on the real Sutainbuyant deployment
host, or an equivalent Ryzen AI machine. This is the option that supports a deployment-representative
serving-cost claim, and no surrogate-host caveat is required in the final report.

The inspection host below is **disqualified as a measurement host** and is recorded only to document
why the decision was necessary. The measurement host's own identity must be captured on that machine
and written into section 14 before the baseline runs:

| Must be recorded on the measurement host | Section 14 row |
|---|---|
| CPU, NPU, GPU, RAM, OS build | measurement host identity |
| Lemonade version (item 5) | Lemonade version |
| Model file name, quantization, and file hash for both models (item 7) | model file / quantization |
| `/v1/models` response, verbatim | run manifest |
| Idle and under-load power draw, if measurable | `COST_METHODOLOGY.md` section 2.1 assumptions |

Until those are captured, items 4, 5 and 7 remain empty in section 14 and the contract stays unfrozen.

### 4.1 Why the inspection host was disqualified

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

Options (B) surrogate host and (C) counters-only were considered and **not** taken. Their fallback
provisions elsewhere in this pack — the surrogate-host caveat in section 11 and the counters-only
metric in `COST_METHODOLOGY.md` section 3.1 — are retained as contingencies only, and apply only if
option (A) later proves impossible. Switching to them after a result has been seen is forbidden by
section 10.

---

## 5. Corpus and question provenance — **RESOLVED: R1, sanitized real**

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

**Reviewer decision, 2026-08-29: R1.** The replay set is built from sanitized real historical
questions over a sanitized real policy corpus, **retained locally only**. The phrase
*"real-workload"* is therefore permitted in the final report, subject to the affiliation disclosure
that always accompanies it.

Binding consequences of choosing R1:

1. The sanitization rules in `REPLAY_SET_DESIGN.md` section 1.1 are mandatory, and the pre-commit
   fixture allow-list check in rule 6 must be in place before any fixture is written.
2. `cases.local.jsonl` and `corpus.local.json` are **never committed**. They are still hashed into
   `checksums.sha256`, so a reviewer with local access can verify that the fixtures used were the
   fixtures declared.
3. The public pack carries case IDs, categories, expected labels, protected flags, counts and hashes
   — never question text or chunk text.
4. Policy-route audit rows contain `question[:600]` by default and may hold confidential company text
   (`AUDIT_OBSERVABILITY.md` section 1.1). They are treated as sensitive fixtures under the same rules
   and never leave the measurement host.

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

Constraints on X, given the decisions of 2026-08-29:

- X is reported with its exact sample count, workload distribution, and per-category breakdown;
- X carries an uncertainty interval computed across the 3 repeats — reported as the observed
  min–max range, labelled as such, since `n = 3` does not support a credible confidence interval;
- *"real-workload"* is **permitted** (section 5 resolved to R1) and no surrogate-host caveat is
  required (section 4 resolved to option A);
- every report states which parts of the workload distribution were **observed** and which were
  **preregistered assumptions**, with the time window and sample count behind the observed portion
  (section 3.1);
- the sentence is accompanied by the note that `ACL`, `LIFECYCLE` and `SRCVAL` proportions are
  assumed and deliberately over-represented, so the set is harder to pass than production, not easier.

Contingency clauses, applicable only if option (A) later proves impossible and **never** as a
response to an unwelcome result: a surrogate host must be disclosed in the sentence, and a
counters-only run makes X a reduction in the named counter rather than a serving-cost percentage,
with no timing or energy claim.

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
| Measurement host identity | *(pending — capture on host, section 4)* |
| Lemonade version | *(pending — capture on host)* |
| Model files + quantization + hashes | *(pending — capture on host)* |
| Corpus provenance | **R1 — sanitized real, retained locally** ✔ decided 2026-08-29 |
| Distribution provenance | **hybrid observed/assumed** ✔ decided 2026-08-29 |
| Observed-window start / end (UTC) | *(pending — capture on host)* |
| Observed-window total `answer` rows | *(pending — must be ≥ 1000, ≥ 30 days)* |
| Excluded `user_id` list (admin/test) | *(pending)* |
| Frozen distribution table | *(pending — written before baseline execution)* |
| Frozen at (UTC) | *(pending)* |

### 14.1 Frozen distribution table (to be completed before baseline execution)

| Code | n | Provenance | Observed count | Window |
|---|---|---|---|---|
| `CHAT` | | observed | | |
| `ROUTE-OBV` | | observed | | |
| `ROUTE-AMB` | | observed | | |
| `SAFETY` | | observed | | |
| `RULE` | | observed | | |
| `RAG` | | observed | | |
| `FOLLOWUP` | | observed | | |
| `NOTFOUND` | | observed (aggregate only) | | |
| `ACL` | 4 | preregistered_assumption | n/a | n/a |
| `LIFECYCLE` | 3 | preregistered_assumption | n/a | n/a |
| `SRCVAL` | 2 | preregistered_assumption | n/a | n/a |

## 15. Reviewer signoff

| Role | Name | Decision | Date | Signature / commit |
|---|---|---|---|---|
| Preparer | | | | |
| Reviewer — measurement host | | **(A) real deployment host** | 2026-08-29 | recorded in session |
| Reviewer — corpus provenance | | **R1 — sanitized real, local** | 2026-08-29 | recorded in session |
| Reviewer — distribution provenance | | **hybrid observed/assumed** | 2026-08-29 | recorded in session |
| Reviewer — contract freeze | | approve / reject | | |
| Reviewer — baseline finalization | | | | |
| Reviewer — candidate verdict | | | | |
