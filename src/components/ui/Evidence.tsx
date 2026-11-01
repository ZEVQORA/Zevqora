import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Check, Copy, FileSearch, Lock } from 'lucide-react';
import { cn } from '@/lib/cn';
import { relativeTime, dateTime } from '@/lib/format';

/** A hash or id, shortened for reading and copied whole. */
export function CopyableHash({ value, label, chars = 10, className }: { value: string | null | undefined; label?: string; chars?: number; className?: string }) {
  const [done, setDone] = useState(false);
  if (!value) return <span className="font-mono text-[12px] text-subtle">—</span>;
  const short = value.length > chars + 2 ? `${value.slice(0, chars)}…` : value;
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1 align-middle', className)}>
      <code className="truncate rounded-xs bg-sunken px-1.5 py-0.5 font-mono text-[11.5px] text-ink" title={value}>
        {short}
      </code>
      <button
        type="button"
        aria-label={`Copy ${label || 'value'}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setDone(true);
            window.setTimeout(() => setDone(false), 1400);
          } catch {
            /* clipboard unavailable */
          }
        }}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-subtle transition-control hover:bg-ink/5 hover:text-ink"
      >
        {done ? <Check size={12} className="text-verified" aria-hidden /> : <Copy size={12} aria-hidden />}
      </button>
      <span aria-live="polite" className="sr-only">{done ? 'Copied' : ''}</span>
    </span>
  );
}

/** A link to the evidence behind a claim (graph node, snapshot, plan, evaluation). */
export function EvidenceLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={cn('inline-flex items-center gap-1 rounded-sm text-[12.5px] font-medium text-accent-text underline-offset-4 transition-control hover:underline', className)}>
      <FileSearch size={12} aria-hidden /> {children}
    </Link>
  );
}

export function ActivityItem({ icon, title, meta, at, children }: { icon?: ReactNode; title: ReactNode; meta?: ReactNode; at?: string | null; children?: ReactNode }) {
  return (
    <li className="flex gap-3 py-2.5">
      <span aria-hidden className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sunken text-subtle">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="min-w-0 break-words text-[13px] text-ink">{title}</p>
          {at && (
            <time dateTime={at} title={dateTime(at)} className="shrink-0 font-mono text-[11px] text-subtle tnum">
              {relativeTime(at)}
            </time>
          )}
        </div>
        {meta && <p className="mt-0.5 break-words text-[12px] text-muted">{meta}</p>}
        {children}
      </div>
    </li>
  );
}

/** One admin audit entry: who did what to which target, with the recorded change. */
export function AuditEvent({ entry }: { entry: { action: string; admin_email?: string | null; admin_id?: string | null; target_type: string | null; target_id: string | null; created_at: string; metadata?: Record<string, unknown> } }) {
  const [open, setOpen] = useState(false);
  const hasMeta = entry.metadata && Object.keys(entry.metadata).length > 0;
  return (
    <ActivityItem icon={<Lock size={12} />} title={<><span className="font-mono text-[12px]">{entry.action}</span>{entry.target_type && <span className="text-muted"> · {entry.target_type}{entry.target_id ? ` ${entry.target_id.slice(0, 40)}` : ''}</span>}</>} meta={entry.admin_email || (entry.admin_id ? `admin ${entry.admin_id.slice(0, 8)}` : 'system')} at={entry.created_at}>
      {hasMeta && (
        <>
          <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="mt-1 text-[11.5px] font-medium text-accent-text">
            {open ? 'Hide change' : 'Show change'}
          </button>
          {open && <pre className="scrollbar-thin mt-1.5 max-h-56 overflow-auto rounded-md border border-line bg-sunken p-2.5 font-mono text-[11px] leading-relaxed text-ink">{JSON.stringify(entry.metadata, null, 2)}</pre>}
        </>
      )}
    </ActivityItem>
  );
}
