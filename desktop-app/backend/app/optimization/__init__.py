"""Optimization package — CandidatePlan / CandidateExecution (Phase 2).

Strategies produce measured candidate evidence only. They never mark VERIFIED.
"""

from .bridge import is_legacy_candidate_evidence, project_execution_onto_traces
from .executor import execute_plan, get_execution, list_executions
from .models import EXECUTION_PROVEN, LEGACY_CANDIDATE_EVIDENCE, ExecutionStatus, PlanStatus, StrategyName
from .planner import create_plans, get_plan, list_plans

__all__ = [
    "LEGACY_CANDIDATE_EVIDENCE",
    "EXECUTION_PROVEN",
    "PlanStatus",
    "ExecutionStatus",
    "StrategyName",
    "create_plans",
    "get_plan",
    "list_plans",
    "execute_plan",
    "get_execution",
    "list_executions",
    "project_execution_onto_traces",
    "is_legacy_candidate_evidence",
]
