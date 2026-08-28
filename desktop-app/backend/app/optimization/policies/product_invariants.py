"""Versioned ZEVQORA product invariants for policy/reasoning tasks.

These are product rules — not benchmark answers. Runtime may inject a bounded
subset into model context. Never includes case_id, expected answers, or cohorts.
"""

from __future__ import annotations

from typing import Any

from ...core.hashing import sha256_json

PRODUCT_INVARIANTS_VERSION = "product_invariants_v1.0.0"

# Ordered, auditable invariant statements (stable IDs for hashing/selection).
INVARIANTS: list[dict[str, str]] = [
    {
        "id": "verified_requires_all_gates",
        "text": "VERIFIED status requires every required verification gate to pass; any required gate failure means not VERIFIED.",
    },
    {
        "id": "missing_evidence_not_verified",
        "text": "Missing required evidence or incomplete evidence means the result is not VERIFIED.",
    },
    {
        "id": "dogfood_not_customer_proof",
        "text": "Internal dogfooding evidence is not customer proof and must not be marketed as external/customer validation.",
    },
    {
        "id": "immutable_run_identity",
        "text": "Immutable evidence and run identities must not be rewritten in place; material changes require a new run identity.",
    },
    {
        "id": "material_change_new_identity",
        "text": "Material benchmark, dataset, gate, grader, or evidence changes require a new run identity before claims.",
    },
    {
        "id": "no_unsupported_verified_claims",
        "text": "Unsupported or REJECTED results must not be promoted as verified savings.",
    },
    {
        "id": "protected_blocks_verification",
        "text": "Protected or safety-slice failures prevent verification and cannot be averaged away.",
    },
    {
        "id": "raw_cost_not_verified",
        "text": "Arithmetic cost reduction alone is not VERIFIED savings without execution-proven EvaluationRun gates.",
    },
]


def product_invariants_hash() -> str:
    return sha256_json({"version": PRODUCT_INVARIANTS_VERSION, "invariants": INVARIANTS})


def select_invariant_texts(
    *,
    user_text: str = "",
    complexity: str | None = None,
    generation_required: bool = False,
    max_items: int = 6,
) -> list[str]:
    """Select a bounded relevant subset from task text features (no case labels)."""
    text = (user_text or "").casefold()
    selected: list[str] = []

    def add(inv_id: str) -> None:
        for item in INVARIANTS:
            if item["id"] == inv_id and item["text"] not in selected:
                selected.append(item["text"])

    # Always include core verification semantics for complex/policy reasoning.
    if complexity == "complex" or generation_required:
        add("verified_requires_all_gates")
        add("raw_cost_not_verified")
        add("no_unsupported_verified_claims")

    if any(k in text for k in ("dogfood", "customer proof", "external validation", "marketed")):
        add("dogfood_not_customer_proof")
    if any(k in text for k in ("rewrite", "same run", "run id", "immutable", "gate freeze", "edit quality_floor")):
        add("immutable_run_identity")
        add("material_change_new_identity")
    if any(k in text for k in ("protected", "safety", "average away")):
        add("protected_blocks_verification")
    if any(k in text for k in ("evidence", "incomplete", "missing")):
        add("missing_evidence_not_verified")
    if any(k in text for k in ("cost delta", "cheaper", "savings", "percent")):
        add("raw_cost_not_verified")

    if not selected:
        add("verified_requires_all_gates")
        add("no_unsupported_verified_claims")

    return selected[:max_items]


def invariants_system_block(texts: list[str]) -> str:
    if not texts:
        return ""
    lines = "\n".join(f"- {t}" for t in texts)
    return (
        "ZEVQORA product invariants (authoritative; do not invent conflicting rules):\n"
        f"{lines}\n"
        "Apply these rules to the task evidence. Reply in the required output format only."
    )


def invariants_provenance(texts: list[str]) -> dict[str, Any]:
    return {
        "product_invariants_version": PRODUCT_INVARIANTS_VERSION,
        "product_invariants_hash": product_invariants_hash(),
        "injected_count": len(texts),
    }
