import subprocess
import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.db_models import Experiment, Finding, Product
from app.implementation import service
from app.implementation.service import ImplementationError
from app.schemas import ImplementationPrepareRequest


def git(repo, *args):
    return subprocess.run(["git", *args], cwd=repo, text=True, capture_output=True, check=True)


@pytest.mark.asyncio
async def test_legacy_verified_blocks_implementation(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "service.py").write_text("def classify(x):\n    return 'old'\n", encoding="utf-8")
    git(repo, "init")
    git(repo, "config", "user.email", "test@example.invalid")
    git(repo, "config", "user.name", "ZEVQORA Test")
    git(repo, "add", "service.py")
    git(repo, "commit", "-m", "initial")

    engine = create_engine(f"sqlite:///{tmp_path / 'db.sqlite'}")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        product_id = str(uuid.uuid4())
        finding_id = str(uuid.uuid4())
        experiment_id = str(uuid.uuid4())
        db.add(Product(id=product_id, name="Demo", root_path=str(repo)))
        db.add(
            Finding(
                id=finding_id,
                product_id=product_id,
                origin="static_scan",
                category="structured_task_candidate",
                title="Bounded classification",
                root_cause="verified candidate available",
                file_path="service.py",
                line=1,
                symbol="classify",
                confidence=0.9,
                risk="medium",
                evidence_status="verified",
            )
        )
        db.add(
            Experiment(
                id=experiment_id,
                product_id=product_id,
                finding_id=finding_id,
                status="VERIFIED",
                sample_size=10,
                baseline_cost_usd=1.0,
                candidate_cost_usd=0.5,
                verified_savings_usd=0.5,
                baseline_quality=1.0,
                candidate_quality=1.0,
                gates_json="[]",
                evidence_version="replay:test",
                verification_source="LEGACY_CANDIDATE_EVIDENCE",
                execution_proven=False,
            )
        )
        db.commit()

        with pytest.raises(ImplementationError, match="not execution-proven"):
            await service.prepare_implementation(
                db,
                product_id,
                ImplementationPrepareRequest(experiment_id=experiment_id),
            )
