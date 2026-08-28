"""Which evaluation counts, when one candidate execution has been evaluated more than once.

Re-evaluations are append-only: EvaluationRun v1, v2, v3 all survive as history and
none is ever mutated or deleted. But aggregate economics must not add up the same
measurement three times, so exactly one run per candidate execution is canonical.

Selection rule (deliberately explicit, because it decides what "verified savings"
means):

  1. finalized runs only  — a RUNNING/PLANNED run has not produced a result
  2. VERIFIED only        — for verified-savings aggregation specifically
  3. latest wins          — the most recent eligible VERIFIED run for that
                            candidate_execution_id
  4. history is preserved — earlier runs stay queryable, they simply do not
                            contribute to the aggregate

A legacy Experiment carrying no candidate_execution_id cannot be deduplicated
against anything, so it is keyed by its own id and counted once.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db_models import Experiment


def canonical_verified_experiments(db: Session, product_id: str) -> list[Experiment]:
    """One VERIFIED Experiment per candidate execution, newest first."""
    rows = list(
        db.scalars(
            select(Experiment)
            .where(
                Experiment.product_id == product_id,
                Experiment.status == "VERIFIED",
            )
            .order_by(Experiment.created_at.desc())
        )
    )
    canonical: dict[str, Experiment] = {}
    for row in rows:
        # Legacy rows without an execution link are their own group.
        key = row.candidate_execution_id or f"experiment:{row.id}"
        # rows are newest-first, so the first hit for a key is the latest.
        canonical.setdefault(key, row)
    return list(canonical.values())
