import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { AuthShell, OAuthButtons, OrDivider } from './AuthShell';
import { Button } from '@/components/ui/Button';
import { Field, Input, Checkbox } from '@/components/ui/Field';
import { InlineNotice } from '@/components/ui/States';
import { useSession } from '@/lib/session';
import { getSupabase } from '@/lib/supabase';
import { api, errorMessage } from '@/lib/api';
import { safeNext } from '@/lib/site';

const USERNAME = /^[A-Za-z0-9._-]{3,30}$/;

export default function SignupPage() {
  const { status } = useSession();
  const [params] = useSearchParams();
  const plan = params.get('plan');
  const next = safeNext(params.get('next'), plan ? `/app/onboarding?plan=${encodeURIComponent(plan)}` : '/app/onboarding');
  const [pending, setPending] = useState(false);
  const [oauthPending, setOauthPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Create account — ZEVQORA';
  }, []);

  if (status === 'signed_in' && !done) return <Navigate to={next} replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get('name') || '').trim();
    const username = String(fd.get('username') || '').trim().toLowerCase();
    const email = String(fd.get('email') || '').trim();
    const password = String(fd.get('password') || '');
    const confirm = String(fd.get('confirm') || '');
    try {
      if (!USERNAME.test(username)) throw new Error('Username must be 3–30 characters using letters, numbers, dot, underscore or hyphen.');
      if (password.length < 10) throw new Error('Use at least 10 characters for your password.');
      if (password !== confirm) throw new Error('Passwords do not match.');
      const check = await api<{ available: boolean }>('/api/auth/username-available', { method: 'POST', auth: false, body: { username } });
      if (!check.available) throw new Error('That username is already taken.');
      const sb = await getSupabase();
      if (!sb) throw new Error('Authentication is not configured on this deployment yet.');
      const { data, error: err } = await sb.auth.signUp({ email, password, options: { data: { username, full_name: name || username, display_name: name || username }, emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` } });
      if (err) throw err;
      if (!data.session) setDone(email);
    } catch (err) {
      setError(errorMessage(err, 'Could not create the account.'));
    } finally {
      setPending(false);
    }
  }

  async function oauth(provider: 'google' | 'github') {
    setOauthPending(provider);
    setError(null);
    try {
      const sb = await getSupabase();
      if (!sb) throw new Error('Authentication is not configured on this deployment yet.');
      const { error: err } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` } });
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
          We sent a confirmation link to <strong>{done}</strong>. Open it to activate your account, then sign in.
        </InlineNotice>
        <p className="text-caption mt-6 text-muted">
          Already confirmed?{' '}
          <Link to="/login" className="text-ink underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Start optimizing"
      subtitle={plan ? `You picked the ${plan} plan. Create your account, then choose billing from Usage.` : 'Create your account. Connect a workload in minutes.'}
      footer={
        <p className="text-caption text-muted">
          Already have an account?{' '}
          <Link to="/login" className="text-ink underline underline-offset-4">
            Sign in
          </Link>
        </p>
      }
    >
      {status === 'unconfigured' && <InlineNotice tone="warning" className="mb-5">Authentication is not configured on this deployment yet.</InlineNotice>}
      <OAuthButtons onClick={oauth} disabled={status === 'unconfigured' || Boolean(oauthPending)} pending={oauthPending} />
      <OrDivider />
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <Field id="name" label="Name">
            <Input id="name" name="name" autoComplete="name" />
          </Field>
          <Field id="username" label="Username" hint="3–30 characters">
            <Input id="username" name="username" autoComplete="username" required pattern="[A-Za-z0-9._-]{3,30}" />
          </Field>
        </div>
        <Field id="email" label="Work email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="password" label="Password" hint="At least 10 characters.">
            <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />
          </Field>
          <Field id="confirm" label="Confirm">
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} />
          </Field>
        </div>
        <Checkbox
          id="terms"
          name="terms"
          required
          label={
            <>
              I agree to the{' '}
              <Link to="/terms" className="text-ink underline underline-offset-4">
                terms
              </Link>{' '}
              and{' '}
              <Link to="/privacy" className="text-ink underline underline-offset-4">
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
        <Button type="submit" size="lg" loading={pending} disabled={status === 'unconfigured'} className="mt-1 w-full">
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
