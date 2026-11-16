import { useEffect, useState, type FocusEvent, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowUpRight, Check, Info } from "lucide-react";
import { ZevqoraLogo } from "@/brand/ZevqoraLogo";
import { Zev, type ZevView } from "@/brand/Zev";
import { getEnabledOAuthProviders, type OAuthProvider } from "@/lib/supabase";

/**
 * How Zev reacts beside the form. `curious` while you type your details,
 * `shy` while a password field has focus (Zev turns away — it never looks),
 * `oops` after an error and `cheer` once something worked.
 */
export type ZevMood = "idle" | "curious" | "shy" | "oops" | "cheer";

const EASE = [0.16, 1, 0.3, 1] as const;

/** Only the full-size turnaround sprites are used here (the small pose sprites blur when enlarged). */
function zevFor(mood: ZevMood, signup: boolean): { view: ZevView; height: number; line: string } {
  switch (mood) {
    case "curious":
      return signup
        ? { view: "front", height: 300, line: "Nice to meet you!" }
        : { view: "three-quarter-front", height: 300, line: "Good to see you again." };
    case "shy":
      return { view: "side", height: 300, line: "I won’t peek. Promise." };
    case "oops":
      return { view: "front", height: 300, line: "Hmm, let’s fix that together." };
    case "cheer":
      return { view: "three-quarter-front", height: 300, line: "Yay! You’re all set." };
    default:
      return signup
        ? { view: "three-quarter-front", height: 300, line: "Hi, I’m Zev. Let’s make room for your next idea." }
        : { view: "front", height: 300, line: "Welcome back! Your evidence is right where you left it." };
  }
}

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  aside,
  mood,
  kicker,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  aside?: ReactNode;
  /** A page-level mood (error, success) that overrides focus-driven reactions. */
  mood?: ZevMood;
  /** Small line above the title, e.g. a step indicator. */
  kicker?: ReactNode;
}) {
  const location = useLocation();
  const signup = location.pathname === "/signup";
  const reduced = useReducedMotion();
  const [focusMood, setFocusMood] = useState<ZevMood>("idle");
  const current = mood && mood !== "idle" ? mood : focusMood;
  const zev = zevFor(current, signup);

  const onFocus = (e: FocusEvent<HTMLElement>) => {
    const t = e.target as HTMLInputElement;
    if (t.tagName !== "INPUT") return;
    setFocusMood(t.type === "password" || t.name === "password" || t.name === "confirm" ? "shy" : "curious");
  };
  const onBlur = (e: FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusMood("idle");
  };

  return (
    <main id="main" className={`zv-auth ${signup ? "is-signup" : "is-login"}`}>
      <header className="zv-auth-top">
        <Link to="/" aria-label="ZEVQORA home" className="zv-auth-logo">
          <ZevqoraLogo size={26} />
        </Link>
        <div className="zv-auth-top-links">
          <Link className="zv-auth-back" to="/?site=1">
            <ArrowLeft size={14} aria-hidden />
            Website
          </Link>
          <Link className="zv-auth-alt" to={`${signup ? "/login" : "/signup"}${location.search}`}>
            <span>{signup ? "Already with us?" : "New here?"}</span>
            <b>{signup ? "Sign in" : "Create account"}</b>
            <ArrowUpRight size={15} aria-hidden />
          </Link>
        </div>
      </header>

      <div className="zv-auth-stage">
        <aside className="zv-auth-world" aria-label="Make AI lighter.">
          <div className="zv-auth-sky" aria-hidden>
            <span className="zv-blob is-a" />
            <span className="zv-blob is-b" />
            <span className="zv-grid" />
          </div>
          {aside ? (
            <div className="zv-auth-custom">{aside}</div>
          ) : (
            <>
              <div className="zv-auth-headline">
                <p className="zv-kicker">Make AI lighter</p>
                <h2>
                  {signup ? (
                    <>
                      Big ideas.
                      <br />
                      <span>A lighter way.</span>
                    </>
                  ) : (
                    <>
                      Back to
                      <br />
                      <span>big ideas.</span>
                    </>
                  )}
                </h2>
              </div>

              <div className="zv-auth-zev" aria-hidden>
                <span className="zv-auth-stage-disc" />
                <AnimatePresence mode="wait">
                  <motion.div
                    key={zev.line}
                    className="zv-auth-bubble"
                    initial={reduced ? false : { opacity: 0, y: 8, scale: 0.92 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.96 }}
                    transition={{ type: "spring", stiffness: 380, damping: 26 }}
                  >
                    {zev.line}
                  </motion.div>
                </AnimatePresence>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={zev.view}
                    className={`zv-auth-sprite is-${current}`}
                    initial={reduced ? false : { opacity: 0, y: 16, scale: 0.94 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.97 }}
                    transition={{ type: "spring", stiffness: 260, damping: 20 }}
                  >
                    <div className="zv-float">
                      <Zev view={zev.view} height={zev.height} alt="" />
                    </div>
                  </motion.div>
                </AnimatePresence>
                <span className="zv-shadow" />
                {current === "cheer" && !reduced && (
                  <div className="zv-confetti">
                    {Array.from({ length: 14 }, (_, i) => (
                      <i key={i} style={{ ["--i" as string]: i }} />
                    ))}
                  </div>
                )}
              </div>

              <ul className="zv-auth-promises">
                {["Read-only by default", "Quality floor before any replay", "You approve every change"].map((t, i) => (
                  <motion.li
                    key={t}
                    initial={reduced ? false : { opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.7, ease: EASE, delay: 0.5 + i * 0.1 }}
                  >
                    <span><Check size={12} aria-hidden /></span>
                    {t}
                  </motion.li>
                ))}
              </ul>
            </>
          )}
        </aside>

        <motion.section
          className="zv-auth-panel"
          aria-label={signup ? "Create account" : "Sign in"}
          initial={reduced ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.1 }}
        >
          <div className="auth-form-wrap zv-auth-card">
            {kicker && <div className="zv-auth-kicker">{kicker}</div>}
            <h1>{title}</h1>
            {subtitle && <p className="auth-subtitle">{subtitle}</p>}
            <div className="auth-form" onFocusCapture={onFocus} onBlurCapture={onBlur}>
              {children}
            </div>
            {footer && <div className="auth-form-footer">{footer}</div>}
            <Link className="auth-demo-link" to="/product">
              Explore the product first
              <ArrowUpRight size={15} aria-hidden />
            </Link>
          </div>
          <footer className="zv-auth-foot">
            <span>© {new Date().getFullYear()} ZEVQORA</span>
            <Link to="/privacy">Your privacy</Link>
            <Link to="/terms">Terms</Link>
          </footer>
        </motion.section>
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
