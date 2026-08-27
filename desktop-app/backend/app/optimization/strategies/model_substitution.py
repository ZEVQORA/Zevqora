from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ...core.config import settings
from ...core.content import bound_text
from ...core.errors import PricingUnavailableError
from ...core.hashing import sha256_text
from ...db_models import CandidatePlan, Finding, Trace
from ...evidence.replay import ReplayableRequestSnapshot
from ...providers.base import LLMProvider
from ...providers.factory import get_provider
from ...providers.models import LLMMessage, LLMRequest
from ...providers.pricing import get_pricing_snapshot
from ..fingerprints import (
    baseline_evidence_hash,
    execution_configuration_fingerprint,
    task_fingerprint_from_request,
    task_fingerprint_from_trace,
)
from ..models import (
    EligibilityResult,
    ErrorCategory,
    PlanDraft,
    PlanStatus,
    SampleResult,
    StrategyName,
)
from .base import OptimizationStrategy


def allowed_candidate_models() -> set[str]:
    return set(settings.candidate_models)


def classify_provider_error(exc: Exception) -> tuple[ErrorCategory, str]:
    text = str(exc).lower()
    if "timeout" in text:
        return ErrorCategory.TIMEOUT, str(exc)[:500]
    if "429" in text or "rate" in text:
        return ErrorCategory.RATE_LIMIT, str(exc)[:500]
    if "401" in text or "403" in text or "auth" in text:
        return ErrorCategory.AUTH, str(exc)[:500]
    if "404" in text or "model" in text and "not" in text:
        return ErrorCategory.INVALID_MODEL, str(exc)[:500]
    if "5" in text and ("00" in text or "02" in text or "03" in text):
        return ErrorCategory.PROVIDER_5XX, str(exc)[:500]
    if "json" in text or "malformed" in text:
        return ErrorCategory.MALFORMED, str(exc)[:500]
    return ErrorCategory.UNKNOWN, str(exc)[:500]


def estimate_sample_cost_usd(
    model: str,
    baseline: Trace,
    *,
    max_output_tokens: int | None = None,
) -> float | None:
    """Conservative estimate using baseline token counts (and optional max output) when rates exist."""
    pricing = get_pricing_snapshot()
    if not pricing.has_verified_rates(model):
        return None
    from ...providers.models import LLMUsage

    text = baseline.input_text or baseline.expected_output or ""
    # Floor when imported traces lack token counts — prefer over-estimate to under-estimate.
    approx_in = max(len(text) // 4, 1) if text else 0
    in_tokens = max(baseline.input_tokens or 0, approx_in, 64 if text else 0)
    out_tokens = baseline.output_tokens or 0
    if max_output_tokens is not None:
        out_tokens = max(out_tokens, max_output_tokens)
    usage = LLMUsage(
        input_tokens=in_tokens,
        output_tokens=out_tokens,
        cached_input_tokens=baseline.cached_input_tokens or 0,
        total_tokens=in_tokens + out_tokens,
    )
    try:
        cost = pricing.resolve_cost(provider="openrouter", model=model, usage=usage, provider_cost_usd=None)
    except PricingUnavailableError:
        return None
    if cost.cost_usd is None:
        return None
    # Pad 25% for conservatism when budgeting.
    return float(cost.cost_usd) * 1.25


SMOKE_MAX_OUTPUT_TOKENS = 64


class ModelSubstitutionStrategy(OptimizationStrategy):
    name = StrategyName.MODEL_SUBSTITUTION.value

    def eligibility(
        self,
        db: Session,
        product_id: str,
        traces: list[Trace],
        finding: Finding | None = None,
        *,
        candidate_model: str | None = None,
        include_protected: bool = False,
        sample_trace_ids: list[str] | None = None,
    ) -> EligibilityResult:
        if not candidate_model:
            return EligibilityResult(
                eligible=False,
                blocked=True,
                reason="Model substitution requires an explicit candidate_model from the allowlist.",
            )
        if candidate_model not in allowed_candidate_models():
            return EligibilityResult(
                eligible=False,
                blocked=True,
                reason=f"Candidate model {candidate_model!r} is not in ZEVQORA_CANDIDATE_MODELS allowlist.",
            )

        scoped = list(traces)
        if finding and finding.symbol:
            matching = [t for t in traces if t.symbol == finding.symbol]
            if matching:
                scoped = matching

        include_protected = include_protected
        usable: list[Trace] = []
        if sample_trace_ids:
            by_id = {t.id: t for t in scoped}
            usable = [by_id[i] for i in sample_trace_ids if i in by_id]
        else:
            for t in scoped:
                if t.protected and not include_protected:
                    continue
                if not (t.input_text or t.expected_output):
                    continue
                if t.output_text is None and t.expected_output is None:
                    continue
                usable.append(t)

        limit = settings.max_candidate_samples if not sample_trace_ids else len(usable)
        selected = usable[:limit]
        if not selected:
            return EligibilityResult(
                eligible=False,
                blocked=True,
                reason="No bounded non-protected baseline traces with task input for model substitution.",
            )

        return EligibilityResult(
            eligible=True,
            reason=f"Model substitution eligible for {len(selected)} baseline sample(s) → {candidate_model}.",
            evidence_trace_ids=[t.id for t in selected],
            details={"candidate_model": candidate_model, "sample_count": len(selected)},
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
        include_protected: bool = False,
        sample_trace_ids: list[str] | None = None,
    ) -> PlanDraft:
        elig = self.eligibility(
            db,
            product_id,
            traces,
            finding,
            candidate_model=candidate_model,
            include_protected=include_protected,
            sample_trace_ids=sample_trace_ids,
        )
        budget = max_budget_usd if max_budget_usd is not None else settings.max_experiment_cost_usd
        if not elig.eligible:
            return PlanDraft(
                strategy=StrategyName.MODEL_SUBSTITUTION,
                status=PlanStatus.BLOCKED,
                finding_id=finding.id if finding else None,
                reason=elig.reason,
                expected_mechanism="model_substitution",
                risk="medium",
                max_budget_usd=budget,
                blocked_reason=elig.reason,
                required_evidence=["baseline_runtime_traces", "allowlisted_candidate_model"],
            )

        by_id = {t.id: t for t in traces}
        sample_traces = [by_id[i] for i in elig.evidence_trace_ids if i in by_id]
        estimates = [
            estimate_sample_cost_usd(candidate_model or "", t, max_output_tokens=SMOKE_MAX_OUTPUT_TOKENS)
            for t in sample_traces
        ]
        if any(e is None for e in estimates) and budget > 0 and not sample_trace_ids:
            # Strict budget without predictable cost → blocked for automatic paid runs.
            return PlanDraft(
                strategy=StrategyName.MODEL_SUBSTITUTION,
                status=PlanStatus.BLOCKED,
                finding_id=finding.id if finding else None,
                baseline_config={"baseline_trace_ids": elig.evidence_trace_ids},
                candidate_config={"model": candidate_model},
                reason="Cannot estimate candidate cost from pricing snapshot; refusing automatic run under strict budget.",
                expected_mechanism="model_substitution",
                risk="medium",
                max_budget_usd=budget,
                sample_scope=elig.evidence_trace_ids,
                blocked_reason="unknown_pricing_under_strict_budget",
                required_evidence=["verified_pricing_rates_or_provider_reported_cost"],
            )

        estimated_total = sum(e or 0.0 for e in estimates)
        return PlanDraft(
            strategy=StrategyName.MODEL_SUBSTITUTION,
            status=PlanStatus.READY,
            finding_id=finding.id if finding else None,
            baseline_config={
                "baseline_trace_ids": elig.evidence_trace_ids,
                "baseline_evidence_hash": baseline_evidence_hash(sample_traces),
                "task_fingerprints": {t.id: task_fingerprint_from_trace(t) for t in sample_traces},
                "baseline_hashes": {
                    t.id: {
                        "input_hash": t.input_hash or sha256_text(t.input_text),
                        "output_hash": t.output_hash or sha256_text(t.output_text),
                        "model": t.model,
                        "cost_source": t.cost_source,
                    }
                    for t in sample_traces
                },
            },
            candidate_config={
                "model": candidate_model,
                "temperature": 0.0,
                "max_tokens": SMOKE_MAX_OUTPUT_TOKENS,
                "estimated_max_cost_usd": estimated_total,
            },
            reason=elig.reason,
            expected_mechanism="Send equivalent task to allowlisted candidate model via provider abstraction.",
            risk="medium",
            fallback="retain_baseline",
            required_evidence=["baseline_runtime_traces", "allowlisted_candidate_model", "budget_ok"],
            max_budget_usd=budget,
            sample_scope=elig.evidence_trace_ids,
        )

    def estimate_budget(self, plan: CandidatePlan | PlanDraft, traces: list[Trace]) -> float:
        if isinstance(plan, PlanDraft):
            cfg = plan.candidate_config
            scope = plan.sample_scope
            model = cfg.get("model")
        else:
            cfg = json.loads(plan.candidate_config_json or "{}")
            scope = json.loads(plan.sample_scope_json or "[]")
            model = cfg.get("model")
        if not model:
            return float("inf")
        by_id = {t.id: t for t in traces}
        total = 0.0
        for tid in scope:
            t = by_id.get(tid)
            if not t:
                continue
            est = estimate_sample_cost_usd(model, t, max_output_tokens=SMOKE_MAX_OUTPUT_TOKENS)
            if est is None:
                return float("inf")
            total += est
        return total

    async def execute_sample(
        self,
        *,
        plan: CandidatePlan,
        baseline: Trace,
        reuse_source: Trace | None = None,
        provider: object | None = None,
    ) -> SampleResult:
        cfg = json.loads(plan.candidate_config_json or "{}")
        model = cfg.get("model")
        if not model or model not in allowed_candidate_models():
            return SampleResult(
                baseline_trace_id=baseline.id,
                status="failed",
                error_category=ErrorCategory.INVALID_MODEL.value,
                error_detail="Candidate model missing or not allowlisted.",
                execution_proven=False,
            )

        temperature = float(cfg.get("temperature", 0.0))
        max_tokens = int(cfg.get("max_tokens") or SMOKE_MAX_OUTPUT_TOKENS)
        snap_json = getattr(baseline, "request_snapshot_json", None)
        if snap_json:
            snapshot = ReplayableRequestSnapshot.model_validate_json(snap_json)
            request = snapshot.to_llm_request(provider="openrouter", model=model)
            request.metadata.update(
                {
                    "baseline_trace_id": baseline.id,
                    "strategy": self.name,
                    "product_id": plan.product_id,
                    "replay_snapshot_hash": snapshot.snapshot_hash(),
                }
            )
            if cfg.get("max_tokens") is not None:
                request.max_tokens = max_tokens
            if cfg.get("temperature") is not None:
                request.temperature = temperature
        else:
            user_content = baseline.input_text or baseline.expected_output or ""
            meta = {}
            if baseline.metadata_json:
                try:
                    raw = json.loads(baseline.metadata_json)
                    if isinstance(raw, dict):
                        meta = raw
                except json.JSONDecodeError:
                    meta = {}
            request = LLMRequest(
                provider="openrouter",
                model=model,
                messages=[LLMMessage(role="user", content=user_content)],
                temperature=temperature,
                max_tokens=max_tokens,
                metadata={
                    "baseline_trace_id": baseline.id,
                    "strategy": self.name,
                    "product_id": plan.product_id,
                    "workflow": baseline.workflow,
                    "temperature": temperature,
                    "system_prompt_version": meta.get("system_prompt_version"),
                    "response_format": meta.get("response_format"),
                },
            )
        task_fp = task_fingerprint_from_request(request)
        baseline_fp = task_fingerprint_from_trace(baseline)
        config_fp = execution_configuration_fingerprint(
            provider="openrouter",
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            extra={"strategy": self.name},
        )
        llm: LLMProvider = provider if isinstance(provider, LLMProvider) else get_provider()
        try:
            response = await llm.complete(request)
        except Exception as exc:
            category, detail = classify_provider_error(exc)
            return SampleResult(
                baseline_trace_id=baseline.id,
                status="failed",
                task_fingerprint=task_fp,
                candidate_config_fingerprint=config_fp,
                provider=getattr(llm, "name", None),
                requested_model=model,
                error_category=category.value,
                error_detail=detail,
                provider_call_count=1,
                execution_proven=False,
            )

        cost_usd = response.cost.cost_usd if response.cost else None
        cost_source = response.cost.cost_source.value if response.cost and response.cost.cost_source else None
        pricing_version = response.cost.pricing_version if response.cost else None
        baseline_cost = baseline.cost_usd
        # Delta only when baseline cost exists; never invent zero baseline.
        delta = None
        if cost_usd is not None and baseline_cost is not None:
            delta = cost_usd - baseline_cost

        bounded = bound_text(response.content)
        return SampleResult(
            baseline_trace_id=baseline.id,
            status="succeeded",
            task_fingerprint=task_fp,
            candidate_config_fingerprint=config_fp,
            provider=response.provider,
            requested_model=response.requested_model,
            resolved_model=response.resolved_model,
            output_text=bounded.text,
            output_hash=bounded.full_hash,
            output_truncated=bounded.truncated,
            output_original_chars=bounded.original_chars,
            output_stored_chars=bounded.stored_chars,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
            cached_input_tokens=response.usage.cached_input_tokens,
            reasoning_tokens=response.usage.reasoning_tokens,
            cost_usd=cost_usd,
            cost_source=cost_source,
            pricing_version=pricing_version,
            baseline_cost_source=baseline.cost_source,
            latency_ms=response.latency_ms,
            provider_request_id=response.provider_request_id,
            provider_call_count=1,
            baseline_cost_usd=baseline_cost,
            candidate_cost_delta_usd=delta,
            execution_proven=True,
            # Store mismatch note in error_detail only when fingerprints diverge (still measured).
            error_detail=(
                None
                if task_fp == baseline_fp
                else "task_fingerprint differs from baseline (metadata-only baseline vs request shape)."
            ),
        )
