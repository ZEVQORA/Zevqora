from __future__ import annotations

from typing import Any

from ..core.hashing import sha256_text
from ..providers.models import CostSource
from ..schemas import TraceIn
from .models import TraceTelemetryFields


def normalize_imported_trace(trace: TraceIn) -> dict[str, Any]:
    """Enrich imported traces without stripping evidence text.

    Cost provenance for imports defaults to imported_external when cost_usd is present
    and no stronger cost_source is explicitly supplied in metadata.
    """
    meta = dict(trace.metadata or {})
    explicit_source = meta.pop("cost_source", None)
    pricing_version = meta.pop("pricing_version", None)

    cost_source: str | None = None
    if isinstance(explicit_source, str) and explicit_source in {
        CostSource.PROVIDER_REPORTED.value,
        CostSource.PRICING_SNAPSHOT_ESTIMATE.value,
        CostSource.IMPORTED_EXTERNAL.value,
    }:
        cost_source = explicit_source
    elif trace.cost_usd is not None:
        cost_source = CostSource.IMPORTED_EXTERNAL.value

    fields = TraceTelemetryFields(
        requested_model=meta.pop("requested_model", None) or trace.model,
        response_model=meta.pop("response_model", None) or trace.model,
        provider_request_id=meta.pop("provider_request_id", None),
        cached_input_tokens=meta.pop("cached_input_tokens", None),
        reasoning_tokens=meta.pop("reasoning_tokens", None),
        cost_source=cost_source,
        pricing_version=pricing_version if isinstance(pricing_version, str) else None,
        ttft_ms=meta.pop("ttft_ms", None),
        attempt=meta.pop("attempt", None),
        retry_reason=meta.pop("retry_reason", None),
        input_hash=sha256_text(trace.input_text),
        output_hash=sha256_text(trace.output_text),
        metadata=meta,
    )
    # Preserve existing text fields for evaluation compatibility.
    return {
        "input_text": trace.input_text,
        "output_text": trace.output_text,
        "fields": fields,
        "metadata": meta,
    }
