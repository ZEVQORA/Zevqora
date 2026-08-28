"""Deterministic product-state operations for bounded routing Tier 1.

These read authoritative ZEVQORA DB/state — never prompt→answer lookup tables.
Operation names are product task envelopes (request metadata.operation), not case IDs.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...db_models import AICall, CandidateExecution, EvaluationRun, Finding

# Explicit allowlist of deterministic product operations.
DETERMINISTIC_OPERATIONS: frozenset[str] = frozenset(
    {
        "count_ai_calls",
        "list_detected_providers",
        "get_evaluation_status",
        "get_candidate_execution_model",
        "get_cost_source",
        "get_finding_origin",
        "get_implementation_eligible",
        "get_failed_gate_names",
        "get_sample_count",
        "get_protected_sample_count",
        "get_requested_model",
        "get_resolved_model",
        "get_execution_proven",
        "get_evaluation_cheaper",
        "get_finding_evidence_status",
    }
)


def _args(context: dict[str, Any]) -> dict[str, Any]:
    raw = context.get("operation_args") or {}
    return raw if isinstance(raw, dict) else {}


def op_count_ai_calls(db: Session, product_id: str, context: dict[str, Any]) -> str:
    n = len(list(db.scalars(select(AICall).where(AICall.product_id == product_id))))
    return str(n)


def op_list_detected_providers(db: Session, product_id: str, context: dict[str, Any]) -> str:
    rows = list(db.scalars(select(AICall).where(AICall.product_id == product_id)))
    providers = sorted({r.provider for r in rows if r.provider})
    return ",".join(providers) if providers else "none"


def op_get_evaluation_status(db: Session, product_id: str, context: dict[str, Any]) -> str:
    eid = _args(context).get("evaluation_run_id")
    if not eid:
        raise ValueError("evaluation_run_id required")
    row = db.scalar(select(EvaluationRun).where(EvaluationRun.id == eid, EvaluationRun.product_id == product_id))
    if not row:
        raise ValueError("EvaluationRun not found")
    return str(row.status)


def op_get_candidate_execution_model(db: Session, product_id: str, context: dict[str, Any]) -> str:
    eid = _args(context).get("candidate_execution_id")
    if not eid:
        raise ValueError("candidate_execution_id required")
    row = db.scalar(
        select(CandidateExecution).where(CandidateExecution.id == eid, CandidateExecution.product_id == product_id)
    )
    if not row:
        raise ValueError("CandidateExecution not found")
    return str(row.requested_model or row.resolved_model or "unknown")


def op_get_cost_source(db: Session, product_id: str, context: dict[str, Any]) -> str:
    eid = _args(context).get("candidate_execution_id")
    if not eid:
        raise ValueError("candidate_execution_id required")
    row = db.scalar(
        select(CandidateExecution).where(CandidateExecution.id == eid, CandidateExecution.product_id == product_id)
    )
    if not row:
        raise ValueError("CandidateExecution not found")
    return str(row.cost_source or "unknown")


def op_get_finding_origin(db: Session, product_id: str, context: dict[str, Any]) -> str:
    fid = _args(context).get("finding_id")
    if not fid:
        raise ValueError("finding_id required")
    row = db.scalar(select(Finding).where(Finding.id == fid, Finding.product_id == product_id))
    if not row:
        raise ValueError("Finding not found")
    return str(row.origin)


def op_get_implementation_eligible(db: Session, product_id: str, context: dict[str, Any]) -> str:
    """Eligible only when EvaluationRun is VERIFIED and execution_proven."""
    eid = _args(context).get("evaluation_run_id")
    if not eid:
        raise ValueError("evaluation_run_id required")
    row = db.scalar(select(EvaluationRun).where(EvaluationRun.id == eid, EvaluationRun.product_id == product_id))
    if not row:
        raise ValueError("EvaluationRun not found")
    eligible = row.status == "VERIFIED" and bool(row.execution_proven)
    return "eligible" if eligible else "not_eligible"


def op_get_failed_gate_names(db: Session, product_id: str, context: dict[str, Any]) -> str:
    eid = _args(context).get("evaluation_run_id")
    if not eid:
        raise ValueError("evaluation_run_id required")
    row = db.scalar(select(EvaluationRun).where(EvaluationRun.id == eid, EvaluationRun.product_id == product_id))
    if not row:
        raise ValueError("EvaluationRun not found")
    gates = json.loads(row.gates_json or "[]")
    failed = [
        str(g.get("name"))
        for g in gates
        if isinstance(g, dict) and str(g.get("outcome", "")).lower() in {"failed", "missing"}
    ]
    return ",".join(failed) if failed else "none"


def op_get_sample_count(db: Session, product_id: str, context: dict[str, Any]) -> str:
    eid = _args(context).get("evaluation_run_id")
    if not eid:
        raise ValueError("evaluation_run_id required")
    row = db.scalar(select(EvaluationRun).where(EvaluationRun.id == eid, EvaluationRun.product_id == product_id))
    if not row:
        raise ValueError("EvaluationRun not found")
    return str(row.sample_count)


def op_get_protected_sample_count(db: Session, product_id: str, context: dict[str, Any]) -> str:
    eid = _args(context).get("evaluation_run_id")
    if not eid:
        raise ValueError("evaluation_run_id required")
    row = db.scalar(select(EvaluationRun).where(EvaluationRun.id == eid, EvaluationRun.product_id == product_id))
    if not row:
        raise ValueError("EvaluationRun not found")
    return str(row.protected_sample_count)


def op_get_requested_model(db: Session, product_id: str, context: dict[str, Any]) -> str:
    eid = _args(context).get("candidate_execution_id")
    if not eid:
        raise ValueError("candidate_execution_id required")
    row = db.scalar(
        select(CandidateExecution).where(CandidateExecution.id == eid, CandidateExecution.product_id == product_id)
    )
    if not row:
        raise ValueError("CandidateExecution not found")
    return str(row.requested_model or "unknown")


def op_get_resolved_model(db: Session, product_id: str, context: dict[str, Any]) -> str:
    eid = _args(context).get("candidate_execution_id")
    if not eid:
        raise ValueError("candidate_execution_id required")
    row = db.scalar(
        select(CandidateExecution).where(CandidateExecution.id == eid, CandidateExecution.product_id == product_id)
    )
    if not row:
        raise ValueError("CandidateExecution not found")
    return str(row.resolved_model or "unknown")


def op_get_execution_proven(db: Session, product_id: str, context: dict[str, Any]) -> str:
    eid = _args(context).get("evaluation_run_id")
    if not eid:
        raise ValueError("evaluation_run_id required")
    row = db.scalar(select(EvaluationRun).where(EvaluationRun.id == eid, EvaluationRun.product_id == product_id))
    if not row:
        raise ValueError("EvaluationRun not found")
    return "true" if row.execution_proven else "false"


def op_get_evaluation_cheaper(db: Session, product_id: str, context: dict[str, Any]) -> str:
    eid = _args(context).get("evaluation_run_id")
    if not eid:
        raise ValueError("evaluation_run_id required")
    row = db.scalar(select(EvaluationRun).where(EvaluationRun.id == eid, EvaluationRun.product_id == product_id))
    if not row:
        raise ValueError("EvaluationRun not found")
    if row.baseline_cost_usd is None or row.candidate_cost_usd is None:
        return "unknown"
    return "yes" if row.candidate_cost_usd < row.baseline_cost_usd else "no"


def op_get_finding_evidence_status(db: Session, product_id: str, context: dict[str, Any]) -> str:
    fid = _args(context).get("finding_id")
    if not fid:
        raise ValueError("finding_id required")
    row = db.scalar(select(Finding).where(Finding.id == fid, Finding.product_id == product_id))
    if not row:
        raise ValueError("Finding not found")
    return str(row.evidence_status)


_OPS: dict[str, Callable[[Session, str, dict[str, Any]], str]] = {
    "count_ai_calls": op_count_ai_calls,
    "list_detected_providers": op_list_detected_providers,
    "get_evaluation_status": op_get_evaluation_status,
    "get_candidate_execution_model": op_get_candidate_execution_model,
    "get_cost_source": op_get_cost_source,
    "get_finding_origin": op_get_finding_origin,
    "get_implementation_eligible": op_get_implementation_eligible,
    "get_failed_gate_names": op_get_failed_gate_names,
    "get_sample_count": op_get_sample_count,
    "get_protected_sample_count": op_get_protected_sample_count,
    "get_requested_model": op_get_requested_model,
    "get_resolved_model": op_get_resolved_model,
    "get_execution_proven": op_get_execution_proven,
    "get_evaluation_cheaper": op_get_evaluation_cheaper,
    "get_finding_evidence_status": op_get_finding_evidence_status,
}


def execute_deterministic_operation(
    db: Session,
    product_id: str,
    operation: str,
    *,
    context: dict[str, Any] | None = None,
) -> str:
    if operation not in DETERMINISTIC_OPERATIONS:
        raise ValueError(f"Unknown or non-deterministic operation: {operation}")
    handler = _OPS[operation]
    return handler(db, product_id, context or {})


def is_deterministic_operation(operation: str | None) -> bool:
    return bool(operation) and operation in DETERMINISTIC_OPERATIONS
