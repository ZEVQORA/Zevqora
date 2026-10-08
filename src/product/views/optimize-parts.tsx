/**
 * Shared pieces of the Optimization Run view: numbered steps, metric tiles and
 * formatting where unknown is always shown as unknown, never as 0.
 */
import type { ReactNode } from 'react';
import { Card, CardHeader, Chip, cn } from '../ui';
import { money } from '../format';

export const unknown = <span className="text-subtle">unknown</span>;
export const usd = (v: number | null | undefined, digits = 4) => (v === null || v === undefined ? unknown : money(v, { digits }));
export const msLabel = (v: number | null | undefined) => (v === null || v === undefined ? unknown : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
export const pctLabel = (v: number | null | undefined) => (v === null || v === undefined ? unknown : `${(v * 100).toFixed(1)}%`);
export const signedPct = (v: number | null | undefined) => (v === null || v === undefined ? unknown : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
export const num3 = (v: number | null | undefined) => (v === null || v === undefined ? unknown : v.toFixed(3));

export function Step({ n, title, done, children, action, description, id }: { n: number; title: string; done?: boolean; children: ReactNode; action?: ReactNode; description?: ReactNode; id?: string }) {
  return (
    <Card className="mt-4">
      <div id={id}>
        <CardHeader
          title={<span className="flex items-center gap-2"><span className={cn('inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold', done ? 'bg-verified-bg text-verified' : 'bg-ink/5 text-muted')}>{n}</span>{title}</span>}
          description={description}
          action={action}
        />
        <div className="pcard-body">{children}</div>
      </div>
    </Card>
  );
}

export function Tile({ label, value, hint, tag }: { label: string; value: ReactNode; hint?: ReactNode; tag?: string }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex items-center justify-between gap-2"><span className="pmetric-label">{label}</span>{tag && <Chip tone="neutral">{tag}</Chip>}</div>
      <div className="mt-2 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink tnum">{value}</div>
      {hint && <div className="mt-1.5 text-[12px] text-subtle">{hint}</div>}
    </div>
  );
}

/** Claim label: estimates are never shown in a success colour. */
export function ClaimTag({ kind }: { kind: 'ESTIMATED' | 'CALIBRATED' | 'EVALUATED' | 'VERIFIED' | 'BAD-DAY REPLAY' | 'OBSERVED' }) {
  const tone = kind === 'VERIFIED' ? 'verified' : kind === 'EVALUATED' || kind === 'CALIBRATED' ? 'accent' : 'neutral';
  return <Chip tone={tone}>{kind}</Chip>;
}

/** A labelled segmented control (radio semantics, keyboard reachable). */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full flex-wrap rounded-lg border border-line p-0.5 text-[12px]">
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={cn('rounded-md px-2.5 py-1.5', value === v ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
          {text}
        </button>
      ))}
    </div>
  );
}
