"""Benchmark tests — MockProvider only, no network."""

from __future__ import annotations

import asyncio

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.benchmarks.dataset import dataset_hash_from_cases, load_dataset
from app.benchmarks.models import PILOT_CASE_IDS
from app.benchmarks.runner import ensure_dataset_version, run_benchmark, seed_benchmark_product
from app.core.db_migrate import HEAD_REVISION, ensure_schema
from app.evals.statistics import bootstrap_ci, paired_cost_savings
from app.evidence.replay import ReplayableRequestSnapshot
from app.providers.mock import MockProvider
from app.providers.models import LLMMessage, LLMUsage


def test_head_is_phase4(tmp_path):
    assert HEAD_REVISION == "0005_benchmark_dogfood"
    db = tmp_path / "b.db"
    ensure_schema(f"sqlite:///{db.as_posix()}", backup_dir=tmp_path / "bk")
    import sqlite3

    conn = sqlite3.connect(str(db))
    try:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        conn.close()
    assert "benchmark_runs" in tables


def test_dataset_hash_stable():
    d1 = load_dataset()
    d2 = load_dataset()
    assert d1.dataset_hash == d2.dataset_hash
    assert len(d1.cases) == 50
    assert d1.difficulty_counts.get("simple") == 20
    assert d1.difficulty_counts.get("medium") == 15
    assert d1.difficulty_counts.get("complex") == 10
    assert d1.difficulty_counts.get("protected") == 5


def test_dataset_hash_changes_when_case_changes():
    d = load_dataset()
    cases = list(d.cases)
    cases[0] = cases[0].model_copy(update={"title": "changed"})
    assert dataset_hash_from_cases(cases, name=d.name, version=d.version) != d.dataset_hash


def test_replay_snapshot_task_fingerprint_stable():
    snap = ReplayableRequestSnapshot(
        messages=[LLMMessage(role="user", content="hello")],
        temperature=0.0,
        max_tokens=32,
    )
    assert snap.snapshot_hash() == snap.snapshot_hash()
    assert snap.task_fingerprint()


def test_paired_cost_and_bootstrap_reproducible():
    b = [0.02, 0.03, 0.01, 0.02, 0.02]
    c = [0.01, 0.015, 0.008, 0.01, 0.012]
    stats = paired_cost_savings(b, c)
    assert stats["percent_savings"] is not None
    ci1 = bootstrap_ci(b, c, seed=42)
    ci2 = bootstrap_ci(b, c, seed=42)
    assert ci1 == ci2


def test_mock_pilot_infrastructure(tmp_path, monkeypatch):
    monkeypatch.setattr("app.benchmarks.runner.git_state", lambda repo_root=None: ("testsha", False))
    dataset = load_dataset()
    pilot = [c for c in dataset.cases if c.case_id in PILOT_CASE_IDS[:3]]
    mock = MockProvider(
        default_content="static_scan",
        usage=LLMUsage(input_tokens=10, output_tokens=2, total_tokens=12),
        provider_cost_usd=0.00001,
        latency_ms=3.0,
    )
    db_path = tmp_path / "bench.db"
    ensure_schema(f"sqlite:///{db_path.as_posix()}", backup_dir=tmp_path / "bk")
    engine = create_engine(f"sqlite:///{db_path.as_posix()}", future=True)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    with Session() as db:
        product = seed_benchmark_product(db, root_path=tmp_path)
        dver = ensure_dataset_version(db, dataset)
        from app.benchmarks.models import PILOT_GATE_CONFIG

        run = asyncio.run(
            run_benchmark(
                db,
                cases=pilot,
                baseline_model="mock/test-model",
                candidate_model="mock/test-model",
                gate_config=PILOT_GATE_CONFIG.model_copy(
                    update={"min_samples": 3, "quality_floor": 0.0, "require_cost_improvement": False}
                ),
                provider=mock,
                product=product,
                dataset_version=dver,
                run_label="mock-pilot",
                max_cost_usd=1.0,
            )
        )
        assert run.baseline_total_cost is not None
        assert run.candidate_total_cost is not None
        assert run.evidence_hash
        assert run.status in {"VERIFIED", "REJECTED", "INCOMPLETE"}
