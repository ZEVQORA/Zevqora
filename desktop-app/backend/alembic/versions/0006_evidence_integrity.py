"""Evidence integrity: product archival plus import/evaluation idempotency.

Revision ID: 0006_evidence_integrity
Revises: 0005_benchmark_dogfood
Create Date: 2026-08-28

Three changes, all additive. No historical row is modified.

1. products.archived_at — lets a product carrying VERIFIED/REJECTED evaluations be
   detached from the workspace without deleting the evidence those runs were
   computed from. Disconnect previously cascaded straight through evaluation_runs.

2. unique(traces.product_id, traces.request_id) — trace import was non-idempotent,
   so a retried or double-clicked import duplicated every row. That doubled
   observed cost and let a five-sample file satisfy a ten-sample gate with five
   real observations.

3. unique(experiments.evaluation_run_id) — every evaluation inserted a fresh
   Experiment row, so re-evaluating one candidate execution double-counted its
   verified savings in the economics aggregate.

Duplicates are collapsed before each unique index is created, keeping the earliest
row of each group so the first observation is the one that survives.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006_evidence_integrity"
down_revision = "0005_benchmark_dogfood"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("products") as batch:
        batch.add_column(sa.Column("archived_at", sa.DateTime(), nullable=True))

    # Collapse pre-existing duplicates before enforcing uniqueness, oldest wins.
    op.execute(
        """
        DELETE FROM traces
        WHERE id NOT IN (
            SELECT MIN(id) FROM traces GROUP BY product_id, request_id
        )
        """
    )
    op.create_index(
        "traces_product_request_uidx",
        "traces",
        ["product_id", "request_id"],
        unique=True,
    )

    op.execute(
        """
        DELETE FROM experiments
        WHERE evaluation_run_id IS NOT NULL
          AND id NOT IN (
            SELECT MIN(id) FROM experiments
            WHERE evaluation_run_id IS NOT NULL
            GROUP BY evaluation_run_id
        )
        """
    )
    op.create_index(
        "experiments_evaluation_run_uidx",
        "experiments",
        ["evaluation_run_id"],
        unique=True,
        sqlite_where=sa.text("evaluation_run_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("experiments_evaluation_run_uidx", table_name="experiments")
    op.drop_index("traces_product_request_uidx", table_name="traces")
    with op.batch_alter_table("products") as batch:
        batch.drop_column("archived_at")
