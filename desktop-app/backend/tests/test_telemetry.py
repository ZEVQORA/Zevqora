import uuid

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db import Base
from app.db_models import Product, Trace
from app.evidence.service import import_traces
from app.providers.models import CostSource
from app.schemas import TraceIn
from app.telemetry.normalizer import normalize_imported_trace


def test_import_preserves_text_and_sets_imported_external(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 't.db'}")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        product = Product(id=str(uuid.uuid4()), name="P", root_path=str(tmp_path))
        db.add(product)
        db.commit()
        imported = import_traces(
            db,
            product.id,
            [
                TraceIn(
                    request_id="req-1",
                    model="openai/gpt-4o-mini",
                    input_text="keep me",
                    output_text="also keep",
                    cost_usd=0.01,
                )
            ],
        )
        assert imported == 1
        row = db.scalar(select(Trace).where(Trace.product_id == product.id))
        assert row is not None
        assert row.input_text == "keep me"
        assert row.output_text == "also keep"
        assert row.cost_source == CostSource.IMPORTED_EXTERNAL.value
        assert row.input_hash is not None
        assert row.requested_model == "openai/gpt-4o-mini"


def test_normalize_respects_explicit_cost_source():
    trace = TraceIn(
        request_id="r1",
        cost_usd=0.5,
        metadata={"cost_source": "provider_reported", "pricing_version": "snap_x"},
    )
    normalized = normalize_imported_trace(trace)
    assert normalized["fields"].cost_source == "provider_reported"
    assert normalized["fields"].pricing_version == "snap_x"


def test_normalize_without_cost_has_no_source():
    trace = TraceIn(request_id="r2", input_text="x")
    normalized = normalize_imported_trace(trace)
    assert normalized["fields"].cost_source is None
    assert normalized["input_text"] == "x"
