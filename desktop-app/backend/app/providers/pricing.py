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

    def merge_rates(self, models: dict[str, dict], *, version: str, source: str | None = None) -> int:
        """Overlay public list prices fetched from the ZEVQORA platform.

        Only entries carrying both input and output rates are accepted, so an
        incomplete row can never turn an unknown model into a priced one. The
        snapshot version records both origins so evidence stays attributable.
        """
        merged = 0
        for model, entry in (models or {}).items():
            if not isinstance(entry, dict):
                continue
            inp = entry.get("input_per_million")
            out = entry.get("output_per_million")
            if inp is None or out is None:
                continue
            try:
                clean: dict = {
                    "provider": str(entry.get("provider") or str(model).split("/")[0]),
                    "input_per_million": float(inp),
                    "output_per_million": float(out),
                }
            except (TypeError, ValueError):
                continue
            cached = entry.get("cached_input_per_million")
            if cached is not None:
                try:
                    clean["cached_input_per_million"] = float(cached)
                except (TypeError, ValueError):
                    pass
            self.models[str(model)] = clean
            merged += 1
        if merged:
            base = self.version.split("+")[0]
            self.version = f"{base}+{version}"
            if source:
                self.source = f"{self.source or 'local'}+{source}"
        return merged

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
            raise PricingUnavailableError(f"No verified pricing rates for model {model!r} in snapshot {self.version}.")
        # Unreported token counts must never be priced as zero. A response with no
        # usage block is an unmeasured call, not a free one.
        if usage.input_tokens is None or usage.output_tokens is None:
            raise PricingUnavailableError(
                f"Token usage not reported for model {model!r} "
                f"(input_tokens={usage.input_tokens}, output_tokens={usage.output_tokens}); refusing to estimate cost."
            )
        input_rate = float(entry["input_per_million"])
        output_rate = float(entry["output_per_million"])
        cached_rate = entry.get("cached_input_per_million")
        cached_rate_f = float(cached_rate) if cached_rate is not None else input_rate * 0.5

        # cached_input_tokens and reasoning_tokens are SUBSETS of input_tokens and
        # output_tokens respectively, so neither is added on top of its parent total:
        # cached is re-priced at the cached rate, reasoning is already billed inside
        # output_tokens and is carried as reporting metadata only.
        billable_input = max(0, usage.input_tokens - usage.cached_input_tokens)
        cost = (
            (billable_input / 1_000_000.0) * input_rate
            + (usage.cached_input_tokens / 1_000_000.0) * cached_rate_f
            + (usage.output_tokens / 1_000_000.0) * output_rate
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
        provider_cost_explicit: bool = False,
    ) -> CostBreakdown:
        # Three distinct states, deliberately not collapsed:
        #   None                        -> cost unknown, fall through to estimate
        #   0.0 with explicit=True      -> the provider really did report $0.00
        #                                  (free tier, promotional credit); a real
        #                                  measurement and recorded as such
        #   0.0 with explicit=False     -> a default or placeholder zero, e.g. a
        #                                  mock's constructor default. Never allowed
        #                                  to masquerade as a measured provider cost.
        # Only a caller that saw a genuine cost field in the provider payload may
        # set provider_cost_explicit.
        trustworthy = provider_cost_usd is not None and (provider_cost_usd > 0 or provider_cost_explicit)
        if trustworthy:
            return CostBreakdown(
                cost_usd=round(float(provider_cost_usd), 10),
                cost_source=CostSource.PROVIDER_REPORTED,
                # Dollars came from the provider — do not imply local snapshot arithmetic.
                pricing_version=None,
                provider=provider,
                model=model,
                computed_at=datetime.now(UTC),
                provider_metadata_source=self.source,
                provider_metadata_retrieved_at=self.retrieved_at,
                provider_metadata_version=self.version,
            )
        try:
            return self.estimate_cost(provider=provider, model=model, usage=usage)
        except PricingUnavailableError:
            return CostBreakdown(
                cost_usd=None,
                cost_source=None,
                # No arithmetic happened, so no pricing_version may be claimed.
                # Record the snapshot that was consulted as catalog metadata instead.
                pricing_version=None,
                provider=provider,
                model=model,
                computed_at=datetime.now(UTC),
                provider_metadata_version=self.version,
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
