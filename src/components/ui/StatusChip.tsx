import { Check, CircleDashed, Minus, X, AlertTriangle, Loader2, Ban } from 'lucide-react';
import { cn } from '@/lib/cn';

export type Status =
  | 'observed'
  | 'open'
  | 'diagnosed'
  | 'candidate'
  | 'testing'
  | 'verifying'
  | 'verified'
  | 'passed'
  | 'rejected'
  | 'failed'
  | 'error'
  | 'needs_evidence'
  | 'dismissed'
  | 'running'
  | 'queued'
  | 'live'
  | 'idle'
  | 'stale'
  | 'waiting'
  | 'active'
  | 'revoked'
  | 'pending'
  | 'not_configured'
  | 'completed';

const STATES: Record<Status, { label: string; cls: string; Icon: typeof Check }> = {
  observed: { label: 'OBSERVED', cls: 'bg-line/60 text-muted', Icon: CircleDashed },
  open: { label: 'OPEN', cls: 'bg-accent-subtle text-accent-text', Icon: Minus },
  diagnosed: { label: 'DIAGNOSED', cls: 'bg-accent-subtle text-accent-text', Icon: Minus },
  candidate: { label: 'CANDIDATE', cls: 'bg-accent-subtle text-accent-text', Icon: CircleDashed },
  testing: { label: 'TESTING', cls: 'bg-accent-subtle text-accent-text', Icon: Loader2 },
  verifying: { label: 'VERIFYING', cls: 'bg-accent-subtle text-accent-text', Icon: Loader2 },
  running: { label: 'RUNNING', cls: 'bg-accent-subtle text-accent-text', Icon: Loader2 },
  queued: { label: 'QUEUED', cls: 'bg-line/60 text-muted', Icon: CircleDashed },
  verified: { label: 'VERIFIED', cls: 'bg-verified-bg text-verified', Icon: Check },
  passed: { label: 'VERIFIED', cls: 'bg-verified-bg text-verified', Icon: Check },
  completed: { label: 'COMPLETED', cls: 'bg-verified-bg text-verified', Icon: Check },
  rejected: { label: 'REJECTED', cls: 'bg-rejected-bg text-rejected', Icon: X },
  failed: { label: 'REJECTED', cls: 'bg-rejected-bg text-rejected', Icon: X },
  error: { label: 'ERROR', cls: 'bg-warning-bg text-warning', Icon: AlertTriangle },
  needs_evidence: { label: 'NEEDS EVIDENCE', cls: 'bg-warning-bg text-warning', Icon: AlertTriangle },
  dismissed: { label: 'DISMISSED', cls: 'bg-line/60 text-subtle', Icon: Ban },
  live: { label: 'LIVE', cls: 'bg-verified-bg text-verified', Icon: Check },
  idle: { label: 'IDLE', cls: 'bg-warning-bg text-warning', Icon: Minus },
  stale: { label: 'STALE', cls: 'bg-line/60 text-muted', Icon: CircleDashed },
  waiting: { label: 'WAITING', cls: 'bg-line/60 text-muted', Icon: CircleDashed },
  active: { label: 'ACTIVE', cls: 'bg-verified-bg text-verified', Icon: Check },
  revoked: { label: 'REVOKED', cls: 'bg-line/60 text-subtle', Icon: Ban },
  pending: { label: 'PENDING', cls: 'bg-warning-bg text-warning', Icon: CircleDashed },
  not_configured: { label: 'NOT CONFIGURED', cls: 'bg-warning-bg text-warning', Icon: Minus },
};

export function StatusChip({ status, label, className, size = 'sm' }: { status: Status | string; label?: string; className?: string; size?: 'sm' | 'md' }) {
  const s = STATES[(status as Status) in STATES ? (status as Status) : 'observed'];
  const Icon = s.Icon;
  const spin = status === 'testing' || status === 'running' || status === 'verifying';
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-sm font-mono leading-none tracking-wide', size === 'sm' ? 'text-technical px-2 py-1' : 'text-caption px-2.5 py-1.5', s.cls, className)}>
      <Icon size={size === 'sm' ? 11 : 13} strokeWidth={2.5} aria-hidden className={spin ? 'animate-spin' : undefined} />
      {label ?? s.label}
    </span>
  );
}

export function LiveDot({ status }: { status: 'live' | 'idle' | 'stale' | 'waiting' }) {
  return <span aria-hidden className={cn('inline-block h-2 w-2 rounded-full', status === 'live' ? 'bg-verified live-dot' : status === 'idle' ? 'bg-warning' : 'bg-line-strong')} />;
}
