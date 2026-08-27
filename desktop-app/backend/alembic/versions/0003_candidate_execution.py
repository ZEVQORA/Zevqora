"""Add CandidatePlan and CandidateExecution tables (Phase 2).

Revision ID: 0003_candidate_execution
Revises: 0002_trace_telemetry_v1
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0003_candidate_execution"
down_revision: Union[str, None] = "0002_trace_telemetry_v1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "candidate_plans",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("product_id", sa.String(length=36), nullable=False),
        sa.Column("finding_id", sa.String(length=36), nullable=True),
        sa.Column("strategy", sa.String(length=80), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("baseline_config_json", sa.Text(), nullable=False),
        sa.Column("candidate_config_json", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("expected_mechanism", sa.Text(), nullable=False),
        sa.Column("risk", sa.String(length=40), nullable=False),
        sa.Column("fallback", sa.Text(), nullable=False),
        sa.Column("required_evidence_json", sa.Text(), nullable=False),
        sa.Column("max_budget_usd", sa.Float(), nullable=False),
        sa.Column("sample_scope_json", sa.Text(), nullable=False),
        sa.Column("plan_version", sa.String(length=40), nullable=False),
        sa.Column("config_hash", sa.String(length=64), nullable=False),
        sa.Column("blocked_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_candidate_plans_product_id", "candidate_plans", ["product_id"])
    op.create_index("ix_candidate_plans_finding_id", "candidate_plans", ["finding_id"])
    op.create_index("ix_candidate_plans_strategy", "candidate_plans", ["strategy"])
    op.create_index("ix_candidate_plans_status", "candidate_plans", ["status"])
    op.create_index("ix_candidate_plans_config_hash", "candidate_plans", ["config_hash"])

    op.create_table(
        "candidate_executions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("candidate_plan_id", sa.String(length=36), nullable=False),
        sa.Column("product_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("execution_key", sa.String(length=64), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("parent_execution_id", sa.String(length=36), nullable=True),
        sa.Column("provider", sa.String(length=80), nullable=True),
        sa.Column("requested_model", sa.String(length=160), nullable=True),
        sa.Column("resolved_model", sa.String(length=160), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("baseline_trace_ids_json", sa.Text(), nullable=False),
        sa.Column("sample_results_json", sa.Text(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("cached_input_tokens", sa.Integer(), nullable=True),
        sa.Column("cost_usd", sa.Float(), nullable=True),
        sa.Column("cost_source", sa.String(length=40), nullable=True),
        sa.Column("pricing_version", sa.String(length=80), nullable=True),
        sa.Column("latency_ms", sa.Float(), nullable=True),
        sa.Column("provider_request_id", sa.String(length=200), nullable=True),
        sa.Column("provider_call_count", sa.Integer(), nullable=False),
        sa.Column("candidate_cost_delta_usd", sa.Float(), nullable=True),
        sa.Column("error_category", sa.String(length=80), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("fallback_used", sa.Boolean(), nullable=False),
        sa.Column("provenance_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["candidate_plan_id"], ["candidate_plans.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_candidate_executions_candidate_plan_id", "candidate_executions", ["candidate_plan_id"])
    op.create_index("ix_candidate_executions_product_id", "candidate_executions", ["product_id"])
    op.create_index("ix_candidate_executions_status", "candidate_executions", ["status"])
    op.create_index("ix_candidate_executions_execution_key", "candidate_executions", ["execution_key"])


def downgrade() -> None:
    op.drop_index("ix_candidate_executions_execution_key", table_name="candidate_executions")
    op.drop_index("ix_candidate_executions_status", table_name="candidate_executions")
    op.drop_index("ix_candidate_executions_product_id", table_name="candidate_executions")
    op.drop_index("ix_candidate_executions_candidate_plan_id", table_name="candidate_executions")
    op.drop_table("candidate_executions")
    op.drop_index("ix_candidate_plans_config_hash", table_name="candidate_plans")
    op.drop_index("ix_candidate_plans_status", table_name="candidate_plans")
    op.drop_index("ix_candidate_plans_strategy", table_name="candidate_plans")
    op.drop_index("ix_candidate_plans_finding_id", table_name="candidate_plans")
    op.drop_index("ix_candidate_plans_product_id", table_name="candidate_plans")
    op.drop_table("candidate_plans")
