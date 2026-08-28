from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.hashing import sha256_json, sha256_text
from ..db_models import CandidateExecution, CandidatePlan, Trace, utcnow
from ..providers.base import LLMProvider
from ..providers.models import CostSource
from .models import ExecutionStatus, PlanStatus, SampleResult, StrategyName
from .registry import get_strategy
from .strategies.model_substitution import estimate_sample_cost_usd

# Recorded when samples in one execution disagree about where their dollars came
# from. Better an explicit "mixed" than silently asserting one sample's provenance
# for the whole run.
_MIXED_COST_SOURCE = "mixed"


def execution_key_for(plan: CandidatePlan, *, baseline_traces: list[Trace] | None = None) -> str:
    """Idempotency key tied to plan config AND immutable baseline evidence.

    sample_scope Trace IDs alone are insufficient: if evidence content changes under
    the same IDs, the key must change. Timestamps are excluded.
    """
    from .fingerprints import baseline_evidence_hash

    scope_ids = json.loads(plan.sample_scope_json or "[]")
    if baseline_traces is None:
        evidence_hash = json.loads(plan.baseline_config_json or "{}").get("baseline_evidence_hash")
    else:
        scoped = [t for t in baseline_traces if t.id in set(scope_ids)]
        evidence_hash = baseline_evidence_hash(scoped)
    return sha256_json(
        {
            "plan_id": plan.id,
            "config_hash": plan.config_hash,
            "sample_scope": scope_ids,
            "candidate_config": json.loads(plan.candidate_config_json or "{}"),
            "baseline_evidence_hash": evidence_hash,
        }
    )


def provenance_hash_for(
    plan: CandidatePlan,
    *,
    baseline_ids: list[str],
    sample_results: list[dict[str, Any]],
    provider: str | None,
    model: str | None,
) -> str:
    return sha256_json(
        {
            "plan_version": plan.plan_version,
            "strategy": plan.strategy,
            "config_hash": plan.config_hash,
            "baseline_trace_ids": baseline_ids,
            "candidate_config": json.loads(plan.candidate_config_json or "{}"),
            "provider": provider,
            "model": model,
            "pricing_version": next(
                (r.get("pricing_version") for r in sample_results if r.get("pricing_version")),
                None,
            ),
            "sample_digests": [
                {
                    "baseline_trace_id": r.get("baseline_trace_id"),
                    "cost_source": r.get("cost_source"),
                    "cost_usd": r.get("cost_usd"),
                    "provider_request_id": r.get("provider_request_id"),
                    "output_hash": sha256_text(r.get("output_text")),
                }
                for r in sample_results
            ],
        }
    )


def _find_idempotent(db: Session, key: str) -> CandidateExecution | None:
    rows = list(
        db.scalars(
            select(CandidateExecution)
            .where(CandidateExecution.execution_key == key)
            .order_by(CandidateExecution.created_at.desc())
        )
    )
    for row in rows:
        if row.status in {ExecutionStatus.RUNNING.value, ExecutionStatus.SUCCEEDED.value}:
            return row
    return None


def _reuse_source_for(plan: CandidatePlan, baseline_id: str, by_id: dict[str, Trace]) -> Trace | None:
    if plan.strategy != StrategyName.EXACT_REUSE.value:
        return None
    baseline_cfg = json.loads(plan.baseline_config_json or "{}")
    groups: dict[str, list[str]] = baseline_cfg.get("cache_groups") or {}
    for members in groups.values():
        if baseline_id not in members:
            continue
        source_id = members[0]
        return by_id.get(source_id)
    return None


async def execute_plan(
    db: Session,
    product_id: str,
    plan_id: str,
    *,
    provider: LLMProvider | None = None,
    force_rerun: bool = False,
) -> CandidateExecution:
    plan = db.scalar(select(CandidatePlan).where(CandidatePlan.id == plan_id, CandidatePlan.product_id == product_id))
    if not plan:
        raise ValueError("Candidate plan not found.")
    if plan.status == PlanStatus.BLOCKED.value:
        raise ValueError(plan.blocked_reason or "Plan is BLOCKED and cannot execute.")
    if plan.status not in {
        PlanStatus.READY.value,
        PlanStatus.COMPLETED.value,
        PlanStatus.FAILED.value,
    }:
        if plan.status == PlanStatus.EXECUTING.value:
            existing = _find_idempotent(
                db,
                execution_key_for(
                    plan, baseline_traces=list(db.scalars(select(Trace).where(Trace.product_id == product_id)))
                ),
            )
            if existing:
                return existing
        raise ValueError(f"Plan status {plan.status} is not executable.")

    traces = list(db.scalars(select(Trace).where(Trace.product_id == product_id)))
    key = execution_key_for(plan, baseline_traces=traces)
    if not force_rerun:
        existing = _find_idempotent(db, key)
        if existing is not None:
            return existing

    by_id = {t.id: t for t in traces}
    strategy = get_strategy(plan.strategy)
    estimated = strategy.estimate_budget(plan, traces)
    candidate_cfg = json.loads(plan.candidate_config_json or "{}")
    benchmark_mode = bool(candidate_cfg.get("benchmark_mode"))
    if estimated == float("inf") and not benchmark_mode:
        raise ValueError("Cannot execute under strict budget: candidate cost is not estimable from verified pricing.")
    if estimated != float("inf") and estimated > plan.max_budget_usd:
        raise ValueError(f"Estimated max cost {estimated:.6f} USD exceeds plan budget {plan.max_budget_usd:.6f} USD.")
    if estimated == float("inf") and benchmark_mode and plan.max_budget_usd <= 0:
        raise ValueError("Benchmark mode still requires a positive max budget for hard spend control.")

    sample_ids: list[str] = json.loads(plan.sample_scope_json or "[]")
    parent_id = None
    attempt = 1
    if force_rerun:
        prior = list(
            db.scalars(
                select(CandidateExecution)
                .where(CandidateExecution.execution_key == key)
                .order_by(CandidateExecution.attempt.desc())
            )
        )
        if prior:
            parent_id = prior[0].id
            attempt = prior[0].attempt + 1

    candidate_cfg = json.loads(plan.candidate_config_json or "{}")
    execution = CandidateExecution(
        id=str(uuid.uuid4()),
        candidate_plan_id=plan.id,
        product_id=product_id,
        status=ExecutionStatus.RUNNING.value,
        execution_key=key,
        attempt=attempt,
        parent_execution_id=parent_id,
        provider=None,
        requested_model=candidate_cfg.get("model"),
        baseline_trace_ids_json=json.dumps(sample_ids, ensure_ascii=False),
        sample_results_json="[]",
        provider_call_count=0,
        fallback_used=False,
        provenance_hash="",
        started_at=utcnow(),
        created_at=utcnow(),
    )
    plan.status = PlanStatus.EXECUTING.value
    db.add(plan)
    db.add(execution)
    db.commit()
    db.refresh(execution)

    semaphore = asyncio.Semaphore(max(1, settings.max_candidate_concurrency))
    budget_lock = asyncio.Lock()
    spent = 0.0
    provider_calls = 0
    error_category = None
    error_detail = None
    final_status = ExecutionStatus.SUCCEEDED
    model = candidate_cfg.get("model")

    async def run_one(trace_id: str) -> SampleResult:
        nonlocal spent, provider_calls, error_category, error_detail, final_status
        baseline = by_id.get(trace_id)
        if baseline is None:
            return SampleResult(
                baseline_trace_id=trace_id,
                status="failed",
                error_category="ineligible",
                error_detail="Baseline trace missing.",
                execution_proven=False,
            )

        async with budget_lock:
            if final_status == ExecutionStatus.BUDGET_EXCEEDED:
                return SampleResult(
                    baseline_trace_id=trace_id,
                    status="failed",
                    error_category="budget_exceeded",
                    error_detail="Plan already exceeded budget.",
                    execution_proven=False,
                )
            if plan.strategy == StrategyName.MODEL_SUBSTITUTION.value and model:
                sample_est = estimate_sample_cost_usd(model, baseline)
                remaining = plan.max_budget_usd - spent
                # Unknown estimate: block normal runs; allow authorized benchmark_mode and
                # rely on post-call cumulative spend enforcement.
                if sample_est is None:
                    if not benchmark_mode:
                        final_status = ExecutionStatus.BUDGET_EXCEEDED
                        return SampleResult(
                            baseline_trace_id=trace_id,
                            status="failed",
                            error_category="budget_exceeded",
                            error_detail="Remaining plan budget insufficient for next provider call.",
                            execution_proven=False,
                        )
                elif sample_est > remaining + 1e-12:
                    final_status = ExecutionStatus.BUDGET_EXCEEDED
                    return SampleResult(
                        baseline_trace_id=trace_id,
                        status="failed",
                        error_category="budget_exceeded",
                        error_detail="Remaining plan budget insufficient for next provider call.",
                        execution_proven=False,
                    )

        reuse_source = _reuse_source_for(plan, trace_id, by_id)
        async with semaphore:
            result = await strategy.execute_sample(
                plan=plan,
                baseline=baseline,
                reuse_source=reuse_source,
                provider=provider,
                db=db,
            )

        async with budget_lock:
            if result.provider_call_count:
                provider_calls += result.provider_call_count
            if result.cost_usd is not None:
                spent += result.cost_usd
                if spent > plan.max_budget_usd + 1e-9:
                    final_status = ExecutionStatus.BUDGET_EXCEEDED
                    result = result.model_copy(
                        update={
                            "status": "failed",
                            "error_category": "budget_exceeded",
                            "error_detail": "Cumulative candidate spend exceeded plan budget.",
                        }
                    )
            if result.status == "failed":
                if result.error_category == "budget_exceeded":
                    final_status = ExecutionStatus.BUDGET_EXCEEDED
                elif final_status == ExecutionStatus.SUCCEEDED:
                    final_status = ExecutionStatus.FAILED
                    error_category = result.error_category
                    error_detail = result.error_detail
        return result

    results = list(await asyncio.gather(*[run_one(tid) for tid in sample_ids])) if sample_ids else []

    if not sample_ids:
        final_status = ExecutionStatus.FAILED
        error_category = "ineligible"
        error_detail = "Plan sample scope is empty."

    if any(r.status == "failed" for r in results) and final_status == ExecutionStatus.SUCCEEDED:
        final_status = ExecutionStatus.FAILED

    sample_dicts = [r.model_dump() for r in results]
    succeeded = [r for r in results if r.status == "succeeded"]
    if plan.strategy == StrategyName.EXACT_REUSE.value and succeeded:
        # Genuine no-provider path. Assert the invariant rather than inheriting
        # whatever label sample zero happened to carry: a reuse execution stamped
        # "provider_reported" would claim the provider billed $0.00 for real work.
        reuse_sources = {r.cost_source for r in succeeded if r.cost_source}
        if reuse_sources - {CostSource.DETERMINISTIC_REUSE.value}:
            agg_cost: float | None = None
            agg_source = _MIXED_COST_SOURCE
        else:
            agg_cost = 0.0
            agg_source = CostSource.DETERMINISTIC_REUSE.value
    elif succeeded and all(r.cost_usd is not None for r in succeeded):
        # All-or-nothing. Summing only the priced samples silently valued the
        # unpriced ones at $0.00, so a run where two of five candidate calls had
        # unknown cost reported a ~93% reduction against five full baselines.
        agg_cost = round(sum(r.cost_usd for r in succeeded if r.cost_usd is not None), 10)
        distinct_sources = {r.cost_source for r in succeeded if r.cost_source}
        agg_source = (
            distinct_sources.pop() if len(distinct_sources) == 1 else (_MIXED_COST_SOURCE if distinct_sources else None)
        )
    else:
        agg_cost = None
        agg_source = None

    # Compare like with like: only samples where BOTH sides are known. Previously
    # the candidate total and the baseline total were built from different subsets.
    paired = [r for r in succeeded if r.cost_usd is not None and r.baseline_cost_usd is not None]
    delta = None
    if agg_cost is not None and paired and len(paired) == len(succeeded):
        delta = round(
            sum(r.cost_usd for r in paired) - sum(r.baseline_cost_usd for r in paired),
            10,
        )

    latencies = [r.latency_ms for r in succeeded if r.latency_ms is not None]
    execution.status = final_status.value
    execution.completed_at = utcnow()
    execution.sample_results_json = json.dumps(sample_dicts, ensure_ascii=False)
    execution.input_tokens = sum(r.input_tokens or 0 for r in succeeded) or (
        0 if plan.strategy == StrategyName.EXACT_REUSE.value and succeeded else None
    )
    execution.output_tokens = sum(r.output_tokens or 0 for r in succeeded) or (
        0 if plan.strategy == StrategyName.EXACT_REUSE.value and succeeded else None
    )
    execution.cached_input_tokens = sum(r.cached_input_tokens or 0 for r in succeeded) or None
    execution.cost_usd = agg_cost
    execution.cost_source = agg_source
    # Only claim a snapshot version when every contributing sample agrees on it.
    # `next(...)` skipped provider_reported samples (which set it to None) and
    # landed on an estimated sample, stamping a local snapshot version onto
    # dollars the provider reported.
    distinct_versions = {r.pricing_version for r in succeeded if r.pricing_version}
    execution.pricing_version = distinct_versions.pop() if len(distinct_versions) == 1 else None
    execution.latency_ms = (sum(latencies) / len(latencies)) if latencies else None
    execution.provider_request_id = next((r.provider_request_id for r in succeeded if r.provider_request_id), None)
    execution.provider_call_count = provider_calls
    execution.candidate_cost_delta_usd = delta
    execution.error_category = error_category
    execution.error_detail = error_detail

    if plan.strategy == StrategyName.EXACT_REUSE.value:
        execution.provider = "none"
    elif provider is not None:
        execution.provider = provider.name
        execution.resolved_model = execution.requested_model
    else:
        from ..providers.factory import get_provider as _gp

        execution.provider = _gp().name
        execution.resolved_model = execution.requested_model

    execution.provenance_hash = provenance_hash_for(
        plan,
        baseline_ids=sample_ids,
        sample_results=sample_dicts,
        provider=execution.provider,
        model=execution.requested_model,
    )

    plan.status = PlanStatus.COMPLETED.value if final_status == ExecutionStatus.SUCCEEDED else PlanStatus.FAILED.value
    db.add(plan)
    db.add(execution)
    db.commit()
    db.refresh(execution)
    return execution


def get_execution(db: Session, product_id: str, execution_id: str) -> CandidateExecution | None:
    return db.scalar(
        select(CandidateExecution).where(
            CandidateExecution.id == execution_id,
            CandidateExecution.product_id == product_id,
        )
    )


def list_executions(db: Session, product_id: str) -> list[CandidateExecution]:
    return list(
        db.scalars(
            select(CandidateExecution)
            .where(CandidateExecution.product_id == product_id)
            .order_by(CandidateExecution.created_at.desc())
        )
    )
