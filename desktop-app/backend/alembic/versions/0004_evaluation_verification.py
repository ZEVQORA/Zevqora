"""Add EvaluationRun / EvaluationCaseResult and Experiment provenance fields.

Revision ID: 0004_evaluation_verification
Revises: 0003_candidate_execution
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0004_evaluation_verification"
down_revision: Union[str, None] = "0003_candidate_execution"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "evaluation_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("product_id", sa.String(length=36), nullable=False),
        sa.Column("candidate_plan_id", sa.String(length=36), nullable=True),
        sa.Column("candidate_execution_id", sa.String(length=36), nullable=False),
        sa.Column("finding_id", sa.String(length=36), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("evaluation_version", sa.String(length=40), nullable=False),
        sa.Column("gate_system_version", sa.String(length=40), nullable=False),
        sa.Column("grader_config_json", sa.Text(), nullable=False),
        sa.Column("grader_config_hash", sa.String(length=64), nullable=False),
        sa.Column("gate_config_json", sa.Text(), nullable=False),
        sa.Column("gate_config_hash", sa.String(length=64), nullable=False),
        sa.Column("baseline_evidence_hash", sa.String(length=64), nullable=False),
        sa.Column("candidate_execution_provenance_hash", sa.String(length=64), nullable=False),
        sa.Column("sample_count", sa.Integer(), nullable=False),
        sa.Column("protected_sample_count", sa.Integer(), nullable=False),
        sa.Column("baseline_quality", sa.Float(), nullable=True),
        sa.Column("candidate_quality", sa.Float(), nullable=True),
        sa.Column("quality_delta", sa.Float(), nullable=True),
        sa.Column("baseline_cost_usd", sa.Float(), nullable=True),
        sa.Column("candidate_cost_usd", sa.Float(), nullable=True),
        sa.Column("raw_cost_delta_usd", sa.Float(), nullable=True),
        sa.Column("raw_cost_delta_percent", sa.Float(), nullable=True),
        sa.Column("baseline_latency_ms", sa.Float(), nullable=True),
        sa.Column("candidate_latency_ms", sa.Float(), nullable=True),
        sa.Column("evidence_completeness", sa.Boolean(), nullable=False),
        sa.Column("verification_source", sa.String(length=40), nullable=False),
        sa.Column("execution_proven", sa.Boolean(), nullable=False),
        sa.Column("evidence_version", sa.String(length=64), nullable=False),
        sa.Column("gates_json", sa.Text(), nullable=False),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_evaluation_runs_product_id", "evaluation_runs", ["product_id"])
    op.create_index("ix_evaluation_runs_candidate_execution_id", "evaluation_runs", ["candidate_execution_id"])
    op.create_index("ix_evaluation_runs_status", "evaluation_runs", ["status"])
    op.create_index("ix_evaluation_runs_finding_id", "evaluation_runs", ["finding_id"])
    op.create_index("ix_evaluation_runs_candidate_plan_id", "evaluation_runs", ["candidate_plan_id"])

    op.create_table(
        "evaluation_case_results",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("evaluation_run_id", sa.String(length=36), nullable=False),
        sa.Column("case_id", sa.String(length=120), nullable=False),
        sa.Column("baseline_trace_id", sa.String(length=36), nullable=False),
        sa.Column("candidate_execution_id", sa.String(length=36), nullable=False),
        sa.Column("task_fingerprint", sa.String(length=64), nullable=True),
        sa.Column("protected", sa.Boolean(), nullable=False),
        sa.Column("grader_specs_json", sa.Text(), nullable=False),
        sa.Column("expected_hash", sa.String(length=64), nullable=True),
        sa.Column("baseline_output_hash", sa.String(length=64), nullable=True),
        sa.Column("candidate_output_hash", sa.String(length=64), nullable=True),
        sa.Column("baseline_score", sa.Float(), nullable=True),
        sa.Column("candidate_score", sa.Float(), nullable=True),
        sa.Column("baseline_grader_json", sa.Text(), nullable=False),
        sa.Column("candidate_grader_json", sa.Text(), nullable=False),
        sa.Column("baseline_cost_usd", sa.Float(), nullable=True),
        sa.Column("candidate_cost_usd", sa.Float(), nullable=True),
        sa.Column("baseline_cost_source", sa.String(length=40), nullable=True),
        sa.Column("candidate_cost_source", sa.String(length=40), nullable=True),
        sa.Column("baseline_latency_ms", sa.Float(), nullable=True),
        sa.Column("candidate_latency_ms", sa.Float(), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("case_provenance_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["evaluation_run_id"], ["evaluation_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_evaluation_case_results_evaluation_run_id", "evaluation_case_results", ["evaluation_run_id"])
    op.create_index("ix_evaluation_case_results_baseline_trace_id", "evaluation_case_results", ["baseline_trace_id"])
    op.create_index(
        "ix_evaluation_case_results_candidate_execution_id", "evaluation_case_results", ["candidate_execution_id"]
    )

    with op.batch_alter_table("experiments") as batch:
        batch.add_column(
            sa.Column(
                "verification_source", sa.String(length=40), nullable=False, server_default="LEGACY_CANDIDATE_EVIDENCE"
            )
        )
        batch.add_column(sa.Column("execution_proven", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("evaluation_run_id", sa.String(length=36), nullable=True))
        batch.add_column(sa.Column("candidate_execution_id", sa.String(length=36), nullable=True))
    op.create_index("ix_experiments_evaluation_run_id", "experiments", ["evaluation_run_id"])
    op.create_index("ix_experiments_candidate_execution_id", "experiments", ["candidate_execution_id"])


def downgrade() -> None:
    op.drop_index("ix_experiments_candidate_execution_id", table_name="experiments")
    op.drop_index("ix_experiments_evaluation_run_id", table_name="experiments")
    with op.batch_alter_table("experiments") as batch:
        batch.drop_column("candidate_execution_id")
        batch.drop_column("evaluation_run_id")
        batch.drop_column("execution_proven")
        batch.drop_column("verification_source")
    op.drop_index("ix_evaluation_case_results_candidate_execution_id", table_name="evaluation_case_results")
    op.drop_index("ix_evaluation_case_results_baseline_trace_id", table_name="evaluation_case_results")
    op.drop_index("ix_evaluation_case_results_evaluation_run_id", table_name="evaluation_case_results")
    op.drop_table("evaluation_case_results")
    op.drop_index("ix_evaluation_runs_candidate_plan_id", table_name="evaluation_runs")
    op.drop_index("ix_evaluation_runs_finding_id", table_name="evaluation_runs")
    op.drop_index("ix_evaluation_runs_status", table_name="evaluation_runs")
    op.drop_index("ix_evaluation_runs_candidate_execution_id", table_name="evaluation_runs")
    op.drop_index("ix_evaluation_runs_product_id", table_name="evaluation_runs")
    op.drop_table("evaluation_runs")
