from __future__ import annotations

import json
import time
from typing import Any

from sqlalchemy.orm import Session

from ...core.hashing import sha256_json, sha256_text
from ...db_models import CandidatePlan, Finding, Trace
from ...providers.models import CostSource
from ..models import EligibilityResult, PlanDraft, PlanStatus, SampleResult, StrategyName
from .base import OptimizationStrategy

# Minimum repeated equivalent executions required for safe exact reuse.
MIN_REUSE_GROUP_SIZE = 2


def _parse_metadata(trace: Trace) -> dict[str, Any]:
    if not trace.metadata_json:
        return {}
    try:
        raw = json.loads(trace.metadata_json)
        return raw if isinstance(raw, dict) else {}
    except Exception:
        return {}


def reuse_identity(trace: Trace) -> dict[str, Any]:
    """Behavior-affecting factors for safe cache equivalence.

    Two traces MUST share this identity to be considered reusable.
    Differences in model, system prompt, tools, temperature, workflow, or context
    produce different identities — lookalike text alone is never enough.
    """
    meta = _parse_metadata(trace)
    input_norm = sha256_text(trace.input_text) or sha256_text(trace.expected_output)
    return {
        "input_hash": input_norm,
        "symbol": trace.symbol or "",
        "workflow": trace.workflow or "",
        "provider": (trace.provider or "").lower(),
        "model": (trace.model or trace.requested_model or "").strip(),
        "temperature": meta.get("temperature"),
        "system_prompt_version": meta.get("system_prompt_version") or meta.get("prompt_version"),
        "tool_schema_hash": meta.get("tool_schema_hash"),
        "context_id": meta.get("context_id") or meta.get("retrieval_context_id"),
        "model_config": meta.get("model_config") or meta.get("generation_config"),
    }


def reuse_identity_hash(trace: Trace) -> str | None:
    identity = reuse_identity(trace)
    if not identity.get("input_hash"):
        return None
    return sha256_json(identity)


def _unsafe_for_reuse(trace: Trace) -> str | None:
    if trace.protected:
        return "Protected/high-risk traces are not eligible for exact reuse."
    meta = _parse_metadata(trace)
    if meta.get("side_effects") or meta.get("non_idempotent") or meta.get("state_changing"):
        return "Trace metadata indicates non-idempotent or state-changing behavior."
    if meta.get("personalized") or meta.get("session_id"):
        # Session-specific output requires session in identity; we refuse unless context_id set.
        if not meta.get("context_id") and not meta.get("retrieval_context_id"):
            return "Personalized/session-specific traces lack a safe context identity."
    if meta.get("tools_executed") or meta.get("has_tool_calls"):
        return "Traces with tool execution are not eligible for exact reuse."
    if not trace.output_text:
        return "Baseline output missing; cannot reuse an empty result."
    if not (trace.input_text or trace.expected_output):
        return "No normalized input/task identity available."
    return None


class ExactReuseStrategy(OptimizationStrategy):
    name = StrategyName.EXACT_REUSE.value

    def eligibility(
        self,
        db: Session,
        product_id: str,
        traces: list[Trace],
        finding: Finding | None = None,
        *,
        candidate_model: str | None = None,
    ) -> EligibilityResult:
        scoped = list(traces)
        if finding and finding.symbol:
            matching = [t for t in traces if t.symbol == finding.symbol]
            if matching:
                scoped = matching

        groups: dict[str, list[Trace]] = {}
        blocked_reasons: list[str] = []
        for trace in scoped:
            unsafe = _unsafe_for_reuse(trace)
            if unsafe:
                blocked_reasons.append(f"{trace.id}: {unsafe}")
                continue
            key = reuse_identity_hash(trace)
            if not key:
                blocked_reasons.append(f"{trace.id}: insufficient identity")
                continue
            groups.setdefault(key, []).append(trace)

        reusable = {k: v for k, v in groups.items() if len(v) >= MIN_REUSE_GROUP_SIZE}
        if not reusable:
            return EligibilityResult(
                eligible=False,
                blocked=True,
                reason=(
                    "Exact reuse requires repeated equivalent runtime evidence "
                    f"(min group size {MIN_REUSE_GROUP_SIZE}). Static source alone is insufficient."
                ),
                details={
                    "blocked_samples": blocked_reasons[:20],
                    "group_sizes": {k: len(v) for k, v in groups.items()},
                },
            )

        # For each group, later duplicates can reuse the first validated result.
        evidence_ids: list[str] = []
        cache_groups: dict[str, list[str]] = {}
        for key, members in reusable.items():
            # Prefer chronological / insertion order; Trace has no guarantee — use request_id sort.
            ordered = sorted(members, key=lambda t: (t.timestamp is None, t.timestamp or t.request_id, t.id))
            cache_groups[key] = [t.id for t in ordered]
            # Samples after the first are candidates for reuse.
            evidence_ids.extend(t.id for t in ordered[1:])

        return EligibilityResult(
            eligible=True,
            reason=f"Found {len(reusable)} equivalence group(s) with repeated runtime evidence.",
            evidence_trace_ids=evidence_ids,
            cache_groups=cache_groups,
            details={"min_group_size": MIN_REUSE_GROUP_SIZE},
        )

    def plan(
        self,
        db: Session,
        product_id: str,
        traces: list[Trace],
        finding: Finding | None = None,
        *,
        candidate_model: str | None = None,
        max_budget_usd: float | None = None,
    ) -> PlanDraft:
        elig = self.eligibility(db, product_id, traces, finding, candidate_model=candidate_model)
        if not elig.eligible:
            return PlanDraft(
                strategy=StrategyName.EXACT_REUSE,
                status=PlanStatus.BLOCKED,
                finding_id=finding.id if finding else None,
                reason=elig.reason,
                expected_mechanism="exact_reuse_cache",
                risk="low",
                max_budget_usd=0.0,
                blocked_reason=elig.reason,
                required_evidence=["repeated_equivalent_runtime_traces"],
            )

        return PlanDraft(
            strategy=StrategyName.EXACT_REUSE,
            status=PlanStatus.READY,
            finding_id=finding.id if finding else None,
            baseline_config={
                "cache_groups": elig.cache_groups,
                "identity_fields": [
                    "input_hash",
                    "symbol",
                    "workflow",
                    "provider",
                    "model",
                    "temperature",
                    "system_prompt_version",
                    "tool_schema_hash",
                    "context_id",
                    "model_config",
                ],
            },
            candidate_config={
                "provider_call_count": 0,
                "cost_source": CostSource.DETERMINISTIC_REUSE.value,
            },
            reason=elig.reason,
            expected_mechanism="Return previously validated identical output without a provider call.",
            risk="low",
            fallback="retain_baseline",
            required_evidence=["repeated_equivalent_runtime_traces", "non_protected", "idempotent"],
            max_budget_usd=0.0,
            sample_scope=elig.evidence_trace_ids,
        )

    def estimate_budget(self, plan: CandidatePlan | PlanDraft, traces: list[Trace]) -> float:
        return 0.0

    async def execute_sample(
        self,
        *,
        plan: CandidatePlan,
        baseline: Trace,
        reuse_source: Trace | None = None,
        provider: object | None = None,
    ) -> SampleResult:
        started = time.perf_counter()
        if reuse_source is None or not reuse_source.output_text:
            return SampleResult(
                baseline_trace_id=baseline.id,
                status="failed",
                error_category="ineligible",
                error_detail="Exact reuse requires a validated source trace with output.",
                execution_proven=False,
            )
        if reuse_identity_hash(baseline) != reuse_identity_hash(reuse_source):
            return SampleResult(
                baseline_trace_id=baseline.id,
                status="failed",
                error_category="ineligible",
                error_detail="Baseline and reuse source do not share cache identity.",
                execution_proven=False,
            )
        unsafe = _unsafe_for_reuse(baseline) or _unsafe_for_reuse(reuse_source)
        if unsafe:
            return SampleResult(
                baseline_trace_id=baseline.id,
                status="failed",
                error_category="ineligible",
                error_detail=unsafe,
                execution_proven=False,
            )

        latency_ms = (time.perf_counter() - started) * 1000.0
        baseline_cost = baseline.cost_usd
        # Measured no-provider path: cost is 0 with explicit deterministic_reuse provenance.
        return SampleResult(
            baseline_trace_id=baseline.id,
            status="succeeded",
            output_text=reuse_source.output_text,
            input_tokens=0,
            output_tokens=0,
            cached_input_tokens=0,
            cost_usd=0.0,
            cost_source=CostSource.DETERMINISTIC_REUSE.value,
            pricing_version=None,
            latency_ms=latency_ms,
            provider_request_id=None,
            provider_call_count=0,
            reused_from_trace_id=reuse_source.id,
            baseline_cost_usd=baseline_cost,
            candidate_cost_delta_usd=(0.0 - baseline_cost) if baseline_cost is not None else None,
            execution_proven=True,
        )
