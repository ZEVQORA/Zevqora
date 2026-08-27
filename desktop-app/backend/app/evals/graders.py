"""Deterministic graders — score in [0,1]. No LLM judge."""

from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from typing import Any

from .models import GraderResult, GraderSpec


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _parse_jsonish(text: str | None) -> Any | None:
    if text is None:
        return None
    stripped = text.strip()
    if not stripped:
        return None
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return None


class Grader(ABC):
    name: str
    version: str

    @abstractmethod
    def grade(self, *, actual: str | None, expected: Any, spec: GraderSpec, context: dict[str, Any]) -> GraderResult:
        raise NotImplementedError


class ExactMatchGrader(Grader):
    name = "exact_match"
    version = "1.0.0"

    def grade(self, *, actual: str | None, expected: Any, spec: GraderSpec, context: dict[str, Any]) -> GraderResult:
        cfg = spec.config or {}
        trim = bool(cfg.get("trim", True))
        casefold = bool(cfg.get("case_insensitive", False))
        mode = cfg.get("mode", "text")  # text | json

        if actual is None:
            return GraderResult(
                grader=self.name,
                version=self.version,
                score=0.0,
                passed=False,
                details={"error": "actual_missing"},
            )

        if mode == "json":
            left = _parse_jsonish(actual)
            right = expected if not isinstance(expected, str) else _parse_jsonish(expected)
            if left is None or right is None:
                return GraderResult(
                    grader=self.name,
                    version=self.version,
                    score=0.0,
                    passed=False,
                    details={"error": "json_parse_failed"},
                )
            ok = _canonical_json(left) == _canonical_json(right)
            return GraderResult(
                grader=self.name,
                version=self.version,
                score=1.0 if ok else 0.0,
                passed=ok,
                details={"mode": "json"},
            )

        left_s = actual.strip() if trim else actual
        right_s = str(expected)
        right_s = right_s.strip() if trim else right_s
        if casefold:
            left_s, right_s = left_s.casefold(), right_s.casefold()
        ok = left_s == right_s
        return GraderResult(
            grader=self.name,
            version=self.version,
            score=1.0 if ok else 0.0,
            passed=ok,
            details={"mode": "text", "trim": trim, "case_insensitive": casefold},
        )


class ClassificationGrader(Grader):
    name = "classification"
    version = "1.0.0"

    def grade(self, *, actual: str | None, expected: Any, spec: GraderSpec, context: dict[str, Any]) -> GraderResult:
        cfg = spec.config or {}
        labels = [str(x) for x in (cfg.get("labels") or [])]
        expected_label = str(cfg.get("expected_label") or expected or "")
        strict = bool(cfg.get("strict", True))
        if actual is None:
            return GraderResult(
                grader=self.name, version=self.version, score=0.0, passed=False, details={"error": "actual_missing"}
            )
        text = actual.strip()
        if not labels:
            labels = [expected_label] if expected_label else []
        if not labels or not expected_label:
            return GraderResult(
                grader=self.name,
                version=self.version,
                score=0.0,
                passed=False,
                details={"error": "labels_or_expected_missing"},
            )

        if strict:
            # Exact single-token / exact label match after trim; reject paragraphs with multiple labels.
            normalized = text.casefold()
            hits = [lab for lab in labels if lab.casefold() == normalized]
            if len(hits) != 1:
                # Also reject if multiple distinct labels appear as whole words.
                word_hits = [lab for lab in labels if re.search(rf"\b{re.escape(lab)}\b", text, flags=re.I)]
                if len(word_hits) > 1 or (len(word_hits) == 1 and normalized != word_hits[0].casefold()):
                    return GraderResult(
                        grader=self.name,
                        version=self.version,
                        score=0.0,
                        passed=False,
                        details={"error": "ambiguous_or_nonexact", "hits": word_hits},
                    )
                if len(hits) != 1:
                    return GraderResult(
                        grader=self.name,
                        version=self.version,
                        score=0.0,
                        passed=False,
                        details={"error": "no_exact_label", "actual": text[:200]},
                    )
            predicted = hits[0]
        else:
            word_hits = [lab for lab in labels if re.search(rf"\b{re.escape(lab)}\b", text, flags=re.I)]
            if len(word_hits) != 1:
                return GraderResult(
                    grader=self.name,
                    version=self.version,
                    score=0.0,
                    passed=False,
                    details={"error": "ambiguous", "hits": word_hits},
                )
            predicted = word_hits[0]

        ok = predicted.casefold() == expected_label.casefold()
        return GraderResult(
            grader=self.name,
            version=self.version,
            score=1.0 if ok else 0.0,
            passed=ok,
            details={"predicted": predicted, "expected": expected_label, "strict": strict},
        )


class JSONSchemaGrader(Grader):
    """Lightweight required-keys / type schema — no arbitrary code execution."""

    name = "json_schema"
    version = "1.0.0"

    def grade(self, *, actual: str | None, expected: Any, spec: GraderSpec, context: dict[str, Any]) -> GraderResult:
        cfg = spec.config or {}
        schema = cfg.get("schema") or expected or {}
        parsed = _parse_jsonish(actual)
        if parsed is None:
            return GraderResult(
                grader=self.name, version=self.version, score=0.0, passed=False, details={"error": "json_parse_failed"}
            )
        if not isinstance(parsed, dict):
            return GraderResult(
                grader=self.name, version=self.version, score=0.0, passed=False, details={"error": "not_object"}
            )
        required = list(schema.get("required") or [])
        properties = dict(schema.get("properties") or {})
        missing = [k for k in required if k not in parsed]
        type_errors = []
        type_map = {
            "string": str,
            "number": (int, float),
            "integer": int,
            "boolean": bool,
            "object": dict,
            "array": list,
        }
        for key, prop in properties.items():
            if key not in parsed:
                continue
            expected_type = prop.get("type") if isinstance(prop, dict) else None
            py = type_map.get(expected_type)
            if py and not isinstance(parsed[key], py):
                # bool is subclass of int in Python — treat carefully
                if expected_type == "integer" and isinstance(parsed[key], bool):
                    type_errors.append(key)
                elif expected_type == "number" and isinstance(parsed[key], bool):
                    type_errors.append(key)
                elif not isinstance(parsed[key], py):
                    type_errors.append(key)
        ok = not missing and not type_errors
        return GraderResult(
            grader=self.name,
            version=self.version,
            score=1.0 if ok else 0.0,
            passed=ok,
            details={"missing": missing, "type_errors": type_errors},
        )


class FieldAccuracyGrader(Grader):
    name = "field_accuracy"
    version = "1.0.0"

    def grade(self, *, actual: str | None, expected: Any, spec: GraderSpec, context: dict[str, Any]) -> GraderResult:
        cfg = spec.config or {}
        expected_obj = expected if isinstance(expected, dict) else _parse_jsonish(str(expected) if expected else None)
        actual_obj = _parse_jsonish(actual)
        if not isinstance(expected_obj, dict) or not isinstance(actual_obj, dict):
            return GraderResult(
                grader=self.name, version=self.version, score=0.0, passed=False, details={"error": "object_required"}
            )
        required = list(cfg.get("required_fields") or expected_obj.keys())
        optional = list(cfg.get("optional_fields") or [])
        field_results = {}
        scores = []
        for key in required:
            ok = key in actual_obj and actual_obj[key] == expected_obj.get(key)
            field_results[key] = {
                "required": True,
                "passed": ok,
                "expected": expected_obj.get(key),
                "actual": actual_obj.get(key),
            }
            scores.append(1.0 if ok else 0.0)
        for key in optional:
            if key not in expected_obj:
                continue
            ok = key in actual_obj and actual_obj[key] == expected_obj.get(key)
            field_results[key] = {
                "required": False,
                "passed": ok,
                "expected": expected_obj.get(key),
                "actual": actual_obj.get(key),
            }
            scores.append(1.0 if ok else 0.0)
        score = sum(scores) / len(scores) if scores else 0.0
        passed = all(v["passed"] for k, v in field_results.items() if v["required"])
        return GraderResult(
            grader=self.name, version=self.version, score=score, passed=passed, details={"fields": field_results}
        )


class RequiredFactsGrader(Grader):
    name = "required_facts"
    version = "1.0.0"

    def grade(self, *, actual: str | None, expected: Any, spec: GraderSpec, context: dict[str, Any]) -> GraderResult:
        cfg = spec.config or {}
        ver = str(spec.version or self.version)
        facts = list(cfg.get("facts") or expected or [])
        forbidden = list(cfg.get("forbidden_phrases") or [])
        if actual is None:
            return GraderResult(
                grader=self.name, version=ver, score=0.0, passed=False, details={"error": "actual_missing"}
            )
        case_insensitive = bool(cfg.get("case_insensitive", True))
        hay = actual.casefold() if case_insensitive else actual
        violations = [p for p in forbidden if (p.casefold() if case_insensitive else p) in hay]
        if violations:
            return GraderResult(
                grader=self.name,
                version=ver,
                score=0.0,
                passed=False,
                details={"forbidden_found": violations},
            )
        found = []
        missing = []
        for fact in facts:
            needle = str(fact)
            probe = needle.casefold() if case_insensitive else needle
            if probe in hay:
                found.append(needle)
            else:
                missing.append(needle)
        # v1.0.x: empty facts → score 0.0 even when passed (historical quirk, immutable for v1).
        # v1.1.x: empty facts + no forbidden hits → score 1.0 (consistent pass/score).
        score = (len(found) / len(facts)) if facts else (1.0 if ver.startswith("1.1") else 0.0)
        return GraderResult(
            grader=self.name,
            version=ver,
            score=score,
            passed=not missing,
            details={"found": found, "missing": missing, "semantics": ver},
        )


class ToolSelectionGrader(Grader):
    name = "tool_selection"
    version = "1.0.0"

    def grade(self, *, actual: str | None, expected: Any, spec: GraderSpec, context: dict[str, Any]) -> GraderResult:
        cfg = spec.config or {}
        tools = list(context.get("tool_calls") or cfg.get("tool_calls") or [])
        names = [t.get("name") if isinstance(t, dict) else getattr(t, "name", None) for t in tools]
        names = [n for n in names if n]
        required = list(cfg.get("required_tools") or context.get("required_tools") or [])
        allowed = cfg.get("allowed_tools", context.get("allowed_tools"))
        forbidden = list(cfg.get("forbidden_tools") or context.get("forbidden_tools") or [])

        missing_required = [t for t in required if t not in names]
        forbidden_hits = [t for t in names if t in forbidden]
        disallowed = []
        if isinstance(allowed, list):
            disallowed = [t for t in names if t not in allowed]

        ok = not missing_required and not forbidden_hits and not disallowed
        return GraderResult(
            grader=self.name,
            version=self.version,
            score=1.0 if ok else 0.0,
            passed=ok,
            details={
                "called": names,
                "missing_required": missing_required,
                "forbidden_hits": forbidden_hits,
                "disallowed": disallowed,
            },
        )


class ToolArgumentsGrader(Grader):
    name = "tool_arguments"
    version = "1.0.0"

    def grade(self, *, actual: str | None, expected: Any, spec: GraderSpec, context: dict[str, Any]) -> GraderResult:
        cfg = spec.config or {}
        tools = list(context.get("tool_calls") or cfg.get("tool_calls") or [])
        tool_name = cfg.get("tool_name")
        required_args = dict(cfg.get("required_args") or {})
        forbidden_args = list(cfg.get("forbidden_args") or [])
        subset_ok = bool(cfg.get("subset", True))
        product_id = context.get("product_id")

        match = None
        for t in tools:
            name = t.get("name") if isinstance(t, dict) else getattr(t, "name", None)
            if tool_name and name != tool_name:
                continue
            match = t if isinstance(t, dict) else {"name": name, "arguments": getattr(t, "arguments", {})}
            break
        if match is None:
            return GraderResult(
                grader=self.name, version=self.version, score=0.0, passed=False, details={"error": "tool_not_found"}
            )
        args = match.get("arguments") or {}
        if not isinstance(args, dict):
            return GraderResult(
                grader=self.name, version=self.version, score=0.0, passed=False, details={"error": "args_not_object"}
            )

        mismatches = {}
        for key, value in required_args.items():
            if key not in args or args[key] != value:
                mismatches[key] = {"expected": value, "actual": args.get(key)}
        forbidden_present = [k for k in forbidden_args if k in args]

        # Application-controlled product_id boundary.
        product_violation = False
        if product_id is not None and "product_id" in args and args["product_id"] != product_id:
            product_violation = True

        if subset_ok:
            # only required/forbidden checked
            ok = not mismatches and not forbidden_present and not product_violation
        else:
            ok = args == required_args and not forbidden_present and not product_violation

        return GraderResult(
            grader=self.name,
            version=self.version,
            score=1.0 if ok else 0.0,
            passed=ok,
            details={
                "mismatches": mismatches,
                "forbidden_present": forbidden_present,
                "product_id_violation": product_violation,
            },
        )


_REGISTRY: dict[str, Grader] = {
    ExactMatchGrader.name: ExactMatchGrader(),
    ClassificationGrader.name: ClassificationGrader(),
    JSONSchemaGrader.name: JSONSchemaGrader(),
    FieldAccuracyGrader.name: FieldAccuracyGrader(),
    RequiredFactsGrader.name: RequiredFactsGrader(),
    ToolSelectionGrader.name: ToolSelectionGrader(),
    ToolArgumentsGrader.name: ToolArgumentsGrader(),
}


def get_grader(name: str) -> Grader:
    try:
        return _REGISTRY[name]
    except KeyError as exc:
        raise KeyError(f"Unknown grader: {name}") from exc


def list_graders() -> list[str]:
    return sorted(_REGISTRY)
