/**
 * Execution traces: JSONL import, normalization and evidence-derived signals.
 * Mirrors the desktop engine so the same file imports identically on the web.
 */
import { ApiError } from '../http.js';
import { sha256Text } from './hashing.js';

const MAX_TEXT = 50_000;
const COST_SOURCES = new Set(['provider_reported', 'pricing_snapshot_estimate', 'imported_external']);

function optNumber(value, name, { min = 0, integer = false } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) throw new Error(`${name} must be a ${integer ? 'non-negative integer' : 'non-negative number'}.`);
  return n;
}

function optText(value, name) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`${name} must be a string.`);
  return value.length > MAX_TEXT ? value.slice(0, MAX_TEXT) : value;
}

const PROMPT_ROLES = new Set(['system', 'developer', 'user', 'assistant', 'tool']);
const MAX_PROMPT_MESSAGES = 60;

/**
 * The request that produced the baseline output. Without it a replay cannot
 * reproduce the task: the candidate would be asked a different, under-specified
 * question and would be graded for the wrong reason. Accepts the OpenAI-shaped
 * `messages` array, or a `system_prompt` alongside `input_text`.
 */
function optMessages(raw, name) {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) throw new Error(`${name} must be an array of {role, content} objects.`);
  const out = [];
  for (const item of raw.slice(0, MAX_PROMPT_MESSAGES)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${name} entries must be objects.`);
    const role = typeof item.role === 'string' ? item.role.trim().toLowerCase() : '';
    if (!PROMPT_ROLES.has(role)) throw new Error(`${name} entries need a role of ${[...PROMPT_ROLES].join(', ')}.`);
    // Content parts (multimodal) are flattened to their text; anything else is refused
    // rather than silently replayed as an empty turn.
    let content = item.content;
    if (Array.isArray(content)) content = content.map((part) => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '')).join('');
    if (typeof content !== 'string') throw new Error(`${name} entries need string content.`);
    out.push({ role, content: content.length > MAX_TEXT ? content.slice(0, MAX_TEXT) : content });
  }
  return out.length ? out : null;
}

/** The user-visible task text, for traces that carry messages but no input_text. */
function lastUserContent(messages) {
  if (!messages) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) if (messages[i].role === 'user') return messages[i].content;
  return null;
}

/** Validate one raw JSON row into a normalized trace ready to store. */
export function normalizeTrace(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Each trace must be a JSON object.');
  const requestId = typeof raw.request_id === 'string' ? raw.request_id.trim() : '';
  if (!requestId) throw new Error('request_id is required.');
  const meta = raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata) ? { ...raw.metadata } : {};
  const explicitSource = meta.cost_source;
  delete meta.cost_source;
  const pricingVersion = typeof meta.pricing_version === 'string' ? meta.pricing_version : null;
  delete meta.pricing_version;
  const costUsd = optNumber(raw.cost_usd, 'cost_usd');
  let costSource = null;
  if (typeof explicitSource === 'string' && COST_SOURCES.has(explicitSource)) costSource = explicitSource;
  else if (costUsd !== null) costSource = 'imported_external';
  const messages = optMessages(raw.messages ?? meta.messages ?? null, 'messages');
  delete meta.messages;
  const systemPrompt = optText(raw.system_prompt ?? meta.system_prompt ?? null, 'system_prompt') || (messages ? messages.filter((m) => m.role === 'system' || m.role === 'developer').map((m) => m.content).join('\n\n') || null : null);
  const inputText = optText(raw.input_text, 'input_text') ?? lastUserContent(messages);
  const outputText = optText(raw.output_text, 'output_text');
  const model = typeof raw.model === 'string' ? raw.model.slice(0, 160) : null;
  let timestamp = null;
  if (raw.timestamp) {
    const d = new Date(raw.timestamp);
    if (!Number.isNaN(d.getTime())) timestamp = d.toISOString();
  }
  return {
    request_id: requestId.slice(0, 200),
    timestamp,
    symbol: typeof raw.symbol === 'string' ? raw.symbol.slice(0, 300) : null,
    workflow: typeof raw.workflow === 'string' ? raw.workflow.slice(0, 300) : null,
    provider: typeof raw.provider === 'string' ? raw.provider.slice(0, 80) : null,
    model: model || (typeof meta.requested_model === 'string' ? meta.requested_model : null),
    requested_model: (typeof meta.requested_model === 'string' ? meta.requested_model : null) || model,
    response_model: (typeof meta.response_model === 'string' ? meta.response_model : null) || model,
    provider_request_id: typeof meta.provider_request_id === 'string' ? meta.provider_request_id.slice(0, 200) : null,
    input_text: inputText,
    output_text: outputText,
    // The prompt that produced output_text. Replays reuse it verbatim.
    system_prompt: systemPrompt,
    messages,
    system_prompt_hash: sha256Text(systemPrompt),
    expected_output: optText(raw.expected_output, 'expected_output'),
    candidate_output: optText(raw.candidate_output, 'candidate_output'),
    input_tokens: optNumber(raw.input_tokens, 'input_tokens', { integer: true }),
    output_tokens: optNumber(raw.output_tokens, 'output_tokens', { integer: true }),
    cached_input_tokens: optNumber(meta.cached_input_tokens, 'cached_input_tokens', { integer: true }),
    reasoning_tokens: optNumber(meta.reasoning_tokens, 'reasoning_tokens', { integer: true }),
    latency_ms: optNumber(raw.latency_ms, 'latency_ms'),
    ttft_ms: optNumber(meta.ttft_ms, 'ttft_ms'),
    candidate_latency_ms: optNumber(raw.candidate_latency_ms, 'candidate_latency_ms'),
    cost_usd: costUsd,
    cost_source: costSource,
    pricing_version: pricingVersion,
    candidate_cost_usd: optNumber(raw.candidate_cost_usd, 'candidate_cost_usd'),
    attempt: optNumber(meta.attempt, 'attempt', { integer: true }),
    retry_reason: typeof meta.retry_reason === 'string' ? meta.retry_reason.slice(0, 200) : null,
    input_hash: sha256Text(inputText),
    output_hash: sha256Text(outputText),
    protected: Boolean(raw.protected),
    metadata: Object.fromEntries(Object.entries(meta).filter(([k]) => !['requested_model', 'response_model', 'provider_request_id', 'cached_input_tokens', 'reasoning_tokens', 'ttft_ms', 'attempt', 'retry_reason', 'system_prompt'].includes(k))),
  };
}

/** Parse a JSONL (or JSON array) payload into normalized traces plus per-row errors. */
export function parseTraces({ jsonl, traces }) {
  const rows = [];
  const errors = [];
  const push = (raw, label) => {
    try {
      rows.push(normalizeTrace(raw));
    } catch (error) {
      errors.push(`${label}: ${error.message}`);
    }
  };
  if (Array.isArray(traces)) traces.forEach((raw, i) => push(raw, `traces[${i}]`));
  if (typeof jsonl === 'string' && jsonl.trim()) {
    const trimmed = jsonl.trim();
    if (trimmed.startsWith('[')) {
      try {
        const arr = JSON.parse(trimmed);
        if (!Array.isArray(arr)) throw new Error('not an array');
        arr.forEach((raw, i) => push(raw, `row ${i + 1}`));
      } catch (error) {
        errors.push(`JSON array could not be parsed: ${error.message}`);
      }
    } else {
      trimmed.split(/\r?\n/).forEach((line, i) => {
        const l = line.trim();
        if (!l) return;
        try {
          push(JSON.parse(l), `line ${i + 1}`);
        } catch {
          errors.push(`line ${i + 1}: invalid JSON`);
        }
      });
    }
  }
  if (!rows.length && !errors.length) throw new ApiError(400, 'No traces were supplied.', 'VALIDATION');
  return { rows, errors };
}

function key(text) {
  if (!text || !String(text).trim()) return null;
  return sha256Text(String(text).split(/\s+/).join(' ').trim().toLowerCase());
}

/**
 * Evidence-derived *signals* (never verified savings): repeated executions and
 * cost concentration. Same thresholds as the desktop engine.
 */
export function diagnoseRuntimeEvidence(traces) {
  const findings = [];
  const groups = new Map();
  for (const t of traces) {
    const h = key(t.input_text);
    if (!h) continue;
    const g = `${t.symbol || t.workflow || 'unknown'} ${h}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(t);
  }
  for (const [g, rows] of groups) {
    if (rows.length < 3) continue;
    const symbol = g.split(' ')[0];
    const costs = rows.filter((r) => r.cost_usd !== null && r.cost_usd !== undefined).map((r) => Number(r.cost_usd));
    const observed = costs.length ? costs.reduce((a, b) => a + b, 0) : null;
    findings.push({
      origin: 'runtime_evidence',
      category: 'repeated_execution',
      title: `Repeated execution observed ${rows.length} times in ${symbol}`,
      root_cause: `The same normalized input was paid for ${rows.length} times in the imported evidence${observed !== null ? `, representing $${observed.toFixed(6)} of observed baseline cost.` : '.'} This is an observed signal, not yet a verified cache/reuse saving.`,
      file_path: 'runtime evidence',
      line: 0,
      symbol: symbol === 'unknown' ? null : symbol,
      confidence: 0.92,
      risk: 'medium',
      evidence_status: 'observed',
    });
  }
  const costRows = traces.filter((t) => t.cost_usd !== null && t.cost_usd !== undefined);
  const total = costRows.reduce((a, r) => a + Number(r.cost_usd), 0);
  if (total > 0) {
    const byWorkflow = new Map();
    for (const r of costRows) {
      const w = r.workflow || r.symbol || 'unattributed';
      if (!byWorkflow.has(w)) byWorkflow.set(w, []);
      byWorkflow.get(w).push(r);
    }
    for (const [workflow, rows] of byWorkflow) {
      if (rows.length < 5) continue;
      const groupCost = rows.reduce((a, r) => a + Number(r.cost_usd), 0);
      const share = groupCost / total;
      if (share < 0.4) continue;
      findings.push({
        origin: 'runtime_evidence',
        category: 'cost_concentration',
        title: `${workflow} drives ${(share * 100).toFixed(1)}% of observed AI cost`,
        root_cause: `This workload accounts for $${groupCost.toFixed(6)} of $${total.toFixed(6)} in the imported evidence. Cost concentration is a prioritization signal, not proof that the workload is wasteful.`,
        file_path: 'runtime evidence',
        line: 0,
        symbol: workflow === 'unattributed' ? null : workflow,
        confidence: 0.88,
        risk: 'low',
        evidence_status: 'observed',
      });
    }
  }
  return findings;
}

const STALE_AFTER_DAYS = 30;
const known = (v) => v !== null && v !== undefined && v !== '';

function tally(rows, key) {
  const out = {};
  for (const r of rows) {
    const k = key(r);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/**
 * Where every baseline number comes from, and what is missing. A total over
 * only the priced traces is a lower bound, so coverage travels with it and
 * the gaps are named instead of silently treated as zero.
 */
export function baselineProvenance(traces, now = Date.now()) {
  const n = traces.length;
  const priced = traces.filter((t) => known(t.cost_usd));
  const timed = traces.filter((t) => known(t.latency_ms));
  const withTokens = traces.filter((t) => known(t.input_tokens) && known(t.output_tokens));
  const withExpected = traces.filter((t) => known(t.expected_output));
  const withPrompt = traces.filter((t) => (Array.isArray(t.messages) && t.messages.length) || known(t.system_prompt));
  const latest = traces.map((t) => t.timestamp).filter(Boolean).sort().pop() || null;
  const ageDays = latest ? (now - Date.parse(latest)) / 86_400_000 : null;
  const stale = ageDays !== null && Number.isFinite(ageDays) && ageDays > STALE_AFTER_DAYS;
  const gaps = [];
  if (!n) gaps.push('no_traces: import execution traces to establish a baseline');
  else {
    if (priced.length < n) gaps.push(`cost_unknown: ${n - priced.length} of ${n} traces have no cost; the cost total is a lower bound`);
    if (timed.length < n) gaps.push(`latency_unknown: ${n - timed.length} of ${n} traces have no latency`);
    if (withExpected.length < n) gaps.push(`no_expected_output: ${n - withExpected.length} of ${n} traces cannot be graded against an expected answer`);
    if (withPrompt.length < n) gaps.push(`input_only: ${n - withPrompt.length} of ${n} traces carry no recorded prompt; a replay cannot ask the same question`);
    if (!traces.some((t) => t.protected)) gaps.push('no_protected_cases: no case is marked protected, so the protected gate cannot assert anything');
    if (stale) gaps.push(`stale: newest trace is ${Math.floor(ageDays)} days old`);
  }
  return {
    trace_count: n,
    cost: { known: priced.length, unknown: n - priced.length, complete: n > 0 && priced.length === n, sources: tally(priced, (t) => t.cost_source || 'unlabelled') },
    latency: { known: timed.length, unknown: n - timed.length },
    tokens: {
      known: withTokens.length,
      input: withTokens.length ? withTokens.reduce((a, t) => a + Number(t.input_tokens), 0) : null,
      output: withTokens.length ? withTokens.reduce((a, t) => a + Number(t.output_tokens), 0) : null,
    },
    models: tally(traces, (t) => t.model || 'unknown'),
    workflows: tally(traces, (t) => t.workflow || t.symbol || 'unattributed'),
    evaluation_coverage: { with_expected_output: withExpected.length, with_recorded_prompt: withPrompt.length, protected: traces.filter((t) => t.protected).length },
    stale,
    stale_after_days: STALE_AFTER_DAYS,
    gaps,
  };
}

export function economics(traces, verifiedEvaluations) {
  const costs = traces.filter((t) => t.cost_usd !== null && t.cost_usd !== undefined).map((t) => Number(t.cost_usd));
  const lats = traces.filter((t) => t.latency_ms !== null && t.latency_ms !== undefined).map((t) => Number(t.latency_ms));
  const stamps = traces.map((t) => t.timestamp).filter(Boolean).sort();
  const providers = {};
  for (const t of traces) providers[t.provider || 'unknown'] = (providers[t.provider || 'unknown'] || 0) + 1;
  const savings = verifiedEvaluations.reduce((a, e) => a + Math.max(0, -(Number(e.raw_cost_delta_usd) || 0)), 0);
  return {
    trace_count: traces.length,
    observed_cost_usd: costs.length ? Number(costs.reduce((a, b) => a + b, 0).toFixed(8)) : null,
    avg_cost_per_trace_usd: costs.length ? Number((costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(8)) : null,
    avg_latency_ms: lats.length ? Number((lats.reduce((a, b) => a + b, 0) / lats.length).toFixed(2)) : null,
    first_evidence_at: stamps[0] || null,
    latest_evidence_at: stamps[stamps.length - 1] || null,
    providers,
    verified_savings_usd: Number(savings.toFixed(8)),
    verified_experiments: verifiedEvaluations.length,
    baseline: baselineProvenance(traces),
    note: traces.length
      ? 'Observed values come only from imported execution evidence. Imported costs are imported_external provenance, not provider-verified. No monthly projection is fabricated.'
      : 'No runtime evidence imported yet. Static findings are not Verified Savings.',
  };
}
