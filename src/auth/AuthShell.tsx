import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Info } from "lucide-react";
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
  const location = useLocation();
  const signup = location.pathname === "/signup";
  const reduced = useReducedMotion();
  const [engaged, setEngaged] = useState(false);
  const words = signup
    ? ["BUILD", "WHAT’S", "NEXT."]
    : ["BACK TO", "BIG", "IDEAS."];
  return (
    <main
      id="main"
      className={`z-auth auth-editorial ${signup ? "is-signup" : "is-login"}`}
    >
      <header className="account-header">
        <Link to="/" aria-label="ZEVQORA home">
          <ZevqoraLogo size={27} />
        </Link>
        <div>
          <Link className="account-home-link" to="/">
            <ArrowLeft size={14} />
            Website
          </Link>
          <Link
            className="account-alternate"
            to={`${signup ? "/login" : "/signup"}${location.search}`}
          >
            <span>{signup ? "Already with us?" : "New here?"}</span>
            <b>{signup ? "Sign in" : "Create account"}</b>
            <ArrowUpRight size={17} />
          </Link>
        </div>
      </header>
      <div className="account-editorial-stage">
        <aside
          className="account-type-poster"
          data-engaged={engaged}
          aria-label="Make AI lighter."
        >
          <div className="account-poster-top">
            <span>MAKE AI LIGHTER.</span>
            <span>ZEVQORA / YOUR NEXT CHAPTER</span>
          </div>
          {aside ? (
            <div className="account-custom-aside">{aside}</div>
          ) : (
            <h2 aria-label={words.join(" ")}>
              {words.map((word, index) => (
                <span className="account-word-mask" key={word}>
                  <motion.span
                    initial={reduced ? false : { y: "110%" }}
                    animate={{ y: 0 }}
                    transition={{
                      duration: 0.9,
                      delay: 0.1 + index * 0.09,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  >
                    {word}
                  </motion.span>
                </span>
              ))}
            </h2>
          )}
          <div className="account-poster-bottom">
            <p>
              {signup ? (
                <>
                  More room for
                  <br />
                  what you’ll build next.
                </>
              ) : (
                <>
                  Good to have you back.
                  <br />
                  Let’s make room for more.
                </>
              )}
            </p>
            <ArrowRight size={44} strokeWidth={1.1} />
          </div>
          <span className="account-focus-rule" aria-hidden />
        </aside>
        <motion.section
          className="account-form-surface"
          aria-label={signup ? "Create account" : "Sign in"}
          initial={reduced ? false : { opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.18 }}
        >
          <div className="auth-form-wrap">
            <div className="account-form-kicker">
              <span>YOUR WORKSPACE STARTS HERE</span>
              <span>
                {signup ? "CREATE" : "ENTER"}
                <ArrowUpRight size={12} />
              </span>
            </div>
            <h1>{title}</h1>
            {subtitle && <p className="auth-subtitle">{subtitle}</p>}
            <div
              className="auth-form"
              onFocusCapture={() => setEngaged(true)}
              onBlurCapture={(event) => {
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                )
                  setEngaged(false);
              }}
            >
              {children}
            </div>
            {footer && <div className="auth-form-footer">{footer}</div>}
            <Link className="auth-demo-link" to="/product">
              Explore the product first
              <ArrowUpRight size={15} />
            </Link>
          </div>
        </motion.section>
      </div>
      <footer className="account-footer">
        <span>© {new Date().getFullYear()} ZEVQORA</span>
        <Link to="/privacy">
          Your privacy
          <ArrowUpRight size={12} />
        </Link>
        <span>BIG IDEAS. A LIGHTER WAY.</span>
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
/** Providers enabled in Supabase Auth; null while loading. */
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
          <img
            src={`/brand/${provider}.svg`}
            alt=""
            width={19}
            height={19}
            aria-hidden
          />
          <span>
            {pending === provider
              ? "Opening…"
              : provider === "google"
                ? "Google"
                : "GitHub"}
          </span>
          <ArrowUpRight size={14} />
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
      <span>or with email</span>
      <span />
    </div>
  );
}
