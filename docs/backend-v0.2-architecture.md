# ZEVQORA Backend v0.2 — Target Architecture (Phase 0 Final)

**Status:** Design target only — implementation waits for Phase 1 approval  
**Baseline MVP:** `0.1.0-premium-desktop` @ `5ed9a2c`  
**Proof-first ordering:** measurement → candidate execution → eval → dogfood → RAG → agent polish

---

## Product truth

ZEVQORA is an **AI Cost Optimization Engineer**.

Core credibility path:

```
evidence
  → candidate plan
  → real candidate execution
  → task-specific evaluation
  → verified savings
  → reviewable implementation
```

**RAG is an enabling subsystem**, not the product identity. Routing, caching, model substitution, context reduction, deterministic replacement are **mechanisms** inside the optimizer — not the company story.

Never optimize blindly. Measure. Replay. Verify. Then implement for human review.

---

## System context

```
┌────────────────────────────────────────────────────────────┐
│              ZEVQORA Desktop (Electron)                    │
│   React UI ── api.ts ── http://127.0.0.1:8000             │
└────────────────────────────┬───────────────────────────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────────┐
│            FastAPI Local Engine (Python)                   │
│                                                            │
│   routers/services ── domain modules ── core               │
│          │                  │                              │
│          ▼                  ▼                              │
│   SQLite (+ FTS5 later)   OpenRouter (optional)            │
│   Alembic migrations      MockProvider (tests)             │
│                           Local workspace FS               │
└────────────────────────────────────────────────────────────┘
```

---

## MVP flow (today)

```
connect-local → scan → Finding(static)
import traces → Trace + Finding(runtime observed)
experiments/run → judges pre-filled candidate_* fields
VERIFIED → implementations/prepare → git worktree (no merge)
agent/chat → tools ± OpenRouter
```

---

## Target proof loop

```
Finding
  │
  ▼
CandidatePlan  (deterministic planner + budgets)
  │
  ▼
CandidateExecution  (providers: OpenRouter / Mock)
  │                  strategies: exact_reuse, model_substitution, …
  ▼
Eval  (task-specific graders)
  │
  ▼
VerifiedExperiment + immutable provenance
  │
  ▼
Implementation (isolated worktree, human review only)
```

Parallel enabling path (Phase 5+):

```
workspace scan → chunks → FTS5 lexical retrieval → bounded context → agent tools
```

---

## Layer diagram

```
┌─────────────────────────────────────────────────────┐
│ API (FastAPI) — preserve desktop contracts          │
└──────────────────────────┬──────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────┐
│ Application services                                │
│ evidence | experiments | agent | optimization*      │
│ benchmarks* | implementation                        │
└──────────┬───────────────┬──────────────┬───────────┘
           │               │              │
           ▼               ▼              ▼
     workspace       optimization*     evals*
     scanner         planner/exec      graders/gates
           │               │              │
           ▼               └──────┬───────┘
     retrieval*                   │
     FTS5 later                   ▼
                            providers
                            LLMProvider + pricing
                                  │
                                  ▼
                            telemetry
                            normalize / cost provenance
                                  │
                                  ▼
                            core (config, logging, security,
                                  subprocesses, db_migrate)
                                  │
                                  ▼
                            SQLAlchemy + SQLite + Alembic
```

`*` = not in MVP; introduced by phase plan.

---

## Evidence classification

| Label | Meaning |
|-------|---------|
| STATIC_SIGNAL | Scan/AST hypotheses |
| OBSERVED | Imported/runtime evidence |
| ESTIMATED | Pricing snapshot estimate |
| BENCHMARK_MEASURED | Dogfood/harness measured |
| VERIFIED | Gates passed on replay/eval |
| EXTERNAL_VERIFIED | Real design-partner evidence only |

Never mix labels. Never call dogfood “customer traction.” Never treat 45% as measured unless a run proves it.

**Phase 4C status (2026-08-27, immutable):** internal `zev_dogfood_v2` run measured **42.01%** raw cost reduction and was **REJECTED** (`quality_floor`). That is **not** verified savings. See `docs/evidence/phase4c-v2/`. Stretch **45%** remains a target only — **retired as a measured claim**.

---

## Database / migration architecture

```
App start
  │
  ▼
db_migrate.ensure_schema()
  │
  ├─ empty DB ──────────────► alembic upgrade head
  │                            (or create_all + stamp head — transitional)
  ├─ MVP DB, no version ────► stamp 0001 → upgrade head
  └─ versioned DB ──────────► upgrade head
  │
  ▼
Serve API  (fail if migration failed)
```

Alembic is authoritative. No silent incompatible schema. No user data wipe.

---

## Provider boundary (Phase 1)

```
LLMRequest  →  LLMProvider.complete()  →  LLMResponse
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
  OpenRouterProvider        MockProvider
         │
         ▼
  CostBreakdown
    cost_source ∈ {provider_reported, pricing_snapshot_estimate, imported_external}
    pricing_version when estimated
```

Reusable httpx client lifecycle preferred. No DI framework.

---

## Agent trust boundary

```
Trusted: system prompt + tool authorization in Python
Trusted structure: tool result envelopes (bounded)
UNTRUSTED DATA: retrieved source / excerpts (delimited)
LLM cannot grant permissions, change product_id, merge, or deploy
```

---

## Phase map (fundraising/proof priority)

| Phase | Focus |
|-------|-------|
| 1 | Providers, telemetry, cost provenance, Alembic runner, subprocess safety, API contract tests |
| 2 | CandidatePlan / CandidateExecution / exact reuse + model substitution |
| 3 | Task graders, gates v2, immutable provenance |
| 4 | Zev dogfood benchmark + honest reports |
| 5 | Secure lexical RAG (FTS5); optional embeddings later |
| 6 | Agent integration + API cleanup |
| 7 | Hardening + release cleanup |

---

## Explicit non-goals (near term)

- Fake 45% evidence
- Vector DB theater before measured optimization loop
- Auto-merge / auto-deploy
- Required GPU / local LLM
- Multi-provider SDK sprawl in Phase 1
