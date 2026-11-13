import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, ClipboardList, FileCheck2, FolderOpen, Plug, X } from 'lucide-react';
import { ZevFace } from '@/brand/Zev';
import { useSession } from '@/lib/session';
import { useProduct } from '../store';
import type { CommandCenter } from '../experience';
import { useOpenWorkload } from './parts';

const DISMISS_KEY = 'zevqora.welcome.newUserDismissed';

/**
 * Display name from the verified profile returned by /api/me (never from the
 * URL or client input). Falls back to the username, then to no name at all.
 */
export function welcomeName(profile: { display_name: string | null; username: string | null } | null | undefined) {
  const name = profile?.display_name?.trim() || profile?.username?.trim() || '';
  return name.slice(0, 60);
}

/**
 * The top of the signed-in home. Returning teams see where they left off and
 * what needs them; a new team sees one light, skippable first step. Every
 * number comes from the Command Center response; nothing is invented, and an
 * empty workspace says so.
 */
export function WelcomeArea({ cc }: { cc: CommandCenter | null }) {
  const { me, activeWorkspace } = useSession();
  const { selected } = useProduct();
  const open = useOpenWorkload();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  if (!activeWorkspace || !cc) return null;
  const name = welcomeName(me?.profile);
  const isNew = cc.products.length === 0;

  if (isNew) {
    if (dismissed) return null;
    const skip = () => {
      setDismissed(true);
      try {
        window.localStorage.setItem(DISMISS_KEY, '1');
      } catch {
        /* storage unavailable: hidden for this visit only */
      }
    };
    return (
      <section className="zq-welcome is-new" aria-labelledby="zq-welcome-title">
        <ZevFace expression="warm-smile" size={44} />
        <div className="zq-welcome-copy">
          <h2 id="zq-welcome-title">{name ? `Welcome to ZEVQORA, ${name}.` : 'Welcome to ZEVQORA.'}</h2>
          <p>Start with one workload: import a sanitized trace, connect OpenTelemetry, or explore the labelled demo. It takes a few minutes.</p>
          <div className="zq-welcome-actions">
            <Link to="/app/onboarding" className="zq-welcome-primary">Start guided setup <ArrowRight size={15} aria-hidden /></Link>
            <Link to="/app/connections" className="zq-welcome-secondary"><Plug size={14} aria-hidden /> Connect evidence</Link>
          </div>
        </div>
        <button type="button" className="zq-welcome-skip" onClick={skip} aria-label="Skip the welcome guide">
          <X size={16} aria-hidden />
        </button>
      </section>
    );
  }

  const lastWorkload = cc.products.find((p) => p.id === selected?.id) || null;
  const pending = cc.decision_queue.length;
  const { VERIFIED, REJECTED, INCOMPLETE, total } = cc.verdicts;
  return (
    <section className="zq-welcome" aria-labelledby="zq-welcome-title">
      <div className="zq-welcome-copy">
        <h2 id="zq-welcome-title">{name ? `Welcome back, ${name}.` : 'Welcome back.'}</h2>
        <p>Your workspace is ready. Pick up where you left off.</p>
      </div>
      <dl className="zq-welcome-facts">
        <div>
          <dt>Workspace</dt>
          <dd>
            {activeWorkspace.name} <small>{activeWorkspace.role}</small>
          </dd>
        </div>
        <div>
          <dt><FolderOpen size={13} aria-hidden /> Last workload</dt>
          <dd>{lastWorkload ? lastWorkload.name : 'None opened yet'}</dd>
        </div>
        <div>
          <dt><FileCheck2 size={13} aria-hidden /> Runs with a verdict</dt>
          <dd>{total ? `${total} · ${VERIFIED} verified · ${REJECTED} rejected · ${INCOMPLETE} incomplete` : 'None yet'}</dd>
        </div>
        <div>
          <dt><ClipboardList size={13} aria-hidden /> Needs you</dt>
          <dd>{pending ? `${pending} pending ${pending === 1 ? 'decision' : 'decisions'}` : 'Nothing pending'}</dd>
        </div>
      </dl>
      <div className="zq-welcome-actions">
        {lastWorkload ? (
          <button type="button" className="zq-welcome-primary" onClick={() => open(lastWorkload.id, '/app/workloads')}>
            Continue with {lastWorkload.name} <ArrowRight size={15} aria-hidden />
          </button>
        ) : (
          <Link to="/app/workloads" className="zq-welcome-primary">Open a workload <ArrowRight size={15} aria-hidden /></Link>
        )}
        {pending > 0 && (
          <button type="button" className="zq-welcome-secondary" onClick={() => open(cc.decision_queue[0].product_id, cc.decision_queue[0].href)}>
            Review: {cc.decision_queue[0].title}
          </button>
        )}
      </div>
    </section>
  );
}
