"""Initial ZEVQORA Desktop + Zev Agent schema.

Revision ID: 0001_desktop_agent_initial
Revises: None
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0001_desktop_agent_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "products",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("root_path", sa.Text(), nullable=False),
        sa.Column("monitoring_enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_scan_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("root_path"),
    )
    op.create_table(
        "ai_calls",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("product_id", sa.String(length=36), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("line", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(length=80), nullable=False),
        sa.Column("symbol", sa.String(length=300), nullable=True),
        sa.Column("excerpt", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_ai_calls_product_id"), "ai_calls", ["product_id"], unique=False)
    op.create_table(
        "findings",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("product_id", sa.String(length=36), nullable=False),
        sa.Column("origin", sa.String(length=40), nullable=False),
        sa.Column("category", sa.String(length=120), nullable=False),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("root_cause", sa.Text(), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("line", sa.Integer(), nullable=False),
        sa.Column("symbol", sa.String(length=300), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("risk", sa.String(length=40), nullable=False),
        sa.Column("evidence_status", sa.String(length=40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_findings_product_id"), "findings", ["product_id"], unique=False)
    op.create_table(
        "traces",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("product_id", sa.String(length=36), nullable=False),
        sa.Column("request_id", sa.String(length=200), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=True),
        sa.Column("symbol", sa.String(length=300), nullable=True),
        sa.Column("workflow", sa.String(length=300), nullable=True),
        sa.Column("provider", sa.String(length=80), nullable=True),
        sa.Column("model", sa.String(length=160), nullable=True),
        sa.Column("input_text", sa.Text(), nullable=True),
        sa.Column("output_text", sa.Text(), nullable=True),
        sa.Column("expected_output", sa.Text(), nullable=True),
        sa.Column("candidate_output", sa.Text(), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("latency_ms", sa.Float(), nullable=True),
        sa.Column("candidate_latency_ms", sa.Float(), nullable=True),
        sa.Column("cost_usd", sa.Float(), nullable=True),
        sa.Column("candidate_cost_usd", sa.Float(), nullable=True),
        sa.Column("protected", sa.Boolean(), nullable=False),
        sa.Column("metadata_json", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_traces_product_id"), "traces", ["product_id"], unique=False)
    op.create_index(op.f("ix_traces_symbol"), "traces", ["symbol"], unique=False)
    op.create_table(
        "experiments",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("product_id", sa.String(length=36), nullable=False),
        sa.Column("finding_id", sa.String(length=36), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("sample_size", sa.Integer(), nullable=False),
        sa.Column("baseline_cost_usd", sa.Float(), nullable=True),
        sa.Column("candidate_cost_usd", sa.Float(), nullable=True),
        sa.Column("verified_savings_usd", sa.Float(), nullable=True),
        sa.Column("baseline_quality", sa.Float(), nullable=True),
        sa.Column("candidate_quality", sa.Float(), nullable=True),
        sa.Column("baseline_latency_ms", sa.Float(), nullable=True),
        sa.Column("candidate_latency_ms", sa.Float(), nullable=True),
        sa.Column("gates_json", sa.Text(), nullable=False),
        sa.Column("evidence_version", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_experiments_finding_id"), "experiments", ["finding_id"], unique=False)
    op.create_index(op.f("ix_experiments_product_id"), "experiments", ["product_id"], unique=False)
    op.create_table(
        "implementations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("product_id", sa.String(length=36), nullable=False),
        sa.Column("experiment_id", sa.String(length=36), nullable=False),
        sa.Column("finding_id", sa.String(length=36), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("branch_name", sa.String(length=240), nullable=False),
        sa.Column("worktree_path", sa.Text(), nullable=False),
        sa.Column("target_file", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("diff_text", sa.Text(), nullable=False),
        sa.Column("test_command", sa.Text(), nullable=True),
        sa.Column("test_exit_code", sa.Integer(), nullable=True),
        sa.Column("test_output", sa.Text(), nullable=True),
        sa.Column("model", sa.String(length=240), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_implementations_experiment_id"), "implementations", ["experiment_id"], unique=False)
    op.create_index(op.f("ix_implementations_finding_id"), "implementations", ["finding_id"], unique=False)
    op.create_index(op.f("ix_implementations_product_id"), "implementations", ["product_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_implementations_product_id"), table_name="implementations")
    op.drop_index(op.f("ix_implementations_finding_id"), table_name="implementations")
    op.drop_index(op.f("ix_implementations_experiment_id"), table_name="implementations")
    op.drop_table("implementations")
    op.drop_index(op.f("ix_experiments_product_id"), table_name="experiments")
    op.drop_index(op.f("ix_experiments_finding_id"), table_name="experiments")
    op.drop_table("experiments")
    op.drop_index(op.f("ix_traces_symbol"), table_name="traces")
    op.drop_index(op.f("ix_traces_product_id"), table_name="traces")
    op.drop_table("traces")
    op.drop_index(op.f("ix_findings_product_id"), table_name="findings")
    op.drop_table("findings")
    op.drop_index(op.f("ix_ai_calls_product_id"), table_name="ai_calls")
    op.drop_table("ai_calls")
    op.drop_table("products")
