"""Implementation review trail: decisions, pushes and pull-request links.

Revision ID: 0007_implementation_review
Revises: 0006_evidence_integrity
Create Date: 2026-09-06

Additive only. A prepared implementation candidate can now record the human
decision made in the desktop review surface (approve for review / reject), the
moment its branch was pushed to the remote, and the pull-request link the
reviewer opened. ZEVQORA never merges: these columns document the handoff.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007_implementation_review"
down_revision = "0006_evidence_integrity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("implementations") as batch:
        batch.add_column(sa.Column("review_note", sa.Text(), nullable=True))
        batch.add_column(sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("pushed_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("remote_url", sa.Text(), nullable=True))
        batch.add_column(sa.Column("pr_url", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("implementations") as batch:
        batch.drop_column("pr_url")
        batch.drop_column("remote_url")
        batch.drop_column("pushed_at")
        batch.drop_column("reviewed_at")
        batch.drop_column("review_note")
