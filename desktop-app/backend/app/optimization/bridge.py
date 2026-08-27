"""Bridge between execution-proven CandidateExecution and LEGACY_CANDIDATE_EVIDENCE fields.

Does NOT mark experiments VERIFIED. Only projects measured candidate fields onto Trace
rows when explicitly requested, with execution_proven provenance in metadata.
"""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db_models import CandidateExecution, Trace
from .models import EXECUTION_PROVEN, LEGACY_CANDIDATE_EVIDENCE, ExecutionStatus


def is_legacy_candidate_evidence(trace: Trace) -> bool:
    """True when candidate_* exists without execution-proven metadata."""
    if trace.candidate_output is None and trace.candidate_cost_usd is None:
        return False
    meta = {}
    if trace.metadata_json:
        try:
            meta = json.loads(trace.metadata_json)
        except Exception:
            meta = {}
    if meta.get("execution_proven") is True or meta.get("evidence_label") == EXECUTION_PROVEN:
        return False
    return True


def project_execution_onto_traces(
    db: Session,
    execution: CandidateExecution,
    *,
    overwrite: bool = False,
) -> int:
    """Copy SUCCEEDED sample results into Trace.candidate_* with execution_proven=true.

    Baseline Trace rows are never deleted. This does not create Experiment VERIFIED status.
    """
    if execution.status != ExecutionStatus.SUCCEEDED.value:
        raise ValueError("Only SUCCEEDED executions can be projected.")
    samples = json.loads(execution.sample_results_json or "[]")
    updated = 0
    for sample in samples:
        if sample.get("status") != "succeeded":
            continue
        trace = db.scalar(select(Trace).where(Trace.id == sample["baseline_trace_id"]))
        if not trace:
            continue
        if (
            not overwrite
            and (trace.candidate_output is not None or trace.candidate_cost_usd is not None)
            and is_legacy_candidate_evidence(trace)
        ):
            # Do not silently replace LEGACY_CANDIDATE_EVIDENCE without overwrite.
            continue
        if not overwrite and trace.candidate_output is not None:
            meta_existing = {}
            if trace.metadata_json:
                try:
                    meta_existing = json.loads(trace.metadata_json)
                except Exception:
                    meta_existing = {}
            if meta_existing.get("execution_proven") and meta_existing.get("candidate_execution_id") == execution.id:
                continue

        meta = {}
        if trace.metadata_json:
            try:
                meta = json.loads(trace.metadata_json)
            except Exception:
                meta = {}
        meta.update(
            {
                "execution_proven": True,
                "evidence_label": EXECUTION_PROVEN,
                "legacy_label": LEGACY_CANDIDATE_EVIDENCE,
                "candidate_execution_id": execution.id,
                "candidate_plan_id": execution.candidate_plan_id,
                "not_verified": True,
            }
        )
        trace.candidate_output = sample.get("output_text")
        trace.candidate_cost_usd = sample.get("cost_usd")
        trace.candidate_latency_ms = sample.get("latency_ms")
        trace.metadata_json = json.dumps(meta, ensure_ascii=False)
        db.add(trace)
        updated += 1
    db.commit()
    return updated
