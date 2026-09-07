export { money, num, compactNum, pct, ms, relativeTime, dateTime, shortId, titleCase } from '@/lib/format';
import { pct } from '@/lib/format';

/** 0..1 quality score rendered as a ratio, the way the gate compares it. */
export function score(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return Number(value).toFixed(digits);
}

export const STRATEGY_LABEL: Record<string, string> = {
  exact_reuse: 'Exact reuse (cache)',
  model_substitution: 'Model substitution',
  bounded_routing: 'Bounded routing',
  context_reduction: 'Context reduction',
  retry_policy: 'Retry policy',
};

export const STRATEGY_HINT: Record<string, string> = {
  exact_reuse: 'Identical requests are answered from the first response. Deterministic; no model call.',
  model_substitution: 'The same task is replayed on a cheaper candidate model and graded against expected outputs.',
  bounded_routing: 'Easy cases go to a cheaper model behind a guard; hard cases keep the baseline.',
};

export interface CostComparison {
  raw_cost_delta_percent: number | null;
  baseline_cost_usd: number | null;
  candidate_cost_usd: number | null;
}

/**
 * Measured cost comparison as prose. The engine reports raw_cost_delta_percent
 * as a reduction relative to the baseline (positive = candidate cheaper).
 * No baseline cost or a zero baseline → "—"; a candidate measured at exactly
 * $0 → "100% lower cost" (with the reason when known); otherwise the precise
 * measured reduction or increase.
 */
export function costDeltaLabel(cmp: CostComparison | null | undefined, { digits = 1, zeroReason }: { digits?: number; zeroReason?: string } = {}) {
  if (!cmp) return '—';
  const base = cmp.baseline_cost_usd;
  const cand = cmp.candidate_cost_usd;
  const reduction = cmp.raw_cost_delta_percent;
  if (base === null || base === undefined || !Number.isFinite(Number(base)) || Number(base) <= 0) return '—';
  if (reduction === null || reduction === undefined || !Number.isFinite(Number(reduction))) return '—';
  if (cand !== null && cand !== undefined && Number(cand) === 0) return `100% lower cost${zeroReason ? ` (${zeroReason})` : ''}`;
  const v = Number(reduction);
  if (Math.abs(v) < 0.005) return 'same cost';
  if (v > 0) return `${pct(v, digits)} lower cost`;
  return `${pct(-v, digits)} higher cost`;
}

export function zeroCostReason(costSource: string | null | undefined) {
  if (costSource === 'deterministic_reuse' || costSource === 'deterministic_no_provider') return 'no provider call';
  if (costSource === 'provider_reported') return 'provider reported $0';
  return undefined;
}

export function observedLabel(value: unknown) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return Number(value).toFixed(4).replace(/\.?0+$/, '');
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function sourceLabel(finding: { file_path: string; line: number; symbol: string | null }) {
  if (finding.file_path === 'runtime evidence') return finding.symbol ? `Runtime evidence · ${finding.symbol}` : 'Runtime evidence';
  return `${finding.file_path}:${finding.line}${finding.symbol ? ` · ${finding.symbol}` : ''}`;
}
