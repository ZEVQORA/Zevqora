import json
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


def test_import_preserves_the_prompt_so_a_replay_asks_the_same_question(tmp_path):
    """A candidate is only comparable if it is asked what the baseline was asked.

    Imported traces used to reach model substitution with `input_text` alone, so
    the replay dropped the instructions that produced the baseline answer and the
    candidate was graded down for answering a different, under-specified task.
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'prompt.db'}")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        product = Product(id=str(uuid.uuid4()), name="P", root_path=str(tmp_path))
        db.add(product)
        db.commit()
        import_traces(
            db,
            product.id,
            [
                TraceIn(
                    request_id="sys-1",
                    system_prompt="Answer with one word.",
                    input_text="Which queue?",
                    output_text="billing",
                    cost_usd=0.01,
                ),
                TraceIn(
                    request_id="msg-1",
                    messages=[
                        {"role": "system", "content": "Answer with one word."},
                        {"role": "user", "content": "Which queue?"},
                        {"role": "assistant", "content": "billing"},
                    ],
                    output_text="billing",
                    cost_usd=0.01,
                ),
                TraceIn(request_id="bare-1", input_text="Which queue?", output_text="billing", cost_usd=0.01),
            ],
        )
        rows = {r.request_id: r for r in db.scalars(select(Trace).where(Trace.product_id == product.id))}

        for key in ("sys-1", "msg-1"):
            snapshot = json.loads(rows[key].request_snapshot_json)
            assert [m["role"] for m in snapshot["messages"]] == ["system", "user"], key
            assert snapshot["messages"][0]["content"] == "Answer with one word."
            assert snapshot["messages"][1]["content"] == "Which queue?"
            assert rows[key].request_snapshot_hash

        # Nothing is invented for a trace that never recorded its prompt.
        assert rows["bare-1"].request_snapshot_json is None
