import { Link } from 'react-router';
import { ArrowRight, Monitor } from 'lucide-react';
import { Panel } from './Panel';

/**
 * ZEVQORA is desktop-first. The web app is the account, team, billing and
 * monitoring portal; the core loop (repository → detection → replay → gate →
 * patch) runs in the desktop engine against the same account.
 */
export function DesktopCallout({ compact = false }: { compact?: boolean }) {
  return (
    <Panel tone="glass" className={compact ? 'flex flex-wrap items-center justify-between gap-3 px-4 py-3' : 'flex flex-wrap items-center justify-between gap-4 p-5'}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-subtle text-accent-text">
          <Monitor size={16} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-caption font-medium text-ink">The core workflow runs in ZEVQORA Desktop.</p>
          <p className="text-technical mt-0.5 text-muted">Connect a repository, detect AI usage, replay candidates on your traces and review patches locally. This portal is for your account, team, billing, live runtime and evidence.</p>
        </div>
      </div>
      <Link to="/download" className="text-caption inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-accent-text underline-offset-4 hover:underline">
        Get the desktop app <ArrowRight size={14} aria-hidden />
      </Link>
    </Panel>
  );
}
