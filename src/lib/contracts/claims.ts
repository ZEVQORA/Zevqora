/** Display-only contract. Backend payloads must be mapped, never overridden. */
export type EvidenceClaim = 'OBSERVED' | 'EVALUATED' | 'PROJECTED' | 'REALIZED' | 'SYNTHETIC' | 'INTERNAL' | 'UNKNOWN';
export type Verdict = 'VERIFIED' | 'REJECTED' | 'INCOMPLETE';
export type CapabilityAvailability =
  | 'available' | 'setup_required' | 'flag_disabled' | 'plan_restricted'
  | 'not_connected' | 'not_implemented' | 'error';

export interface EvidenceMetric {
  value: number | null;
  unit: 'USD' | 'USD_PER_SUCCESS' | 'MS' | 'PERCENT' | 'COUNT';
  claim: EvidenceClaim;
  sourceId: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  sampleCount: number | null;
  coverage: number | null;
  lowerBound?: number | null;
  upperBound?: number | null;
  note?: string;
}
export interface FeatureCapability {
  key: string;
  availability: CapabilityAvailability;
  configured: boolean;
  reason?: string;
  documentationUrl?: string;
}
export interface DecisionCard {
  id: string;
  title: string;
  verdict: Verdict | null;
  evidenceSource: string | null;
  sourceUrl?: string | null;
  risk: 'low' | 'moderate' | 'high' | 'unknown';
  nextAction: string;
  requiredRole: 'viewer' | 'member' | 'admin';
  status: 'needs_evidence' | 'ready_for_review' | 'blocked' | 'completed';
}

/** A missing reading must NEVER become a valid zero or a realized claim. */
export function metricLabel(metric: EvidenceMetric): string {
  if (metric.value === null || !Number.isFinite(metric.value)) return 'Unknown';
  if (metric.unit === 'USD' || metric.unit === 'USD_PER_SUCCESS') return `$${metric.value.toFixed(2)}`;
  if (metric.unit === 'MS') return `${Math.round(metric.value)} ms`;
  if (metric.unit === 'PERCENT') return `${metric.value.toFixed(1)}%`;
  return metric.value.toLocaleString();
}
export function isVerifiableVerdict(value: unknown): value is Verdict {
  return value === 'VERIFIED' || value === 'REJECTED' || value === 'INCOMPLETE';
}
