"""Local-runtime abstraction for DUREM-style execution.

ZEVQORA's existing providers assume a cloud, token-priced API. DUREM talks to an
OpenAI-compatible local runtime (Lemonade) instead. Two runtimes are supported
here and they share one contract:

``local``
    A real Lemonade server. DUREM is pointed at it unchanged.

``mock``
    A deterministic stub served over real HTTP on an ephemeral port. DUREM is
    pointed at it unchanged too — same client, same JSON, same error handling —
    so routing, retrieval, source validation and instrumentation all execute for
    real. Only the *content* of model answers is stubbed.

The stub deliberately does **not** know which arm it is serving. It cannot make a
candidate look cheaper, because it never sees the arm, the case expectations, or
the gate configuration. Savings can only come from DUREM making fewer or smaller
calls, which the probe counts independently.
"""

from __future__ import annotations

import json
import re
import threading
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .metrics import approx_tokens

RUNTIME_VERSION = "durem_local_runtime_v1"

DEFAULT_CHAT_MODEL = "Qwen3-8B-GGUF"
DEFAULT_EMBEDDING_MODEL = "Qwen3-Embedding-0.6B-GGUF"

EMBEDDING_DIM = 32

_RULE_RE = re.compile(r"\[RULE ([^\]]+)\]")
_CHUNK_RE = re.compile(r"\[CHUNK ([^\]]+)\]")
_RESP_RE = re.compile(r"\[RESPONSIBILITY ([^\]]+)\]")
_DECISION_HINT_RE = re.compile(r"Decision hint: ([A-Z_]+)")
_APPROVER_RE = re.compile(r"Approver hint: (.+)")
_POLICY_SCORE_RE = re.compile(r"POLICY SCORE: (-?\d+)")
_CHAT_SCORE_RE = re.compile(r"CHAT SCORE: (-?\d+)")


@dataclass(frozen=True)
class RuntimeDescriptor:
    """Identity of whatever answered the calls. Recorded in every run manifest."""

    kind: str  # "mock" | "local"
    base_url: str
    chat_model: str
    embedding_model: str
    is_real: bool
    version: str = RUNTIME_VERSION

    def as_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "base_url": self.base_url,
            "chat_model": self.chat_model,
            "embedding_model": self.embedding_model,
            "is_real": self.is_real,
            "runtime_version": self.version,
        }


def _deterministic_vector(text: str, dim: int = EMBEDDING_DIM) -> list[float]:
    """Stable pseudo-embedding derived from the text.

    Deterministic across processes and runs, so replays are reproducible. It
    carries enough lexical signal for cosine similarity to behave sensibly
    (shared tokens raise the score), without pretending to be a real model.
    """
    vector = [0.0] * dim
    for token in re.findall(r"\w+", text.lower()):
        slot = hash_token(token) % dim
        vector[slot] += 1.0
    norm = sum(v * v for v in vector) ** 0.5
    if norm == 0:
        return [0.0] * dim
    return [round(v / norm, 8) for v in vector]


def hash_token(token: str) -> int:
    """FNV-1a. Python's hash() is salted per process; this must be stable."""
    h = 2166136261
    for char in token.encode("utf-8"):
        h ^= char
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def _router_answer(user_prompt: str) -> str:
    """Deterministic classifier reply driven by DUREM's own signal scores.

    The stub only reaches this path when DUREM's deterministic router already
    declined to decide, so the prompt genuinely is ambiguous. Ties resolve to
    policy, matching DUREM's documented safety asymmetry: a false policy degrades
    to NOT_FOUND, a false chat can fabricate company authority.
    """
    policy = int(m.group(1)) if (m := _POLICY_SCORE_RE.search(user_prompt)) else 0
    chat = int(m.group(1)) if (m := _CHAT_SCORE_RE.search(user_prompt)) else 0
    if policy >= chat:
        route, reason, confidence = "policy", "ambiguous_policy_bias", 0.74
    else:
        route, reason, confidence = "chat", "general_helper", 0.80
    return json.dumps({"route": route, "confidence": confidence, "reason_code": reason})


def _content_prefixes(text: str, min_len: int = 6, prefix: int = 6) -> set[str]:
    """Content-word prefixes. Mongolian is agglutinative, so suffixed forms of the
    same stem must still match; comparing fixed-length prefixes does that without
    a morphological analyser.

    Six characters, not five: at five, the common auxiliary "байдаг" collides with
    the unrelated noun "байдал", which made an out-of-domain question look
    relevant to a security document."""
    return {token[:prefix] for token in re.findall(r"[\w%₮]+", text.lower(), flags=re.UNICODE) if len(token) >= min_len}


def _blocks(user_prompt: str, marker: str) -> list[tuple[str, str]]:
    """Split the approved-context section into (id, body) pairs for one marker."""
    pattern = re.compile(rf"\[{marker} ([^\]]+)\](.*?)(?=\[(?:RULE|CHUNK|RESPONSIBILITY) |\Z)", re.S)
    return [(m.group(1), m.group(2)) for m in pattern.finditer(user_prompt)]


def _question_of(user_prompt: str) -> str:
    match = re.search(r"^QUESTION: (.+)$", user_prompt, flags=re.M)
    return match.group(1) if match else user_prompt


def _best_block(question: str, blocks: list[tuple[str, str]]) -> tuple[str, str] | None:
    """Pick the most relevant context block, or None when nothing is relevant.

    This is the one judgment the stub makes, and it is deliberately generic: it
    knows nothing about cases, expectations, arms or gates. It mirrors what a
    competent grounded model does -- cite the best-matching approved source, and
    refuse when none of them is about the question.
    """
    q = _content_prefixes(question)
    if not q:
        return None
    best: tuple[int, str, str] | None = None
    for block_id, body in blocks:
        overlap = len(q & _content_prefixes(body))
        if overlap and (best is None or overlap > best[0]):
            best = (overlap, block_id, body)
    if best is None:
        return None
    return best[1], best[2]


def _policy_answer(user_prompt: str) -> str:
    """Deterministic policy reply that cites only IDs present in the context.

    Mirrors a well-behaved model: it never invents a source, and it returns
    NOT_FOUND when the approved context does not address the question. DUREM's own
    _normalize() still runs over this output, so the source-validation path is
    exercised for real.
    """
    question = _question_of(user_prompt)
    rules = _blocks(user_prompt, "RULE")
    chunks = _blocks(user_prompt, "CHUNK")
    responsibilities = _blocks(user_prompt, "RESPONSIBILITY")

    not_found = json.dumps(
        {
            "answer_type": "NOT_FOUND",
            "decision": "NOT_FOUND",
            "headline": "Мэдээлэл олдсонгүй",
            "answer": "Батлагдсан эх сурвалж хангалтгүй байна.",
        }
    )

    if not rules and not chunks and not responsibilities:
        return not_found

    if responsibilities and "REQUEST MODE: who" in user_prompt:
        best = _best_block(question, responsibilities)
        if best is not None:
            return json.dumps(
                {
                    "answer_type": "ROUTING",
                    "decision": "NOT_FOUND",
                    "headline": "Хариуцсан ажилтан",
                    "answer": "Энэ асуудлыг хариуцсан ажилтан руу хандана уу.",
                    "approver": "",
                    "source_responsibility_ids": [best[0]],
                }
            )

    best_rule = _best_block(question, rules)
    if best_rule is not None:
        rule_id, body = best_rule
        hint_match = _DECISION_HINT_RE.search(body)
        hint = hint_match.group(1) if hint_match else "AUTO"
        approver_match = _APPROVER_RE.search(body)
        approver = approver_match.group(1).strip() if approver_match else ""
        if approver == "-":
            approver = ""
        if hint in {"ALLOWED", "DENIED", "APPROVAL_REQUIRED"}:
            return json.dumps(
                {
                    "answer_type": "DECISION",
                    "decision": hint,
                    "headline": "Шийдвэр",
                    "answer": "Дүрмийн дагуу шийдвэрлэв.",
                    "approver": approver,
                    "next_steps": [],
                    "source_rule_ids": [rule_id],
                }
            )
        return json.dumps(
            {
                "answer_type": "POLICY",
                "decision": "NOT_FOUND",
                "headline": "Журам",
                "answer": "Холбогдох журмын заалт.",
                "source_rule_ids": [rule_id],
            }
        )

    best_chunk = _best_block(question, chunks)
    if best_chunk is not None:
        return json.dumps(
            {
                "answer_type": "POLICY",
                "decision": "NOT_FOUND",
                "headline": "Баримт",
                "answer": "Холбогдох баримт бичгийн заалт.",
                "source_chunk_ids": [best_chunk[0]],
            }
        )

    return not_found


def _chat_answer(user_prompt: str) -> str:
    return "Тодорхой хариулт: " + user_prompt.strip().replace("\n", " ")[:160]


class _Handler(BaseHTTPRequestHandler):
    server_version = "DuremStubRuntime/1.0"

    def log_message(self, *args: Any) -> None:  # keep test output clean
        return

    def _send(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") == "/v1/models":
            self._send(
                {
                    "data": [
                        {"id": DEFAULT_CHAT_MODEL, "object": "model"},
                        {"id": DEFAULT_EMBEDDING_MODEL, "object": "model"},
                    ]
                }
            )
            return
        self._send({"error": "not_found"}, status=404)

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._send({"error": "bad_json"}, status=400)
            return

        server: MockRuntimeServer = self.server.controller  # type: ignore[attr-defined]
        path = self.path.rstrip("/")

        if path == "/v1/chat/completions":
            server.chat_requests += 1
            if server.fail_chat:
                self._send({"error": "injected_failure"}, status=503)
                return
            messages = payload.get("messages") or []
            system = next((m.get("content", "") for m in messages if m.get("role") == "system"), "")
            user = next((m.get("content", "") for m in reversed(messages) if m.get("role") == "user"), "")
            if "DUREM Router" in system:
                content = _router_answer(user)
            elif "company policy assistant" in system:
                content = _policy_answer(user)
            else:
                content = _chat_answer(user)
            if server.emit_invalid_policy_json and "company policy assistant" in system:
                # One-shot: exercises DUREM's repair-retry path for real.
                server.emit_invalid_policy_json = False
                content = "not json at all"

            prompt_text = "".join(str(m.get("content", "")) for m in messages)
            self._send(
                {
                    "id": f"stub-{server.chat_requests}",
                    "object": "chat.completion",
                    "model": payload.get("model", DEFAULT_CHAT_MODEL),
                    "choices": [
                        {"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}
                    ],
                    # Synthetic, derived from real prompt size. Labelled
                    # SYNTHETIC_TEST_METRIC everywhere downstream.
                    "usage": {
                        "prompt_tokens": approx_tokens(prompt_text),
                        "completion_tokens": approx_tokens(content),
                        "total_tokens": approx_tokens(prompt_text) + approx_tokens(content),
                    },
                }
            )
            return

        if path == "/v1/embeddings":
            server.embedding_requests += 1
            if server.fail_embeddings:
                self._send({"error": "injected_failure"}, status=503)
                return
            raw = payload.get("input")
            texts = [raw] if isinstance(raw, str) else list(raw or [])
            self._send(
                {
                    "object": "list",
                    "model": payload.get("model", DEFAULT_EMBEDDING_MODEL),
                    "data": [
                        {"object": "embedding", "index": i, "embedding": _deterministic_vector(str(t))}
                        for i, t in enumerate(texts)
                    ],
                    "usage": {
                        "prompt_tokens": sum(approx_tokens(str(t)) for t in texts),
                        "total_tokens": sum(approx_tokens(str(t)) for t in texts),
                    },
                }
            )
            return

        self._send({"error": "not_found"}, status=404)


class MockRuntimeServer:
    """Deterministic OpenAI-compatible runtime on an ephemeral local port.

    Used as a context manager. DUREM talks to it over real HTTP with its real
    client, so nothing in DUREM is monkeypatched or bypassed.
    """

    def __init__(self) -> None:
        self._httpd: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None
        self.chat_requests = 0
        self.embedding_requests = 0
        # Fault injection, for exercising DUREM's degradation paths on purpose.
        self.fail_chat = False
        self.fail_embeddings = False
        self.emit_invalid_policy_json = False

    @property
    def base_url(self) -> str:
        if self._httpd is None:
            raise RuntimeError("server not started")
        host, port = self._httpd.server_address[:2]
        return f"http://127.0.0.1:{port}"

    def descriptor(self) -> RuntimeDescriptor:
        return RuntimeDescriptor(
            kind="mock",
            base_url=self.base_url,
            chat_model=DEFAULT_CHAT_MODEL,
            embedding_model=DEFAULT_EMBEDDING_MODEL,
            is_real=False,
        )

    def start(self) -> MockRuntimeServer:
        self._httpd = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        self._httpd.controller = self  # type: ignore[attr-defined]
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None

    def __enter__(self) -> MockRuntimeServer:
        return self.start()

    def __exit__(self, *exc: object) -> None:
        self.stop()


def local_descriptor(
    base_url: str,
    chat_model: str = DEFAULT_CHAT_MODEL,
    embedding_model: str = DEFAULT_EMBEDDING_MODEL,
) -> RuntimeDescriptor:
    return RuntimeDescriptor(
        kind="local",
        base_url=base_url.rstrip("/"),
        chat_model=chat_model,
        embedding_model=embedding_model,
        is_real=True,
    )


def probe_local_runtime(base_url: str, timeout: float = 6.0) -> dict[str, Any]:
    """Ask a real Lemonade server what it is. Used by the server-ready path."""
    import httpx

    try:
        response = httpx.get(f"{base_url.rstrip('/')}/v1/models", timeout=timeout, trust_env=False)
        if response.status_code != 200:
            return {"reachable": False, "error": f"http_{response.status_code}"}
        return {"reachable": True, "models": response.json()}
    except Exception as exc:  # noqa: BLE001 - reported, not raised
        return {"reachable": False, "error": f"{type(exc).__name__}: {exc}"}
