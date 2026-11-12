import { useEffect, useState, type FormEvent } from "react";
import { track } from "@/lib/analytics";
import { Link, Navigate, useSearchParams } from "react-router";
import { ArrowRight, Mail } from "lucide-react";
import { PasswordInput } from "./PasswordInput";
import {
  AuthShell,
  AuthPreviewNote,
  OAuthButtons,
  OrDivider,
} from "./AuthShell";
import { Button } from "@/components/ui/Button";
import { Field, Input, Checkbox } from "@/components/ui/Field";
import { InlineNotice } from "@/components/ui/States";
import { useSession } from "@/lib/session";
import { getSupabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/api";
import { safeNext } from "@/lib/site";

export default function SignupPage() {
  const { status } = useSession();
  const [params] = useSearchParams();
  const plan = params.get("plan");
  const next = safeNext(
    params.get("next"),
    plan ? `/app/onboarding?plan=${encodeURIComponent(plan)}` : "/app/zev",
  );
  const [pending, setPending] = useState(false);
  const [oauthPending, setOauthPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Create account — ZEVQORA";
  }, []);

  if (status === "signed_in" && !done) return <Navigate to={next} replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    track("signup_started", { path: "/signup" });
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") || "").trim();
    const email = String(fd.get("email") || "").trim();
    const password = String(fd.get("password") || "");
    try {
      if (!name) throw new Error("Please enter your name.");
      if (password.length < 10)
        throw new Error("Use at least 10 characters for your password.");
      const sb = await getSupabase();
      if (!sb)
        throw new Error(
          "Authentication is not configured on this deployment yet.",
        );
      const { data, error: err } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name,
            display_name: name,
          },
          emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (err) throw err;
      if (!data.session) setDone(email);
    } catch (err) {
      setError(errorMessage(err, "Could not create the account."));
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
      setError(errorMessage(err, `${provider} sign-up is not available.`));
      setOauthPending(null);
    }
  }

  if (done) {
    return (
      <AuthShell title="Check your email">
        <InlineNotice tone="success">
          We sent a confirmation link to <strong>{done}</strong>. Open it to
          activate your account, then sign in.
        </InlineNotice>
        <p className="text-caption mt-6 text-muted">
          Already confirmed?{" "}
          <Link to="/login" className="text-ink underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="A lighter start"
      subtitle={
        plan
          ? `You picked the ${plan} plan. Create your account, then choose billing from Usage.`
          : "Create your ZEVQORA account"
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
      <OAuthButtons
        onClick={oauth}
        disabled={status === "unconfigured" || Boolean(oauthPending)}
        pending={oauthPending}
      />
      <OrDivider />
      <form
        onSubmit={onSubmit}
        className="auth-signup-form flex flex-col gap-4"
      >
        <Field id="name" label="Name">
          <Input
            id="name"
            name="name"
            autoComplete="name"
            placeholder="Your name"
            required
          />
        </Field>
        <Field id="email" label="Email">
          <div className="auth-input-with-icon">
            <Mail size={16} />
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              required
            />
          </div>
        </Field>
        <Field id="password" label="Password">
          <PasswordInput
            strength
            id="password"
            name="password"
            autoComplete="new-password"
            placeholder="Create a password"
            required
            minLength={10}
          />
        </Field>
        <Checkbox
          id="terms"
          name="terms"
          required
          label={
            <>
              I agree to the{" "}
              <Link
                to="/terms"
                className="text-ink underline underline-offset-4"
              >
                terms
              </Link>{" "}
              and{" "}
              <Link
                to="/privacy"
                className="text-ink underline underline-offset-4"
              >
                privacy policy
              </Link>
              .
            </>
          }
        />
        {error && (
          <p role="alert" className="text-caption text-rejected">
            {error}
          </p>
        )}
        <Button
          type="submit"
          size="lg"
          loading={pending}
          disabled={status === "unconfigured"}
          className="mt-1 w-full"
        >
          <span>Create your workspace</span>
          <ArrowRight size={17} />
        </Button>
      </form>
      {status === "unconfigured" && <AuthPreviewNote />}
    </AuthShell>
  );
}
