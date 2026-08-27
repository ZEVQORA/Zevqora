"""Add Phase 1 trace telemetry / cost provenance fields.

Revision ID: 0002_trace_telemetry_v1
Revises: 0001_desktop_agent_initial
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002_trace_telemetry_v1"
down_revision: Union[str, None] = "0001_desktop_agent_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("traces") as batch:
        batch.add_column(sa.Column("requested_model", sa.String(length=160), nullable=True))
        batch.add_column(sa.Column("response_model", sa.String(length=160), nullable=True))
        batch.add_column(sa.Column("provider_request_id", sa.String(length=200), nullable=True))
        batch.add_column(sa.Column("cached_input_tokens", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("reasoning_tokens", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("ttft_ms", sa.Float(), nullable=True))
        batch.add_column(sa.Column("cost_source", sa.String(length=40), nullable=True))
        batch.add_column(sa.Column("pricing_version", sa.String(length=80), nullable=True))
        batch.add_column(sa.Column("attempt", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("retry_reason", sa.String(length=200), nullable=True))
        batch.add_column(sa.Column("input_hash", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("output_hash", sa.String(length=64), nullable=True))

    op.create_index("ix_traces_request_id", "traces", ["request_id"], unique=False)
    op.create_index("ix_traces_workflow", "traces", ["workflow"], unique=False)
    op.create_index("ix_traces_provider", "traces", ["provider"], unique=False)
    op.create_index("ix_traces_model", "traces", ["model"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_traces_model", table_name="traces")
    op.drop_index("ix_traces_provider", table_name="traces")
    op.drop_index("ix_traces_workflow", table_name="traces")
    op.drop_index("ix_traces_request_id", table_name="traces")

    with op.batch_alter_table("traces") as batch:
        batch.drop_column("output_hash")
        batch.drop_column("input_hash")
        batch.drop_column("retry_reason")
        batch.drop_column("attempt")
        batch.drop_column("pricing_version")
        batch.drop_column("cost_source")
        batch.drop_column("ttft_ms")
        batch.drop_column("reasoning_tokens")
        batch.drop_column("cached_input_tokens")
        batch.drop_column("provider_request_id")
        batch.drop_column("response_model")
        batch.drop_column("requested_model")
