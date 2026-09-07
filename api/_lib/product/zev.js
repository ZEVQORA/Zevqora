/**
 * Zev on the platform: the same tool-loop as the desktop agent, over the
 * workspace's engine records. Read-only tools; verification authority stays
 * with the deterministic gates.
 */
export const SYSTEM_PROMPT = `You are Zev, the conversational interface to ZEVQORA, an AI Cost Optimization Engineer for AI products.
Your job is to explain evidence, diagnose likely AI COGS waste, and help the user run controlled verification.

Hard rules:
- ZEVQORA is not a generic model router, gateway, cache product, or chatbot.
- Static code findings are potential signals only. Never call them Verified Savings.
- Only an evaluation whose deterministic gates returned status VERIFIED may be described as verified.
- If runtime/replay evidence is missing, say exactly what evidence is missing.
- Prefer workload, task success, quality, latency, retries, duplicate work, context/RAG/agent behavior, and cost-per-successful-task over model-price trivia.
- Never claim zero quality loss, guaranteed savings, or production safety without evidence.
- Source access is read-only through controlled tools. Do not ask for or expose secrets.
- Human approval is mandatory before risky implementation, merge, or deployment.
- Be concise, technical, and understandable to a founder or engineer.`;

const product = { type: 'object', properties: { product_id: { type: 'string' } }, required: ['product_id'] };

export const TOOL_DEFINITIONS = [
  { type: 'function', function: { name: 'workspace_summary', description: 'Get the connected product and scan status.', parameters: product } },
  { type: 'function', function: { name: 'list_ai_calls', description: 'List detected AI execution call sites from the latest scan.', parameters: product } },
  { type: 'function', function: { name: 'list_findings', description: 'List potential waste/optimization findings. Static findings are never automatically Verified Savings.', parameters: product } },
  { type: 'function', function: { name: 'economics_summary', description: 'Get observed cost and verified savings from imported evidence.', parameters: product } },
  { type: 'function', function: { name: 'list_experiments', description: 'List replay/evaluation runs and their gate verdicts.', parameters: product } },
];

/**
 * Executes one read-only tool. `ctx` provides async loaders bound to the
 * product the UI selected; model-supplied product ids are ignored.
 */
export async function executeTool(ctx, name) {
  if (name === 'workspace_summary') {
    const p = await ctx.product();
    return [JSON.stringify({ id: p.id, name: p.name, root_path: p.root_path, source: p.source, monitoring_enabled: p.monitoring_enabled, last_scan_at: p.last_scan_at, files_scanned: p.files_scanned, detected_stack: p.detected_stack }), `Workspace: ${p.name}`];
  }
  if (name === 'list_ai_calls') {
    const rows = await ctx.aiCalls();
    return [JSON.stringify(rows.slice(0, 80).map((r) => ({ file: r.file_path, line: r.line, provider: r.provider, symbol: r.symbol, excerpt: r.excerpt }))), `${rows.length} AI call sites returned.`];
  }
  if (name === 'list_findings') {
    const rows = await ctx.findings();
    return [JSON.stringify(rows.slice(0, 80).map((r) => ({ id: r.id, origin: r.origin, title: r.title, category: r.category, root_cause: r.root_cause, file: r.file_path, line: r.line, symbol: r.symbol, confidence: r.confidence, risk: r.risk, evidence_status: r.evidence_status }))), `${rows.length} potential findings returned.`];
  }
  if (name === 'economics_summary') {
    const e = await ctx.economics();
    return [JSON.stringify(e), 'Observed economics returned.'];
  }
  if (name === 'list_experiments') {
    const rows = await ctx.evaluations();
    return [JSON.stringify(rows.slice(0, 40).map((r) => ({ id: r.id, status: r.status, sample_count: r.sample_count, candidate_quality: r.candidate_quality, baseline_quality: r.baseline_quality, baseline_cost_usd: r.baseline_cost_usd, candidate_cost_usd: r.candidate_cost_usd, raw_cost_delta_percent: r.raw_cost_delta_percent, rejection_reason: r.rejection_reason, gates: (r.gates || []).map((g) => ({ name: g.name, outcome: g.outcome, required: g.required })) }))), `${rows.length} evaluations returned.`];
  }
  throw new Error(`Unknown tool: ${name}`);
}

/**
 * Tool loop. `complete` is the accounted platform call (payload → {content,
 * toolCalls, model}). Returns {message, model, tool_events}.
 */
export async function runZev({ complete, ctx, history, model, productId, maxSteps = 6 }) {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history.map((m) => ({ role: m.role, content: m.content }))];
  if (productId) messages.push({ role: 'system', content: `The currently selected ZEVQORA product_id is ${productId}. Use it for tools unless the user explicitly changes product.` });
  const events = [];
  let chosen = model;
  for (let step = 0; step < maxSteps; step += 1) {
    const res = await complete({ model: chosen, messages, tools: TOOL_DEFINITIONS, tool_choice: 'auto', temperature: 0.2, max_tokens: 900 });
    chosen = res.model || chosen;
    if (!res.toolCalls.length) return { message: res.content || 'I finished the analysis but received no text response.', model: chosen, tool_events: events };
    messages.push({ role: 'assistant', content: res.content, tool_calls: res.toolCalls });
    for (const call of res.toolCalls) {
      const name = call.function?.name || 'unknown';
      let result;
      try {
        const [payload, summary] = await executeTool(ctx, name);
        result = payload;
        events.push({ name, status: 'done', summary });
      } catch (error) {
        result = JSON.stringify({ error: String(error?.message || error) });
        events.push({ name, status: 'error', summary: String(error?.message || error) });
      }
      messages.push({ role: 'tool', content: result, name, tool_call_id: call.id || `call_${step}` });
    }
  }
  return { message: 'I reached the tool-step limit. Ask me to continue from the evidence already collected.', model: chosen, tool_events: events };
}
