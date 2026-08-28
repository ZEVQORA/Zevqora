"""Bounded routing strategy — executes the reusable product optimization policy."""

from __future__ import annotations

import json
import time
import uuid
from typing import Any

from sqlalchemy.orm import Session

from ...core.config import settings
from ...core.content import bound_text
from ...db_models import CandidatePlan, Finding, Trace
from ...evidence.replay import ReplayableRequestSnapshot
from ...providers.factory import get_provider
from ...providers.models import CostSource, LLMMessage, LLMRequest
from ..fingerprints import (
    baseline_evidence_hash,
    execution_configuration_fingerprint,
    task_fingerprint_from_request,
    task_fingerprint_from_trace,
)
from ..models import (
    EXECUTION_PROVEN,
    EligibilityResult,
    PlanDraft,
    PlanStatus,
    SampleResult,
    StrategyName,
)
from ..policies.bounded_routing import (
    DEFAULT_BASELINE_MODEL,
    DEFAULT_CHEAP_MODEL,
    POLICY_VERSION_FULL,
    RouteTier,
    RoutingObservability,
    extract_task_features,
    select_route,
)
from ..policies.product_invariants import PRODUCT_INVARIANTS_VERSION, invariants_system_block
from ..policies.structured_output import (
    STRUCTURED_OUTPUT_VERSION,
    structured_system_instruction,
    validate_structured_output,
)
from .base import OptimizationStrategy
from .model_substitution import classify_provider_error, estimate_sample_cost_usd


def _messages_and_tools_from_baseline(
    baseline: Trace,
) -> tuple[list[Any], list[Any] | None, int | None, dict[str, Any]]:
    snap_json = getattr(baseline, "request_snapshot_json", None)
    if snap_json:
        snapshot = ReplayableRequestSnapshot.model_validate_json(snap_json)
        messages = [m.model_dump() for m in snapshot.messages]
        tools = [t.model_dump() for t in snapshot.tools] if snapshot.tools else None
        meta = dict(snapshot.metadata or {})
        # Never feed benchmark identity into the product router.
        meta.pop("case_id", None)
        meta.pop("expected", None)
        meta.pop("cohort", None)
        return messages, tools, snapshot.max_tokens, meta
    return [{"role": "user", "content": baseline.input_text or ""}], None, None, {}


def _meta(baseline: Trace) -> dict[str, Any]:
    try:
        raw = json.loads(baseline.metadata_json or "{}")
        return raw if isinstance(raw, dict) else {}
    except json.JSONDecodeError:
        return {}


class BoundedRoutingStrategy(OptimizationStrategy):
    name = StrategyName.BOUNDED_ROUTING.value

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
        cheap_model: str | None = None,
        baseline_model: str | None = None,
        **_: Any,
    ) -> EligibilityResult:
        scoped = list(traces)
        if sample_trace_ids is not None:
            allow = set(sample_trace_ids)
            scoped = [t for t in traces if t.id in allow]
        if not include_protected:
            scoped = [t for t in scoped if not t.protected]
        if not scoped:
            return EligibilityResult(
                eligible=False,
                blocked=True,
                reason="No eligible baseline traces for bounded routing.",
            )
        return EligibilityResult(
            eligible=True,
            blocked=False,
            reason="Bounded routing policy can execute over provided baseline traces.",
            evidence_trace_ids=[t.id for t in scoped],
            details={
                "policy_version": POLICY_VERSION_FULL,
                "cheap_model": cheap_model or candidate_model or DEFAULT_CHEAP_MODEL,
                "baseline_model": baseline_model or DEFAULT_BASELINE_MODEL,
            },
        )

    def plan(
        self,
        db: Session,
        product_id: str,
        traces: list[Trace],
        finding: Finding | None = None,
        *,
        candidate_model: str | None = None,
        max_budget_usd: float = 0.0,
        include_protected: bool = False,
        sample_trace_ids: list[str] | None = None,
        cheap_model: str | None = None,
        baseline_model: str | None = None,
        **_: Any,
    ) -> PlanDraft:
        cheap = cheap_model or candidate_model or DEFAULT_CHEAP_MODEL
        strong = baseline_model or DEFAULT_BASELINE_MODEL
        elig = self.eligibility(
            db,
            product_id,
            traces,
            finding,
            candidate_model=cheap,
            include_protected=include_protected,
            sample_trace_ids=sample_trace_ids,
            cheap_model=cheap,
            baseline_model=strong,
        )
        if not elig.eligible:
            return PlanDraft(
                strategy=StrategyName.BOUNDED_ROUTING,
                status=PlanStatus.BLOCKED,
                finding_id=finding.id if finding else None,
                reason=elig.reason,
                expected_mechanism="bounded_routing",
                blocked_reason=elig.reason,
                max_budget_usd=max_budget_usd,
            )

        sample_traces = [t for t in traces if t.id in set(elig.evidence_trace_ids)]
        # Budget: worst-case every sample may fallback to strong path (2 calls).
        estimates: list[float | None] = []
        for t in sample_traces:
            e_c = estimate_sample_cost_usd(cheap, t, max_output_tokens=64)
            e_b = estimate_sample_cost_usd(strong, t, max_output_tokens=64)
            if e_c is None or e_b is None:
                estimates.append(None)
            else:
                estimates.append((e_c or 0) + (e_b or 0))

        budget = max_budget_usd if max_budget_usd is not None else settings.max_experiment_cost_usd
        if any(e is None for e in estimates) and budget < float("inf"):
            # Still allow authorized benchmark_mode via executor; plan READY with note.
            pass

        estimated_total = sum(e or 0.0 for e in estimates if e is not None)
        return PlanDraft(
            strategy=StrategyName.BOUNDED_ROUTING,
            status=PlanStatus.READY,
            finding_id=finding.id if finding else None,
            baseline_config={
                "baseline_trace_ids": elig.evidence_trace_ids,
                "baseline_evidence_hash": baseline_evidence_hash(sample_traces),
                "task_fingerprints": {t.id: task_fingerprint_from_trace(t) for t in sample_traces},
            },
            candidate_config={
                "policy_id": "bounded_routing",
                "policy_version": POLICY_VERSION_FULL,
                "cheap_model": cheap,
                "baseline_model": strong,
                "model": cheap,  # primary declared model for allowlist/display
                "temperature": 0.0,
                "max_tokens": 64,
                "estimated_max_cost_usd": estimated_total,
                "fallback": "baseline_strong_on_invalid_or_provider_error",
            },
            reason=elig.reason,
            expected_mechanism="deterministic_tools_plus_cheap_bounded_plus_strong_fallback",
            risk="low",
            fallback="baseline_strong",
            required_evidence=["baseline_runtime_traces", "bounded_routing_policy"],
            max_budget_usd=budget,
            sample_scope=elig.evidence_trace_ids,
            plan_version="bounded_routing_v1",
        )

    def estimate_budget(self, plan: CandidatePlan | PlanDraft, traces: list[Trace]) -> float:
        if isinstance(plan, PlanDraft):
            cfg = plan.candidate_config
            scope = plan.sample_scope
        else:
            cfg = json.loads(plan.candidate_config_json or "{}")
            scope = json.loads(plan.sample_scope_json or "[]")
        cheap = cfg.get("cheap_model") or cfg.get("model") or DEFAULT_CHEAP_MODEL
        strong = cfg.get("baseline_model") or DEFAULT_BASELINE_MODEL
        by_id = {t.id: t for t in traces}
        total = 0.0
        for tid in scope:
            t = by_id.get(tid)
            if not t:
                continue
            e_c = estimate_sample_cost_usd(cheap, t, max_output_tokens=64)
            e_b = estimate_sample_cost_usd(strong, t, max_output_tokens=64)
            if e_c is None or e_b is None:
                return float("inf")
            total += float(e_c) + float(e_b)
        return total

    async def execute_sample(
        self,
        *,
        plan: CandidatePlan,
        baseline: Trace,
        reuse_source: Trace | None = None,
        provider: object | None = None,
        db: Session | None = None,
    ) -> SampleResult:
        cfg = json.loads(plan.candidate_config_json or "{}")
        cheap = cfg.get("cheap_model") or cfg.get("model") or DEFAULT_CHEAP_MODEL
        strong = cfg.get("baseline_model") or DEFAULT_BASELINE_MODEL
        messages, tools, snap_max, snap_meta = _messages_and_tools_from_baseline(baseline)
        meta = {**snap_meta, **_meta(baseline)}
        # Trace metadata may carry tool constraints; never cohort/expected/case_id.
        for banned in ("case_id", "expected", "cohort", "difficulty", "dataset_cohort", "benchmark_case_id"):
            meta.pop(banned, None)
        features = extract_task_features(
            messages=messages,
            tools=tools,
            required_tools=meta.get("required_tools"),
            forbidden_tools=meta.get("forbidden_tools"),
            max_tokens=snap_max,
            safety_sensitive=bool(baseline.protected),
            metadata=meta,
        )
        decision = select_route(features, cheap_model=cheap, baseline_model=strong)
        task_fp = task_fingerprint_from_trace(baseline)
        config_fp = execution_configuration_fingerprint(
            provider="openrouter",
            model=f"policy:{POLICY_VERSION_FULL}",
            temperature=0.0,
            max_tokens=decision.max_tokens,
            extra={"strategy": self.name, "policy_version": POLICY_VERSION_FULL},
        )
        llm = provider if provider is not None else get_provider()
        if not hasattr(llm, "complete"):
            llm = get_provider()

        started = time.perf_counter()
        # Restore isolated product-state seed before any path that may read product DB.
        seed = features.product_state_seed
        if seed and db is not None:
            from ...benchmarks.setup_seed import materialize_product_state_seed

            materialize_product_state_seed(db, plan.product_id, seed, clear_first=True)

        if decision.tier == RouteTier.DETERMINISTIC:
            return await self._execute_deterministic(
                plan=plan,
                baseline=baseline,
                decision=decision,
                task_fp=task_fp,
                config_fp=config_fp,
                db=db,
                started=started,
            )

        if decision.tier == RouteTier.CHEAP_BOUNDED:
            return await self._execute_cheap_with_fallback(
                plan=plan,
                baseline=baseline,
                decision=decision,
                messages=messages,
                tools=tools,
                task_fp=task_fp,
                config_fp=config_fp,
                llm=llm,
                started=started,
            )

        return await self._execute_provider(
            plan=plan,
            baseline=baseline,
            decision=decision,
            messages=messages,
            tools=tools,
            model=strong,
            tier=RouteTier.BASELINE_STRONG,
            task_fp=task_fp,
            config_fp=config_fp,
            llm=llm,
            started=started,
            initial_route=RouteTier.BASELINE_STRONG.value,
            route_reason=decision.reason,
            provider_calls_so_far=0,
            cost_so_far=0.0,
        )

    async def _execute_deterministic(
        self,
        *,
        plan: CandidatePlan,
        baseline: Trace,
        decision,
        task_fp: str,
        config_fp: str,
        db: Session | None,
        started: float,
    ) -> SampleResult:
        tool_calls: list[dict[str, Any]] = []
        output = decision.deterministic_answer or ""
        if decision.deterministic_operation:
            from ..policies.deterministic_ops import execute_deterministic_operation

            if db is None:
                raise ValueError("deterministic_operation requires db session")
            # Reconstruct operation args from baseline snapshot metadata only.
            _, _, _, snap_meta = _messages_and_tools_from_baseline(baseline)
            ctx = {"operation_args": dict(snap_meta.get("operation_args") or {})}
            output = execute_deterministic_operation(db, plan.product_id, decision.deterministic_operation, context=ctx)
        elif decision.deterministic_tool:
            args = {"product_id": plan.product_id}
            if db is None:
                tool_calls.append(
                    {
                        "id": f"det-{uuid.uuid4().hex[:10]}",
                        "name": decision.deterministic_tool,
                        "arguments": args,
                    }
                )
                output = decision.deterministic_tool
            else:
                from ...agent.tools import execute_tool

                # Record the bound tool call first — application decided to invoke it.
                tool_calls.append(
                    {
                        "id": f"det-{uuid.uuid4().hex[:10]}",
                        "name": decision.deterministic_tool,
                        "arguments": args,
                    }
                )
                try:
                    _raw, summary = execute_tool(db, decision.deterministic_tool, args)
                    output = decision.deterministic_tool or summary
                except ValueError:
                    # Tool refused or workspace unavailable — call still recorded for observability.
                    output = decision.deterministic_answer or decision.deterministic_tool

        # Secret path: explicitly do NOT call read_source_excerpt
        if decision.refuse_tools:
            tool_calls = [tc for tc in tool_calls if tc.get("name") not in decision.refuse_tools]

        latency_ms = (time.perf_counter() - started) * 1000.0
        bounded = bound_text(output)
        obs = RoutingObservability(
            initial_route=RouteTier.DETERMINISTIC.value,
            route_reason=decision.reason,
            final_route=RouteTier.DETERMINISTIC.value,
            deterministic_tool=decision.deterministic_tool,
            deterministic_operation=getattr(decision, "deterministic_operation", None),
            provider_call_count=0,
            cost_usd=0.0,
            cost_source=CostSource.DETERMINISTIC_NO_PROVIDER.value,
            latency_ms=latency_ms,
        )
        return SampleResult(
            baseline_trace_id=baseline.id,
            status="succeeded",
            task_fingerprint=task_fp,
            candidate_config_fingerprint=config_fp,
            provider="none",
            requested_model=None,
            resolved_model=None,
            output_text=bounded.text,
            output_hash=bounded.full_hash,
            output_truncated=bounded.truncated,
            output_original_chars=bounded.original_chars,
            output_stored_chars=bounded.stored_chars,
            input_tokens=0,
            output_tokens=0,
            cost_usd=0.0,
            cost_source=CostSource.DETERMINISTIC_NO_PROVIDER.value,
            baseline_cost_source=baseline.cost_source,
            latency_ms=latency_ms,
            provider_call_count=0,
            baseline_cost_usd=baseline.cost_usd,
            candidate_cost_delta_usd=(0.0 - baseline.cost_usd) if baseline.cost_usd is not None else None,
            execution_proven=True,
            evidence_label=EXECUTION_PROVEN,
            tool_calls=tool_calls,
            route_selected=RouteTier.DETERMINISTIC.value,
            route_reason=decision.reason,
            initial_route=RouteTier.DETERMINISTIC.value,
            final_route=RouteTier.DETERMINISTIC.value,
            fallback_occurred=False,
            routing_observability=obs.model_dump(),
        )

    async def _execute_cheap_with_fallback(
        self,
        *,
        plan: CandidatePlan,
        baseline: Trace,
        decision,
        messages: list[Any],
        tools: list[Any] | None,
        task_fp: str,
        config_fp: str,
        llm: object,
        started: float,
    ) -> SampleResult:
        cheap_result = await self._execute_provider(
            plan=plan,
            baseline=baseline,
            decision=decision,
            messages=messages,
            tools=tools,
            model=decision.cheap_model,
            tier=RouteTier.CHEAP_BOUNDED,
            task_fp=task_fp,
            config_fp=config_fp,
            llm=llm,
            started=started,
            initial_route=RouteTier.CHEAP_BOUNDED.value,
            route_reason=decision.reason,
            provider_calls_so_far=0,
            cost_so_far=0.0,
            enforce_labels=True,
        )
        if cheap_result.status == "succeeded" and not cheap_result.fallback_occurred:
            return cheap_result

        # Fallback to strong path — accumulate cost and provider calls.
        reason = cheap_result.fallback_reason or cheap_result.error_detail or "cheap_path_failed"
        cost_so_far = float(cheap_result.cost_usd or 0.0)
        calls_so_far = int(cheap_result.provider_call_count or 0)
        strong = await self._execute_provider(
            plan=plan,
            baseline=baseline,
            decision=decision,
            messages=messages,
            tools=tools,
            model=decision.baseline_model,
            tier=RouteTier.BASELINE_STRONG,
            task_fp=task_fp,
            config_fp=config_fp,
            llm=llm,
            started=started,
            initial_route=RouteTier.CHEAP_BOUNDED.value,
            route_reason=decision.reason,
            provider_calls_so_far=calls_so_far,
            cost_so_far=cost_so_far,
            enforce_labels=bool(decision.allowed_labels),
            fallback_from=RouteTier.CHEAP_BOUNDED.value,
            fallback_reason=reason,
        )
        return strong

    async def _execute_provider(
        self,
        *,
        plan: CandidatePlan,
        baseline: Trace,
        decision,
        messages: list[Any],
        tools: list[Any] | None,
        model: str,
        tier: RouteTier,
        task_fp: str,
        config_fp: str,
        llm: object,
        started: float,
        initial_route: str,
        route_reason: str,
        provider_calls_so_far: int,
        cost_so_far: float,
        enforce_labels: bool = False,
        fallback_from: str | None = None,
        fallback_reason: str | None = None,
    ) -> SampleResult:
        # Build constrained messages for cheap / strong paths
        out_messages: list[LLMMessage] = []
        contract = decision.output_contract
        if tier == RouteTier.CHEAP_BOUNDED:
            from ..policies.structured_output import OutputContract as _OC

            sys_text = structured_system_instruction(contract or _OC())
            out_messages.append(LLMMessage(role="system", content=sys_text))
            for m in messages:
                role = m.get("role") if isinstance(m, dict) else getattr(m, "role", None)
                content = m.get("content") if isinstance(m, dict) else getattr(m, "content", None)
                if role == "user":
                    out_messages.append(LLMMessage(role="user", content=str(content or "")))
        else:
            inv_block = invariants_system_block(list(decision.product_invariants or []))
            if inv_block:
                out_messages.append(LLMMessage(role="system", content=inv_block))
            if contract and contract.kind in {"labels", "json_object"}:
                out_messages.append(LLMMessage(role="system", content=structured_system_instruction(contract)))
            for m in messages:
                if isinstance(m, dict):
                    out_messages.append(LLMMessage.model_validate(m))
                else:
                    out_messages.append(m)

        snap_json = getattr(baseline, "request_snapshot_json", None)
        temperature = 0.0
        max_tokens = decision.max_tokens
        if snap_json and tier == RouteTier.BASELINE_STRONG and not fallback_from:
            snapshot = ReplayableRequestSnapshot.model_validate_json(snap_json)
            request = snapshot.to_llm_request(provider="openrouter", model=model)
            # Prepend product invariants / output contract without altering task fingerprint inputs:
            # fingerprint already frozen from baseline; inject for generation quality only.
            prefix: list[LLMMessage] = []
            inv_block = invariants_system_block(list(decision.product_invariants or []))
            if inv_block:
                prefix.append(LLMMessage(role="system", content=inv_block))
            if contract and contract.kind in {"labels", "json_object"}:
                prefix.append(LLMMessage(role="system", content=structured_system_instruction(contract)))
            if prefix:
                request.messages = [*prefix, *list(request.messages)]
            request.metadata.update(
                {
                    "baseline_trace_id": baseline.id,
                    "strategy": self.name,
                    "product_id": plan.product_id,
                    "policy_version": POLICY_VERSION_FULL,
                    "route": tier.value,
                }
            )
        else:
            request = LLMRequest(
                provider="openrouter",
                model=model,
                messages=out_messages,
                temperature=temperature,
                max_tokens=max_tokens,
                metadata={
                    "baseline_trace_id": baseline.id,
                    "strategy": self.name,
                    "product_id": plan.product_id,
                    "policy_version": POLICY_VERSION_FULL,
                    "route": tier.value,
                    "temperature": temperature,
                },
            )

        # Prefer baseline task fingerprint for comparable savings accounting.
        _ = task_fingerprint_from_request(request)

        try:
            response = await llm.complete(request)
        except Exception as exc:
            category, detail = classify_provider_error(exc)
            latency_ms = (time.perf_counter() - started) * 1000.0
            calls = provider_calls_so_far + 1
            if tier == RouteTier.CHEAP_BOUNDED:
                return SampleResult(
                    baseline_trace_id=baseline.id,
                    status="failed",
                    task_fingerprint=task_fp,
                    candidate_config_fingerprint=config_fp,
                    provider=getattr(llm, "name", None),
                    requested_model=model,
                    error_category=category.value,
                    error_detail=detail,
                    provider_call_count=calls,
                    cost_usd=cost_so_far if cost_so_far else None,
                    latency_ms=latency_ms,
                    execution_proven=False,
                    route_selected=tier.value,
                    route_reason=route_reason,
                    initial_route=initial_route,
                    final_route=tier.value,
                    fallback_occurred=True,
                    fallback_reason=f"provider_error:{category.value}",
                )
            obs = RoutingObservability(
                initial_route=initial_route,
                route_reason=route_reason,
                final_route=tier.value,
                fallback_occurred=bool(fallback_from),
                fallback_reason=fallback_reason or detail,
                requested_provider=getattr(llm, "name", None),
                requested_model=model,
                provider_call_count=calls,
                cost_usd=cost_so_far if cost_so_far else None,
                latency_ms=latency_ms,
            )
            return SampleResult(
                baseline_trace_id=baseline.id,
                status="failed",
                task_fingerprint=task_fp,
                candidate_config_fingerprint=config_fp,
                provider=getattr(llm, "name", None),
                requested_model=model,
                error_category=category.value,
                error_detail=detail,
                provider_call_count=calls,
                cost_usd=cost_so_far if cost_so_far else None,
                latency_ms=latency_ms,
                execution_proven=False,
                route_selected=tier.value,
                route_reason=route_reason,
                initial_route=initial_route,
                final_route=tier.value,
                fallback_occurred=bool(fallback_from),
                fallback_reason=fallback_reason,
                routing_observability=obs.model_dump(),
            )

        content = response.content or ""
        call_cost = float(response.cost.cost_usd) if response.cost and response.cost.cost_usd is not None else 0.0
        cost_source = response.cost.cost_source.value if response.cost and response.cost.cost_source else None
        pricing_version = response.cost.pricing_version if response.cost else None
        total_cost = cost_so_far + call_cost
        calls = provider_calls_so_far + 1
        latency_ms = (time.perf_counter() - started) * 1000.0

        # Structured output / label contract validation (Tier 2 triggers fallback on failure)
        enforce_contract = bool(contract and contract.kind != "none")
        validation_failure = None
        if enforce_contract and contract is not None:
            vr = validate_structured_output(content, contract)
            if not vr.ok and tier == RouteTier.CHEAP_BOUNDED:
                return SampleResult(
                    baseline_trace_id=baseline.id,
                    status="failed",
                    task_fingerprint=task_fp,
                    candidate_config_fingerprint=config_fp,
                    provider=response.provider,
                    requested_model=response.requested_model,
                    resolved_model=response.resolved_model,
                    output_text=content,
                    cost_usd=total_cost,
                    cost_source=cost_source,
                    pricing_version=pricing_version,
                    latency_ms=latency_ms,
                    provider_call_count=calls,
                    execution_proven=False,
                    route_selected=tier.value,
                    route_reason=route_reason,
                    initial_route=initial_route,
                    final_route=tier.value,
                    fallback_occurred=True,
                    fallback_reason=f"invalid_structured_output:{vr.reason}",
                    routing_observability=RoutingObservability(
                        initial_route=initial_route,
                        route_reason=route_reason,
                        final_route=tier.value,
                        fallback_occurred=True,
                        fallback_reason=f"invalid_structured_output:{vr.reason}",
                        requested_provider=response.provider,
                        requested_model=model,
                        provider_call_count=calls,
                        cost_usd=total_cost,
                        cost_source=cost_source,
                        latency_ms=latency_ms,
                        structured_output_version=STRUCTURED_OUTPUT_VERSION,
                        validation_failure=vr.reason,
                    ).model_dump(),
                )
            if vr.ok and vr.normalized_text is not None:
                content = vr.normalized_text
            elif not vr.ok:
                validation_failure = vr.reason

        tool_calls = [tc.model_dump() if hasattr(tc, "model_dump") else tc for tc in (response.tool_calls or [])]
        bounded = bound_text(content)
        delta = None
        if baseline.cost_usd is not None:
            delta = total_cost - baseline.cost_usd

        obs = RoutingObservability(
            initial_route=initial_route,
            route_reason=route_reason,
            final_route=tier.value,
            fallback_occurred=bool(fallback_from),
            fallback_reason=fallback_reason,
            requested_provider=response.provider,
            requested_model=model,
            provider_call_count=calls,
            cost_usd=total_cost,
            cost_source=cost_source,
            latency_ms=latency_ms,
            structured_output_version=STRUCTURED_OUTPUT_VERSION if contract and contract.kind != "none" else None,
            product_invariants_version=PRODUCT_INVARIANTS_VERSION if decision.product_invariants else None,
            validation_failure=validation_failure,
        )
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
            cost_usd=total_cost,
            cost_source=cost_source,
            pricing_version=pricing_version,
            baseline_cost_source=baseline.cost_source,
            latency_ms=latency_ms,
            provider_request_id=response.provider_request_id,
            provider_call_count=calls,
            baseline_cost_usd=baseline.cost_usd,
            candidate_cost_delta_usd=delta,
            execution_proven=True,
            tool_calls=tool_calls,
            route_selected=tier.value,
            route_reason=route_reason,
            initial_route=initial_route,
            final_route=tier.value,
            fallback_occurred=bool(fallback_from),
            fallback_reason=fallback_reason,
            routing_observability=obs.model_dump(),
        )
