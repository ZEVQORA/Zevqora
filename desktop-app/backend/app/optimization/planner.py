from __future__ import annotations

import json
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.hashing import sha256_json
from ..db_models import CandidatePlan, Finding, Trace, utcnow
from .models import PlanDraft, StrategyName
from .registry import get_strategy


def _config_hash(draft: PlanDraft) -> str:
    return sha256_json(
        {
            "strategy": draft.strategy.value,
            "baseline_config": draft.baseline_config,
            "candidate_config": draft.candidate_config,
            "sample_scope": draft.sample_scope,
            "plan_version": draft.plan_version,
            "max_budget_usd": draft.max_budget_usd,
        }
    )


def _persist(db: Session, product_id: str, draft: PlanDraft) -> CandidatePlan:
    plan = CandidatePlan(
        id=str(uuid.uuid4()),
        product_id=product_id,
        finding_id=draft.finding_id,
        strategy=draft.strategy.value,
        status=draft.status.value,
        baseline_config_json=json.dumps(draft.baseline_config, sort_keys=True, ensure_ascii=False),
        candidate_config_json=json.dumps(draft.candidate_config, sort_keys=True, ensure_ascii=False),
        reason=draft.reason,
        expected_mechanism=draft.expected_mechanism,
        risk=draft.risk,
        fallback=draft.fallback,
        required_evidence_json=json.dumps(draft.required_evidence, ensure_ascii=False),
        max_budget_usd=draft.max_budget_usd,
        sample_scope_json=json.dumps(draft.sample_scope, ensure_ascii=False),
        plan_version=draft.plan_version,
        config_hash=_config_hash(draft),
        blocked_reason=draft.blocked_reason,
        created_at=utcnow(),
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


def create_plans(
    db: Session,
    product_id: str,
    *,
    finding_id: str | None = None,
    strategy: str | None = None,
    candidate_model: str | None = None,
    max_budget_usd: float | None = None,
    include_protected: bool = False,
    sample_trace_ids: list[str] | None = None,
) -> list[CandidatePlan]:
    """Deterministic planner — no LLM. Emits READY or BLOCKED plans only."""
    finding = None
    if finding_id:
        finding = db.scalar(select(Finding).where(Finding.id == finding_id, Finding.product_id == product_id))
        if not finding:
            raise ValueError("Finding not found for this product.")

    traces = list(db.scalars(select(Trace).where(Trace.product_id == product_id)))
    budget = max_budget_usd if max_budget_usd is not None else settings.max_experiment_cost_usd
    created: list[CandidatePlan] = []

    names: list[str]
    if strategy:
        names = [strategy]
    else:
        names = [StrategyName.EXACT_REUSE.value]
        if candidate_model:
            names.append(StrategyName.MODEL_SUBSTITUTION.value)

    for name in names:
        strat = get_strategy(name)
        plan_kwargs: dict = {
            "candidate_model": candidate_model,
            "max_budget_usd": budget,
        }
        if name == StrategyName.MODEL_SUBSTITUTION.value:
            plan_kwargs["include_protected"] = include_protected
            plan_kwargs["sample_trace_ids"] = sample_trace_ids
        draft = strat.plan(
            db,
            product_id,
            traces,
            finding,
            **plan_kwargs,
        )
        created.append(_persist(db, product_id, draft))
    return created


def get_plan(db: Session, product_id: str, plan_id: str) -> CandidatePlan | None:
    return db.scalar(select(CandidatePlan).where(CandidatePlan.id == plan_id, CandidatePlan.product_id == product_id))


def list_plans(db: Session, product_id: str) -> list[CandidatePlan]:
    return list(
        db.scalars(
            select(CandidatePlan)
            .where(CandidatePlan.product_id == product_id)
            .order_by(CandidatePlan.created_at.desc())
        )
    )
