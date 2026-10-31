import { useEffect, useState, type FormEvent } from "react";
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
import { Field, Input } from "@/components/ui/Field";
import { InlineNotice } from "@/components/ui/States";
import { useSession } from "@/lib/session";
import { getSupabase } from "@/lib/supabase";
import { api, errorMessage } from "@/lib/api";
import { safeNext } from "@/lib/site";

export default function LoginPage() {
  const { status } = useSession();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [pending, setPending] = useState(false);
  const [oauthPending, setOauthPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notice = params.get("created")
    ? "Account created. Sign in to continue."
    : params.get("reset")
      ? "Password updated. Sign in with your new password."
      : params.get("confirmed")
        ? "Email confirmed. You can sign in now."
        : null;

  useEffect(() => {
    document.title = "Sign in — ZEVQORA";
  }, []);

  if (status === "signed_in") return <Navigate to={next} replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const sb = await getSupabase();
      if (!sb)
        throw new Error(
          "Authentication is not configured on this deployment yet.",
        );
      const body = await api<{
        session: { accessToken: string; refreshToken: string };
      }>("/api/auth/password-login", {
        method: "POST",
        auth: false,
        body: {
          identifier: String(fd.get("identifier") || ""),
          password: String(fd.get("password") || ""),
        },
      });
      const { error: setError2 } = await sb.auth.setSession({
        access_token: body.session.accessToken,
        refresh_token: body.session.refreshToken,
      });
      if (setError2) throw setError2;
    } catch (err) {
      setError(errorMessage(err, "Sign-in failed."));
      setPending(false);
    }
  }

  async function oauth(provider: "google" | "github") {
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
      setError(errorMessage(err, `${provider} sign-in is not available.`));
      setOauthPending(null);
    }
  }

  return (
    <AuthShell
      title="Sign in."
      subtitle="Welcome back. Let’s pick up where you left off."
      footer={
        <p className="text-caption text-muted">
          New to ZEVQORA?{" "}
          <Link
            to={`/signup${next !== "/app" ? `?next=${encodeURIComponent(next)}` : ""}`}
            className="text-ink underline underline-offset-4"
          >
            Create an account
          </Link>
        </p>
      }
    >
      {notice && (
        <InlineNotice tone="success" className="mb-5">
          {notice}
        </InlineNotice>
      )}
      <OAuthButtons
        onClick={oauth}
        disabled={status === "unconfigured" || Boolean(oauthPending)}
        pending={oauthPending}
      />
      <OrDivider />
      <form onSubmit={onSubmit} className="auth-login-form flex flex-col gap-4">
        <Field id="identifier" label="Username or email">
          <div className="auth-input-with-icon">
            <Mail size={16} />
            <Input
              id="identifier"
              name="identifier"
              autoComplete="username"
              placeholder="you@company.com"
              required
            />
          </div>
        </Field>
        <Field id="password" label="Password">
          <PasswordInput
            id="password"
            name="password"
            autoComplete="current-password"
            required
          />
        </Field>
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
          <span>Sign in to your workspace</span>
          <ArrowRight size={17} />
        </Button>
        <Link
          to="/forgot-password"
          className="text-caption text-center text-muted underline-offset-4 hover:underline"
        >
          Forgot your password?
        </Link>
      </form>
      {status === "unconfigured" && <AuthPreviewNote />}
    </AuthShell>
  );
}
