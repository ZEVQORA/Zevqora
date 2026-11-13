import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Info } from 'lucide-react';
import { ZevqoraLogo } from '@/brand/ZevqoraLogo';
import { WeightlessEngine } from '@/brand/WeightlessEngine';
import { getEnabledOAuthProviders, type OAuthProvider } from '@/lib/supabase';

export function AuthShell({ title, subtitle, children, footer, aside }: {
  title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; aside?: ReactNode;
}) {
  const [engaged, setEngaged] = useState(false);
  return <main id="main" className="z-auth atelier-auth">
    <div className="atelier-auth-art" aria-hidden="true"><WeightlessEngine centered paused={engaged} /></div>
    <header className="atelier-auth-header"><Link to="/" aria-label="ZEVQORA home"><ZevqoraLogo variant="inverse" size={29} /></Link><Link to="/" className="atelier-auth-back" aria-label="Back to website"><ArrowLeft size={16} /><span>Back to website</span></Link></header>
    <div className="atelier-auth-layout">
      <aside className="atelier-auth-story">{aside || <><h2>A lighter way<br />forward.</h2><p>Your AI. Its full potential.</p></>}</aside>
      <section className="atelier-auth-surface" aria-label={title}>
        <div className="atelier-auth-form"><h1>{title}</h1>{subtitle && <p className="auth-subtitle">{subtitle}</p>}<div className="auth-form" onFocusCapture={() => setEngaged(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setEngaged(false); }}>{children}</div>{footer && <div className="auth-form-footer">{footer}</div>}</div>
        <footer className="atelier-auth-legal"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></footer>
      </section>
    </div>
  </main>;
}

export function AuthPreviewNote() {
  return (
    <p className="auth-preview-note" role="status">
      <Info size={14} />
      <span>
        Design preview. Sign-in connects on the configured application.
      </span>
    </p>
  );
}

function useOAuthProviders(): OAuthProvider[] | null {
  const [providers, setProviders] = useState<OAuthProvider[] | null>(null);
  useEffect(() => {
    let live = true;
    getEnabledOAuthProviders().then((list) => {
      if (live) setProviders(list);
    });
    return () => {
      live = false;
    };
  }, []);
  return providers;
}

export function OAuthButtons({
  onClick,
  disabled,
  pending,
}: {
  onClick: (provider: "google" | "github") => void;
  disabled?: boolean;
  pending?: string | null;
}) {
  const providers = useOAuthProviders();
  if (!providers?.length) return null;
  return (
    <div className="auth-oauth-buttons">
      {providers.map((provider) => (
        <button
          type="button"
          key={provider}
          disabled={disabled}
          onClick={() => onClick(provider)}
        >
          <img src={`/brand/${provider}.svg`} alt="" width={19} height={19} />
          <span>
            {pending === provider
              ? "Opening…"
              : provider === "google"
                ? "Google"
                : "GitHub"}
          </span>
        </button>
      ))}
    </div>
  );
}

export function OrDivider() {
  const providers = useOAuthProviders();
  if (!providers?.length) return null;
  return (
    <div className="auth-or-divider" aria-hidden>
      <span />
      <span>or continue with email</span>
      <span />
    </div>
  );
}
