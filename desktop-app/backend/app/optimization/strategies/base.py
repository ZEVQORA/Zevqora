from __future__ import annotations

from abc import ABC, abstractmethod

from sqlalchemy.orm import Session

from ...db_models import CandidatePlan, Finding, Trace
from ..models import EligibilityResult, PlanDraft, SampleResult


class OptimizationStrategy(ABC):
    """Strategy produces plans and measured execution evidence only — never VERIFIED."""

    name: str

    @abstractmethod
    def eligibility(
        self,
        db: Session,
        product_id: str,
        traces: list[Trace],
        finding: Finding | None = None,
        *,
        candidate_model: str | None = None,
    ) -> EligibilityResult:
        raise NotImplementedError

    @abstractmethod
    def plan(
        self,
        db: Session,
        product_id: str,
        traces: list[Trace],
        finding: Finding | None = None,
        *,
        candidate_model: str | None = None,
        max_budget_usd: float | None = None,
    ) -> PlanDraft:
        raise NotImplementedError

    @abstractmethod
    def estimate_budget(self, plan: CandidatePlan | PlanDraft, traces: list[Trace]) -> float:
        """Conservative upper bound of provider spend for this plan."""
        raise NotImplementedError

    @abstractmethod
    async def execute_sample(
        self,
        *,
        plan: CandidatePlan,
        baseline: Trace,
        reuse_source: Trace | None = None,
        provider: object | None = None,
        db: Session | None = None,
    ) -> SampleResult:
        raise NotImplementedError
