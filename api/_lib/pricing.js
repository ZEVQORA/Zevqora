/**
 * Model pricing snapshot (public list prices; estimates only).
 *
 * Every estimated cost carries `cost_source = pricing_snapshot_estimate` and
 * the snapshot version so it is never confused with provider-reported cost.
 */
let cache = { at: 0, rows: null };
const TTL_MS = 5 * 60_000;

export async function loadPricing(admin) {
  if (cache.rows && Date.now() - cache.at < TTL_MS) return cache.rows;
  const { data } = await admin.from('model_pricing').select('*').eq('active', true);
  const rows = new Map();
  for (const row of data || []) rows.set(row.model, row);
  cache = { at: Date.now(), rows };
  return rows;
}

export function invalidatePricingCache() {
  cache = { at: 0, rows: null };
}

const PROVIDER_ALIASES = {
  openai: 'openai',
  azure: 'openai',
  'azure-openai': 'openai',
  anthropic: 'anthropic',
  google: 'google',
  gemini: 'google',
  vertex: 'google',
  'vertex-ai': 'google',
  openrouter: 'openrouter',
  mistral: 'mistralai',
  mistralai: 'mistralai',
  deepseek: 'deepseek',
  meta: 'meta-llama',
  'meta-llama': 'meta-llama',
  groq: 'groq',
  together: 'together',
};

/** Canonical `provider/model` key, with date and preview suffixes stripped. */
export function normalizeModel(provider, model) {
  let m = String(model || '').trim().toLowerCase();
  let p = String(provider || '').trim().toLowerCase();
  if (m.includes('/')) {
    const [maybeProvider, ...rest] = m.split('/');
    if (!p || p === 'openrouter') p = maybeProvider;
    m = rest.join('/');
  }
  p = PROVIDER_ALIASES[p] || p || 'unknown';
  m = m
    .replace(/-(\d{4}-\d{2}-\d{2}|\d{8}|\d{4})$/, '')
    .replace(/-(preview|latest)$/, '')
    .replace(/^claude-3-5-/, 'claude-3.5-')
    .replace(/^claude-3-7-/, 'claude-3.7-')
    .replace(/^claude-sonnet-4-.*/, 'claude-sonnet-4')
    .replace(/^claude-opus-4-.*/, 'claude-opus-4')
    .replace(/^gemini-2\.5-flash-lite.*/, 'gemini-2.5-flash-lite')
    .replace(/^gemini-2\.5-flash.*/, (s) => (s.includes('lite') ? 'gemini-2.5-flash-lite' : 'gemini-2.5-flash'))
    .replace(/^gemini-2\.5-pro.*/, 'gemini-2.5-pro')
    .replace(/^gpt-4o-mini.*/, 'gpt-4o-mini')
    .replace(/^gpt-4o(?!-mini).*/, 'gpt-4o')
    .replace(/^gpt-4\.1-mini.*/, 'gpt-4.1-mini')
    .replace(/^gpt-4\.1-nano.*/, 'gpt-4.1-nano')
    .replace(/^gpt-4\.1(?!-mini|-nano).*/, 'gpt-4.1');
  if (p === 'unknown') {
    if (/^(gpt|o[1-9]|text-embedding|chatgpt)/.test(m)) p = 'openai';
    else if (/^claude/.test(m)) p = 'anthropic';
    else if (/^gemini/.test(m)) p = 'google';
    else if (/^mistral|^mixtral|^codestral/.test(m)) p = 'mistralai';
    else if (/^deepseek/.test(m)) p = 'deepseek';
    else if (/^llama/.test(m)) p = 'meta-llama';
  }
  return { provider: p, model: m, key: `${p}/${m}` };
}

export function priceFor(pricing, key) {
  return pricing?.get(key) || null;
}

export function estimateCost(pricing, key, { input = 0, output = 0, cached = 0 } = {}) {
  const row = priceFor(pricing, key);
  if (!row) return null;
  const cachedRate = row.cached_input_per_million ?? row.input_per_million;
  const billableInput = Math.max(0, (input || 0) - (cached || 0));
  const cost =
    (billableInput * Number(row.input_per_million)) / 1e6 +
    ((cached || 0) * Number(cachedRate)) / 1e6 +
    ((output || 0) * Number(row.output_per_million)) / 1e6;
  return { cost: Number(cost.toFixed(8)), source: 'pricing_snapshot_estimate', version: `model_pricing@${row.retrieved_at?.slice?.(0, 10) || 'snapshot'}` };
}

export function tierOf(pricing, key) {
  const row = priceFor(pricing, key);
  if (row) return row.tier;
  const m = key.split('/')[1] || key;
  if (/gpt-4o-mini|gpt-4\.1-mini|gpt-4\.1-nano|haiku|flash-lite|flash|mini|small|nano|8b|3b|1b/.test(m)) return 'small';
  if (/gpt-4o|gpt-4\.1|gpt-4|o1|o3|sonnet|opus|gemini-2\.5-pro|pro|70b|405b/.test(m)) return 'frontier';
  if (/embedding/.test(m)) return 'embedding';
  return 'standard';
}

const PREFERRED_CANDIDATE = {
  'openai/gpt-4o': 'openai/gpt-4o-mini',
  'openai/gpt-4.1': 'openai/gpt-4.1-mini',
  'openai/gpt-4.1-mini': 'openai/gpt-4.1-nano',
  'openai/o3-mini': 'openai/gpt-4.1-mini',
  'anthropic/claude-sonnet-4': 'anthropic/claude-3.5-haiku',
  'anthropic/claude-3.5-sonnet': 'anthropic/claude-3.5-haiku',
  'anthropic/claude-3.7-sonnet': 'anthropic/claude-3.5-haiku',
  'anthropic/claude-opus-4': 'anthropic/claude-sonnet-4',
  'google/gemini-2.5-pro': 'google/gemini-2.5-flash',
  'google/gemini-2.5-flash': 'google/gemini-2.5-flash-lite',
};

/** A cheaper candidate in the same provider family, or the cheapest small model overall. */
export function cheaperCandidateFor(pricing, key) {
  const preferred = PREFERRED_CANDIDATE[key];
  if (preferred && pricing.has(preferred)) return preferred;
  const current = priceFor(pricing, key);
  const provider = key.split('/')[0];
  let best = null;
  for (const row of pricing.values()) {
    if (row.tier === 'embedding' || row.model === key) continue;
    if (row.provider !== provider) continue;
    if (current && Number(row.output_per_million) >= Number(current.output_per_million)) continue;
    if (!best || Number(row.output_per_million) < Number(best.output_per_million)) best = row;
  }
  return best?.model || null;
}

export function priceRatio(pricing, fromKey, toKey, { input = 1, output = 1 } = {}) {
  const a = priceFor(pricing, fromKey);
  const b = priceFor(pricing, toKey);
  if (!a || !b) return null;
  const from = input * Number(a.input_per_million) + output * Number(a.output_per_million);
  const to = input * Number(b.input_per_million) + output * Number(b.output_per_million);
  if (!from) return null;
  return to / from;
}
