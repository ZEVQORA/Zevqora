# ZEVQORA Verified Optimization Run

## Who buys it

A CTO or head of platform with **one expensive production AI workload** — a
support triage model, a classification or extraction step, an agent loop — who
is being asked "can we make this cheaper or faster without breaking it?" and
does not want to answer with a dashboard or a vendor's promise.

## What they connect

Recorded execution evidence for that workload: the engine's JSONL trace import,
or OpenTelemetry GenAI / OpenInference spans (ZevIR adapters). Hashes, token
counts, timings, cost with its source, and — if they want quality graded —
expected outputs. Prompts and outputs are not stored in ZevIR or in diagnoses.

## What they get

1. An **Evaluation Contract**: quality floor, task-success floor, p95 budget or
   regression limit, protected cases, minimum evidence — frozen before any result.
2. A **Verified Performance baseline**: known cost and its coverage, cost per
   successful outcome (or why it cannot be computed), p50/p95/p99, task success,
   reliability, and a bad-day profile — all observed, nothing filled in.
3. **Diagnoses** with evidence and a falsifier: redundant calls, retry
   amplification, context amplification, model overprovisioning, latency hotspots.
4. **Candidates** with expected effects (projected), risk, rollback and whether
   ZEVQORA can actually replay them.
5. A **replay** of supported candidates on the same cases, and a verdict.
6. An **Executive report** (baseline vs candidate, verdict, "production result: not
   yet measured") and a **Developer view** (ZevIR nodes, evidence refs, gate by gate,
   candidate config, rollback).

## What VERIFIED means

Every required gate of the frozen contract passed on the replayed cases:
evidence complete, enough cases, quality floor and non-inferiority, task success,
protected cases, cost lower with sufficient cost coverage, latency within budget,
execution proven. Missing evidence makes it INCOMPLETE; any failed gate makes it
REJECTED — however much cheaper or faster the candidate was.

## What is NOT claimed

- A diagnosis is not a saving. A candidate is not verified.
- An evaluated improvement on replayed cases is not a realized production saving
  ("Realized" is never shown in Part 2A).
- Synthetic, internal or affiliated evidence is not independent customer proof.
- Unknown cost is not $0; missing task success is not success or failure.

## How a paid evaluation runs

1. **Scope** (day 0): one workload, its data boundary, who signs the contract.
2. **Connect** (days 1–3): import a representative window of traces; check the
   baseline's evidence coverage and fix gaps (cost source, expected outputs,
   logical request ids).
3. **Freeze** (day 3): the customer's owner freezes the Evaluation Contract.
4. **Diagnose + replay** (days 4–8): ZEVQORA runs the supported candidates under
   the contract; unsupported ones are delivered as implementation briefs.
5. **Readout** (day 10): executive and developer reports. Price is fixed per
   evaluation; no performance fee (Part 2A does not measure realized savings).

The demo workload (`DEMO / SYNTHETIC — NOT CUSTOMER DATA`) walks this whole flow
in a few minutes and produces one REJECTED and one VERIFIED candidate honestly.

## Optimization Intelligence (vNext Part 2B)

Behind `optimization_intelligence_vnext`, the run continues past single
candidates: a bounded **plan search** composes compatible changes, prunes
conflicting, blocked and dominated plans, **calibrates** promising ones on a
seeded sample, **replays** the best on the whole evaluation set under the same
frozen contract, computes the **Pareto frontier** of VERIFIED plans, and lets
the customer state the objective (margin, latency, reliability, balanced or
custom limits) to select one plan — with every reason, falsifier and rollback
written down, an optional **Bad-Day Replay**, and the production result still
NOT YET MEASURED. See `execution-plan-model.md`, `plan-search.md`,
`calibration-replay.md`, `pareto-frontier.md`, `bad-day-replay.md`.
