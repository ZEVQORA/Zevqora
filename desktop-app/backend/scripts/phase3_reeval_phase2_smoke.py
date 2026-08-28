"""Phase 3 re-eval of Phase 2 smoke semantics (no additional paid calls).

Phase 2 real smoke used a tempfile DB that is not retained. This script
reconstructs the known outcome with MockProvider:

  expected = account
  candidate = account
  ClassificationGrader

With GateConfig.min_samples=5 (production-like), status must be INCOMPLETE.

Usage:
  python scripts/phase3_reeval_phase2_smoke.py
"""

from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.db_migrate import ensure_schema  # noqa: E402
from app.core.hashing import sha256_text  # noqa: E402
from app.db_models import Product, Trace  # noqa: E402
from app.evals.models import EvaluationCaseSpec, GateConfig, GraderSpec  # noqa: E402
from app.evals.runner import create_and_run_evaluation  # noqa: E402
from app.optimization.executor import execute_plan  # noqa: E402
from app.optimization.planner import create_plans  # noqa: E402
from app.optimization.strategies import model_substitution as ms  # noqa: E402
from app.providers.mock import MockProvider  # noqa: E402
from app.providers.models import CostSource, LLMUsage  # noqa: E402


def main() -> int:
    settings.candidate_models = ("mock/test-model",)
    ms.settings.candidate_models = ("mock/test-model",)
    ms.settings.max_candidate_samples = 10

    with tempfile.TemporaryDirectory(prefix="zevqora-p3-reeval-") as tmp:
        tmp_path = Path(tmp)
        db_path = tmp_path / "reeval.db"
        ensure_schema(f"sqlite:///{db_path.as_posix()}", backup_dir=tmp_path / "backups")
        engine = create_engine(f"sqlite:///{db_path.as_posix()}", future=True)
        SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
        try:
            with SessionLocal() as db:
                product = Product(
                    id=str(uuid.uuid4()),
                    name="Phase3Reeval",
                    root_path=str(tmp_path),
                    monitoring_enabled=False,
                    created_at=datetime.now(UTC),
                )
                db.add(product)
                text = (
                    "Classify this support message into exactly one label: "
                    "billing, technical, account.\n"
                    "Message: I cannot reset my password.\n"
                    "Reply with only the label."
                )
                out = "account"
                db.add(
                    Trace(
                        id=str(uuid.uuid4()),
                        product_id=product.id,
                        request_id="phase2-smoke",
                        timestamp=datetime.now(UTC),
                        symbol="classify",
                        workflow="support",
                        provider="openrouter",
                        model="openai/gpt-4o-mini",
                        input_text=text,
                        output_text=out,
                        expected_output="account",
                        input_tokens=40,
                        output_tokens=1,
                        latency_ms=400.0,
                        cost_usd=0.00002,
                        cost_source=CostSource.IMPORTED_EXTERNAL.value,
                        input_hash=sha256_text(text),
                        output_hash=sha256_text(out),
                        protected=False,
                        metadata_json=json.dumps({"note": "phase2_smoke_reconstructed"}),
                    )
                )
                db.commit()

                plans = create_plans(
                    db,
                    product.id,
                    strategy="model_substitution",
                    candidate_model="mock/test-model",
                    max_budget_usd=0.01,
                )
                plan = plans[0]
                if plan.status != "READY":
                    print(f"FAIL: plan blocked: {plan.blocked_reason}")
                    return 1

                mock = MockProvider(
                    default_content="account",
                    usage=LLMUsage(input_tokens=40, output_tokens=1, total_tokens=41),
                    provider_cost_usd=0.000006,
                    latency_ms=350.0,
                )
                execution = asyncio.run(execute_plan(db, product.id, plan.id, provider=mock))
                samples = json.loads(execution.sample_results_json)
                run = create_and_run_evaluation(
                    db,
                    product.id,
                    candidate_execution_id=execution.id,
                    cases=[
                        EvaluationCaseSpec(
                            case_id="phase2-smoke",
                            baseline_trace_id=samples[0]["baseline_trace_id"],
                            graders=[
                                GraderSpec(
                                    name="classification",
                                    config={
                                        "labels": ["billing", "technical", "account"],
                                        "expected_label": "account",
                                        "strict": True,
                                    },
                                )
                            ],
                            expected="account",
                        )
                    ],
                    gate_config=GateConfig(min_samples=5, quality_floor=0.95, require_fallback=True),
                    project_experiment=False,
                )
                print(f"execution_status={execution.status}")
                print(f"candidate_output={samples[0].get('output_text')!r}")
                print(f"candidate_quality={run.candidate_quality}")
                print(f"evaluation_status={run.status}")
                print(f"rejection_reason={run.rejection_reason}")
                print("additional_openrouter_spend_usd=0.0")
                print("note=phase2_tempfile_evidence_unavailable; reconstructed_mock_path")
                if run.status != "INCOMPLETE":
                    print("FAIL: expected INCOMPLETE for single sample under min_samples=5")
                    return 1
                print("OK")
                return 0
        finally:
            engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
