from __future__ import annotations

import json
import uuid
from collections import Counter
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db_models import Experiment, Trace
from ..schemas import EconomicsOut, TraceIn


def import_traces(db: Session, product_id: str, traces: list[TraceIn]) -> int:
    imported = 0
    for item in traces:
        trace = Trace(
            id=str(uuid.uuid4()),
            product_id=product_id,
            request_id=item.request_id,
            timestamp=item.timestamp,
            symbol=item.symbol,
            workflow=item.workflow,
            provider=item.provider,
            model=item.model,
            input_text=item.input_text,
            output_text=item.output_text,
            expected_output=item.expected_output,
            candidate_output=item.candidate_output,
            input_tokens=item.input_tokens,
            output_tokens=item.output_tokens,
            latency_ms=item.latency_ms,
            candidate_latency_ms=item.candidate_latency_ms,
            cost_usd=item.cost_usd,
            candidate_cost_usd=item.candidate_cost_usd,
            protected=item.protected,
            metadata_json=json.dumps(item.metadata, ensure_ascii=False),
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
    verified = list(
        db.scalars(
            select(Experiment).where(
                Experiment.product_id == product_id,
                Experiment.status == "VERIFIED",
            )
        )
    )
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
            "Observed values come only from imported execution evidence. No monthly projection is fabricated."
            if traces
            else "No runtime evidence imported yet. Static findings are not Verified Savings."
        ),
    )
