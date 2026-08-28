from __future__ import annotations

import json
import uuid
from collections import Counter
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db_models import Trace
from ..schemas import EconomicsOut, TraceIn
from ..telemetry.normalizer import normalize_imported_trace
from .canonical import canonical_verified_experiments


def import_traces(db: Session, product_id: str, traces: list[TraceIn]) -> int:
    """Import traces, skipping request_ids this product already has.

    Import was non-idempotent: a retried or double-clicked POST duplicated every
    row, doubling observed_cost_usd and letting a five-sample file satisfy a
    ten-sample gate on five real observations. (product_id, request_id) is now
    unique at the schema level; this skips rather than raising so a partial
    re-import of a longer file still lands the new rows.
    """
    existing = {r[0] for r in db.execute(select(Trace.request_id).where(Trace.product_id == product_id)).all()}
    seen_in_batch: set[str] = set()
    imported = 0
    for item in traces:
        if item.request_id in existing or item.request_id in seen_in_batch:
            continue
        seen_in_batch.add(item.request_id)
        normalized = normalize_imported_trace(item)
        fields = normalized["fields"]
        trace = Trace(
            id=str(uuid.uuid4()),
            product_id=product_id,
            request_id=item.request_id,
            timestamp=item.timestamp,
            symbol=item.symbol,
            workflow=item.workflow,
            provider=item.provider,
            model=item.model or fields.requested_model,
            requested_model=fields.requested_model,
            response_model=fields.response_model,
            provider_request_id=fields.provider_request_id,
            input_text=normalized["input_text"],
            output_text=normalized["output_text"],
            expected_output=item.expected_output,
            candidate_output=item.candidate_output,
            input_tokens=item.input_tokens,
            output_tokens=item.output_tokens,
            cached_input_tokens=fields.cached_input_tokens,
            reasoning_tokens=fields.reasoning_tokens,
            latency_ms=item.latency_ms,
            ttft_ms=fields.ttft_ms,
            candidate_latency_ms=item.candidate_latency_ms,
            cost_usd=item.cost_usd,
            cost_source=fields.cost_source,
            pricing_version=fields.pricing_version,
            candidate_cost_usd=item.candidate_cost_usd,
            attempt=fields.attempt,
            retry_reason=fields.retry_reason,
            input_hash=fields.input_hash,
            output_hash=fields.output_hash,
            protected=item.protected,
            metadata_json=json.dumps({**item.metadata, **normalized["metadata"]}, ensure_ascii=False),
        )
        db.add(trace)
        imported += 1
    db.commit()
    from .diagnosis import diagnose_runtime_evidence

    diagnose_runtime_evidence(db, product_id)
    return imported


def economics(db: Session, product_id: str) -> EconomicsOut:
    traces = list(db.scalars(select(Trace).where(Trace.product_id == product_id)))
    costs = [t.cost_usd for t in traces if t.cost_usd is not None]
    latencies = [t.latency_ms for t in traces if t.latency_ms is not None]
    timestamps: list[datetime] = [t.timestamp for t in traces if t.timestamp is not None]
    providers = Counter(t.provider or "unknown" for t in traces)
    verified = canonical_verified_experiments(db, product_id)
    verified_savings = sum(e.verified_savings_usd or 0.0 for e in verified)

    return EconomicsOut(
        trace_count=len(traces),
        observed_cost_usd=round(sum(costs), 8) if costs else None,
        avg_cost_per_trace_usd=round(sum(costs) / len(costs), 8) if costs else None,
        avg_latency_ms=round(sum(latencies) / len(latencies), 2) if latencies else None,
        first_evidence_at=min(timestamps) if timestamps else None,
        latest_evidence_at=max(timestamps) if timestamps else None,
        providers=dict(providers),
        verified_savings_usd=round(verified_savings, 8),
        verified_experiments=len(verified),
        note=(
            "Observed values come only from imported execution evidence. "
            "Imported costs are imported_external provenance, not provider-verified. "
            "No monthly projection is fabricated. "
            "Experiment verification of pre-filled candidate_* fields is LEGACY and not execution-proven."
            if traces
            else "No runtime evidence imported yet. Static findings are not Verified Savings."
        ),
    )
