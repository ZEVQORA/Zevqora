/**
 * Read-only source scanner — the same detection the desktop engine performs,
 * written once in plain JavaScript so the browser can run it locally over a
 * folder the user picks (source never leaves the machine) and the server can
 * validate what it receives. No filesystem access here: callers feed paths and
 * text.
 */
export const SAFE_EXTENSIONS = ['.py', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
export const SKIP_DIRS = ['.git', 'node_modules', '.venv', 'venv', 'dist', 'build', '.next', '.cache', '.zevqora', 'coverage'];
export const FORBIDDEN_NAME_PARTS = ['.env', 'secret', 'private', 'credential', 'token', 'production', 'backup', 'dump', 'keystore', 'service-account'];
export const FORBIDDEN_EXACT_SUFFIXES = ['.pem', '.key', '.p12', '.pfx', '.jks'];
export const MAX_SOURCE_FILE_BYTES = 1_000_000;

const PROVIDER_PATTERNS = [
  ['openrouter', /openrouter|OPENROUTER_API_KEY/i],
  ['openai', /\bOpenAI\b|from\s+openai|import\s+openai|\.responses\.create|chat\.completions\.create/i],
  ['anthropic', /\bAnthropic\b|from\s+anthropic|import\s+anthropic|messages\.create/i],
  ['gemini', /google\.genai|google\.generativeai|GenerativeModel|generate_content/i],
  ['vercel-ai-sdk', /from\s+['"]ai['"]|generateText\(|streamText\(|generateObject\(/i],
  ['litellm', /\blitellm\b|completion\(/i],
  ['langchain', /\blangchain\b|ChatOpenAI|ChatAnthropic/i],
];

const SECRET_LIKE_PATTERNS = [
  /(api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\s*[:=]\s*(["'])([^"'\n]{6,})\2/i,
  /\bsk-[A-Za-z0-9_-]{12,}\b/,
  /\bAIza[A-Za-z0-9_-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
];

const CALL_HINT = /responses\.create|completions\.create|messages\.create|generate_content|generateText\(|streamText\(|generateObject\(|\bcompletion\(|\.invoke\(|\.ainvoke\(/i;

const FUNCTION_PATTERNS = [
  /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/,
  /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/,
];

export function containsSecretLikeValue(text) {
  return SECRET_LIKE_PATTERNS.some((p) => p.test(text));
}

export function redactSecretLikeValues(text) {
  let out = text.replace(SECRET_LIKE_PATTERNS[0], (_m, key, quote) => `${key}=${quote}****${quote}`);
  out = out.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, 'sk-****');
  out = out.replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, 'AIza****');
  out = out.replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, 'gh_****');
  return out;
}

export function isForbiddenName(name) {
  const lowered = String(name).toLowerCase();
  if (FORBIDDEN_EXACT_SUFFIXES.some((s) => lowered.endsWith(s))) return true;
  return FORBIDDEN_NAME_PARTS.some((part) => lowered.includes(part));
}

function extensionOf(path) {
  const base = path.split('/').pop() || '';
  const idx = base.lastIndexOf('.');
  return idx >= 0 ? base.slice(idx).toLowerCase() : '';
}

/**
 * Classify a repository-relative path. `skipped_sensitive` counts files that
 * look like source but live under skipped folders or carry secret-like names.
 */
export function classifyPath(relPath) {
  const normalized = String(relPath).replace(/\\/g, '/');
  const parts = normalized.split('/');
  const name = parts[parts.length - 1] || '';
  const ext = extensionOf(normalized);
  const sourceExt = SAFE_EXTENSIONS.includes(ext);
  const inSkipDir = parts.slice(0, -1).some((p) => SKIP_DIRS.includes(p.toLowerCase()));
  if (!sourceExt) return 'ignore';
  if (inSkipDir || isForbiddenName(name)) return 'skipped_sensitive';
  return 'source';
}

function findSymbol(line, current) {
  for (const pattern of FUNCTION_PATTERNS) {
    const m = pattern.exec(line);
    if (m) return m[1];
  }
  return current;
}

function providerFor(text) {
  for (const [provider, pattern] of PROVIDER_PATTERNS) if (pattern.test(text)) return provider;
  return null;
}

export function classifyFinding(context, provider) {
  const low = context.toLowerCase();
  if (['retry', 'fallback', 'backoff'].some((w) => low.includes(w))) {
    return { category: 'reliability_retries', title: 'Repeated AI execution may be happening on retry/fallback paths', root_cause: 'This call sits near retry or fallback logic. Runtime traces are required to prove whether duplicate paid work is occurring.', confidence: 0.7, risk: 'medium' };
  }
  if (['classify', 'classification', 'intent', 'label'].some((w) => low.includes(w))) {
    return { category: 'structured_task_candidate', title: 'This AI call looks like a bounded classification task', root_cause: 'Bounded tasks can sometimes use a cheaper execution strategy, but ZEVQORA will not call it a saving until replay and quality gates pass.', confidence: 0.68, risk: 'medium' };
  }
  if (['extract', 'json', 'schema', 'structured'].some((w) => low.includes(w))) {
    return { category: 'structured_output_candidate', title: 'This call appears to produce structured output', root_cause: 'Structured workloads often have deterministic quality checks. Import representative traces so ZEVQORA can test cheaper candidates safely.', confidence: 0.64, risk: 'medium' };
  }
  if (['system_prompt', 'system prompt', 'context', 'documents', 'retrieval', 'rag'].some((w) => low.includes(w))) {
    return { category: 'context_review', title: 'This AI call may carry repeated or large context', root_cause: 'Static inspection cannot quantify context waste. Runtime token and task evidence is needed before proposing an optimization.', confidence: 0.56, risk: 'medium' };
  }
  return { category: 'needs_evidence', title: `AI execution path detected (${provider})`, root_cause: 'ZEVQORA found an AI execution path. Connect runtime evidence to attribute cost and decide whether any optimization is safe.', confidence: 0.5, risk: 'medium' };
}

/**
 * Scan one file's text. Returns detected call sites, the findings they imply
 * and the providers seen anywhere in the file.
 */
export function scanText(relPath, text) {
  const file = String(relPath).replace(/\\/g, '/');
  const lines = String(text).split(/\r?\n/);
  const calls = [];
  const findings = [];
  const stack = new Set();
  let current = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    current = findSymbol(line, current);
    const provider = providerFor(line);
    if (provider) stack.add(provider);
    if (!provider || !CALL_HINT.test(line)) continue;
    const lineNo = i + 1;
    calls.push({ file_path: file, line: lineNo, provider, symbol: current, excerpt: redactSecretLikeValues(line.trim()).slice(0, 500) });
    const context = lines.slice(Math.max(0, lineNo - 5), Math.min(lines.length, lineNo + 4)).join('\n');
    findings.push({ ...classifyFinding(context, provider), origin: 'static_scan', file_path: file, line: lineNo, symbol: current, evidence_status: 'needs_evidence' });
  }
  return { calls, findings, stack: [...stack].sort() };
}

/**
 * Scan a set of files ({path, text}). Callers pre-filter with classifyPath and
 * pass the count of skipped sensitive paths they saw.
 */
export function scanFiles(files) {
  const calls = [];
  const findings = [];
  const stack = new Set();
  let scanned = 0;
  for (const f of files) {
    if (classifyPath(f.path) !== 'source') continue;
    if (typeof f.text !== 'string' || f.text.length > MAX_SOURCE_FILE_BYTES) continue;
    scanned += 1;
    const r = scanText(f.path, f.text);
    calls.push(...r.calls);
    findings.push(...r.findings);
    for (const p of r.stack) stack.add(p);
  }
  return { files_scanned: scanned, ai_calls: calls, findings, detected_stack: [...stack].sort() };
}
