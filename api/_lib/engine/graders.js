/**
 * Deterministic graders. Scores are in [0, 1]. No LLM judge.
 *
 * The grader is chosen from the shape of the baseline output so the same
 * rule applies to every case in an experiment:
 *   - JSON baseline  -> json_equivalence (canonical equality, else key/value overlap)
 *   - short label    -> classification (normalized exact match)
 *   - free text      -> token_similarity (Dice coefficient with a length guard)
 */

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

export function parseJsonish(text) {
  if (typeof text !== 'string') return undefined;
  let t = text.trim();
  if (!t) return undefined;
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  if (fence) t = fence[1].trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

function flatten(value, prefix = '', out = new Map()) {
  if (value === null || typeof value !== 'object') {
    out.set(prefix || '$', canonical(value));
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    if (!value.length) out.set(prefix, '[]');
    return out;
  }
  for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  if (!Object.keys(value).length) out.set(prefix || '$', '{}');
  return out;
}

export function normalizeText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(text) {
  return normalizeText(text).split(' ').filter(Boolean);
}

export function diceCoefficient(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length && !tb.length) return 1;
  if (!ta.length || !tb.length) return 0;
  const counts = new Map();
  for (const t of ta) counts.set(t, (counts.get(t) || 0) + 1);
  let overlap = 0;
  for (const t of tb) {
    const c = counts.get(t) || 0;
    if (c > 0) {
      overlap += 1;
      counts.set(t, c - 1);
    }
  }
  return (2 * overlap) / (ta.length + tb.length);
}

export function isShortLabel(text) {
  const t = normalizeText(text);
  return t.length > 0 && t.length <= 32 && tokens(t).length <= 4;
}

export function chooseGrader(baselineOutput) {
  if (parseJsonish(baselineOutput) !== undefined) return 'json_equivalence';
  if (isShortLabel(baselineOutput)) return 'classification';
  return 'token_similarity';
}

export function gradeJson(baseline, candidate) {
  const b = parseJsonish(baseline);
  const c = parseJsonish(candidate);
  if (b === undefined) return { score: 0, details: { error: 'baseline_not_json' } };
  if (c === undefined) return { score: 0, details: { error: 'candidate_not_json' } };
  if (canonical(b) === canonical(c)) return { score: 1, details: { mode: 'exact' } };
  const fb = flatten(b);
  const fc = flatten(c);
  const keys = new Set([...fb.keys(), ...fc.keys()]);
  let matched = 0;
  for (const k of keys) if (fb.has(k) && fc.has(k) && fb.get(k) === fc.get(k)) matched += 1;
  const score = keys.size ? matched / keys.size : 0;
  return { score: Number(score.toFixed(4)), details: { mode: 'field_overlap', fields: keys.size, matched } };
}

export function gradeClassification(baseline, candidate) {
  const b = normalizeText(baseline);
  const c = normalizeText(candidate);
  if (!b) return { score: 0, details: { error: 'baseline_empty' } };
  if (b === c) return { score: 1, details: { mode: 'exact' } };
  // A wrapped label ("Label: refund") still counts when the label itself is the only token match.
  const cTokens = tokens(c);
  if (cTokens.length <= 6 && cTokens.includes(b)) return { score: 1, details: { mode: 'contained' } };
  return { score: 0, details: { mode: 'mismatch', expected: b.slice(0, 40), got: c.slice(0, 40) } };
}

export function gradeSimilarity(baseline, candidate) {
  const dice = diceCoefficient(baseline, candidate);
  const lb = tokens(baseline).length || 1;
  const lc = tokens(candidate).length || 0;
  const ratio = Math.min(lb, lc) / Math.max(lb, lc || 1);
  // Penalize strongly truncated or runaway outputs even when vocabulary overlaps.
  const lengthGuard = ratio < 0.5 ? ratio / 0.5 : 1;
  const score = Math.max(0, Math.min(1, dice * lengthGuard));
  return { score: Number(score.toFixed(4)), details: { dice: Number(dice.toFixed(4)), length_ratio: Number(ratio.toFixed(3)) } };
}

export function grade(grader, baseline, candidate) {
  if (typeof candidate !== 'string' || !candidate.length) return { grader, score: 0, details: { error: 'candidate_missing' } };
  const result =
    grader === 'json_equivalence'
      ? gradeJson(baseline, candidate)
      : grader === 'classification'
        ? gradeClassification(baseline, candidate)
        : gradeSimilarity(baseline, candidate);
  return { grader, ...result };
}

export const GRADER_VERSION = 'graders_v1.0.0';
