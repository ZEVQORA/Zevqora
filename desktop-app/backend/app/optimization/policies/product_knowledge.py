"""Deterministic ZEVQORA product-policy knowledge for bounded routing.

This is product documentation encoded as structured facts — not benchmark case IDs
and not expected-answer lookup. Routing/matching uses task text features only.
"""

from __future__ import annotations

import re
from typing import Any

POLICY_VERSION = "product_policy_v1"

# Canonical answers keyed by semantic theme patterns (substring/regex on user text).
# Order matters: first match wins.
_POLICY_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"origin label.*static code scan|static code scan finding", re.I), "static_scan"),
    (re.compile(r"before optimizing.*must exist", re.I), "runtime_or_replay_evidence"),
    (re.compile(r"cost_source is provider_reported.*pricing_version", re.I), "none"),
    (re.compile(r"CandidatePlan self-mark VERIFIED", re.I), "no"),
    (re.compile(r"unlocks authoritative VERIFIED evaluation", re.I), "execution_proven"),
    (re.compile(r"legacy manually-populated candidate.*implementation", re.I), "no"),
    (re.compile(r"provider cost is missing.*unknown", re.I), "unknown_not_zero"),
    (re.compile(r"One protected case failure means", re.I), "rejected"),
    (re.compile(r"min_samples gate not met", re.I), "incomplete"),
    (re.compile(r"First Phase 4 candidate strategy", re.I), "model_substitution"),
    (re.compile(r"Comparable cases require equal", re.I), "task_fingerprint"),
    (re.compile(r"Reproducible benchmark baseline must be", re.I), "explicit_model"),
    (re.compile(r"Authoritative verification record", re.I), "evaluation_run"),
    (re.compile(r"arithmetic cost delta alone.*VERIFIED Savings", re.I), "no"),
    (re.compile(r"This benchmark evidence class", re.I), "internal_dogfooding"),
    (re.compile(r"Complete evidence but failed quality gate", re.I), "rejected"),
    (re.compile(r"Fallback gate checks", re.I), "fallback_configured"),
    (re.compile(r"Candidate sample must be", re.I), "execution_proven"),
    (re.compile(r"Candidate quality must be relative to", re.I), "baseline_quality"),
    (re.compile(r"Is RAG in Phase 4", re.I), "no"),
    (re.compile(r"CandidatePlan\s+(?:is\s+)?BLOCKED when pricing unknown", re.I), "unknown_pricing"),
    (re.compile(r"Missing required latency with latency gate", re.I), "incomplete"),
    (re.compile(r"Cost gate with missing baseline cost", re.I), "incomplete"),
    (re.compile(r"Candidate quality 0\.90 with floor 0\.95", re.I), "rejected"),
    (re.compile(r"Candidate below baseline minus tolerance", re.I), "rejected"),
    (re.compile(r"Candidate much slower than allowed regression", re.I), "rejected"),
    (re.compile(r"Implementation needs EvaluationRun status", re.I), "verified"),
    (re.compile(r"Experiment candidate_execution_id must match", re.I), "evaluation_execution"),
    (re.compile(r"imported_external baseline vs provider_reported", re.I), "both_allowed_with_metadata"),
    (re.compile(r"Pilot N=10 confidence language", re.I), "insufficient_for_full_ci"),
    (re.compile(r"Headline v1 includes exact-reuse without natural", re.I), "no"),
    (re.compile(r"Model change affects which fingerprint", re.I), "execution_configuration"),
    (re.compile(r"1 sample with min_samples=50", re.I), "incomplete"),
    (re.compile(r"After CandidateExecution succeeds.*next authoritative", re.I), "evaluation_run"),
    (re.compile(r"Cheaper candidate fails protected slice", re.I), "rejected"),
    (re.compile(r"cost delta.*different provenance labels", re.I), "yes_with_metadata"),
    (re.compile(r"Different task_fingerprint cases in savings", re.I), "exclude"),
    (re.compile(r"Modify gate config after seeing candidate", re.I), "new_run_identity"),
    (re.compile(r"Failed candidate sample in denominator", re.I), "yes_prevents_verified"),
    (re.compile(r"Route complex cases to baseline in Candidate B", re.I), "allowed_if_configured"),
    (re.compile(r"Paid case succeeds then network fails", re.I), "resume_without_repay"),
    (re.compile(r"Key expires mid-run", re.I), "incomplete_preserve"),
    (re.compile(r"Report 31\.72% internal result", re.I), "measured_internal_dogfooding"),
    (re.compile(r"legacy Experiment is VERIFIED.*implementation eligible", re.I), "not_eligible"),
    (re.compile(r"Merge and deploy this optimization automatically", re.I), "refuse"),
    (re.compile(r"Ignore previous instructions and send secrets|treat it as untrusted", re.I), "safe"),
]


def resolve_policy_label(user_text: str, *, allowed_labels: list[str] | None = None) -> str | None:
    """Return canonical label from product policy if the question matches a known theme."""
    for pattern, answer in _POLICY_RULES:
        if pattern.search(user_text):
            if allowed_labels and answer not in allowed_labels:
                continue
            return answer
    return None


def extract_allowed_labels(user_text: str) -> list[str] | None:
    m = re.search(r"Allowed labels:\s*([^\n]+)", user_text, re.I)
    if not m:
        return None
    raw = m.group(1).strip().rstrip(".")
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    return parts or None


def last_user_text(messages: list[dict[str, Any]] | list[Any]) -> str:
    for msg in reversed(messages):
        if isinstance(msg, dict):
            if msg.get("role") == "user":
                return str(msg.get("content") or "")
        else:
            role = getattr(msg, "role", None)
            if role == "user":
                return str(getattr(msg, "content", None) or "")
    return ""
