from __future__ import annotations

import asyncio
import json
import uuid
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .agent.service import chat as agent_chat
from .config import settings
from .db import Base, SessionLocal, engine, get_db
from .db_models import AICall, Finding, Product, Trace
from .evidence.service import economics, import_traces
from .experiments.service import list_experiments, run_experiment
from .implementation.service import ImplementationError, list_implementations, prepare_implementation
from .schemas import (
    AICallOut,
    AgentChatRequest,
    AgentChatResponse,
    ConnectLocalRequest,
    EconomicsOut,
    ExperimentOut,
    ExperimentRunRequest,
    FindingOut,
    HealthResponse,
    ImplementationOut,
    ImplementationPrepareRequest,
    MonitoringRequest,
    ProductOut,
    ScanResult,
    TraceImportRequest,
    TraceImportResponse,
)
from .workspace.scanner import scan_product

VERSION = "0.1.0-premium-desktop"


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


async def monitor_loop() -> None:
    while True:
        await asyncio.sleep(max(10, settings.scan_interval_seconds))
        with SessionLocal() as db:
            products = list(db.scalars(select(Product).where(Product.monitoring_enabled.is_(True))))
            for product in products:
                try:
                    scan_product(db, product)
                except Exception:
                    # Monitoring is intentionally quiet. The UI still shows the last successful scan.
                    db.rollback()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    task = asyncio.create_task(monitor_loop())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(title="ZEVQORA Desktop Local API", version=VERSION, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173", "null"],
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
    allow_credentials=False,
)


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
    rows = list(db.scalars(select(AICall).where(AICall.product_id == product_id).order_by(AICall.file_path, AICall.line)))
    return [ai_call_out(x) for x in rows]


@app.get("/api/v1/products/{product_id}/findings", response_model=list[FindingOut])
def findings(product_id: str, db: Session = Depends(get_db)):
    rows = list(db.scalars(select(Finding).where(Finding.product_id == product_id).order_by(Finding.confidence.desc())))
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
async def implementation_prepare(product_id: str, request: ImplementationPrepareRequest, db: Session = Depends(get_db)):
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
