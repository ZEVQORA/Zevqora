import { useState, type ReactNode } from 'react';
import { DateRangePicker, ViewHeader, rangeLabel, rangeQuery, type RangeValue } from '@/components/ui/Layout';
import { relativeTime } from '@/lib/format';

/** Range state shared by the admin analytics pages (UTC, server-validated). */
export function useRange(initial: RangeValue = { preset: '30d' }) {
  const [range, setRange] = useState<RangeValue>(initial);
  return { range, setRange, query: rangeQuery(range), label: rangeLabel(range) };
}

export function AdminHeader({ title, description, range, onRange, children }: { title: string; description?: ReactNode; range?: RangeValue; onRange?: (r: RangeValue) => void; children?: ReactNode }) {
  return (
    <ViewHeader eyebrow="Internal · server-enforced" title={title} description={description} actions={range && onRange ? <DateRangePicker value={range} onChange={onRange} /> : undefined}>
      {children}
    </ViewHeader>
  );
}

/** Source, range and freshness line under every admin data view. */
export function SourceLine({ source, range, generatedAt, lastEventAt }: { source: string; range: string; generatedAt?: string; lastEventAt?: string | null }) {
  return (
    <p className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-subtle">
      <span>Source: {source}</span>
      <span>Range: {range}</span>
      {generatedAt && <span>Generated {relativeTime(generatedAt)}</span>}
      <span>{lastEventAt ? `Last recorded event ${relativeTime(lastEventAt)}` : 'No recorded event in range'}</span>
    </p>
  );
}

export function StatusPill({ value }: { value: string }) {
  const ok = value === 'ok' || value === 'configured' || value === 'on' || value === 'collecting';
  const neutral = value === 'not_integrated';
  return (
    <span className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-wide ${ok ? 'bg-verified-bg text-verified' : neutral ? 'bg-sunken text-muted' : 'bg-warning-bg text-warning'}`}>
      {ok ? '✓' : neutral ? '–' : '!'} {value.replace(/_/g, ' ')}
    </span>
  );
}
