import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft, Info, X } from "lucide-react";
import { Aurora } from "@/brand/Aurora";
import { ZevqoraLogo } from "@/brand/ZevqoraLogo";
import { getEnabledOAuthProviders, type OAuthProvider } from "@/lib/supabase";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  aside,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  aside?: ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <main id="main" className="nova-auth">
      <Aurora />
      <header className="nova-auth-header">
        <Link to="/" aria-label="ZEVQORA home">
          <ZevqoraLogo variant="inverse" size={30} />
        </Link>
        <Link to="/">
          <ArrowLeft size={13} /> Back to website
        </Link>
      </header>
      <div>
        <motion.section
          className="nova-auth-card"
          aria-label={title}
          initial={reduced ? false : { opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        >
          <Link
            to="/"
            className="nova-auth-close"
            aria-label="Close and return home"
          >
            <X size={20} />
          </Link>
          <div className="nova-auth-brand">
            <ZevqoraLogo variant="inverse" size={28} />
          </div>
          <h1>{title}</h1>
          {subtitle && <p className="auth-subtitle">{subtitle}</p>}
          {aside && <div className="nova-auth-aside">{aside}</div>}
          <div className="auth-form">{children}</div>
          {footer && <div className="auth-form-footer">{footer}</div>}
        </motion.section>
        <footer className="nova-auth-footer">
          <span>© {new Date().getFullYear()} ZEVQORA</span>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </footer>
      </div>
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
