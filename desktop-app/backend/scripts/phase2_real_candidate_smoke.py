"""Phase 2 real OpenRouter CandidateExecution smoke (explicit, not CI).

Usage:
  python scripts/phase2_real_candidate_smoke.py

Requires desktop-app/backend/.env with OPENROUTER_API_KEY (gitignored).
Never prints the API key.
"""

from __future__ import annotations

import json
import sys
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path

import httpx

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

# Import after path setup; config loads .env without printing secrets.
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.db_migrate import ensure_schema  # noqa: E402
from app.core.hashing import sha256_text  # noqa: E402
from app.db import configure_engine  # noqa: E402
from app.db_models import Product, Trace  # noqa: E402
from app.optimization.executor import execute_plan  # noqa: E402
from app.optimization.planner import create_plans  # noqa: E402
from app.optimization.strategies.model_substitution import (  # noqa: E402
    SMOKE_MAX_OUTPUT_TOKENS,
    estimate_sample_cost_usd,
)
from app.providers.factory import get_provider, reset_providers_for_tests  # noqa: E402
from app.providers.models import CostSource  # noqa: E402
from app.providers.pricing import reset_pricing_snapshot_cache  # noqa: E402

MODEL = "openai/gpt-4o-mini"
HARD_BUDGET_USD = 0.01
TASK = (
    "Classify this support message into exactly one label: billing, technical, account.\n"
    "Message: I cannot reset my password.\n"
    "Reply with only the label."
)


def _fetch_model_rates(api_key: str, model_id: str) -> dict:
    url = f"{settings.openrouter_base_url}/models"
    with httpx.Client(timeout=30.0) as client:
        response = client.get(url, headers={"Authorization": f"Bearer {api_key}"})
    if response.status_code >= 400:
        raise RuntimeError(f"OpenRouter models lookup failed: HTTP {response.status_code}")
    data = response.json().get("data") or []
    match = next((m for m in data if m.get("id") == model_id), None)
    if not match:
        raise RuntimeError(f"Model {model_id!r} not found in live OpenRouter catalog.")
    pricing = match.get("pricing") or {}
    prompt = pricing.get("prompt")
    completion = pricing.get("completion")
    if prompt is None or completion is None:
        raise RuntimeError(f"Model {model_id!r} has no prompt/completion pricing in OpenRouter metadata.")
    # OpenRouter quotes USD per token; convert to per-million for our snapshot.
    return {
        "input_per_million": float(prompt) * 1_000_000.0,
        "output_per_million": float(completion) * 1_000_000.0,
        "cached_input_per_million": float(pricing.get("input_cache_read") or prompt) * 1_000_000.0,
        "raw_id": match.get("id"),
        "architecture": match.get("architecture"),
    }


def main() -> int:
    report: dict = {"status": "FAIL"}
    if not settings.openrouter_api_key:
        print("FAIL: OPENROUTER_API_KEY missing from environment/.env")
        return 2
    if MODEL not in settings.candidate_models:
        print(f"FAIL: {MODEL} not in ZEVQORA_CANDIDATE_MODELS allowlist")
        return 2

    rates = _fetch_model_rates(settings.openrouter_api_key, MODEL)
    print(f"live_model_found={rates['raw_id']}")
    print(f"input_per_million_usd={rates['input_per_million']}")
    print(f"output_per_million_usd={rates['output_per_million']}")

    with tempfile.TemporaryDirectory(prefix="zevqora-p2-smoke-") as tmp:
        tmp_path = Path(tmp)
        pricing_path = tmp_path / "pricing_openrouter_live.json"
        pricing_payload = {
            "version": f"openrouter_live_{datetime.now(UTC).strftime('%Y%m%d')}",
            "retrieved_at": datetime.now(UTC).isoformat(),
            "source": "openrouter_models_api",
            "source_url": f"{settings.openrouter_base_url}/models",
            "notes": "Ephemeral smoke-test snapshot from live OpenRouter metadata. Not committed.",
            "models": {
                MODEL: {
                    "provider": "openrouter",
                    "input_per_million": rates["input_per_million"],
                    "output_per_million": rates["output_per_million"],
                    "cached_input_per_million": rates["cached_input_per_million"],
                },
                "mock/test-model": {
                    "provider": "mock",
                    "input_per_million": 1.0,
                    "output_per_million": 2.0,
                    "cached_input_per_million": 0.1,
                },
            },
        }
        pricing_path.write_text(json.dumps(pricing_payload, indent=2), encoding="utf-8")
        # Reload pricing for this process.
        import os

        os.environ["ZEVQORA_PRICING_SNAPSHOT"] = str(pricing_path)
        settings.pricing_snapshot_path = str(pricing_path)
        reset_pricing_snapshot_cache()

        db_path = tmp_path / "smoke.db"
        url = f"sqlite:///{db_path.as_posix()}"
        ensure_schema(url, backup_dir=tmp_path / "backups")
        engine = configure_engine(url)
        SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
        exit_code = 5

        try:
            with SessionLocal() as db:
                product = Product(
                    id=str(uuid.uuid4()),
                    name="Phase2 Real Smoke",
                    root_path=str(tmp_path / "workspace"),
                    monitoring_enabled=False,
                    created_at=datetime.now(UTC),
                )
                (tmp_path / "workspace").mkdir(parents=True, exist_ok=True)
                db.add(product)
                baseline = Trace(
                    id=str(uuid.uuid4()),
                    product_id=product.id,
                    request_id="phase2-smoke-baseline",
                    timestamp=datetime.now(UTC),
                    symbol="classify_support",
                    workflow="support_triage",
                    provider="imported",
                    model="baseline/unknown",
                    requested_model="baseline/unknown",
                    input_text=TASK,
                    output_text="account",
                    expected_output="account",
                    input_tokens=None,
                    output_tokens=None,
                    latency_ms=None,
                    cost_usd=None,  # no fabricated comparable baseline cost
                    cost_source=None,
                    input_hash=sha256_text(TASK),
                    output_hash=sha256_text("account"),
                    protected=False,
                    metadata_json=json.dumps(
                        {
                            "temperature": 0.0,
                            "response_format": None,
                            "note": "synthetic task text for plumbing smoke; not provider-backed baseline",
                        }
                    ),
                )
                db.add(baseline)
                db.commit()

                conservative = estimate_sample_cost_usd(MODEL, baseline, max_output_tokens=SMOKE_MAX_OUTPUT_TOKENS)
                report["conservative_estimated_max_cost_usd"] = conservative
                print(f"conservative_estimated_max_cost_usd={conservative}")
                if conservative is None:
                    print("FAIL: could not estimate cost from verified live rates")
                    return 3
                if conservative > HARD_BUDGET_USD:
                    print(f"FAIL: estimate {conservative} exceeds hard budget {HARD_BUDGET_USD}")
                    return 3

                plans = create_plans(
                    db,
                    product.id,
                    strategy="model_substitution",
                    candidate_model=MODEL,
                    max_budget_usd=HARD_BUDGET_USD,
                )
                plan = plans[0]
                report["plan_id"] = plan.id
                report["plan_status"] = plan.status
                print(f"plan_id={plan.id}")
                print(f"plan_status={plan.status}")
                if plan.status != "READY":
                    print(f"FAIL: plan blocked: {plan.blocked_reason or plan.reason}")
                    return 4

                reset_providers_for_tests()
                provider = get_provider("openrouter")
                import asyncio

                execution = asyncio.run(
                    execute_plan(
                        db,
                        product.id,
                        plan.id,
                        provider=provider,
                        force_rerun=False,
                    )
                )
                samples = json.loads(execution.sample_results_json or "[]")
                sample = samples[0] if samples else {}
                report.update(
                    {
                        "status": execution.status,
                        "execution_id": execution.id,
                        "requested_model": execution.requested_model,
                        "resolved_model": execution.resolved_model,
                        "provider": execution.provider,
                        "provider_call_count": execution.provider_call_count,
                        "input_tokens": execution.input_tokens,
                        "output_tokens": execution.output_tokens,
                        "cached_input_tokens": execution.cached_input_tokens,
                        "cost_usd": execution.cost_usd,
                        "cost_source": execution.cost_source,
                        "pricing_version": execution.pricing_version,
                        "latency_ms": execution.latency_ms,
                        "provider_request_id": execution.provider_request_id,
                        "provenance_hash": execution.provenance_hash,
                        "sample_count": len(samples),
                        "sample_output": (sample.get("output_text") or "")[:200],
                        "sample_reasoning_tokens": sample.get("reasoning_tokens"),
                        "raw_cost_delta": "NOT COMPARABLE / NO EQUIVALENT PROVIDER-BACKED BASELINE",
                        "baseline_cost_usd": sample.get("baseline_cost_usd"),
                        "candidate_cost_delta_usd": sample.get("candidate_cost_delta_usd"),
                        "task_fingerprint": sample.get("task_fingerprint"),
                        "candidate_config_fingerprint": sample.get("candidate_config_fingerprint"),
                        "label": "REAL PROVIDER-BACKED CANDIDATE EXECUTION",
                    }
                )
                for k, v in report.items():
                    if k == "sample_output":
                        print(f"{k}={v!r}")
                    else:
                        print(f"{k}={v}")

                if execution.status != "SUCCEEDED":
                    print(f"error_category={execution.error_category}")
                    print(f"error_detail={execution.error_detail}")
                    exit_code = 5
                elif execution.provider_call_count < 1:
                    print("FAIL: expected at least one provider call")
                    exit_code = 6
                else:
                    if execution.cost_source not in {
                        CostSource.PROVIDER_REPORTED.value,
                        CostSource.PRICING_SNAPSHOT_ESTIMATE.value,
                    }:
                        print(f"WARN: unexpected cost_source={execution.cost_source}")
                    exit_code = 0
        finally:
            engine.dispose()
            reset_providers_for_tests()
        return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
