import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Ban, CloudOff, Lock } from 'lucide-react';
import { ZevqoraLogo } from '@/brand/ZevqoraLogo';
import { Button } from '@/components/ui/Button';
import { useSession } from '@/lib/session';
import { getConfigSync } from '@/lib/config';

type Kind = 'suspended' | 'load_failed' | 'permission_denied';

const COPY: Record<Kind, { Icon: typeof Ban; title: string; body: string }> = {
  suspended: {
    Icon: Ban,
    title: 'This account is suspended.',
    body: 'You can still sign out. Nothing in your workspaces has been deleted. Contact support to restore access.',
  },
  load_failed: {
    Icon: CloudOff,
    title: 'We could not load your account.',
    body: 'You are signed in, but your workspaces did not load. This is usually a network problem or a short outage. Try again, or sign out and back in.',
  },
  permission_denied: {
    Icon: Lock,
    title: 'You do not have access to this.',
    body: 'Your role in this workspace does not allow it. Ask a workspace owner or admin to change your role.',
  },
};

/** Deliberate full-page states for signed-in users who cannot use the app right now. */
export function AccountStateScreen({ kind, detail }: { kind: Kind; detail?: string | null }) {
  const { refreshMe, signOut, me } = useSession();
  const navigate = useNavigate();
  const [retrying, setRetrying] = useState(false);
  const { Icon, title, body } = COPY[kind];

  const retry = async () => {
    setRetrying(true);
    try {
      await refreshMe();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <main id="main" className="app-env flex min-h-dvh flex-col">
      <header className="container-page py-6">
        <Link to="/" aria-label="ZEVQORA home" className="inline-flex rounded-sm">
          <ZevqoraLogo size={22} />
        </Link>
      </header>
      <div className="container-page flex flex-1 items-center justify-center pb-24">
        <div className="max-w-[30rem] text-center" role={kind === 'permission_denied' ? undefined : 'alert'}>
          <span className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-full bg-sunken text-muted">
            <Icon size={20} aria-hidden />
          </span>
          <h1 className="text-h2 mt-5 text-ink">{title}</h1>
          <p className="text-body mt-3 text-muted">{body}</p>
          {detail && kind !== 'suspended' && <p className="text-technical mt-3 text-subtle">{detail}</p>}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {kind === 'load_failed' && <Button onClick={() => void retry()} loading={retrying}>Try again</Button>}
            {kind === 'permission_denied' && me && <Button onClick={() => navigate('/app')}>Back to overview</Button>}
            {kind === 'suspended' && getConfigSync().contactEmail && (
              <Button variant="secondary" onClick={() => { window.location.href = `mailto:${getConfigSync().contactEmail}`; }}>Contact support</Button>
            )}
            <Button variant={kind === 'load_failed' || kind === 'permission_denied' ? 'secondary' : 'primary'} onClick={() => void signOut().then(() => navigate('/'))}>Sign out</Button>
          </div>
        </div>
      </div>
    </main>
  );
}
