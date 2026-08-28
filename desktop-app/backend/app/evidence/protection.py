"""Which evidence rows are load-bearing, and therefore not freely destroyable.

A VERIFIED evaluation is only auditable while the baseline traces it was computed
from still exist and still say what they said. Once a referenced trace is deleted,
`baseline_evidence_hash` can never be recomputed and the verification record
survives as an unfalsifiable claim. Once one is rewritten in place, the record
silently stops matching the evidence beneath it.

So a trace is *pinned* when a finalized evaluation or a candidate execution refers
to it. Pinned traces are refused rather than cascaded, and rewritten only through
an explicit, scoped path.
"""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db_models import CandidateExecution, EvaluationCaseResult, EvaluationRun, Trace

# A run in one of these states has produced a result someone may rely on.
# PLANNED/RUNNING have not, so they pin nothing.
FINALIZED_EVALUATION_STATUSES = frozenset({"INCOMPLETE", "VERIFIED", "REJECTED", "FAILED", "CANCELLED"})

# Only these assert a measured outcome worth protecting from a product disconnect.
CONCLUSIVE_EVALUATION_STATUSES = frozenset({"VERIFIED", "REJECTED"})


def pinned_trace_ids(db: Session, product_id: str) -> set[str]:
    """Trace ids this product's finalized evidence depends on."""
    pinned: set[str] = set()

    rows = db.execute(
        select(EvaluationCaseResult.baseline_trace_id)
        .join(EvaluationRun, EvaluationRun.id == EvaluationCaseResult.evaluation_run_id)
        .where(
            EvaluationRun.product_id == product_id,
            EvaluationRun.status.in_(tuple(FINALIZED_EVALUATION_STATUSES)),
        )
    ).all()
    pinned.update(r[0] for r in rows if r[0])

    for (raw,) in db.execute(
        select(CandidateExecution.baseline_trace_ids_json).where(CandidateExecution.product_id == product_id)
    ).all():
        try:
            ids = json.loads(raw or "[]")
        except json.JSONDecodeError:
            continue
        if isinstance(ids, list):
            pinned.update(str(i) for i in ids if i)

    return pinned


def pinning_evaluation_ids(db: Session, product_id: str, trace_ids: set[str]) -> list[str]:
    """Finalized evaluation runs that depend on any of `trace_ids` — for error detail."""
    if not trace_ids:
        return []
    rows = db.execute(
        select(EvaluationRun.id)
        .join(EvaluationCaseResult, EvaluationCaseResult.evaluation_run_id == EvaluationRun.id)
        .where(
            EvaluationRun.product_id == product_id,
            EvaluationRun.status.in_(tuple(FINALIZED_EVALUATION_STATUSES)),
            EvaluationCaseResult.baseline_trace_id.in_(tuple(trace_ids)),
        )
        .distinct()
    ).all()
    return [r[0] for r in rows]


def product_trace_ids(db: Session, product_id: str) -> set[str]:
    rows = db.execute(select(Trace.id).where(Trace.product_id == product_id)).all()
    return {r[0] for r in rows}


def has_conclusive_evidence(db: Session, product_id: str) -> bool:
    """Whether this product carries a VERIFIED or REJECTED evaluation."""
    found = db.scalar(
        select(EvaluationRun.id)
        .where(
            EvaluationRun.product_id == product_id,
            EvaluationRun.status.in_(tuple(CONCLUSIVE_EVALUATION_STATUSES)),
        )
        .limit(1)
    )
    return found is not None
