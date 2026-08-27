# Early Phase 1 Commit Review (`c6b15eb`)

**Compared:** `72cc1ce` → `backup/backend-v0.2-early-phase1` (`c6b15eb`)  
**Diff size:** 31 files, +1419 / −198  
**Verdict:** **Do not cherry-pick whole.** Reuse selectively with required changes. Prefer a controlled rewrite that copies good modules and fixes critical gaps.

Preserved at: `backup/backend-v0.2-early-phase1`

---

## Overall assessment

The accidental Phase 1 draft is directionally correct:

- Typed provider models
- OpenRouter adapter + MockProvider
- Versioned pricing snapshot
- Trace v2 Alembic revision (additive)
- Agent/implementation moved off raw httpx
- `shell=False` + metacharacter rejection for implementation tests
- Useful unit tests for providers/telemetry

Critical gaps vs final Phase 0 requirements:

1. **No Alembic migration runner** — lifespan still only `create_all()` → existing SQLite installs will not gain Trace v2 columns.
2. **No API contract regression suite** — compatibility asserted, not proven.
3. **CostSource incomplete** — missing `imported_external`; snapshot source naming not aligned to `pricing_snapshot_estimate`.
4. **`hash_only` default can strip replay text** — breaks experiment inputs that need `input_text`/`output_text` without expected/candidate present.
5. **Premature RAG knobs** in config (`rag_mode`, embedding provider/model) before Phase 5.
6. **Pricing fallback** can silently invent rates for unknown models.
7. **Shared httpx client** lacks explicit shutdown/`aclose` lifecycle.
8. **Subprocess helper** lives in config (`parse_safe_command`) instead of a dedicated safe-runner module with cwd/output limits.

---

## File classification

| File | Decision | Why |
|------|----------|-----|
| `app/providers/base.py` | **ACCEPT** | Minimal ABC; correct boundary |
| `app/providers/models.py` | **ACCEPT_WITH_CHANGES** | Strong LLMRequest/Response/Usage/CostBreakdown; add `imported_external`; rename snapshot enum to `pricing_snapshot_estimate`; keep ModelInfo optional/light |
| `app/providers/openrouter.py` | **ACCEPT_WITH_CHANGES** | Good normalization, timeouts, bounded retries on 429/5xx; fix shared-client timeout stickiness; add `aclose`; keep retries non-duplicative for ambiguous successes |
| `app/providers/mock.py` | **ACCEPT** | Deterministic test/offline provider |
| `app/providers/pricing.py` | **ACCEPT_WITH_CHANGES** | Versioned snapshot good; remove silent wrong-model rate invention; never rewrite historical evidence; align CostSource labels |
| `app/providers/data/pricing_v1.json` | **ACCEPT** | Versioned fallback table |
| `app/providers/registry.py` | **ACCEPT_WITH_CHANGES** | Thin dict registry OK; avoid “default to mock” surprises in production paths; no DI framework |
| `app/providers/__init__.py` | **ACCEPT** | Package marker |
| `app/core/errors.py` | **ACCEPT** | Small typed errors |
| `app/core/hashing.py` | **ACCEPT** | Simple helpers |
| `app/core/logging.py` | **ACCEPT_WITH_CHANGES** | JSON logs useful; ensure secrets never logged |
| `app/core/config.py` | **ACCEPT_WITH_CHANGES** | Budgets/timeouts useful; drop Phase-5 RAG/embedding knobs for now; keep Settings frozen or document why mutable; move `parse_safe_command` out |
| `app/core/__init__.py` | **ACCEPT** | Package marker |
| `app/config.py` | **ACCEPT_WITH_CHANGES** | Compat re-export OK if imports stay stable |
| `app/telemetry/models.py` | **ACCEPT_WITH_CHANGES** | Useful normalized fields; trim unused complexity |
| `app/telemetry/normalizer.py` | **REWRITE** | Content policy must not break replay/experiment imports; default cost_source for imports = `imported_external`; preserve existing TraceIn behavior for desktop |
| `app/telemetry/collector.py` | **ACCEPT_WITH_CHANGES** | Fine as thin helper; not required for first land if unused |
| `app/telemetry/__init__.py` | **ACCEPT** | Package marker |
| `alembic/versions/0002_trace_telemetry_v2.py` | **ACCEPT_WITH_CHANGES** | Additive SQLite-friendly migration good; must be paired with runner + stamp strategy |
| `app/db_models.py` | **ACCEPT_WITH_CHANGES** | Additive Trace columns align with migration; keep nullable for compatibility |
| `app/evidence/service.py` | **ACCEPT_WITH_CHANGES** | Wire normalizer carefully; label imported costs; do not drop fields desktop needs |
| `app/agent/openrouter.py` | **ACCEPT_WITH_CHANGES** | Correct move to provider layer; preserve product_id override; keep tool loop simple |
| `app/implementation/service.py` | **ACCEPT_WITH_CHANGES** | Provider use + `shell=False` are wins; complete via dedicated subprocess module (timeout, cwd bound, output limit) |
| `app/main.py` | **REWRITE** (startup path) | Still `create_all` only — **must** call migration bootstrap before serve; version bump optional |
| `app/workspace/scanner.py` | **DROP** (noise) | Only UTC alias / ruff noise in this commit — do not need to carry |
| `desktop-app/.env.example` | **ACCEPT_WITH_CHANGES** | Document budgets/timeouts/capture; omit unused RAG embedding knobs until Phase 5 |
| `requirements-dev.txt` | **ACCEPT** | ruff + pytest-cov reasonable |
| `pyproject.toml` | **ACCEPT** | Tooling config |
| `tests/test_providers.py` | **ACCEPT_WITH_CHANGES** | Good start; expand cost_source cases |
| `tests/test_telemetry.py` | **ACCEPT_WITH_CHANGES** | Fix against corrected content policy |
| `tests/test_agent_scope.py` | **ACCEPT_WITH_CHANGES** | Keep product_id override assertion under MockProvider |
| *(missing)* `core/db_migrate.py` | **REWRITE / ADD** | Required; not present in `c6b15eb` |
| *(missing)* `core/subprocesses.py` | **REWRITE / ADD** | Required stronger than `parse_safe_command` alone |
| *(missing)* `tests/test_api_contracts.py` | **ADD** | Required Phase 1 acceptance |
| *(missing)* `tests/test_db_migrate.py` | **ADD** | Required Phase 1 acceptance |
| *(missing)* `tests/test_subprocess_safety.py` | **ADD** | Required Phase 1 acceptance |

---

## Topic review

### Provider abstraction quality
**Good.** Minimal surface; not framework theater. Keep.

### Normalized models
**Good.** Add `imported_external`. Align estimate source naming.

### HTTP client lifecycle
**Partial.** Shared client is correct intent; needs explicit close and per-request timeout clarity without sticky wrong defaults.

### Retries / timeouts
**Mostly good.** Retry 429/5xx only; never retry successful ambiguous paid work. Document attempt count on response.

### Provider usage parsing
**Good.** prompt/completion tokens + cached details + optional cost fields.

### Cost source distinction
**Incomplete.** Has provider vs snapshot; missing imported_external; snapshot naming mismatch vs final audit.

### Pricing versioning
**Good idea.** Snapshot version field present. Fallback rate inventing is unsafe — mark unknown/missing instead of guessing.

### Historical evidence correctness
**Risk.** Nothing prevents later re-estimation of old rows if code paths recompute; Phase 1 must treat stored `cost_usd` + `cost_source` + `pricing_version` as immutable for completed evidence.

### DB migration safety
**FAIL vs requirements.** Migration file exists; **execution path does not**. This alone blocks whole cherry-pick.

### Existing API compatibility
**Unproven.** Endpoint shapes likely intact, but no TestClient suite.

### Config design
**Mostly good**, with premature RAG/embedding settings to remove from Phase 1 land.

### Telemetry schema
**Useful**, slightly ahead of needs; keep additive nullable columns. Fix import normalizer semantics.

### Tests
**Useful unit coverage**; missing migration/API/subprocess acceptance tests.

### Dependencies
**Acceptable.** No new runtime deps. Dev tooling OK.

### Subprocess safety
**Partial win.** `shell=False` present; needs dedicated safe runner + tests; Windows argv parsing care.

### Overengineering
**Mild.** Registry + collector + early RAG knobs + content-policy aggressiveness. Avoid DI, vector, hybrid, optimizer in this land.

---

## Recommendation for `c6b15eb`

**Cherry-pick partially / rewrite from backup.**

Recommended workflow for Phase 1 implementation (after approval):

1. Keep branch tip at finalized Phase 0 docs commit.
2. Manually port **ACCEPT** / **ACCEPT_WITH_CHANGES** modules from `backup/backend-v0.2-early-phase1`.
3. Rewrite normalizer content policy + main startup migration bootstrap.
4. Add missing `db_migrate`, `subprocesses`, API/migration/subprocess tests.
5. Do **not** `git cherry-pick c6b15eb` as a single commit.

**Do not cherry-pick whole** because migration-runner gap + import content-policy behavior are ship blockers for existing desktop DBs and experiment replay.
