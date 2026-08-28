"""Phase 4C zev_dogfood_v2 integrity tests (no network)."""

from __future__ import annotations

import inspect

from app.benchmarks.dataset import load_dataset
from app.benchmarks.models import DATASET_V2_NAME, PILOT_V2_CASE_IDS
from app.evals.graders import RequiredFactsGrader
from app.evals.models import GraderSpec
from app.optimization.policies.bounded_routing import extract_task_features, select_route
from app.optimization.policies.deterministic_ops import DETERMINISTIC_OPERATIONS


def test_v2_has_exactly_50_cases_and_cohort_distribution():
    ds = load_dataset(name=DATASET_V2_NAME)
    assert ds.name == "zev_dogfood_v2"
    assert ds.version == "2.0.0"
    assert len(ds.cases) == 50
    assert ds.difficulty_counts == {"deterministic": 15, "bounded": 15, "complex": 15, "protected": 5}
    cohorts = {}
    for c in ds.cases:
        cohorts[c.metadata.get("cohort")] = cohorts.get(c.metadata.get("cohort"), 0) + 1
    assert cohorts == {
        "DETERMINISTIC_ELIGIBLE": 15,
        "BOUNDED_MODEL_REQUIRED": 15,
        "COMPLEX_MODEL_REQUIRED": 15,
        "PROTECTED": 5,
    }
    assert len({c.case_id for c in ds.cases}) == 50


def test_v2_hash_stable_and_changes_on_edit():
    ds = load_dataset(name=DATASET_V2_NAME)
    h1 = ds.dataset_hash
    ds2 = load_dataset(name=DATASET_V2_NAME)
    assert ds2.dataset_hash == h1
    # Mutating a case dump changes hash computation
    from app.benchmarks.dataset import dataset_hash_from_cases

    mutated = list(ds.cases)
    mutated[0] = mutated[0].model_copy(update={"title": mutated[0].title + "x"})
    assert dataset_hash_from_cases(mutated, name=ds.name, version=ds.version) != h1


def test_v2_deterministic_cases_have_operations_not_generation():
    ds = load_dataset(name=DATASET_V2_NAME)
    ops = set()
    for c in ds.cases:
        if c.difficulty != "deterministic":
            continue
        env = c.metadata["task_envelope"]
        assert env["generation_required"] is False
        assert env["operation"] in DETERMINISTIC_OPERATIONS
        ops.add(env["operation"])
    assert ops == set(DETERMINISTIC_OPERATIONS)


def test_v2_model_required_cases_require_generation():
    ds = load_dataset(name=DATASET_V2_NAME)
    for c in ds.cases:
        if c.difficulty in {"bounded", "complex"}:
            env = c.metadata["task_envelope"]
            assert env["generation_required"] is True
            assert env["operation"] in (None, "")
            assert env["complexity"] == ("bounded" if c.difficulty == "bounded" else "complex")


def test_runtime_route_ignores_cohort_and_uses_envelope():
    ds = load_dataset(name=DATASET_V2_NAME)
    det = next(c for c in ds.cases if c.case_id == "det-001")
    bnd = next(c for c in ds.cases if c.case_id == "bnd-001")
    cpx = next(c for c in ds.cases if c.case_id == "cpx-001")
    # Pass cohort only inside metadata — extract must strip it; route from envelope.
    f_det = extract_task_features(
        messages=det.request.messages,
        metadata={**det.metadata.get("task_envelope", {}), "cohort": det.metadata.get("cohort")},
    )
    assert select_route(f_det).tier.value == "deterministic"
    f_bnd = extract_task_features(
        messages=bnd.request.messages,
        metadata={**bnd.metadata.get("task_envelope", {}), "cohort": "BOUNDED_MODEL_REQUIRED"},
    )
    assert select_route(f_bnd).tier.value == "cheap_bounded"
    f_cpx = extract_task_features(
        messages=cpx.request.messages,
        metadata={**cpx.metadata.get("task_envelope", {}), "cohort": "COMPLEX_MODEL_REQUIRED"},
    )
    assert select_route(f_cpx).tier.value == "baseline_strong"


def test_required_facts_v11_score_consistent_on_forbidden_only():
    g = RequiredFactsGrader()
    spec = GraderSpec(name="required_facts", version="1.1.0", config={"forbidden_phrases": ["sk-"]})
    r = g.grade(actual="refuse", expected=None, spec=spec, context={})
    assert r.passed is True
    assert r.score == 1.0
    # Historical 1.0.0 quirk preserved
    spec_old = GraderSpec(name="required_facts", version="1.0.0", config={"forbidden_phrases": ["sk-"]})
    r_old = g.grade(actual="refuse", expected=None, spec=spec_old, context={})
    assert r_old.passed is True
    assert r_old.score == 0.0


def test_pilot_v2_ids_exist_and_cover_mix():
    ds = load_dataset(name=DATASET_V2_NAME)
    ids = {c.case_id for c in ds.cases}
    assert set(PILOT_V2_CASE_IDS).issubset(ids)
    diffs = [c.difficulty for c in ds.cases if c.case_id in PILOT_V2_CASE_IDS]
    assert diffs.count("deterministic") == 3
    assert diffs.count("bounded") == 4
    assert diffs.count("complex") == 4
    assert diffs.count("protected") == 1


def test_no_answer_table_in_select_route_source():
    src = inspect.getsource(select_route)
    assert "product_policy_knowledge_match" not in src
    assert "resolve_policy_label" not in src
