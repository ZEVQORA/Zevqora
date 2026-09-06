import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ZevqoraLogo } from '@/brand/ZevqoraLogo';
import { Zev } from '@/brand/Zev';
import { StatusChip } from '@/components/ui/StatusChip';

export function AuthShell({ title, subtitle, children, footer, aside }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; aside?: ReactNode }) {
  return (
    <main id="main" className="studio min-h-dvh lg:grid lg:grid-cols-[1fr_1fr]">
      <div className="flex flex-col px-6 py-8 lg:px-14 lg:py-12">
        <Link to="/" aria-label="ZEVQORA home" className="inline-flex w-fit rounded-sm">
          <ZevqoraLogo size={26} />
        </Link>
        <div className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center py-12">
          <h1 className="text-h2 text-ink">{title}</h1>
          {subtitle && <p className="text-body mt-3 max-w-[40ch] text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8">{footer}</div>}
        </div>
      </div>
      <div data-surface="ink" className="hidden flex-col justify-between bg-canvas px-14 py-12 lg:flex">
        <p className="text-eyebrow uppercase text-subtle">AI cost optimization engineer</p>
        <div>
          {aside ?? (
            <>
              <p className="text-h2 max-w-[16ch] text-ink">Cheaper isn&rsquo;t verified.</p>
              <p className="text-body mt-6 max-w-[42ch] text-muted">Measure. Replay. Verify. Then optimize. ZEVQORA rejects changes that fail your verification gates, including the ones that would have saved the most.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <div className="rounded-md border border-line bg-surface px-4 py-3">
                  <StatusChip status="rejected" />
                  <p className="mt-2 font-mono text-technical text-muted tnum">42.01% cheaper · quality 0.87 &lt; 0.95</p>
                </div>
                <div className="rounded-md border border-line bg-surface px-4 py-3">
                  <StatusChip status="verified" />
                  <p className="mt-2 font-mono text-technical text-muted tnum">12.32% cheaper · quality 0.97 ≥ 0.95</p>
                </div>
              </div>
              <p className="text-technical mt-4 font-mono text-subtle">Internal benchmark. Not customer results.</p>
            </>
          )}
        </div>
        <div className="flex items-end justify-between">
          <Zev view="pose-sitting" height={150} />
          <p className="text-technical max-w-[26ch] text-right font-mono text-subtle">Private beta</p>
        </div>
      </div>
    </main>
  );
}

export function OAuthButtons({ onClick, disabled, pending }: { onClick: (provider: 'google' | 'github') => void; disabled?: boolean; pending?: string | null }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {(['google', 'github'] as const).map((p) => (
        <button key={p} type="button" disabled={disabled} onClick={() => onClick(p)} className="text-caption inline-flex h-11 items-center justify-center gap-2.5 rounded-md border border-line-control bg-surface font-medium text-ink transition-control hover:bg-canvas disabled:opacity-50">
          <img src={`/brand/${p}.svg`} alt="" width={16} height={16} aria-hidden />
          {pending === p ? 'Opening…' : p === 'google' ? 'Google' : 'GitHub'}
        </button>
      ))}
    </div>
  );
}

export function OrDivider() {
  return (
    <div className="my-6 flex items-center gap-4" aria-hidden>
      <span className="h-px flex-1 bg-line" />
      <span className="text-technical uppercase text-subtle">or</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
