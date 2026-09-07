"""Non-USD work metrics for local-runtime products.

DUREM runs a local inference runtime and has no per-token price. These metrics
describe *work*, not money. Nothing here ever writes into a ``*_usd`` field, and
``verified_savings_usd`` stays ``None`` unless real cost provenance exists.

Fidelity is tracked per metric, because it differs by runtime:

REAL_STRUCTURAL
    True regardless of which runtime answered. How many times DUREM invoked a
    model, how many embeddings it requested, how many chunks it retrieved — these
    are properties of DUREM's control flow, so a stub runtime measures them just
    as faithfully as Qwen3-8B would.

SYNTHETIC_TEST_METRIC
    Produced by a stub runtime. Token counts and timings under the mock runtime
    are deterministic functions of real prompt sizes, not measurements of a real
    model. Useful for exercising the pipeline; never reportable as a result.

MEASURED
    Reported by a real local runtime on a real host.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

METRICS_VERSION = "durem_work_metrics_v1"


class MetricFidelity(StrEnum):
    REAL_STRUCTURAL = "REAL_STRUCTURAL"
    SYNTHETIC_TEST_METRIC = "SYNTHETIC_TEST_METRIC"
    MEASURED = "MEASURED"
    UNAVAILABLE = "UNAVAILABLE"


# Which fidelity each metric carries, given the runtime that produced it.
STRUCTURAL_METRICS = frozenset(
    {
        "llm_calls",
        "classifier_calls",
        "policy_generation_calls",
        "repair_calls",
        "chat_calls",
        "embedding_calls",
        "retrieved_context_units",
        "context_chars",
    }
)
RUNTIME_DEPENDENT_METRICS = frozenset(
    {"input_tokens", "output_tokens", "total_tokens", "inference_ms", "end_to_end_ms", "model_work_units"}
)


@dataclass(frozen=True)
class WorkUnitWeights:
    """Declared weights for the ``model_work_units`` composite.

    The composite is only meaningful because these weights are published with
    every result. They are not tuned, and they are folded into the metric hash so
    a reviewer can tell whether two runs used the same definition.
    """

    per_llm_call: float = 1.0
    per_embedding_call: float = 0.1
    per_input_token: float = 0.0
    per_output_token: float = 0.0

    def as_dict(self) -> dict[str, float]:
        return {
            "per_llm_call": self.per_llm_call,
            "per_embedding_call": self.per_embedding_call,
            "per_input_token": self.per_input_token,
            "per_output_token": self.per_output_token,
        }


DEFAULT_WEIGHTS = WorkUnitWeights()


@dataclass
class WorkMetrics:
    """Per-case work counters, aggregated by summation across a replay set."""

    llm_calls: int = 0
    classifier_calls: int = 0
    policy_generation_calls: int = 0
    repair_calls: int = 0
    chat_calls: int = 0
    embedding_calls: int = 0
    retrieved_context_units: int = 0
    context_chars: int = 0

    # None means the runtime did not report the value. Never coerced to 0:
    # unmeasured and zero are different facts.
    input_tokens: int | None = None
    output_tokens: int | None = None
    inference_ms: float | None = None
    end_to_end_ms: float | None = None

    @property
    def total_tokens(self) -> int | None:
        if self.input_tokens is None and self.output_tokens is None:
            return None
        return (self.input_tokens or 0) + (self.output_tokens or 0)

    def model_work_units(self, weights: WorkUnitWeights = DEFAULT_WEIGHTS) -> float:
        value = self.llm_calls * weights.per_llm_call + self.embedding_calls * weights.per_embedding_call
        if weights.per_input_token and self.input_tokens is not None:
            value += self.input_tokens * weights.per_input_token
        if weights.per_output_token and self.output_tokens is not None:
            value += self.output_tokens * weights.per_output_token
        return round(value, 6)

    @classmethod
    def from_probe(cls, probe: dict[str, Any]) -> WorkMetrics:
        """Build from one DUREM eval_probe record."""
        return cls(
            llm_calls=int(probe.get("llm_call_count", 0)),
            classifier_calls=int(probe.get("classifier_call_count", 0)),
            policy_generation_calls=int(probe.get("policy_generation_call_count", 0)),
            repair_calls=int(probe.get("repair_call_count", 0)),
            chat_calls=int(probe.get("chat_call_count", 0)),
            embedding_calls=int(probe.get("embedding_call_count", 0)),
            retrieved_context_units=int(probe.get("retrieved_chunk_count", 0)),
            context_chars=int(probe.get("context_chars", 0)),
            input_tokens=probe.get("input_tokens"),
            output_tokens=probe.get("output_tokens"),
            inference_ms=probe.get("inference_ms"),
            end_to_end_ms=probe.get("request_latency_ms"),
        )

    def __add__(self, other: WorkMetrics) -> WorkMetrics:
        def _add(a: int | float | None, b: int | float | None):
            # None + value = value; None + None stays None, so "nothing reported"
            # never silently becomes a measured zero.
            if a is None and b is None:
                return None
            return (a or 0) + (b or 0)

        return WorkMetrics(
            llm_calls=self.llm_calls + other.llm_calls,
            classifier_calls=self.classifier_calls + other.classifier_calls,
            policy_generation_calls=self.policy_generation_calls + other.policy_generation_calls,
            repair_calls=self.repair_calls + other.repair_calls,
            chat_calls=self.chat_calls + other.chat_calls,
            embedding_calls=self.embedding_calls + other.embedding_calls,
            retrieved_context_units=self.retrieved_context_units + other.retrieved_context_units,
            context_chars=self.context_chars + other.context_chars,
            input_tokens=_add(self.input_tokens, other.input_tokens),
            output_tokens=_add(self.output_tokens, other.output_tokens),
            inference_ms=_add(self.inference_ms, other.inference_ms),
            end_to_end_ms=_add(self.end_to_end_ms, other.end_to_end_ms),
        )

    def as_dict(self, weights: WorkUnitWeights = DEFAULT_WEIGHTS) -> dict[str, Any]:
        return {
            "llm_calls": self.llm_calls,
            "classifier_calls": self.classifier_calls,
            "policy_generation_calls": self.policy_generation_calls,
            "repair_calls": self.repair_calls,
            "chat_calls": self.chat_calls,
            "embedding_calls": self.embedding_calls,
            "retrieved_context_units": self.retrieved_context_units,
            "context_chars": self.context_chars,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.total_tokens,
            "inference_ms": self.inference_ms,
            "end_to_end_ms": self.end_to_end_ms,
            "model_work_units": self.model_work_units(weights),
        }


@dataclass
class MetricSelection:
    """The single number a run is compared on, plus its honest provenance."""

    name: str
    baseline_value: float | None
    candidate_value: float | None
    fidelity: MetricFidelity
    weights: dict[str, float] = field(default_factory=dict)
    note: str = ""

    @property
    def reduction_pct(self) -> float | None:
        if self.baseline_value is None or self.candidate_value is None or self.baseline_value == 0:
            return None
        return round((self.baseline_value - self.candidate_value) / self.baseline_value * 100.0, 4)

    @property
    def reportable(self) -> bool:
        """Whether this number may appear in an evidence claim.

        Synthetic metrics never may. They exist to prove the pipeline runs, and a
        percentage derived from a stub runtime is not a result.
        """
        return self.fidelity in {MetricFidelity.REAL_STRUCTURAL, MetricFidelity.MEASURED}

    def as_dict(self) -> dict[str, Any]:
        return {
            "metric": self.name,
            "baseline": self.baseline_value,
            "candidate": self.candidate_value,
            "reduction_pct": self.reduction_pct,
            "fidelity": self.fidelity.value,
            "reportable": self.reportable,
            "weights": self.weights,
            "note": self.note,
        }


def fidelity_for(metric_name: str, runtime_is_real: bool) -> MetricFidelity:
    if metric_name in STRUCTURAL_METRICS:
        # Control-flow facts. A stub runtime measures these just as faithfully.
        return MetricFidelity.REAL_STRUCTURAL
    if metric_name in RUNTIME_DEPENDENT_METRICS:
        return MetricFidelity.MEASURED if runtime_is_real else MetricFidelity.SYNTHETIC_TEST_METRIC
    return MetricFidelity.UNAVAILABLE


def select_metric(
    *,
    name: str,
    baseline: WorkMetrics,
    candidate: WorkMetrics | None,
    runtime_is_real: bool,
    weights: WorkUnitWeights = DEFAULT_WEIGHTS,
) -> MetricSelection:
    def _value(metrics: WorkMetrics | None) -> float | None:
        if metrics is None:
            return None
        if name == "model_work_units":
            return metrics.model_work_units(weights)
        value = getattr(metrics, name, None)
        if value is None and name == "total_tokens":
            return None
        return float(value) if value is not None else None

    fidelity = fidelity_for(name, runtime_is_real)
    note = ""
    if fidelity is MetricFidelity.SYNTHETIC_TEST_METRIC:
        note = (
            "SYNTHETIC_TEST_METRIC: produced by the stub runtime. Deterministic "
            "function of real prompt sizes, not a measurement of a real model. "
            "Not reportable as a result."
        )
    elif fidelity is MetricFidelity.REAL_STRUCTURAL:
        note = "Structural counter: a property of DUREM's control flow, identical whichever runtime answered."
    return MetricSelection(
        name=name,
        baseline_value=_value(baseline),
        candidate_value=_value(candidate),
        fidelity=fidelity,
        weights=weights.as_dict() if name == "model_work_units" else {},
        note=note,
    )


def approx_tokens(text: str) -> int:
    """Deterministic synthetic token estimate used only by the stub runtime."""
    return max(1, math.ceil(len(text) / 4))
