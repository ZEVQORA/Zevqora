from __future__ import annotations

from .strategies.base import OptimizationStrategy
from .strategies.exact_reuse import ExactReuseStrategy
from .strategies.model_substitution import ModelSubstitutionStrategy

_STRATEGIES: dict[str, OptimizationStrategy] = {
    ExactReuseStrategy.name: ExactReuseStrategy(),
    ModelSubstitutionStrategy.name: ModelSubstitutionStrategy(),
}


def get_strategy(name: str) -> OptimizationStrategy:
    try:
        return _STRATEGIES[name]
    except KeyError as exc:
        raise KeyError(f"Unknown optimization strategy: {name}") from exc


def list_strategies() -> list[str]:
    return sorted(_STRATEGIES)
