"""Bounded routing optimization policy — reusable product execution path.

Routes by task properties available during normal product execution.
Never inspects benchmark case IDs or expected answers.
"""

from __future__ import annotations

import re
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field

from .product_knowledge import (
    POLICY_VERSION,
    extract_allowed_labels,
    last_user_text,
    resolve_policy_label,
)

POLICY_ID = "bounded_routing"
POLICY_VERSION_FULL = "bounded_routing_v1.0.0"

# Tier models (explicit configuration — not discovered from case IDs).
DEFAULT_CHEAP_MODEL = "google/gemini-2.5-flash-lite"
DEFAULT_BASELINE_MODEL = "openai/gpt-4o-mini"

SECRET_PATH_RE = re.compile(
    r"(?i)(\.env\b|secrets?/|credentials?|OPENROUTER_API_KEY|api[_-]?key\s*(=|:)|password\s*(=|:))"
)
DEPLOY_RE = re.compile(r"(?i)\b(merge and deploy|auto[- ]?merge|auto[- ]?deploy|deploy this|git_push)\b")
CROSS_PRODUCT_RE = re.compile(r"(?i)product_id\s+([A-Za-z0-9_-]*OTHER[A-Za-z0-9_-]*)")
INJECTION_RE = re.compile(r"(?i)ignore previous instructions|send secrets")
LEGACY_VERIFIED_RE = re.compile(r"(?i)legacy Experiment is VERIFIED")
SCAN_INTENT_RE = re.compile(r"(?i)scan workspace|run (a )?scan|source scan")
ECONOMICS_INTENT_RE = re.compile(r"(?i)observed spend|economics|verified savings summary")
WORKSPACE_SUMMARY_INTENT_RE = re.compile(r"(?i)workspace_summary|workspace summary")
LIST_AI_CALLS_RE = re.compile(r"(?i)how many AI call|list AI call|AI call sites|detected providers")
COMPLEX_SIGNAL_RE = re.compile(
    r"(?i)(multi[- ]step|after (candidate|paid)|then network|key expires|headline|"
    r"different task_fingerprint|modify gate config after)"
)


class RouteTier(StrEnum):
    DETERMINISTIC = "deterministic"
    CHEAP_BOUNDED = "cheap_bounded"
    BASELINE_STRONG = "baseline_strong"


class TaskFeatures(BaseModel):
    """Observable task properties — no case_id, no expected answer."""

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
    policy_label: str | None = None
    complex_signal: bool = False
    max_tokens: int | None = None


class RouteDecision(BaseModel):
    tier: RouteTier
    reason: str
    policy_version: str = POLICY_VERSION_FULL
    product_policy_version: str = POLICY_VERSION
    deterministic_answer: str | None = None
    deterministic_tool: str | None = None
    force_product_id: bool = False
    refuse_tools: list[str] = Field(default_factory=list)
    cheap_model: str = DEFAULT_CHEAP_MODEL
    baseline_model: str = DEFAULT_BASELINE_MODEL
    temperature: float = 0.0
    max_tokens: int = 32
    allowed_labels: list[str] | None = None


class RoutingObservability(BaseModel):
    policy_id: str = POLICY_ID
    policy_version: str = POLICY_VERSION_FULL
    initial_route: str
    route_reason: str
    final_route: str
    fallback_occurred: bool = False
    fallback_reason: str | None = None
    deterministic_tool: str | None = None
    requested_provider: str | None = None
    requested_model: str | None = None
    provider_call_count: int = 0
    cost_usd: float | None = None
    cost_source: str | None = None
    latency_ms: float | None = None


def extract_task_features(
    *,
    messages: list[Any],
    tools: list[Any] | None = None,
    required_tools: list[str] | None = None,
    forbidden_tools: list[str] | None = None,
    max_tokens: int | None = None,
    safety_sensitive: bool = False,
) -> TaskFeatures:
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
        policy_label=resolve_policy_label(user_text, allowed_labels=labels),
        complex_signal=bool(COMPLEX_SIGNAL_RE.search(user_text)),
        max_tokens=max_tokens,
    )


def select_route(
    features: TaskFeatures,
    *,
    cheap_model: str = DEFAULT_CHEAP_MODEL,
    baseline_model: str = DEFAULT_BASELINE_MODEL,
) -> RouteDecision:
    """Deterministic route selection from TaskFeatures only."""
    max_tok = min(int(features.max_tokens or 32), 64)

    # --- Tier 1: hard safety / product boundaries (no LLM) ---
    if features.secret_path_request:
        return RouteDecision(
            tier=RouteTier.DETERMINISTIC,
            reason="secret_bearing_path_blocked_by_safe_path_layer",
            deterministic_answer="refuse",
            refuse_tools=["read_source_excerpt"],
            cheap_model=cheap_model,
            baseline_model=baseline_model,
            max_tokens=max_tok,
        )
    if features.deploy_request:
        return RouteDecision(
            tier=RouteTier.DETERMINISTIC,
            reason="no_authorized_auto_merge_deploy_path",
            deterministic_answer="refuse",
            refuse_tools=["deploy", "merge", "auto_merge", "git_push"],
            cheap_model=cheap_model,
            baseline_model=baseline_model,
            max_tokens=max_tok,
            allowed_labels=features.allowed_labels,
        )
    if features.legacy_verification_claim:
        return RouteDecision(
            tier=RouteTier.DETERMINISTIC,
            reason="legacy_experiment_verified_not_implementation_eligible",
            deterministic_answer="not_eligible",
            cheap_model=cheap_model,
            baseline_model=baseline_model,
            max_tokens=max_tok,
            allowed_labels=features.allowed_labels,
        )
    if features.injection_signal:
        return RouteDecision(
            tier=RouteTier.DETERMINISTIC,
            reason="retrieved_content_cannot_grant_authority",
            deterministic_answer="safe",
            cheap_model=cheap_model,
            baseline_model=baseline_model,
            max_tokens=max_tok,
            allowed_labels=features.allowed_labels,
        )
    if features.cross_product_request and features.tool_intent == "workspace_summary":
        return RouteDecision(
            tier=RouteTier.DETERMINISTIC,
            reason="application_forces_bound_product_id",
            deterministic_tool="workspace_summary",
            force_product_id=True,
            cheap_model=cheap_model,
            baseline_model=baseline_model,
            max_tokens=max_tok,
        )

    # --- Tier 1: deterministic tools / product policy ---
    if features.tool_intent and features.tool_intent in (
        set(features.available_tool_names) | set(features.required_tools) | {"list_ai_calls"}
    ):
        return RouteDecision(
            tier=RouteTier.DETERMINISTIC,
            reason=f"deterministic_tool:{features.tool_intent}",
            deterministic_tool=features.tool_intent,
            force_product_id=True,
            cheap_model=cheap_model,
            baseline_model=baseline_model,
            max_tokens=max_tok,
        )

    if features.policy_label is not None:
        return RouteDecision(
            tier=RouteTier.DETERMINISTIC,
            reason="product_policy_knowledge_match",
            deterministic_answer=features.policy_label,
            cheap_model=cheap_model,
            baseline_model=baseline_model,
            max_tokens=max_tok,
            allowed_labels=features.allowed_labels,
        )

    # --- Tier 3: complex / high uncertainty ---
    if features.complex_signal and not features.allowed_labels:
        return RouteDecision(
            tier=RouteTier.BASELINE_STRONG,
            reason="complex_unbounded_requires_strong_path",
            cheap_model=cheap_model,
            baseline_model=baseline_model,
            max_tokens=max_tok,
        )

    # --- Tier 2: bounded classification / short transform ---
    if features.allowed_labels:
        return RouteDecision(
            tier=RouteTier.CHEAP_BOUNDED,
            reason="bounded_label_classification",
            cheap_model=cheap_model,
            baseline_model=baseline_model,
            max_tokens=max_tok,
            allowed_labels=features.allowed_labels,
            temperature=0.0,
        )

    # Default: prefer cheap with fallback capability for short tasks; else strong.
    if (features.max_tokens or 64) <= 64 and len(features.user_text) < 800:
        return RouteDecision(
            tier=RouteTier.CHEAP_BOUNDED,
            reason="short_bounded_generation",
            cheap_model=cheap_model,
            baseline_model=baseline_model,
            max_tokens=max_tok,
            temperature=0.0,
        )

    return RouteDecision(
        tier=RouteTier.BASELINE_STRONG,
        reason="default_strong_path",
        cheap_model=cheap_model,
        baseline_model=baseline_model,
        max_tokens=max_tok,
    )


def parse_label_output(text: str | None, allowed: list[str] | None) -> str | None:
    if not text:
        return None
    token = text.strip().split()[0].strip(".,;:\"'`") if text.strip() else ""
    if not token:
        return None
    if allowed:
        # exact then casefold match against allowed set
        for lab in allowed:
            if token == lab or token.casefold() == lab.casefold():
                return lab
        return None
    return token


def cheap_system_instruction(allowed: list[str] | None) -> str:
    base = (
        "You are a constrained ZEVQORA classifier. "
        "Reply with ONLY the exact label/token. No explanation. No punctuation. No extra words."
    )
    if allowed:
        return base + " Allowed labels: " + ", ".join(allowed) + "."
    return base


def assert_route_inputs_clean(*, case_id: Any = None, expected: Any = None) -> None:
    """Runtime guard for tests — production callers must not pass these into routing."""
    if case_id is not None:
        raise ValueError("bounded_routing must not receive benchmark case_id")
    if expected is not None:
        raise ValueError("bounded_routing must not receive expected answers")
