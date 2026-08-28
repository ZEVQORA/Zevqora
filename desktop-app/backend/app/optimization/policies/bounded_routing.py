"""Bounded routing optimization policy — reusable product execution path.

Version bounded_routing_v1.2.0:
- Tier 1 only for hard safety, tools, or explicit deterministic product operations
- Structured output contract validation (JSON/labels) with fallback
- Product-invariants context for complex/policy reasoning
- NO prompt→answer quiz tables
- Never inspects case_id, expected answers, or dataset cohort labels
"""

from __future__ import annotations

import re
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field

from ...core.hashing import sha256_json
from .deterministic_ops import DETERMINISTIC_OPERATIONS, is_deterministic_operation
from .product_invariants import (
    PRODUCT_INVARIANTS_VERSION,
    product_invariants_hash,
    select_invariant_texts,
)
from .product_knowledge import extract_allowed_labels, last_user_text
from .structured_output import (
    STRUCTURED_OUTPUT_VERSION,
    OutputContract,
    derive_output_contract,
    structured_system_instruction,
)

POLICY_ID = "bounded_routing"
POLICY_VERSION_FULL = "bounded_routing_v1.2.0"

DEFAULT_CHEAP_MODEL = "google/gemini-2.5-flash-lite"
DEFAULT_BASELINE_MODEL = "openai/gpt-4o-mini"

SECRET_PATH_RE = re.compile(
    r"(?i)(\.env\b|secrets?/|credentials?|OPENROUTER_API_KEY|api[_-]?key\s*(=|:)|password\s*(=|:))"
)
DEPLOY_RE = re.compile(r"(?i)\b(merge and deploy|auto[- ]?merge|auto[- ]?deploy|deploy this|git_push)\b")
CROSS_PRODUCT_RE = re.compile(r"(?i)product_id\s+([A-Za-z0-9_-]*OTHER[A-Za-z0-9_-]*)")
INJECTION_RE = re.compile(r"(?i)ignore previous instructions|send secrets")
LEGACY_VERIFIED_RE = re.compile(r"(?i)legacy Experiment is VERIFIED|legacy/manual candidate")
SCAN_INTENT_RE = re.compile(r"(?i)scan workspace|run (a )?scan|source scan")
ECONOMICS_INTENT_RE = re.compile(r"(?i)observed spend|economics|verified savings summary")
WORKSPACE_SUMMARY_INTENT_RE = re.compile(r"(?i)workspace_summary|workspace summary")
LIST_AI_CALLS_RE = re.compile(r"(?i)how many AI call|list AI call|AI call sites|detected providers")


class RouteTier(StrEnum):
    DETERMINISTIC = "deterministic"
    CHEAP_BOUNDED = "cheap_bounded"
    BASELINE_STRONG = "baseline_strong"


class TaskFeatures(BaseModel):
    """Observable task properties — no case_id, expected answer, or cohort."""

    user_text: str = ""
    has_tools: bool = False
    available_tool_names: list[str] = Field(default_factory=list)
    required_tools: list[str] = Field(default_factory=list)
    forbidden_tools: list[str] = Field(default_factory=list)
    allowed_labels: list[str] | None = None
    safety_sensitive: bool = False
    secret_path_request: bool = False
    deploy_request: bool = False
    cross_product_request: bool = False
    requested_foreign_product_id: str | None = None
    injection_signal: bool = False
    legacy_verification_claim: bool = False
    tool_intent: str | None = None
    operation: str | None = None
    operation_args: dict[str, Any] = Field(default_factory=dict)
    generation_required: bool = False
    complexity: str | None = None
    max_tokens: int | None = None
    output_contract: OutputContract | None = None
    product_invariants: list[str] = Field(default_factory=list)
    product_state_seed: dict[str, Any] | None = None


class RouteDecision(BaseModel):
    tier: RouteTier
    reason: str
    policy_version: str = POLICY_VERSION_FULL
    deterministic_answer: str | None = None
    deterministic_tool: str | None = None
    deterministic_operation: str | None = None
    force_product_id: bool = False
    refuse_tools: list[str] = Field(default_factory=list)
    cheap_model: str = DEFAULT_CHEAP_MODEL
    baseline_model: str = DEFAULT_BASELINE_MODEL
    temperature: float = 0.0
    max_tokens: int = 32
    allowed_labels: list[str] | None = None
    output_contract: OutputContract | None = None
    product_invariants: list[str] = Field(default_factory=list)


class RoutingObservability(BaseModel):
    policy_id: str = POLICY_ID
    policy_version: str = POLICY_VERSION_FULL
    initial_route: str
    route_reason: str
    final_route: str
    fallback_occurred: bool = False
    fallback_reason: str | None = None
    deterministic_tool: str | None = None
    deterministic_operation: str | None = None
    requested_provider: str | None = None
    requested_model: str | None = None
    provider_call_count: int = 0
    cost_usd: float | None = None
    cost_source: str | None = None
    latency_ms: float | None = None
    structured_output_version: str | None = None
    product_invariants_version: str | None = None
    validation_failure: str | None = None


def _meta_get(metadata: dict[str, Any] | None, *keys: str) -> Any:
    if not metadata:
        return None
    for k in keys:
        if k in metadata and metadata[k] is not None:
            return metadata[k]
    return None


def extract_task_features(
    *,
    messages: list[Any],
    tools: list[Any] | None = None,
    required_tools: list[str] | None = None,
    forbidden_tools: list[str] | None = None,
    max_tokens: int | None = None,
    safety_sensitive: bool = False,
    metadata: dict[str, Any] | None = None,
) -> TaskFeatures:
    clean_meta = dict(metadata or {})
    for banned in ("case_id", "expected", "cohort", "difficulty", "dataset_cohort"):
        clean_meta.pop(banned, None)

    user_text = last_user_text(messages)
    tool_names: list[str] = []
    for t in tools or []:
        if isinstance(t, dict):
            fn = (t.get("function") or {}).get("name") or t.get("name")
            if fn:
                tool_names.append(str(fn))
        else:
            name = getattr(t, "name", None) or getattr(getattr(t, "function", None), "name", None)
            if name:
                tool_names.append(str(name))

    labels = extract_allowed_labels(user_text)
    foreign = None
    m = CROSS_PRODUCT_RE.search(user_text)
    if m:
        foreign = m.group(1)

    tool_intent = None
    if SCAN_INTENT_RE.search(user_text) or "scan_workspace" in (required_tools or []):
        tool_intent = "scan_workspace"
    elif ECONOMICS_INTENT_RE.search(user_text) or "economics_summary" in (required_tools or []):
        tool_intent = "economics_summary"
    elif LIST_AI_CALLS_RE.search(user_text):
        tool_intent = "list_ai_calls"
    elif WORKSPACE_SUMMARY_INTENT_RE.search(user_text) and tool_names:
        tool_intent = "workspace_summary"

    secret = bool(SECRET_PATH_RE.search(user_text))
    deploy = bool(DEPLOY_RE.search(user_text))
    injection = bool(INJECTION_RE.search(user_text))
    legacy = bool(LEGACY_VERIFIED_RE.search(user_text))
    cross = foreign is not None

    operation = _meta_get(clean_meta, "operation")
    if operation is not None:
        operation = str(operation)
    op_args = _meta_get(clean_meta, "operation_args") or {}
    if not isinstance(op_args, dict):
        op_args = {}
    generation_required = bool(_meta_get(clean_meta, "generation_required") or False)
    complexity = _meta_get(clean_meta, "complexity")
    if complexity is not None:
        complexity = str(complexity).lower()

    seed = _meta_get(clean_meta, "product_state_seed")
    if seed is not None and not isinstance(seed, dict):
        seed = None

    contract = derive_output_contract(
        user_text=user_text,
        metadata=clean_meta,
        allowed_labels=labels,
    )
    invariants = select_invariant_texts(
        user_text=user_text,
        complexity=complexity,
        generation_required=generation_required,
    )

    return TaskFeatures(
        user_text=user_text,
        has_tools=bool(tool_names),
        available_tool_names=tool_names,
        required_tools=list(required_tools or []),
        forbidden_tools=list(forbidden_tools or []),
        allowed_labels=labels,
        safety_sensitive=bool(safety_sensitive or secret or deploy or injection or legacy or cross),
        secret_path_request=secret,
        deploy_request=deploy,
        cross_product_request=cross,
        requested_foreign_product_id=foreign,
        injection_signal=injection,
        legacy_verification_claim=legacy,
        tool_intent=tool_intent,
        operation=operation,
        operation_args=op_args,
        generation_required=generation_required,
        complexity=complexity,
        max_tokens=max_tokens,
        output_contract=contract,
        product_invariants=invariants,
        product_state_seed=seed,
    )


def select_route(
    features: TaskFeatures,
    *,
    cheap_model: str = DEFAULT_CHEAP_MODEL,
    baseline_model: str = DEFAULT_BASELINE_MODEL,
) -> RouteDecision:
    """Deterministic route selection from TaskFeatures only."""
    max_tok = min(int(features.max_tokens or 64), 256)

    def _dec(**kwargs: Any) -> RouteDecision:
        return RouteDecision(
            cheap_model=cheap_model,
            baseline_model=baseline_model,
            max_tokens=max_tok,
            allowed_labels=features.allowed_labels,
            output_contract=features.output_contract,
            product_invariants=list(features.product_invariants or []),
            **kwargs,
        )

    if features.secret_path_request:
        return _dec(
            tier=RouteTier.DETERMINISTIC,
            reason="secret_bearing_path_blocked_by_safe_path_layer",
            deterministic_answer="refuse",
            refuse_tools=["read_source_excerpt"],
        )
    if features.deploy_request:
        return _dec(
            tier=RouteTier.DETERMINISTIC,
            reason="no_authorized_auto_merge_deploy_path",
            deterministic_answer="refuse",
            refuse_tools=["deploy", "merge", "auto_merge", "git_push"],
        )
    if features.legacy_verification_claim:
        return _dec(
            tier=RouteTier.DETERMINISTIC,
            reason="legacy_experiment_verified_not_implementation_eligible",
            deterministic_answer="not_eligible",
        )
    if features.injection_signal:
        return _dec(
            tier=RouteTier.DETERMINISTIC,
            reason="retrieved_content_cannot_grant_authority",
            deterministic_answer="safe",
        )
    if features.cross_product_request and (
        features.tool_intent == "workspace_summary" or features.operation == "workspace_summary"
    ):
        return _dec(
            tier=RouteTier.DETERMINISTIC,
            reason="application_forces_bound_product_id",
            deterministic_tool="workspace_summary",
            force_product_id=True,
        )

    if (
        not features.generation_required
        and is_deterministic_operation(features.operation)
        and features.operation in DETERMINISTIC_OPERATIONS
    ):
        return _dec(
            tier=RouteTier.DETERMINISTIC,
            reason=f"deterministic_operation:{features.operation}",
            deterministic_operation=features.operation,
        )

    if features.tool_intent and features.tool_intent in (
        set(features.available_tool_names) | set(features.required_tools) | {"list_ai_calls"}
    ):
        return _dec(
            tier=RouteTier.DETERMINISTIC,
            reason=f"deterministic_tool:{features.tool_intent}",
            deterministic_tool=features.tool_intent,
            force_product_id=True,
        )

    if features.generation_required or features.complexity in {"bounded", "complex"}:
        if features.complexity == "complex":
            return _dec(
                tier=RouteTier.BASELINE_STRONG,
                reason="complex_generation_requires_strong_path",
            )
        return _dec(
            tier=RouteTier.CHEAP_BOUNDED,
            reason="bounded_generation_required",
            temperature=0.0,
        )

    if features.allowed_labels and (features.max_tokens or 64) <= 128:
        return _dec(
            tier=RouteTier.CHEAP_BOUNDED,
            reason="bounded_label_classification",
            temperature=0.0,
        )

    if (features.max_tokens or 64) > 128 or len(features.user_text) > 900:
        return _dec(
            tier=RouteTier.BASELINE_STRONG,
            reason="long_or_high_token_requires_strong_path",
        )

    return _dec(
        tier=RouteTier.CHEAP_BOUNDED,
        reason="default_bounded_generation",
        temperature=0.0,
    )


def parse_label_output(text: str | None, allowed: list[str] | None) -> str | None:
    if not text:
        return None
    token = text.strip().split()[0].strip(".,;:\"'`") if text.strip() else ""
    if not token:
        return None
    if allowed:
        for lab in allowed:
            if token == lab or token.casefold() == lab.casefold():
                return lab
        return None
    return token


def cheap_system_instruction(allowed: list[str] | None) -> str:
    contract = OutputContract(kind="labels", allowed_labels=allowed, source="labels") if allowed else OutputContract()
    return structured_system_instruction(contract)


def policy_config_fingerprint(*, cheap_model: str, baseline_model: str) -> str:
    return sha256_json(
        {
            "policy_id": POLICY_ID,
            "policy_version": POLICY_VERSION_FULL,
            "cheap_model": cheap_model,
            "baseline_model": baseline_model,
            "structured_output_version": STRUCTURED_OUTPUT_VERSION,
            "product_invariants_version": PRODUCT_INVARIANTS_VERSION,
            "product_invariants_hash": product_invariants_hash(),
        }
    )


def assert_route_inputs_clean(
    *,
    case_id: Any = None,
    expected: Any = None,
    cohort: Any = None,
) -> None:
    if case_id is not None:
        raise ValueError("bounded_routing must not receive benchmark case_id")
    if expected is not None:
        raise ValueError("bounded_routing must not receive expected answers")
    if cohort is not None:
        raise ValueError("bounded_routing must not receive dataset cohort labels")
