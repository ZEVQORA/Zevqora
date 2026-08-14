import uuid

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db import Base
from app.db_models import Finding, Product, Trace
from app.evidence.diagnosis import diagnose_runtime_evidence


def test_runtime_duplicate_signal_is_observed_not_verified(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        product = Product(id=str(uuid.uuid4()), name="Demo", root_path=str(tmp_path))
        db.add(product)
        for i in range(3):
            db.add(
                Trace(
                    id=str(uuid.uuid4()),
                    product_id=product.id,
                    request_id=f"r-{i}",
                    symbol="classify_ticket",
                    input_text="same input",
                    cost_usd=0.01,
                )
            )
        db.commit()
        diagnose_runtime_evidence(db, product.id)
        row = db.scalar(select(Finding).where(Finding.origin == "runtime_evidence"))
        assert row is not None
        assert row.evidence_status == "observed"
        assert row.category == "repeated_execution"
