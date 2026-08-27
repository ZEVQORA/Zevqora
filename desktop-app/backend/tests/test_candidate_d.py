"""Candidate D: fixture isolation, structured output, product invariants."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.benchmarks.models import BenchmarkCaseRequest, BenchmarkCaseSetup, BenchmarkCaseSpec
from app.benchmarks.setup_seed import (
    FIXTURE_HARNESS_VERSION,
    apply_case_setup,
    clear_product_fixture_state,
    materialize_product_state_seed,
)
from app.core.db_migrate import ensure_schema
from app.db_models import AICall, Product, utcnow
from app.evals.models import GraderSpec
from app.optimization.policies.bounded_routing import POLICY_VERSION_FULL, extract_task_features, select_route
from app.optimization.policies.deterministic_ops import execute_deterministic_operation
from app.optimization.policies.product_invariants import (
    PRODUCT_INVARIANTS_VERSION,
    product_invariants_hash,
    select_invariant_texts,
)
from app.optimization.policies.structured_output import (
    derive_output_contract,
    validate_structured_output,
)


@pytest.fixture()
def db_session(tmp_path):
    db_path = tmp_path / "cand_d.db"
    ensure_schema(f"sqlite:///{db_path.as_posix()}", backup_dir=tmp_path / "backups")
    engine = create_engine(f"sqlite:///{db_path.as_posix()}", future=True)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    db = Session()
    product = Product(
        id=str(uuid.uuid4()),
        name="cand-d",
        root_path=str(tmp_path / "ws"),
        created_at=utcnow(),
    )
    db.add(product)
    db.commit()
    yield db, product
    db.close()


def _count_case(case_id: str, n: int) -> BenchmarkCaseSpec:
    calls = [
        {
            "id": f"fixture-ai-{i:03d}__{case_id}",
            "provider": "openai",
            "file_path": "a.py",
            "line": i,
            "excerpt": "x",
        }
        for i in range(1, n + 1)
    ]
    return BenchmarkCaseSpec(
        case_id=case_id,
        title=f"count {n}",
        difficulty="deterministic",
        setup=BenchmarkCaseSetup(ai_calls=calls),
        request=BenchmarkCaseRequest(
            messages=[{"role": "user", "content": "How many AI call sites?"}],
            max_tokens=16,
        ),
        graders=[GraderSpec(name="exact_match", config={"trim": True})],
        expected=str(n),
        metadata={
            "task_envelope": {
                "operation": "count_ai_calls",
                "operation_args": {},
                "generation_required": False,
                "complexity": None,
            }
        },
    )


def test_fixture_harness_versioned():
    assert FIXTURE_HARNESS_VERSION.startswith("fixture_harness_v1.")


def test_isolation_order_independent(db_session):
    db, product = db_session
    a = _count_case("syn-a", 2)
    b = _count_case("syn-b", 5)
    for order in ([a, b], [b, a]):
        for case in order:
            apply_case_setup(db, product.id, case)
            out = execute_deterministic_operation(db, product.id, "count_ai_calls", context={})
            assert out == case.expected, (order[0].case_id, case.case_id, out)


def test_isolation_repeatable_two_preparations(db_session):
    db, product = db_session
    case = _count_case("syn-r", 3)
    for _ in range(2):
        apply_case_setup(db, product.id, case)
        assert execute_deterministic_operation(db, product.id, "count_ai_calls", context={}) == "3"
    # After clear, count is zero until reseed
    clear_product_fixture_state(db, product.id)
    db.commit()
    n = db.scalar(select(func.count()).select_from(AICall).where(AICall.product_id == product.id))
    assert n == 0


def test_candidate_restore_seed_matches_baseline(db_session):
    db, product = db_session
    case = _count_case("syn-c", 4)
    seed = apply_case_setup(db, product.id, case)
    assert execute_deterministic_operation(db, product.id, "count_ai_calls", context={}) == "4"
    # Pollute then restore via seed (candidate path)
    db.add(
        AICall(
            id="pollution",
            product_id=product.id,
            file_path="p.py",
            line=1,
            provider="x",
            excerpt="y",
        )
    )
    db.commit()
    materialize_product_state_seed(db, product.id, seed, clear_first=True)
    assert execute_deterministic_operation(db, product.id, "count_ai_calls", context={}) == "4"


def test_structured_output_unseen_schema():
    contract = derive_output_contract(
        user_text="Reply with ONLY a JSON object. No markdown fences.",
        metadata={"output_schema": {"required": ["alpha", "beta"], "properties": {"alpha": {"type": "string"}}}},
    )
    assert contract.kind == "json_object"
    assert contract.required_fields == ["alpha", "beta"]
    ok = validate_structured_output('{"alpha":"1","beta":"2"}', contract)
    assert ok.ok
    bad = validate_structured_output("not json", contract)
    assert not bad.ok and bad.reason == "object_required"
    missing = validate_structured_output('{"alpha":"1"}', contract)
    assert not missing.ok


def test_structured_output_from_text_contract_without_envelope():
    contract = derive_output_contract(
        user_text=(
            "From evidence, emit JSON with origin and evidence_status.\n"
            "Reply with ONLY a JSON object. No markdown fences."
        )
    )
    assert contract.source == "text_contract"
    assert "origin" in contract.required_fields
    assert "evidence_status" in contract.required_fields


def test_product_invariants_synthetic_not_in_v2():
    texts = select_invariant_texts(
        user_text="Should we rewrite the same run id after editing quality_floor?",
        complexity="complex",
        generation_required=True,
    )
    blob = " ".join(texts).casefold()
    assert "new run identity" in blob or "immutable" in blob
    assert PRODUCT_INVARIANTS_VERSION
    assert len(product_invariants_hash()) == 64


def test_policy_v1_2_0_and_no_case_leakage():
    assert POLICY_VERSION_FULL == "bounded_routing_v1.2.0"
    features = extract_task_features(
        messages=[{"role": "user", "content": "Classify.\nAllowed labels: keep, drop."}],
        metadata={"generation_required": True, "complexity": "complex"},
    )
    decision = select_route(features)
    assert decision.tier.value == "baseline_strong"
    assert decision.product_invariants
    assert decision.output_contract is not None
    src = open(
        __import__("app.optimization.policies.bounded_routing", fromlist=["x"]).__file__,
        encoding="utf-8",
    ).read()
    assert "expected_answer" not in src
