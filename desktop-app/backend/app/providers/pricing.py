from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from ..core.errors import PricingUnavailableError
from .models import CostBreakdown, CostSource, LLMUsage


class PricingSnapshot:
    """Versioned local pricing table. Never invent rates for unknown models."""

    def __init__(self, path: Path) -> None:
        self.path = path
        raw = json.loads(path.read_text(encoding="utf-8"))
        self.version: str = str(raw["version"])
        self.retrieved_at: str | None = raw.get("retrieved_at")
        self.source: str | None = raw.get("source")
        self.source_url: str | None = raw.get("source_url")
        self.models: dict[str, dict] = raw.get("models") or {}

    @classmethod
    def load(cls, path: str | Path) -> PricingSnapshot:
        return cls(Path(path))

    def has_verified_rates(self, model: str) -> bool:
        entry = self.models.get(model)
        if not entry:
            return False
        return entry.get("input_per_million") is not None and entry.get("output_per_million") is not None

    def estimate_cost(
        self,
        *,
        provider: str,
        model: str,
        usage: LLMUsage,
    ) -> CostBreakdown:
        entry = self.models.get(model)
        if not entry or entry.get("input_per_million") is None or entry.get("output_per_million") is None:
            raise PricingUnavailableError(
                f"No verified pricing rates for model {model!r} in snapshot {self.version}."
            )
        input_rate = float(entry["input_per_million"])
        output_rate = float(entry["output_per_million"])
        cached_rate = entry.get("cached_input_per_million")
        cached_rate_f = float(cached_rate) if cached_rate is not None else input_rate * 0.5

        billable_input = max(0, usage.input_tokens - usage.cached_input_tokens)
        cost = (
            (billable_input / 1_000_000.0) * input_rate
            + (usage.cached_input_tokens / 1_000_000.0) * cached_rate_f
            + (usage.output_tokens / 1_000_000.0) * output_rate
            + (usage.reasoning_tokens / 1_000_000.0) * output_rate
        )
        return CostBreakdown(
            cost_usd=round(cost, 10),
            cost_source=CostSource.PRICING_SNAPSHOT_ESTIMATE,
            pricing_version=self.version,
            provider=provider,
            model=model,
            input_rate_per_million=input_rate,
            output_rate_per_million=output_rate,
            cached_rate_per_million=cached_rate_f,
            computed_at=datetime.now(UTC),
        )

    def resolve_cost(
        self,
        *,
        provider: str,
        model: str,
        usage: LLMUsage,
        provider_cost_usd: float | None,
    ) -> CostBreakdown:
        if provider_cost_usd is not None and provider_cost_usd >= 0:
            entry = self.models.get(model) or {}
            return CostBreakdown(
                cost_usd=round(float(provider_cost_usd), 10),
                cost_source=CostSource.PROVIDER_REPORTED,
                pricing_version=self.version,
                provider=provider,
                model=model,
                input_rate_per_million=entry.get("input_per_million"),
                output_rate_per_million=entry.get("output_per_million"),
                cached_rate_per_million=entry.get("cached_input_per_million"),
                computed_at=datetime.now(UTC),
            )
        try:
            return self.estimate_cost(provider=provider, model=model, usage=usage)
        except PricingUnavailableError:
            return CostBreakdown(
                cost_usd=None,
                cost_source=None,
                pricing_version=self.version,
                provider=provider,
                model=model,
                computed_at=datetime.now(UTC),
            )


_default_snapshot: PricingSnapshot | None = None


def get_pricing_snapshot(path: str | None = None) -> PricingSnapshot:
    global _default_snapshot
    if path is not None:
        return PricingSnapshot.load(path)
    if _default_snapshot is None:
        from ..core.config import settings

        _default_snapshot = PricingSnapshot.load(settings.pricing_snapshot_path)
    return _default_snapshot


def reset_pricing_snapshot_cache() -> None:
    global _default_snapshot
    _default_snapshot = None
