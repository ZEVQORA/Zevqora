import { AlertTriangle, Ban, Beaker, Check, CircleDashed, Clock, Eye, FlaskConical, HelpCircle, LineChart, Sigma, Sparkles, TrendingUp, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Evidence states. Every number in ZEVQORA carries one of these, and they are
 * never colour-only: each has an icon and an uppercase word.
 */
export type Claim =
  | 'OBSERVED'
  | 'ESTIMATED'
  | 'CALIBRATED'
  | 'EVALUATED'
  | 'VERIFIED'
  | 'REJECTED'
  | 'INCOMPLETE'
  | 'PROJECTED'
  | 'REALIZED'
  | 'SIMULATED'
  | 'REPLAYED'
  | 'UNKNOWN'
  | 'NOT_YET_MEASURED'
  | 'SYNTHETIC';

const CLAIMS: Record<Claim, { label: string; cls: string; Icon: typeof Check; help: string }> = {
  OBSERVED: { label: 'OBSERVED', cls: 'bg-line/60 text-ink', Icon: Eye, help: 'Measured from recorded execution evidence.' },
  ESTIMATED: { label: 'ESTIMATED', cls: 'bg-sunken text-muted ring-1 ring-inset ring-line-strong', Icon: Sigma, help: 'A model of what might happen. Never a result.' },
  CALIBRATED: { label: 'CALIBRATED', cls: 'bg-accent-subtle text-accent-text', Icon: Beaker, help: 'Measured on a small sample. Not verified.' },
  EVALUATED: { label: 'EVALUATED', cls: 'bg-accent-subtle text-accent-text', Icon: FlaskConical, help: 'Replayed on the evaluation set under the frozen contract.' },
  REPLAYED: { label: 'REPLAYED', cls: 'bg-accent-subtle text-accent-text', Icon: FlaskConical, help: 'Measured during replay, not in production.' },
  VERIFIED: { label: 'VERIFIED', cls: 'bg-verified-bg text-verified', Icon: Check, help: 'Passed every gate of the frozen Evaluation Contract on replay. Not deployed.' },
  REJECTED: { label: 'REJECTED', cls: 'bg-rejected-bg text-rejected', Icon: X, help: 'Failed at least one gate of the frozen contract.' },
  INCOMPLETE: { label: 'INCOMPLETE', cls: 'bg-warning-bg text-warning', Icon: AlertTriangle, help: 'Evidence was missing, so no verdict either way.' },
  PROJECTED: { label: 'PROJECTED', cls: 'border border-dashed border-line-control bg-surface text-ink', Icon: TrendingUp, help: 'An evaluated change applied to observed volume. Not realized.' },
  REALIZED: { label: 'REALIZED', cls: 'bg-verified-bg text-verified', Icon: LineChart, help: 'Measured in production after shipping.' },
  SIMULATED: { label: 'SIMULATED', cls: 'bg-warning-bg text-warning', Icon: Sparkles, help: 'Produced by a simulation (for example Bad-Day Replay). Not a production guarantee.' },
  UNKNOWN: { label: 'UNKNOWN', cls: 'bg-sunken text-subtle', Icon: HelpCircle, help: 'Not recorded. Unknown is never treated as zero.' },
  NOT_YET_MEASURED: { label: 'NOT YET MEASURED', cls: 'bg-sunken text-muted ring-1 ring-inset ring-line-strong', Icon: Clock, help: 'ZEVQORA does not measure production results yet.' },
  SYNTHETIC: { label: 'SYNTHETIC DEMO', cls: 'bg-warning-bg text-warning', Icon: CircleDashed, help: 'Synthetic demo data — not customer data.' },
};

export function claimHelp(claim: Claim) {
  return CLAIMS[claim].help;
}

export function ClaimBadge({ claim, className, label, size = 'sm', title }: { claim: Claim; className?: string; label?: ReactNode; size?: 'xs' | 'sm'; title?: string }) {
  const c = CLAIMS[claim] || CLAIMS.UNKNOWN;
  const Icon = c.Icon;
  return (
    <span title={title ?? c.help} className={cn('inline-flex shrink-0 items-center gap-1 rounded-sm font-mono uppercase leading-none tracking-wide', size === 'xs' ? 'px-1.5 py-[3px] text-[10px]' : 'text-technical px-2 py-1', c.cls, className)}>
      <Icon size={size === 'xs' ? 10 : 11} strokeWidth={2.5} aria-hidden />
      {label ?? c.label}
    </span>
  );
}

/** A plan or evaluation verdict. */
export function VerdictBadge({ verdict, className, size }: { verdict: string | null | undefined; className?: string; size?: 'xs' | 'sm' }) {
  const v = String(verdict || '').toUpperCase();
  if (v === 'VERIFIED' || v === 'REJECTED' || v === 'INCOMPLETE') return <ClaimBadge claim={v} className={className} size={size} />;
  return <ClaimBadge claim="UNKNOWN" label="NO VERDICT" className={className} size={size} />;
}

/** "unknown", styled so it can never be read as a zero. */
export function Unknown({ reason, className }: { reason?: string; className?: string }) {
  return (
    <span title={reason || 'Not recorded. Unknown is never treated as zero.'} className={cn('inline-flex items-center gap-1 font-mono text-[0.85em] italic text-subtle', className)}>
      <Ban size={11} aria-hidden /> unknown
    </span>
  );
}
