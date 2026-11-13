import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowLeft, ArrowRight, Check, Info } from "lucide-react";
import { ZevqoraLogo } from "@/brand/ZevqoraLogo";
import { ZevqoraMark } from "@/brand/ZevqoraMark";
import { getEnabledOAuthProviders, type OAuthProvider } from "@/lib/supabase";

export function AuthShell({ title, subtitle, children, footer, aside }: {
  title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; aside?: ReactNode;
}) {
  return (
    <main id="main" className="z-auth polished-auth">
      <header className="polished-auth-header">
        <Link to="/" aria-label="ZEVQORA home"><ZevqoraLogo size={27} /></Link>
        <Link to="/"><ArrowLeft size={16} /> Back to website</Link>
      </header>
      <div className="polished-auth-layout">
        <aside className="polished-auth-story">
          <span className="polished-eyebrow">YOUR NEXT LIGHTER STEP</span>
          <h2>Big ideas.<br />A lighter way<span>.</span></h2>
          <p>Understand your AI spend. Test a better approach. Keep quality in the decision.</p>
          {aside || <div className="polished-auth-diagram" aria-hidden="true">
            <div className="polished-auth-source">Your AI workload<span>Calls · Context · Retries</span></div>
            <div className="polished-auth-connector" />
            <div className="polished-auth-node"><ZevqoraMark height={34} /><span>Measure. Replay. Verify.</span></div>
            <div className="polished-auth-connector" />
            <div className="polished-auth-result"><Check size={17} /> Evidence for your next decision</div>
          </div>}
          <Link to="/product">Take a look inside <ArrowRight size={17} /></Link>
        </aside>
        <section className="polished-auth-surface" aria-label={title}>
          <div className="polished-auth-form">
            <h1>{title}</h1>
            {subtitle && <p className="auth-subtitle">{subtitle}</p>}
            <div className="auth-form">{children}</div>
            {footer && <div className="auth-form-footer">{footer}</div>}
          </div>
        </section>
      </div>
      <footer className="polished-auth-footer">
        <span>© {new Date().getFullYear()} ZEVQORA</span>
        <nav aria-label="Legal"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></nav>
      </footer>
    </main>
  );
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
