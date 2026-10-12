import { Bell, Gauge, Heart, LayoutDashboard, Network, Settings, ShieldCheck, Stethoscope } from 'lucide-react';
import { ZevqoraMark } from '@/brand/ZevqoraMark';
import { ZevqoraWordmark } from '@/brand/ZevqoraWordmark';
import { cn } from '@/lib/cn';

/**
 * A deterministic product preview in the brand board's "Product UI preview"
 * style: icon rail, Overview, three metric tiles, an impact line and the Zev
 * bar. Every value is a labelled synthetic illustration — never a result.
 */
export function ProductPreview({ className }: { className?: string }) {
  const series = [0.0040, 0.0040, 0.0039, 0.0040, 0.0039, 0.0040, 0.0040];
  const candidate = [null, null, null, 0.0021, 0.0017, 0.0016, 0.0016];
  const w = 300;
  const h = 92;
  const max = 0.0045;
  const x = (i: number) => 8 + (i / (series.length - 1)) * (w - 16);
  const y = (v: number) => h - 10 - (v / max) * (h - 22);
  const line = (vals: Array<number | null>) => vals.map((v, i) => (v === null ? '' : `${vals[i - 1] === null || i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join(' ');
  return (
    <figure className={cn('relative w-full max-w-[520px] select-none', className)} aria-label="Illustration of the ZEVQORA Command Center with synthetic values">
      <div className="overflow-hidden rounded-[22px] border border-line bg-surface shadow-[0_2px_4px_rgb(15_17_21/0.04),0_30px_70px_-34px_rgb(15_17_21/0.35)]">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="inline-flex items-center gap-2">
            <ZevqoraMark height={16} />
            <span className="text-ink"><ZevqoraWordmark height={8} /></span>
          </span>
          <span className="inline-flex items-center gap-2 text-subtle">
            <Bell size={13} aria-hidden />
            <span className="h-5 w-5 rounded-full bg-accent-subtle" aria-hidden />
          </span>
        </div>
        <div className="flex">
          <div className="flex w-11 shrink-0 flex-col items-center gap-3.5 border-r border-line py-4 text-subtle" aria-hidden>
            <span className="rounded-md bg-accent-subtle p-1.5 text-accent-text"><LayoutDashboard size={14} /></span>
            <Network size={14} />
            <Stethoscope size={14} />
            <Gauge size={14} />
            <ShieldCheck size={14} />
            <Settings size={14} />
          </div>
          <div className="min-w-0 flex-1 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[13px] font-semibold text-ink">Command Center</p>
                <p className="text-[10.5px] text-subtle">Your AI workload, with evidence.</p>
              </div>
              <span className="rounded-sm bg-warning-bg px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-warning">Synthetic illustration</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                ['Cost / success', '$0.0016', '−59% evaluated'],
                ['p95 latency', '2.12 s', 'unchanged'],
                ['Task success', '96.6%', 'held'],
              ].map(([k, v, d]) => (
                <div key={k} className="rounded-[12px] border border-line p-2.5">
                  <p className="text-[9.5px] text-subtle">{k}</p>
                  <p className="mt-1 text-[15px] font-semibold tracking-[-0.02em] text-ink tnum">{v}</p>
                  <p className="mt-0.5 font-mono text-[9px] text-accent-text">{d}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-[12px] border border-line p-2.5">
              <div className="flex items-center justify-between">
                <p className="text-[10.5px] font-medium text-ink">Cost per successful outcome</p>
                <span className="flex items-center gap-2 text-[9px] text-subtle">
                  <span className="inline-flex items-center gap-1"><span className="h-0.5 w-3 bg-[var(--zq-fg-subtle)]" aria-hidden />baseline</span>
                  <span className="inline-flex items-center gap-1"><span className="h-0.5 w-3 bg-accent" aria-hidden />verified plan</span>
                </span>
              </div>
              <svg viewBox={`0 0 ${w} ${h}`} className="mt-1 block h-auto w-full" aria-hidden>
                {[0, 1, 2].map((i) => <line key={i} x1="8" x2={w - 8} y1={12 + i * 30} y2={12 + i * 30} stroke="var(--zq-border)" />)}
                <path d={line(series)} fill="none" stroke="var(--zq-fg-subtle)" strokeWidth="1.6" strokeDasharray="4 3" />
                <path d={line(candidate)} fill="none" stroke="var(--zq-accent)" strokeWidth="2.2" strokeLinecap="round" />
                <circle cx={x(6)} cy={y(0.0016)} r="3.5" fill="var(--zq-accent)" />
              </svg>
            </div>
            <div className="mt-3 grid gap-1.5">
              <div className="flex items-center justify-between gap-2 rounded-[10px] border border-line px-2.5 py-1.5 text-[10.5px]">
                <span className="truncate text-ink">Validated lookup · route_refund</span>
                <span className="shrink-0 rounded-sm bg-verified-bg px-1.5 py-0.5 font-mono text-[8.5px] text-verified">✓ VERIFIED</span>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-[10px] border border-line px-2.5 py-1.5 text-[10.5px]">
                <span className="truncate text-ink">Smaller model · classify_ticket</span>
                <span className="shrink-0 rounded-sm bg-rejected-bg px-1.5 py-0.5 font-mono text-[8.5px] text-rejected">✕ REJECTED · quality</span>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-[12px] bg-accent-subtle px-2.5 py-2">
              <img src="/assets/zev/zev-face-warm-smile.webp" alt="" width={22} height={22} className="h-[22px] w-[22px] rounded-full border border-surface object-cover" style={{ objectPosition: '50% 38%' }} />
              <p className="min-w-0 flex-1 text-[10.5px] text-ink">Zev verified 1 plan and rejected 1 that broke quality.</p>
              <Heart size={12} className="shrink-0 fill-accent text-accent" aria-hidden />
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}
