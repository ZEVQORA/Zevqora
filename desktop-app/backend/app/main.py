from __future__ import annotations

import asyncio
import json
import uuid
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .agent.service import chat as agent_chat
from .config import settings
from .core.api_auth import API_TOKEN_HEADER, resolve_api_token, token_matches, token_required
from .core.db_migrate import ensure_schema
from .core.errors import MigrationError
from .core.logging import configure_logging, get_logger
from .db import SessionLocal, configure_engine, get_db
from .db_models import AICall, Finding, Product, Trace
from .evals.models import EvaluationCaseSpec, GateConfig
from .evals.runner import create_and_run_evaluation, get_evaluation, list_evaluations
from .evidence.service import economics, import_traces
from .experiments.service import list_experiments, run_experiment
from .implementation.service import ImplementationError, list_implementations, prepare_implementation
from .optimization.bridge import project_execution_onto_traces
from .optimization.executor import execute_plan, get_execution, list_executions
from .optimization.planner import create_plans, get_plan, list_plans
from .providers.factory import aclose_providers, get_provider
from .schemas import (
    AgentChatRequest,
    AgentChatResponse,
    AICallOut,
    ConnectLocalRequest,
    EconomicsOut,
    EvaluationCreateRequest,
    EvaluationOut,
    ExperimentOut,
    ExperimentRunRequest,
    FindingOut,
    HealthResponse,
    ImplementationOut,
    ImplementationPrepareRequest,
    MonitoringRequest,
    OptimizationExecuteRequest,
    OptimizationExecutionOut,
    OptimizationPlanCreateRequest,
    OptimizationPlanOut,
    ProductOut,
    ScanResult,
    TraceImportRequest,
    TraceImportResponse,
)
from .workspace.scanner import scan_product

VERSION = "0.2.0-phase3"
logger = get_logger(__name__)


def product_out(product: Product) -> ProductOut:
    return ProductOut(
        id=product.id,
        name=product.name,
        root_path=product.root_path,
        monitoring_enabled=product.monitoring_enabled,
        created_at=product.created_at,
        last_scan_at=product.last_scan_at,
    )


def finding_out(row: Finding) -> FindingOut:
    return FindingOut(
        id=row.id,
        origin=row.origin,
        category=row.category,
        title=row.title,
        root_cause=row.root_cause,
        file_path=row.file_path,
        line=row.line,
        symbol=row.symbol,
        confidence=row.confidence,
        risk=row.risk,
        evidence_status=row.evidence_status,
    )


def ai_call_out(row: AICall) -> AICallOut:
    return AICallOut(
        id=row.id,
        file_path=row.file_path,
        line=row.line,
        provider=row.provider,
        symbol=row.symbol,
        excerpt=row.excerpt,
    )


def plan_out(plan) -> OptimizationPlanOut:
    return OptimizationPlanOut(
        id=plan.id,
        product_id=plan.product_id,
        finding_id=plan.finding_id,
        strategy=plan.strategy,
        status=plan.status,
        reason=plan.reason,
        expected_mechanism=plan.expected_mechanism,
        risk=plan.risk,
        fallback=plan.fallback,
        max_budget_usd=plan.max_budget_usd,
        sample_scope=json.loads(plan.sample_scope_json or "[]"),
        baseline_config=json.loads(plan.baseline_config_json or "{}"),
        candidate_config=json.loads(plan.candidate_config_json or "{}"),
        required_evidence=json.loads(plan.required_evidence_json or "[]"),
        plan_version=plan.plan_version,
        config_hash=plan.config_hash,
        blocked_reason=plan.blocked_reason,
        created_at=plan.created_at,
    )


def execution_out(row) -> OptimizationExecutionOut:
    return OptimizationExecutionOut(
        id=row.id,
        candidate_plan_id=row.candidate_plan_id,
        product_id=row.product_id,
        status=row.status,
        execution_key=row.execution_key,
        attempt=row.attempt,
        parent_execution_id=row.parent_execution_id,
        provider=row.provider,
        requested_model=row.requested_model,
        resolved_model=row.resolved_model,
        started_at=row.started_at,
        completed_at=row.completed_at,
        baseline_trace_ids=json.loads(row.baseline_trace_ids_json or "[]"),
        sample_results=json.loads(row.sample_results_json or "[]"),
        input_tokens=row.input_tokens,
        output_tokens=row.output_tokens,
        cached_input_tokens=row.cached_input_tokens,
        cost_usd=row.cost_usd,
        cost_source=row.cost_source,
        pricing_version=row.pricing_version,
        latency_ms=row.latency_ms,
        provider_request_id=row.provider_request_id,
        provider_call_count=row.provider_call_count,
        candidate_cost_delta_usd=row.candidate_cost_delta_usd,
        error_category=row.error_category,
        error_detail=row.error_detail,
        fallback_used=row.fallback_used,
        provenance_hash=row.provenance_hash,
        created_at=row.created_at,
    )


def evaluation_out(row) -> EvaluationOut:
    return EvaluationOut(
        id=row.id,
        product_id=row.product_id,
        candidate_plan_id=row.candidate_plan_id,
        candidate_execution_id=row.candidate_execution_id,
        finding_id=row.finding_id,
        status=row.status,
        evaluation_version=row.evaluation_version,
        sample_count=row.sample_count,
        protected_sample_count=row.protected_sample_count,
        baseline_quality=row.baseline_quality,
        candidate_quality=row.candidate_quality,
        quality_delta=row.quality_delta,
        baseline_cost_usd=row.baseline_cost_usd,
        candidate_cost_usd=row.candidate_cost_usd,
        raw_cost_delta_usd=row.raw_cost_delta_usd,
        raw_cost_delta_percent=row.raw_cost_delta_percent,
        baseline_latency_ms=row.baseline_latency_ms,
        candidate_latency_ms=row.candidate_latency_ms,
        evidence_completeness=row.evidence_completeness,
        verification_source=row.verification_source,
        execution_proven=row.execution_proven,
        evidence_version=row.evidence_version,
        gates=json.loads(row.gates_json or "[]"),
        rejection_reason=row.rejection_reason,
        grader_config_hash=row.grader_config_hash,
        gate_config_hash=row.gate_config_hash,
        created_at=row.created_at,
        completed_at=row.completed_at,
    )


async def monitor_loop() -> None:
    while True:
        await asyncio.sleep(max(10, settings.scan_interval_seconds))
        with SessionLocal() as db:
            products = list(db.scalars(select(Product).where(Product.monitoring_enabled.is_(True))))
            for product in products:
                try:
                    scan_product(db, product)
                except Exception:
                    db.rollback()


def create_app(
    *,
    database_url: str | None = None,
    run_migrations: bool = True,
    start_monitor: bool = True,
) -> FastAPI:
    """Application factory for production and tests."""
    configure_logging()
    url = database_url or settings.database_url
    if database_url is not None:
        configure_engine(database_url)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if run_migrations:
            try:
                result = ensure_schema(url)
                logger.info(
                    "schema.ready",
                    extra={"request_id": result.action, "model": result.revision},
                )
            except MigrationError as exc:
                logger.error("schema.migration_failed", extra={"request_id": str(exc)})
                raise
        task = None
        if start_monitor:
            task = asyncio.create_task(monitor_loop())
        try:
            yield
        finally:
            if task is not None:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
            await aclose_providers()

    application = FastAPI(title="ZEVQORA Desktop Local API", version=VERSION, lifespan=lifespan)

    # The packaged renderer loads from file://, so it sends `Origin: null` and
    # "null" must stay in the CORS allowlist. Any web page can also obtain a null
    # origin, so CORS cannot be the only control — the shared token below is what
    # actually separates the renderer from a drive-by page.
    application.state.api_token = resolve_api_token()
    enforce_token = token_required()
    if not enforce_token:
        logger.warning("api_auth.disabled", extra={"request_id": "ZEVQORA_API_REQUIRE_TOKEN=0"})

    # Registered BEFORE CORSMiddleware so that CORS ends up the outer layer and
    # still decorates 401 responses; Starlette applies the last-added middleware
    # outermost.
    @application.middleware("http")
    async def _require_api_token(request, call_next):
        # Path-based rather than per-route so a newly added /api/v1 route cannot
        # silently ship without auth.
        if enforce_token and request.method != "OPTIONS" and request.url.path.startswith("/api/v1"):
            supplied = request.headers.get(API_TOKEN_HEADER)
            if not token_matches(supplied, request.app.state.api_token):
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Missing or invalid local API token."},
                )
        return await call_next(request)

    # Defence in depth against DNS rebinding: without this, a hostname the
    # attacker controls that resolves to 127.0.0.1 makes their page same-origin
    # and CORS never applies.
    application.add_middleware(TrustedHostMiddleware, allowed_hosts=list(settings.api_allowed_hosts))
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173", "null"],
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-Zevqora-Token"],
        allow_credentials=False,
    )
    _register_routes(application)
    return application


def _register_routes(app: FastAPI) -> None:
    @app.get("/api/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(status="ok", version=VERSION, openrouter_configured=bool(settings.openrouter_api_key))

    @app.get("/api/v1/products", response_model=list[ProductOut])
    def list_products(db: Session = Depends(get_db)):
        rows = list(db.scalars(select(Product).order_by(Product.created_at.desc())))
        return [product_out(row) for row in rows]

    @app.post("/api/v1/products/connect-local", response_model=ScanResult)
    def connect_local(request: ConnectLocalRequest, db: Session = Depends(get_db)):
        root = Path(request.path).expanduser().resolve()
        if not root.exists() or not root.is_dir():
            raise HTTPException(status_code=422, detail="The selected folder does not exist or is not a directory.")
        existing = db.scalar(select(Product).where(Product.root_path == str(root)))
        product = existing or Product(
            id=str(uuid.uuid4()),
            name=request.name or root.name or "AI product",
            root_path=str(root),
            monitoring_enabled=False,
        )
        db.add(product)
        db.commit()
        db.refresh(product)
        try:
            stats, calls, findings, stack = scan_product(db, product)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return ScanResult(
            product=product_out(product),
            files_scanned=stats.files_scanned,
            ai_calls=[ai_call_out(x) for x in calls],
            findings=[finding_out(x) for x in findings],
            detected_stack=stack,
            skipped_sensitive_paths=stats.skipped_sensitive_paths,
        )

    @app.get("/api/v1/products/{product_id}", response_model=ProductOut)
    def get_product(product_id: str, db: Session = Depends(get_db)):
        product = db.scalar(select(Product).where(Product.id == product_id))
        if not product:
            raise HTTPException(status_code=404, detail="Product not found.")
        return product_out(product)

    @app.delete("/api/v1/products/{product_id}")
    def disconnect_product(product_id: str, db: Session = Depends(get_db)):
        product = db.scalar(select(Product).where(Product.id == product_id))
        if not product:
            raise HTTPException(status_code=404, detail="Product not found.")
        db.delete(product)
        db.commit()
        return {"status": "disconnected"}

    @app.post("/api/v1/products/{product_id}/monitoring", response_model=ProductOut)
    def set_monitoring(product_id: str, request: MonitoringRequest, db: Session = Depends(get_db)):
        product = db.scalar(select(Product).where(Product.id == product_id))
        if not product:
            raise HTTPException(status_code=404, detail="Product not found.")
        product.monitoring_enabled = request.enabled
        db.add(product)
        db.commit()
        db.refresh(product)
        return product_out(product)

    @app.post("/api/v1/products/{product_id}/scan", response_model=ScanResult)
    def scan(product_id: str, db: Session = Depends(get_db)):
        product = db.scalar(select(Product).where(Product.id == product_id))
        if not product:
            raise HTTPException(status_code=404, detail="Product not found.")
        try:
            stats, calls, findings, stack = scan_product(db, product)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return ScanResult(
            product=product_out(product),
            files_scanned=stats.files_scanned,
            ai_calls=[ai_call_out(x) for x in calls],
            findings=[finding_out(x) for x in findings],
            detected_stack=stack,
            skipped_sensitive_paths=stats.skipped_sensitive_paths,
        )

    @app.get("/api/v1/products/{product_id}/ai-calls", response_model=list[AICallOut])
    def ai_calls(product_id: str, db: Session = Depends(get_db)):
        rows = list(
            db.scalars(select(AICall).where(AICall.product_id == product_id).order_by(AICall.file_path, AICall.line))
        )
        return [ai_call_out(x) for x in rows]

    @app.get("/api/v1/products/{product_id}/findings", response_model=list[FindingOut])
    def findings(product_id: str, db: Session = Depends(get_db)):
        rows = list(
            db.scalars(select(Finding).where(Finding.product_id == product_id).order_by(Finding.confidence.desc()))
        )
        return [finding_out(x) for x in rows]

    @app.post("/api/v1/products/{product_id}/traces/import", response_model=TraceImportResponse)
    def traces_import(product_id: str, request: TraceImportRequest, db: Session = Depends(get_db)):
        product = db.scalar(select(Product).where(Product.id == product_id))
        if not product:
            raise HTTPException(status_code=404, detail="Product not found.")
        parsed = list(request.traces)
        errors: list[str] = []
        if request.jsonl:
            from .schemas import TraceIn

            for index, line in enumerate(request.jsonl.splitlines(), start=1):
                if not line.strip():
                    continue
                try:
                    payload = json.loads(line)
                    parsed.append(TraceIn.model_validate(payload))
                except Exception as exc:
                    errors.append(f"line {index}: {exc}")
        imported = import_traces(db, product_id, parsed)
        return TraceImportResponse(imported=imported, rejected=len(errors), errors=errors[:50])

    @app.delete("/api/v1/products/{product_id}/traces")
    def clear_traces(product_id: str, db: Session = Depends(get_db)):
        db.execute(delete(Trace).where(Trace.product_id == product_id))
        db.commit()
        return {"status": "cleared"}

    @app.get("/api/v1/products/{product_id}/economics", response_model=EconomicsOut)
    def product_economics(product_id: str, db: Session = Depends(get_db)):
        product = db.scalar(select(Product).where(Product.id == product_id))
        if not product:
            raise HTTPException(status_code=404, detail="Product not found.")
        return economics(db, product_id)

    @app.post("/api/v1/products/{product_id}/experiments/run", response_model=ExperimentOut)
    def experiment_run(product_id: str, request: ExperimentRunRequest, db: Session = Depends(get_db)):
        product = db.scalar(select(Product).where(Product.id == product_id))
        if not product:
            raise HTTPException(status_code=404, detail="Product not found.")
        try:
            return run_experiment(db, product_id, request)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.get("/api/v1/products/{product_id}/experiments", response_model=list[ExperimentOut])
    def experiments(product_id: str, db: Session = Depends(get_db)):
        return list_experiments(db, product_id)

    @app.get("/api/v1/products/{product_id}/implementations", response_model=list[ImplementationOut])
    def implementations(product_id: str, db: Session = Depends(get_db)):
        product = db.scalar(select(Product).where(Product.id == product_id))
        if not product:
            raise HTTPException(status_code=404, detail="Product not found.")
        return list_implementations(db, product_id)

    @app.post("/api/v1/products/{product_id}/implementations/prepare", response_model=ImplementationOut)
    async def implementation_prepare(
        product_id: str, request: ImplementationPrepareRequest, db: Session = Depends(get_db)
    ):
        try:
            return await prepare_implementation(db, product_id, request)
        except ImplementationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.post("/api/v1/agent/chat", response_model=AgentChatResponse)
    async def agent_endpoint(request: AgentChatRequest, db: Session = Depends(get_db)):
        if not request.messages:
            raise HTTPException(status_code=422, detail="At least one chat message is required.")
        try:
            return await agent_chat(
                db,
                product_id=request.product_id,
                history=[m.model_dump() for m in request.messages],
                model=request.model,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    @app.post("/api/v1/products/{product_id}/optimization/plans", response_model=list[OptimizationPlanOut])
    def optimization_create_plans(
        product_id: str,
        request: OptimizationPlanCreateRequest,
        db: Session = Depends(get_db),
    ):
        product = db.scalar(select(Product).where(Product.id == product_id))
        if not product:
            raise HTTPException(status_code=404, detail="Product not found.")
        try:
            plans = create_plans(
                db,
                product_id,
                finding_id=request.finding_id,
                strategy=request.strategy,
                candidate_model=request.candidate_model,
                max_budget_usd=request.max_budget_usd,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return [plan_out(p) for p in plans]

    @app.get("/api/v1/products/{product_id}/optimization/plans", response_model=list[OptimizationPlanOut])
    def optimization_list_plans(product_id: str, db: Session = Depends(get_db)):
        return [plan_out(p) for p in list_plans(db, product_id)]

    @app.get(
        "/api/v1/products/{product_id}/optimization/plans/{plan_id}",
        response_model=OptimizationPlanOut,
    )
    def optimization_get_plan(product_id: str, plan_id: str, db: Session = Depends(get_db)):
        plan = get_plan(db, product_id, plan_id)
        if not plan:
            raise HTTPException(status_code=404, detail="Candidate plan not found.")
        return plan_out(plan)

    @app.post(
        "/api/v1/products/{product_id}/optimization/plans/{plan_id}/execute",
        response_model=OptimizationExecutionOut,
    )
    async def optimization_execute_plan(
        product_id: str,
        plan_id: str,
        request: OptimizationExecuteRequest,
        db: Session = Depends(get_db),
    ):
        product = db.scalar(select(Product).where(Product.id == product_id))
        if not product:
            raise HTTPException(status_code=404, detail="Product not found.")
        try:
            # Tests / offline: MockProvider. Never invent agent model IDs for spend.
            provider = get_provider()
            execution = await execute_plan(
                db,
                product_id,
                plan_id,
                provider=provider,
                force_rerun=request.force_rerun,
            )
            if request.project_to_legacy_traces and execution.status == "SUCCEEDED":
                project_execution_onto_traces(db, execution, overwrite=True)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return execution_out(execution)

    @app.get(
        "/api/v1/products/{product_id}/optimization/executions",
        response_model=list[OptimizationExecutionOut],
    )
    def optimization_list_executions(product_id: str, db: Session = Depends(get_db)):
        return [execution_out(e) for e in list_executions(db, product_id)]

    @app.get(
        "/api/v1/products/{product_id}/optimization/executions/{execution_id}",
        response_model=OptimizationExecutionOut,
    )
    def optimization_get_execution(product_id: str, execution_id: str, db: Session = Depends(get_db)):
        row = get_execution(db, product_id, execution_id)
        if not row:
            raise HTTPException(status_code=404, detail="Candidate execution not found.")
        return execution_out(row)

    @app.post("/api/v1/products/{product_id}/evaluations", response_model=EvaluationOut)
    def evaluations_create(product_id: str, request: EvaluationCreateRequest, db: Session = Depends(get_db)):
        product = db.scalar(select(Product).where(Product.id == product_id))
        if not product:
            raise HTTPException(status_code=404, detail="Product not found.")
        try:
            cases = None
            if request.cases:
                cases = [EvaluationCaseSpec.model_validate(c) for c in request.cases]
            gate_cfg = GateConfig.model_validate(request.gate_config or {})
            run = create_and_run_evaluation(
                db,
                product_id,
                candidate_execution_id=request.candidate_execution_id,
                finding_id=request.finding_id,
                cases=cases,
                gate_config=gate_cfg,
                project_experiment=request.project_experiment,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return evaluation_out(run)

    @app.get("/api/v1/products/{product_id}/evaluations", response_model=list[EvaluationOut])
    def evaluations_list(product_id: str, db: Session = Depends(get_db)):
        return [evaluation_out(r) for r in list_evaluations(db, product_id)]

    @app.get("/api/v1/products/{product_id}/evaluations/{evaluation_id}", response_model=EvaluationOut)
    def evaluations_get(product_id: str, evaluation_id: str, db: Session = Depends(get_db)):
        row = get_evaluation(db, product_id, evaluation_id)
        if not row:
            raise HTTPException(status_code=404, detail="Evaluation not found.")
        return evaluation_out(row)


app = create_app()
