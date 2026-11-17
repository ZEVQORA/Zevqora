import { useEffect, useRef, useState, type FormEvent } from "react";
import { track } from "@/lib/analytics";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, AtSign, Check, Mail, MailCheck, User } from "lucide-react";
import { PasswordInput } from "./PasswordInput";
import {
  AuthShell,
  AuthPreviewNote,
  OAuthButtons,
  OrDivider,
  type ZevMood,
} from "./AuthShell";
import { Button } from "@/components/ui/Button";
import { Field, Input, Checkbox } from "@/components/ui/Field";
import { useSession } from "@/lib/session";
import { getSupabase } from "@/lib/supabase";
import { api, errorMessage } from "@/lib/api";
import { safeNext } from "@/lib/site";

const USERNAME = /^[A-Za-z0-9._-]{3,30}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EASE = [0.16, 1, 0.3, 1] as const;
const STEPS = ["About you", "Secure your account"] as const;

/** Password rules shown as a live checklist. Only the length is enforced, as before. */
function rules(pw: string) {
  return [
    { ok: pw.length >= 10, label: "At least 10 characters" },
    { ok: /[A-Z]/.test(pw) && /[a-z]/.test(pw), label: "Upper and lower case" },
    { ok: /\d|[^\w]/.test(pw), label: "A number or symbol" },
  ];
}

export default function SignupPage() {
  const { status } = useSession();
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const [params] = useSearchParams();
  const plan = params.get("plan");
  const next = safeNext(
    params.get("next"),
    plan
      ? `/app/onboarding?plan=${encodeURIComponent(plan)}`
      : "/app/onboarding",
  );
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [oauthPending, setOauthPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [done, setDone] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = "Create account — ZEVQORA";
  }, []);

  // "Check your email": continue on its own once the link is confirmed. A link opened in
  // this browser signs the other tab in (Supabase syncs tabs, so `status` flips); a link
  // opened elsewhere is caught by retrying the password sign-in, which Supabase refuses
  // with `email_not_confirmed` until the email is confirmed.
  useEffect(() => {
    if (!done) return;
    if (status === "signed_in") {
      navigate(next, { replace: true });
      return;
    }
    if (!password) return;
    const address = done;
    const startedAt = Date.now();
    let stopped = false;
    let busy = false;
    let timer = 0;
    const stop = () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", attempt);
      window.removeEventListener("focus", attempt);
    };
    async function attempt() {
      if (stopped || busy || document.visibilityState !== "visible") return;
      if (Date.now() - startedAt > 15 * 60_000) return stop();
      busy = true;
      try {
        const sb = await getSupabase();
        if (!sb || stopped) return;
        const { data, error: err } = await sb.auth.signInWithPassword({ email: address, password });
        if (stopped) return;
        if (data.session) {
          stop();
          navigate(next, { replace: true });
          return;
        }
        const code = (err as { code?: string; status?: number } | null)?.code;
        const httpStatus = (err as { status?: number } | null)?.status;
        if (err && code !== "email_not_confirmed" && httpStatus !== 429) stop();
      } catch {
        /* network hiccup: the next tick retries */
      } finally {
        busy = false;
      }
    }
    timer = window.setInterval(attempt, 6000);
    document.addEventListener("visibilitychange", attempt);
    window.addEventListener("focus", attempt);
    return stop;
  }, [done, status, password, next, navigate]);

  if (status === "signed_in" && !done) return <Navigate to={next} replace />;

  const fail = (message: string) => {
    setError(message);
    setShake((n) => n + 1);
  };
  const go = (to: number) => {
    setDir(to > step ? 1 : -1);
    setError(null);
    setStep(to);
  };

  async function continueToSecurity(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    track("signup_started", { path: "/signup" });
    const handle = username.trim().toLowerCase();
    if (!USERNAME.test(handle))
      return fail("Username must be 3–30 characters using letters, numbers, dot, underscore or hyphen.");
    if (!EMAIL.test(email.trim())) return fail("Enter a valid email address.");
    setPending(true);
    setError(null);
    try {
      const check = await api<{ available: boolean }>(
        "/api/auth/username-available",
        { method: "POST", auth: false, body: { username: handle } },
      );
      if (!check.available) return fail("That username is already taken.");
      setUsername(handle);
      go(1);
    } catch (err) {
      fail(errorMessage(err, "Could not check that username."));
    } finally {
      setPending(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const handle = username.trim().toLowerCase();
    const address = email.trim();
    const display = name.trim();
    try {
      if (!USERNAME.test(handle))
        throw new Error(
          "Username must be 3–30 characters using letters, numbers, dot, underscore or hyphen.",
        );
      if (password.length < 10)
        throw new Error("Use at least 10 characters for your password.");
      if (password !== confirm) throw new Error("Passwords do not match.");
      const sb = await getSupabase();
      if (!sb)
        throw new Error(
          "Authentication is not configured on this deployment yet.",
        );
      const { data, error: err } = await sb.auth.signUp({
        email: address,
        password,
        options: {
          data: {
            username: handle,
            full_name: display || handle,
            display_name: display || handle,
          },
          emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      // SEC-03: an existing address gets the same "check your email" screen as a new one.
      // (With confirmations off GoTrue says "User already registered"; never echo that.)
      if (err && /already (been )?registered|user_already_exists|email_exists/i.test(`${err.message} ${(err as { code?: string }).code ?? ''}`)) {
        setDone(address);
        return;
      }
      if (err) throw err;
      if (!data.session) setDone(address);
    } catch (err) {
      fail(errorMessage(err, "Could not create the account."));
    } finally {
      setPending(false);
    }
  }

  async function oauth(provider: "google" | "github") {
    track("signup_started", { path: "/signup" });
    setOauthPending(provider);
    setError(null);
    try {
      const sb = await getSupabase();
      if (!sb)
        throw new Error(
          "Authentication is not configured on this deployment yet.",
        );
      const { error: err } = await sb.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (err) throw err;
    } catch (err) {
      fail(errorMessage(err, `${provider} sign-up is not available.`));
      setOauthPending(null);
    }
  }

  if (done) {
    return (
      <AuthShell title="Check your email" mood="cheer">
        <motion.div
          className="zv-mail"
          initial={reduced ? false : { opacity: 0, scale: 0.9, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 18 }}
        >
          <span className="zv-mail-icon" aria-hidden>
            <MailCheck size={28} />
          </span>
          <p>
            We sent a confirmation link to <strong>{done}</strong>. Open it to
            activate your account, then sign in.
          </p>
          <ol className="zv-mail-steps">
            <li><span>1</span> Open the email from ZEVQORA</li>
            <li><span>2</span> Click “Confirm your account”</li>
            <li><span>3</span> Meet Zev in your new workspace</li>
          </ol>
        </motion.div>
        <p className="text-caption mt-4 text-muted" aria-live="polite">
          Keep this tab open. It continues on its own once you confirm.
        </p>
        <p className="text-caption mt-6 text-muted">
          Already confirmed?{" "}
          <Link to="/login" className="text-ink underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </AuthShell>
    );
  }

  const mood: ZevMood | undefined = error ? "oops" : undefined;
  const checks = rules(password);
  const matches = confirm.length > 0 && confirm === password;

  return (
    <AuthShell
      title={step === 0 ? "Create account." : "Secure your account."}
      mood={mood}
      kicker={
        <div className="zv-steps-ind" aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
          {STEPS.map((s, i) => (
            <span key={s} className={i < step ? "is-done" : i === step ? "is-active" : ""} aria-hidden>
              <i>{i < step ? <Check size={11} /> : i + 1}</i>
              {s}
            </span>
          ))}
        </div>
      }
      subtitle={
        step === 0
          ? plan
            ? `You picked the ${plan} plan. Create your account, then choose billing from Usage.`
            : "Two quick steps. Your next idea starts here."
          : `Almost there, ${name.trim() || username}. Pick a password only you know.`
      }
      footer={
        <p className="text-caption text-muted">
          Already have an account?{" "}
          <Link to="/login" className="text-ink underline underline-offset-4">
            Sign in
          </Link>
        </p>
      }
    >
      <motion.div key={shake} animate={shake && !reduced ? { x: [0, -10, 9, -6, 4, 0] } : undefined} transition={{ duration: 0.45 }}>
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          {step === 0 ? (
            <motion.div
              key="about"
              custom={dir}
              initial={reduced ? false : { opacity: 0, x: dir * 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduced ? undefined : { opacity: 0, x: dir * -40 }}
              transition={{ duration: 0.45, ease: EASE }}
            >
              <OAuthButtons
                onClick={oauth}
                disabled={status === "unconfigured" || Boolean(oauthPending)}
                pending={oauthPending}
              />
              <OrDivider />
              <form onSubmit={continueToSecurity} className="auth-signup-form flex flex-col gap-4">
                <div className="auth-field-pair grid grid-cols-2 gap-3">
                  <Field id="name" label="Name">
                    <div className="auth-input-with-icon">
                      <User size={16} />
                      <Input ref={firstField} id="name" name="name" autoComplete="name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                  </Field>
                  <Field id="username" label="Username" hint="3–30 characters">
                    <div className="auth-input-with-icon">
                      <AtSign size={16} />
                      <Input
                        id="username"
                        name="username"
                        autoComplete="username"
                        placeholder="yourname"
                        required
                        pattern="[A-Za-z0-9._-]{3,30}"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                      />
                    </div>
                  </Field>
                </div>
                <Field id="email" label="Work email">
                  <div className="auth-input-with-icon">
                    <Mail size={16} />
                    <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                </Field>
                {error && (
                  <p role="alert" className="zv-auth-error">
                    {error}
                  </p>
                )}
                <Button type="submit" size="lg" loading={pending} disabled={status === "unconfigured"} className="zv-auth-submit mt-1 w-full">
                  <span>Continue</span>
                  <ArrowRight size={17} />
                </Button>
              </form>
            </motion.div>
          ) : (
            <motion.div
              key="secure"
              custom={dir}
              initial={reduced ? false : { opacity: 0, x: dir * 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduced ? undefined : { opacity: 0, x: dir * -40 }}
              transition={{ duration: 0.45, ease: EASE }}
            >
              <form onSubmit={onSubmit} className="auth-signup-form flex flex-col gap-4">
                <div className="zv-who">
                  <span className="zv-who-avatar" aria-hidden>{(name.trim() || username)[0]?.toUpperCase()}</span>
                  <span className="min-w-0">
                    <b>{name.trim() || username}</b>
                    <small>{email}</small>
                  </span>
                  <button type="button" onClick={() => go(0)}>Edit</button>
                </div>
                <Field id="password" label="Password">
                  <PasswordInput
                    strength
                    id="password"
                    name="password"
                    autoComplete="new-password"
                    placeholder="Create a password"
                    required
                    minLength={10}
                    autoFocus
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                <ul className="zv-rules" aria-label="Password checklist">
                  {checks.map((r) => (
                    <li key={r.label} className={r.ok ? "is-ok" : ""}>
                      <span aria-hidden>{r.ok ? <Check size={11} /> : null}</span>
                      {r.label}
                      <span className="sr-only">{r.ok ? " — done" : " — not yet"}</span>
                    </li>
                  ))}
                </ul>
                <Field id="confirm" label="Confirm password">
                  <PasswordInput
                    id="confirm"
                    name="confirm"
                    autoComplete="new-password"
                    placeholder="Repeat password"
                    required
                    minLength={10}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </Field>
                {confirm.length > 0 && (
                  <p className={`zv-match ${matches ? "is-ok" : ""}`} aria-live="polite">
                    {matches ? "Passwords match." : "Passwords do not match yet."}
                  </p>
                )}
                <Checkbox
                  id="terms"
                  name="terms"
                  required
                  label={
                    <>
                      I agree to the{" "}
                      <Link to="/terms" className="text-ink underline underline-offset-4">
                        terms
                      </Link>{" "}
                      and{" "}
                      <Link to="/privacy" className="text-ink underline underline-offset-4">
                        privacy policy
                      </Link>
                      .
                    </>
                  }
                />
                {error && (
                  <p role="alert" className="zv-auth-error">
                    {error}
                  </p>
                )}
                <div className="zv-auth-actions">
                  <button type="button" className="zv-auth-backbtn" onClick={() => go(0)} aria-label="Back to your details">
                    <ArrowLeft size={17} aria-hidden />
                  </button>
                  <Button type="submit" size="lg" loading={pending} disabled={status === "unconfigured"} className="zv-auth-submit w-full">
                    <span>Create your workspace</span>
                    <ArrowRight size={17} />
                  </Button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      {status === "unconfigured" && <AuthPreviewNote />}
    </AuthShell>
  );
}
