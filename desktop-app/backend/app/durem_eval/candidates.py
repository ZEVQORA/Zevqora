"""Candidate optimization framework.

Each candidate declares its hypothesis, the waste it targets, the delta it
applies, the expected benefit, its risk, its rollback, the behaviour it must
preserve, and the gates it must clear. A candidate is applied only to the
candidate arm and is always reverted afterwards.

Deltas are applied here as narrow, reversible runtime patches. Each candidate
records ``production_change`` -- the equivalent edit to DUREM's source -- so the
patch is a faithful stand-in for a real change and not a test-only shortcut.

No candidate targets a savings percentage. The measured effect is whatever it is.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

CANDIDATES_VERSION = "durem_candidates_v1"


@dataclass
class Candidate:
    candidate_id: str
    title: str
    hypothesis: str
    target_finding: str
    production_change: str
    expected_benefit: str
    expected_risk: str
    rollback: str
    protected_behavior: list[str] = field(default_factory=list)
    required_gates: list[str] = field(default_factory=list)
    _apply: Callable[[Any], Callable[[], None]] | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "candidate_id": self.candidate_id,
            "title": self.title,
            "hypothesis": self.hypothesis,
            "target_finding": self.target_finding,
            "production_change": self.production_change,
            "expected_benefit": self.expected_benefit,
            "expected_risk": self.expected_risk,
            "rollback": self.rollback,
            "protected_behavior": self.protected_behavior,
            "required_gates": self.required_gates,
            "candidates_version": CANDIDATES_VERSION,
        }

    def apply(self, session: Any) -> Callable[[], None]:
        """Apply the delta. Returns a callable that reverts it exactly."""
        if self._apply is None:
            raise NotImplementedError(f"{self.candidate_id} has no delta implementation")
        return self._apply(session)


# ---------------------------------------------------------------------------
# Candidate A -- skip the discarded embedding on deterministic-rule cases
# ---------------------------------------------------------------------------


def _apply_candidate_a(session: Any) -> Callable[[], None]:
    """Skip chunk retrieval when the numeric rule engine will decide the case.

    In ``_answer_policy`` the order is: retrieve_rules, retrieve_chunks (which
    embeds the query), retrieve_responsibilities, and only then
    ``_deterministic_numeric_rule``. When that rule fires, the chunks are never
    read -- the deterministic response is built from the rule alone. So the
    embedding is computed and discarded.

    The delta reuses the engine's own predicate verbatim, so "will the rule fire"
    cannot drift from "did the rule fire". When it fires, returning no chunks is
    output-equivalent by construction.
    """
    engine = session.engine
    retrieval = session.retrieval
    original = engine.retrieve_chunks

    async def patched(question, user, limit: int = 6):
        # Same predicate the engine is about to evaluate, on the same rule set.
        rules = retrieval.retrieve_rules(question, user)
        if engine._deterministic_numeric_rule(question, rules) is not None:
            return []
        return await original(question, user, limit)

    engine.retrieve_chunks = patched

    def revert() -> None:
        engine.retrieve_chunks = original

    return revert


CANDIDATE_A = Candidate(
    candidate_id="durem-cand-a",
    title="Skip discarded query embedding when the deterministic rule engine decides",
    hypothesis=(
        "Exact-threshold questions pay one embedding call whose vector is discarded, "
        "because retrieve_chunks() runs before _deterministic_numeric_rule()."
    ),
    target_finding="DIAG-001",
    production_change=(
        "In app/assistant_engine.py::_answer_policy, evaluate _deterministic_numeric_rule "
        "against retrieve_rules() before calling retrieve_chunks(), and skip chunk retrieval "
        "entirely when a rule matches. No thresholds, prompts or rule semantics change."
    ),
    expected_benefit=(
        "One embedding call removed per deterministic-rule case. No change to LLM calls, "
        "decisions, cited sources or answers."
    ),
    expected_risk=(
        "If the pre-check diverged from the engine's own check, a case could lose RAG context. "
        "Mitigated by calling the engine's own predicate rather than reimplementing it. "
        "The extra retrieve_rules() call is SQL-only and costs no model work."
    ),
    rollback="Restore the original retrieve_chunks binding; the delta is a single reversible patch.",
    protected_behavior=[
        "every RULE case keeps its exact decision and cited rule id",
        "no ACL or lifecycle document becomes reachable",
        "NOT_FOUND behaviour is unchanged",
        "routing is untouched",
    ],
    required_gates=[
        "quality_floor",
        "non_inferiority",
        "protected_slice",
        "deterministic_rule_correctness",
        "acl_privacy",
        "document_lifecycle",
        "not_found_safety",
        "execution_success",
        "work_improvement",
    ],
    _apply=_apply_candidate_a,
)


REGISTRY: dict[str, Candidate] = {CANDIDATE_A.candidate_id: CANDIDATE_A}


def get(candidate_id: str) -> Candidate:
    if candidate_id not in REGISTRY:
        raise KeyError(f"unknown candidate {candidate_id!r}; known: {sorted(REGISTRY)}")
    return REGISTRY[candidate_id]


def list_candidates() -> list[dict[str, Any]]:
    return [c.as_dict() for c in REGISTRY.values()]
