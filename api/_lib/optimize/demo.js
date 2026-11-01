/**
 * DEMO / SYNTHETIC — NOT CUSTOMER DATA.
 *
 * One deterministic workload for local and demo use only. Every number here
 * is invented to exercise the product end to end; none of it is evidence
 * about any real system and it must never be presented as customer proof.
 *
 * What it contains, by construction:
 *   - classify_ticket: 6 support messages, each asked 3× with the same answer
 *     → redundant calls whose reuse is correct (replay can VERIFY it);
 *   - route_refund: 3 refund requests asked 3×; the FIRST answer to one of
 *     them was wrong and later ones right → reusing the first answer is
 *     worse (replay REJECTS it);
 *   - retries: rate-limited first attempts on some refund requests (a 429 is
 *     not billed: a known $0 cost, distinct from the one unpriced trace);
 *   - a protected slice (account takeover reports), never reused;
 *   - a stable system prompt resent uncached with large inputs;
 *   - frontier model (gpt-4o) for one-word outputs;
 *   - p95 latency above the demo contract's budget.
 */
export const DEMO_LABEL = 'DEMO / SYNTHETIC — NOT CUSTOMER DATA';
export const DEMO_NAME = `Support triage (${DEMO_LABEL})`;
export const DEMO_ROOT = 'workload://demo-synthetic-support-triage';

const SYSTEM = {
  classify: 'DEMO SYNTHETIC. Classify the support message as exactly one of: billing, technical, account. Answer with the label only.',
  refund: 'DEMO SYNTHETIC. Decide the refund request: answer approve or deny only.',
};

const CLASSIFY = [
  ['I was charged twice this month', 'billing'],
  ['The app crashes when I upload a file', 'technical'],
  ['How do I change my email address', 'account'],
  ['My invoice shows the wrong VAT number', 'billing'],
  ['Sync stopped working after the update', 'technical'],
  ['Please close my workspace', 'account'],
];
const REFUND = [
  // [input, expected, answers per repeat]
  ['Order 1001 arrived broken, photos attached', 'approve', ['deny', 'approve', 'approve']],
  ['Order 1002 never shipped, 40 days ago', 'approve', ['approve', 'approve', 'approve']],
  ['Order 1003 used for 9 months, changed my mind', 'deny', ['deny', 'deny', 'deny']],
];
const PROTECTED = [
  ['Someone logged into my account from another country', 'account'],
  ['I did not authorize this password reset', 'account'],
];

/** Deterministic pseudo-random in [0,1) from an integer seed. */
function rnd(seed) {
  let x = (seed * 2654435761) % 4294967296;
  x = (x ^ (x >>> 13)) * 1274126177 % 4294967296;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const day = (i) => new Date(Date.UTC(2026, 8, 1, 9, 0, 0) + i * 37 * 60_000).toISOString();
const PRICE = { in: 2.5 / 1e6, out: 10 / 1e6 };

/** The demo traces, in the engine's JSONL import shape. Deterministic. */
export function demoTraces() {
  const out = [];
  let i = 0;
  const push = (row) => {
    i += 1;
    const inTok = row.input_tokens;
    const outTok = row.output_tokens;
    out.push({
      timestamp: day(i),
      provider: 'openai',
      model: 'gpt-4o',
      input_tokens: inTok,
      output_tokens: outTok,
      cost_usd: Number((inTok * PRICE.in + outTok * PRICE.out).toFixed(8)),
      ...row,
      metadata: { cost_source: 'provider_reported', synthetic: true, demo: DEMO_LABEL, temperature: 0, ...(row.metadata || {}) },
    });
  };
  CLASSIFY.forEach(([text, label], k) => {
    for (let r = 0; r < 3; r += 1) {
      push({ request_id: `demo-classify-${k}-${r}`, symbol: 'classify_ticket', workflow: 'support_triage', system_prompt: SYSTEM.classify, input_text: text, output_text: label, expected_output: label, input_tokens: 1480 + Math.round(rnd(k * 10 + r) * 120), output_tokens: 1, latency_ms: 900 + Math.round(rnd(k * 7 + r + 3) * 1500), metadata: { ttft_ms: 420 + Math.round(rnd(k + r) * 300) } });
    }
  });
  REFUND.forEach(([text, expected, answers], k) => {
    for (let r = 0; r < 3; r += 1) {
      const logical = `demo-refund-${k}-${r}`;
      const retried = r === 1 && k !== 2;
      if (retried) {
        push({ request_id: `${logical}-a1`, symbol: 'route_refund', workflow: 'refunds', system_prompt: SYSTEM.refund, input_text: text, output_text: null, expected_output: expected, input_tokens: 1530, output_tokens: 0, latency_ms: 880, cost_usd: 0, metadata: { logical_request_id: logical, attempt: 1, status: 'error', error_type: 'rate_limit' } });
      }
      push({ request_id: retried ? `${logical}-a2` : logical, symbol: 'route_refund', workflow: 'refunds', system_prompt: SYSTEM.refund, input_text: text, output_text: answers[r], expected_output: expected, input_tokens: 1510 + Math.round(rnd(k * 13 + r) * 80), output_tokens: 1, latency_ms: 1100 + Math.round(rnd(k * 5 + r + 9) * 1300), metadata: { logical_request_id: logical, attempt: retried ? 2 : 1, retry_reason: retried ? 'rate_limited' : undefined } });
    }
  });
  PROTECTED.forEach(([text, label], k) => {
    push({ request_id: `demo-protected-${k}`, symbol: 'classify_ticket', workflow: 'support_triage', system_prompt: SYSTEM.classify, input_text: text, output_text: label, expected_output: label, input_tokens: 1495, output_tokens: 1, latency_ms: 1300 + k * 200, protected: true });
  });
  // One trace without reported cost: unknown, never $0.
  push({ request_id: 'demo-unpriced-0', symbol: 'classify_ticket', workflow: 'support_triage', system_prompt: SYSTEM.classify, input_text: 'Where can I download my receipts', output_text: 'billing', expected_output: 'billing', input_tokens: 1470, output_tokens: 1, latency_ms: 1010, cost_usd: null, metadata: { cost_source: undefined } });
  // engine import shape: attempt lives in metadata
  return out.map((t) => {
    const metadata = Object.fromEntries(Object.entries(t.metadata).filter(([, v]) => v !== undefined));
    if (t.cost_usd === null) delete metadata.cost_source;
    return { ...t, metadata };
  });
}

/** The contract the demo freezes: strict, with a latency budget the baseline misses. */
export const DEMO_REQUIREMENTS = Object.freeze({
  quality_floor: 0.95,
  min_task_success_rate: 0.95,
  latency: { require: true, max_p95_ms: 2000, max_regression_pct: 20 },
  protected: { require_cases: false, min_cases: 0 },
  cost: { require_evidence: true, min_coverage: 0.9, require_improvement: true, min_improvement_pct: 0 },
  evidence: { min_samples: 5, min_latency_samples: 20, min_outcome_coverage: 0.8 },
  required_metrics: ['cost', 'latency', 'quality', 'task_success'],
  dataset_version: 'demo-synthetic-v1',
});

// ---- vNext Part 2B: Optimization Intelligence demo ------------------------------------
/**
 * SYNTHETIC DEMO — NOT CUSTOMER DATA.
 *
 * The Part 2A triage traces above plus a synthetic refund agent exported as
 * OpenInference spans (content is hashed by the ZevIR adapter; nothing raw is
 * stored). By construction the agent:
 *   - calls `lookup_order` twice with the same arguments and the same result;
 *   - in two runs repeats [lookup_order → plan] with identical inputs and
 *     outputs (a no-progress loop);
 *   - retrieves from `kb_search` twice per run with the same query, getting
 *     overlapping chunks, ten documents per call;
 *   - spends most of its time in the first retrieval (a latency hotspot).
 * Agent and retrieval changes are proposed but cannot be replayed by the
 * harness (they stay BLOCKED); the triage plans can.
 */
export const DEMO_V2_LABEL = 'SYNTHETIC DEMO — NOT CUSTOMER DATA';
export const DEMO_V2_NAME = `Support triage + refund agent (${DEMO_V2_LABEL})`;
export const DEMO_V2_ROOT = 'workload://demo-synthetic-optimization-intelligence';

export const DEMO_V2_REQUIREMENTS = Object.freeze({
  quality_floor: 0.95,
  min_task_success_rate: 0.95,
  latency: { require: true, max_p95_ms: null, max_regression_pct: 10 },
  protected: { require_cases: true, min_cases: 2 },
  cost: { require_evidence: true, min_coverage: 0.9, require_improvement: true, min_improvement_pct: 0 },
  evidence: { min_samples: 5, min_latency_samples: 20, min_outcome_coverage: 0.8 },
  reliability: { max_failure_rate: 0.05, max_retry_rate: null },
  required_metrics: ['cost', 'latency', 'protected', 'quality', 'reliability', 'task_success'],
  dataset_version: 'demo-synthetic-v2',
});

const hex = (n, width) => n.toString(16).padStart(width, '0');
const at = (base, ms) => new Date(base + ms).toISOString();

/** OpenInference span list for six synthetic refund-agent runs. Deterministic. */
export function demoAgentSpans() {
  const spans = [];
  for (let run = 0; run < 6; run += 1) {
    const traceId = `d2${hex(run + 1, 30)}`;
    const t0 = Date.UTC(2026, 8, 2, 10, 0, 0) + run * 3_600_000;
    let sid = 0;
    const span = (name, kind, start, end, attributes, parent) => {
      sid += 1;
      const id = `${hex(run + 1, 4)}${hex(sid, 12)}`;
      spans.push({ name, context: { trace_id: traceId, span_id: id }, parent_id: parent, span_kind: kind, start_time: at(t0, start), end_time: at(t0, end), status_code: 'OK', attributes: { openinference: { span: { kind } }, ...attributes } });
      return id;
    };
    const order = `ORDER-${1000 + (run % 3)}`;
    const docs = (offset) => ({ documents: Array.from({ length: 10 }, (_, i) => ({ document: { id: `kb-${(i + offset) % 14}`, score: Number((0.9 - i * 0.05).toFixed(2)), content: `DEMO SYNTHETIC chunk ${(i + offset) % 14}` } })) });
    const loop = run % 3 === 0;
    const end = loop ? 7600 : 5600;
    const agent = span('refund_agent', 'AGENT', 0, end, { agent: { name: 'refund_agent' }, input: { value: `DEMO SYNTHETIC refund request for ${order}` }, output: { value: 'DEMO SYNTHETIC decision' } }, null);
    span('kb_search', 'RETRIEVER', 50, 3050, { input: { value: 'DEMO SYNTHETIC refund policy' }, retrieval: docs(0) }, agent);
    span('lookup_order', 'TOOL', 3100, 3500, { tool: { name: 'lookup_order' }, input: { value: `{"order_id":"${order}"}` }, output: { value: `DEMO SYNTHETIC order ${order} delivered` } }, agent);
    span('gpt-4o', 'LLM', 3550, 4300, { llm: { model_name: 'gpt-4o', provider: 'openai', token_count: { prompt: 2100, completion: 40 } }, input: { value: `DEMO SYNTHETIC plan for ${order}` }, output: { value: 'DEMO SYNTHETIC next: verify order' } }, agent);
    let tAt = 4350;
    if (loop) {
      // No progress: the same tool call and the same plan step, with identical results.
      span('lookup_order', 'TOOL', tAt, tAt + 400, { tool: { name: 'lookup_order' }, input: { value: `{"order_id":"${order}"}` }, output: { value: `DEMO SYNTHETIC order ${order} delivered` } }, agent);
      span('gpt-4o', 'LLM', tAt + 450, tAt + 1200, { llm: { model_name: 'gpt-4o', provider: 'openai', token_count: { prompt: 2100, completion: 40 } }, input: { value: `DEMO SYNTHETIC plan for ${order}` }, output: { value: 'DEMO SYNTHETIC next: verify order' } }, agent);
      tAt += 1250;
    } else {
      span('lookup_order', 'TOOL', tAt, tAt + 400, { tool: { name: 'lookup_order' }, input: { value: `{"order_id":"${order}"}` }, output: { value: `DEMO SYNTHETIC order ${order} delivered` } }, agent);
      tAt += 450;
    }
    span('kb_search', 'RETRIEVER', tAt, tAt + 600, { input: { value: 'DEMO SYNTHETIC refund policy' }, retrieval: docs(4) }, agent);
    span('gpt-4o', 'LLM', tAt + 650, end - 50, { llm: { model_name: 'gpt-4o', provider: 'openai', token_count: { prompt: 3400, completion: 60 } }, input: { value: `DEMO SYNTHETIC final answer for ${order}` }, output: { value: 'DEMO SYNTHETIC approve' } }, agent);
  }
  return { spans };
}
