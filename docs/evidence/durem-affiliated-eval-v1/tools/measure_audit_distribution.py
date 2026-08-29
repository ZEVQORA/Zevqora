"""Measure observable workload frequencies from a real DUREM audit database.

Run this ON the measurement host. It opens durem.db READ-ONLY and emits ONLY
aggregate metadata: counts, the UTC window, routing-setting stability, and the
category frequencies defined in AUDIT_OBSERVABILITY.md section 2.

It never reads, prints, or writes the `question` field, `sources` values, usernames,
or any other content. The output is safe to commit.

Usage:
    python measure_audit_distribution.py --db <path to durem.db> --out observed_distribution.json
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

# Keys this tool is permitted to read out of metadata_json. `question` and `sources`
# are deliberately absent: they may carry confidential company text or document IDs.
ALLOWED_METADATA_KEYS = frozenset(
    {
        "route",
        "route_method",
        "classifier_invoked",
        "safety_override",
        "method",
        "answer_type",
        "decision",
        "mode",
    }
)

# Preregistered validity conditions (AUDIT_OBSERVABILITY.md section 4.1).
MIN_ANSWER_ROWS = 1000
MIN_WINDOW_DAYS = 30

ROUTING_SETTINGS = ("auto_routing_enabled", "hybrid_router_enabled", "general_chat_enabled")

# Exclusive-assignment precedence, most specific first (PREREGISTRATION.md section 3.2).
# Categories overlap by construction; without a frozen precedence the proportions
# would not sum to 1 and the mix could be tuned by changing evaluation order.
PRECEDENCE = (
    "SAFETY",
    "RULE",
    "NOTFOUND",
    "FOLLOWUP",
    "ROUTE-AMB",
    "RAG",
    "ROUTE-OBV",
    "CHAT",
)


def _truthy(value: object) -> bool:
    return value is True or value == 1 or value == "true"


def _predicates(meta: dict, has_sources: bool) -> dict[str, bool]:
    route = meta.get("route")
    method = meta.get("method")
    route_method = meta.get("route_method")
    answer_type = meta.get("answer_type")
    classifier = _truthy(meta.get("classifier_invoked"))

    return {
        "CHAT": route == "chat" and method == "chat_llm",
        "ROUTE-OBV": route == "policy"
        and not classifier
        and route_method in {"deterministic", "explicit"},
        "ROUTE-AMB": classifier and route_method == "llm_classifier",
        "SAFETY": _truthy(meta.get("safety_override")),
        "RULE": method == "rule_engine",
        "RAG": route == "policy"
        and method == "llm"
        and answer_type != "NOT_FOUND"
        and has_sources,
        "FOLLOWUP": route_method == "followup",
        "NOTFOUND": answer_type == "NOT_FOUND",
    }


def _parse_ts(raw: str) -> datetime | None:
    if not raw:
        return None
    text = raw.strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
            try:
                return datetime.strptime(text[:19], fmt)
            except ValueError:
                continue
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True, help="path to the real durem.db")
    parser.add_argument("--out", default="observed_distribution.json")
    args = parser.parse_args()

    db_path = Path(args.db).resolve()
    if not db_path.exists():
        print(f"ERROR: no database at {db_path}")
        return 2

    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row

    # Admin and test accounts are excluded by role. Their ids are reported so the
    # exclusion is auditable; usernames are never emitted.
    admin_ids = sorted(
        r["id"]
        for r in conn.execute(
            "SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.is_admin = 1"
        ).fetchall()
    )

    rows = conn.execute(
        """SELECT user_id, metadata_json, created_at
           FROM audit_logs
           WHERE event_type = 'assistant' AND action = 'answer'
           ORDER BY created_at ASC"""
    ).fetchall()

    settings_changes = conn.execute(
        """SELECT created_at, metadata_json FROM audit_logs
           WHERE event_type = 'admin' AND action = 'settings_updated'
           ORDER BY created_at ASC"""
    ).fetchall()

    current_settings = {
        r["key"]: r["value"]
        for r in conn.execute(
            f"SELECT key, value FROM settings WHERE key IN ({','.join('?' * len(ROUTING_SETTINGS))})",
            ROUTING_SETTINGS,
        ).fetchall()
    }

    conn.close()

    predicate_counts: Counter[str] = Counter()
    exclusive_counts: Counter[str] = Counter()
    unclassified = 0
    malformed = 0
    excluded_admin_rows = 0
    timestamps: list[datetime] = []

    for row in rows:
        if row["user_id"] in admin_ids:
            excluded_admin_rows += 1
            continue
        try:
            raw_meta = json.loads(row["metadata_json"] or "{}")
        except (json.JSONDecodeError, TypeError):
            malformed += 1
            continue
        if not isinstance(raw_meta, dict):
            malformed += 1
            continue

        has_sources = bool(raw_meta.get("sources"))  # emptiness only; values never read
        meta = {k: v for k, v in raw_meta.items() if k in ALLOWED_METADATA_KEYS}

        ts = _parse_ts(row["created_at"])
        if ts is not None:
            timestamps.append(ts)

        hits = _predicates(meta, has_sources)
        for name, hit in hits.items():
            if hit:
                predicate_counts[name] += 1

        for name in PRECEDENCE:
            if hits.get(name):
                exclusive_counts[name] += 1
                break
        else:
            unclassified += 1

    analysed = len(rows) - excluded_admin_rows - malformed
    window_start = min(timestamps) if timestamps else None
    window_end = max(timestamps) if timestamps else None
    window_days = (window_end - window_start).days if window_start and window_end else 0

    changes_in_window = [
        c
        for c in settings_changes
        if window_start
        and window_end
        and (_parse_ts(c["created_at"]) or window_start) >= window_start
    ]

    conditions = {
        "min_answer_rows": {
            "required": MIN_ANSWER_ROWS,
            "observed": analysed,
            "passed": analysed >= MIN_ANSWER_ROWS,
        },
        "min_window_days": {
            "required": MIN_WINDOW_DAYS,
            "observed": window_days,
            "passed": window_days >= MIN_WINDOW_DAYS,
        },
        "routing_settings_enabled_now": {
            "required": {k: "1" for k in ROUTING_SETTINGS},
            "observed": current_settings,
            "passed": all(current_settings.get(k) == "1" for k in ROUTING_SETTINGS),
        },
        "no_settings_change_in_window": {
            "required": 0,
            "observed": len(changes_in_window),
            "passed": len(changes_in_window) == 0,
        },
    }
    all_passed = all(c["passed"] for c in conditions.values())

    total_exclusive = sum(exclusive_counts.values())
    result = {
        "tool_version": "measure_audit_distribution_v1",
        "database_path_hash": __import__("hashlib").sha256(str(db_path).encode()).hexdigest(),
        "window_start_utc": window_start.isoformat() if window_start else None,
        "window_end_utc": window_end.isoformat() if window_end else None,
        "window_days": window_days,
        "total_answer_rows": len(rows),
        "excluded_admin_rows": excluded_admin_rows,
        "excluded_admin_user_ids": admin_ids,
        "malformed_metadata_rows": malformed,
        "analysed_rows": analysed,
        "predicate_counts_overlapping": dict(predicate_counts),
        "exclusive_counts": dict(exclusive_counts),
        "exclusive_shares": {
            k: round(v / total_exclusive, 6) for k, v in exclusive_counts.items()
        }
        if total_exclusive
        else {},
        "unclassified_rows": unclassified,
        "precedence": list(PRECEDENCE),
        "validity_conditions": conditions,
        "all_conditions_passed": all_passed,
        "verdict": (
            "USE_OBSERVED_FOR_8_CATEGORIES"
            if all_passed
            else "FALL_BACK_TO_PREREGISTERED_ASSUMED_MIX"
        ),
        "note": (
            "ACL, LIFECYCLE and SRCVAL are not measurable from audit logs "
            "(AUDIT_OBSERVABILITY.md section 3) and keep preregistered counts. "
            "NOTFOUND is observable in aggregate only, not by cause."
        ),
    }

    Path(args.out).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    if not all_passed:
        print("\nVALIDITY CONDITIONS NOT MET -> the entire distribution reverts to the")
        print("preregistered assumed mix. Do not blend a marginal window with assumptions.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
