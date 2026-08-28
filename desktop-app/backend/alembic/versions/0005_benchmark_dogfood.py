"""Add replay snapshots and benchmark run entities (Phase 4).

Revision ID: 0005_benchmark_dogfood
Revises: 0004_evaluation_verification
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005_benchmark_dogfood"
down_revision: Union[str, None] = "0004_evaluation_verification"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("traces", sa.Column("request_snapshot_json", sa.Text(), nullable=True))
    op.add_column("traces", sa.Column("request_snapshot_hash", sa.String(length=64), nullable=True))

    op.create_table(
        "benchmark_dataset_versions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("version", sa.String(length=40), nullable=False),
        sa.Column("dataset_hash", sa.String(length=64), nullable=False),
        sa.Column("case_count", sa.Integer(), nullable=False),
        sa.Column("case_manifest_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dataset_hash"),
    )
    op.create_index("ix_benchmark_dataset_versions_name", "benchmark_dataset_versions", ["name"])

    op.create_table(
        "benchmark_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("product_id", sa.String(length=36), nullable=True),
        sa.Column("dataset_version_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("benchmark_version", sa.String(length=40), nullable=False),
        sa.Column("baseline_config_json", sa.Text(), nullable=False),
        sa.Column("candidate_config_json", sa.Text(), nullable=False),
        sa.Column("baseline_model", sa.String(length=160), nullable=False),
        sa.Column("candidate_model", sa.String(length=160), nullable=False),
        sa.Column("git_commit_sha", sa.String(length=64), nullable=True),
        sa.Column("git_dirty", sa.Boolean(), nullable=False),
        sa.Column("provider", sa.String(length=80), nullable=False),
        sa.Column("pricing_provenance_json", sa.Text(), nullable=False),
        sa.Column("seed", sa.Integer(), nullable=False),
        sa.Column("case_count", sa.Integer(), nullable=False),
        sa.Column("completed_case_count", sa.Integer(), nullable=False),
        sa.Column("protected_case_count", sa.Integer(), nullable=False),
        sa.Column("baseline_total_cost", sa.Float(), nullable=True),
        sa.Column("candidate_total_cost", sa.Float(), nullable=True),
        sa.Column("absolute_cost_delta", sa.Float(), nullable=True),
        sa.Column("cost_savings_percent", sa.Float(), nullable=True),
        sa.Column("baseline_quality", sa.Float(), nullable=True),
        sa.Column("candidate_quality", sa.Float(), nullable=True),
        sa.Column("quality_delta", sa.Float(), nullable=True),
        sa.Column("baseline_latency_ms", sa.Float(), nullable=True),
        sa.Column("candidate_latency_ms", sa.Float(), nullable=True),
        sa.Column("latency_delta_ms", sa.Float(), nullable=True),
        sa.Column("protected_pass_rate", sa.Float(), nullable=True),
        sa.Column("evaluation_run_id", sa.String(length=36), nullable=True),
        sa.Column("candidate_execution_id", sa.String(length=36), nullable=True),
        sa.Column("evidence_hash", sa.String(length=64), nullable=False),
        sa.Column("gate_config_hash", sa.String(length=64), nullable=False),
        sa.Column("grader_config_hash", sa.String(length=64), nullable=False),
        sa.Column("statistics_json", sa.Text(), nullable=False),
        sa.Column("artifact_dir", sa.Text(), nullable=True),
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_benchmark_runs_dataset_version_id", "benchmark_runs", ["dataset_version_id"])
    op.create_index("ix_benchmark_runs_status", "benchmark_runs", ["status"])
    op.create_index("ix_benchmark_runs_product_id", "benchmark_runs", ["product_id"])

    op.create_table(
        "benchmark_case_results",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("benchmark_run_id", sa.String(length=36), nullable=False),
        sa.Column("case_id", sa.String(length=120), nullable=False),
        sa.Column("difficulty", sa.String(length=40), nullable=False),
        sa.Column("protected", sa.Boolean(), nullable=False),
        sa.Column("task_fingerprint", sa.String(length=64), nullable=True),
        sa.Column("baseline_trace_id", sa.String(length=36), nullable=True),
        sa.Column("candidate_execution_id", sa.String(length=36), nullable=True),
        sa.Column("evaluation_case_result_id", sa.String(length=36), nullable=True),
        sa.Column("baseline_model", sa.String(length=160), nullable=True),
        sa.Column("candidate_model", sa.String(length=160), nullable=True),
        sa.Column("baseline_output_hash", sa.String(length=64), nullable=True),
        sa.Column("candidate_output_hash", sa.String(length=64), nullable=True),
        sa.Column("baseline_cost_usd", sa.Float(), nullable=True),
        sa.Column("candidate_cost_usd", sa.Float(), nullable=True),
        sa.Column("baseline_cost_source", sa.String(length=40), nullable=True),
        sa.Column("candidate_cost_source", sa.String(length=40), nullable=True),
        sa.Column("baseline_latency_ms", sa.Float(), nullable=True),
        sa.Column("candidate_latency_ms", sa.Float(), nullable=True),
        sa.Column("baseline_quality", sa.Float(), nullable=True),
        sa.Column("candidate_quality", sa.Float(), nullable=True),
        sa.Column("comparable", sa.Boolean(), nullable=False),
        sa.Column("gate_summary_json", sa.Text(), nullable=False),
        sa.Column("error_status", sa.Text(), nullable=True),
        sa.Column("case_provenance_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["benchmark_run_id"], ["benchmark_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_benchmark_case_results_benchmark_run_id", "benchmark_case_results", ["benchmark_run_id"])


def downgrade() -> None:
    op.drop_index("ix_benchmark_case_results_benchmark_run_id", table_name="benchmark_case_results")
    op.drop_table("benchmark_case_results")
    op.drop_index("ix_benchmark_runs_product_id", table_name="benchmark_runs")
    op.drop_index("ix_benchmark_runs_status", table_name="benchmark_runs")
    op.drop_index("ix_benchmark_runs_dataset_version_id", table_name="benchmark_runs")
    op.drop_table("benchmark_runs")
    op.drop_index("ix_benchmark_dataset_versions_name", table_name="benchmark_dataset_versions")
    op.drop_table("benchmark_dataset_versions")
    op.drop_column("traces", "request_snapshot_hash")
    op.drop_column("traces", "request_snapshot_json")
