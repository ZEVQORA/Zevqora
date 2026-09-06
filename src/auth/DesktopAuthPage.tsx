import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AuthShell, OAuthButtons, OrDivider } from './AuthShell';
import { Button, ButtonAnchor, ButtonLink } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { InlineNotice } from '@/components/ui/States';
import { getSupabase } from '@/lib/supabase';
import { api, errorMessage } from '@/lib/api';

const STATE_KEY = 'zevqora.desktopAuthState';
const validState = (v: string | null) => typeof v === 'string' && /^[A-Za-z0-9_-]{32,200}$/.test(v);

/**
 * Desktop handoff: authenticate in the browser, create a one-time encrypted
 * handoff, and return to the installed app through a deep link.
 */
export default function DesktopAuthPage() {
  const [params] = useSearchParams();
  const [state, setState] = useState<string>('');
  const [note, setNote] = useState<{ tone: 'info' | 'success' | 'danger'; text: string } | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    document.title = 'Connect ZEVQORA Desktop';
    const incoming = params.get('state');
    if (validState(incoming)) sessionStorage.setItem(STATE_KEY, incoming as string);
    const s = sessionStorage.getItem(STATE_KEY) || '';
    setState(validState(s) ? s : '');
  }, [params]);

  async function complete() {
    const sb = await getSupabase();
    if (!sb) throw new Error('Authentication is not configured on this deployment yet.');
    const { data } = await sb.auth.getSession();
    let session = data.session;
    if (session && (!session.refresh_token || session.refresh_token.length < 20)) {
      const { data: refreshed } = await sb.auth.refreshSession(session);
      session = refreshed.session;
    }
    if (!session) throw new Error('Sign in first, then retry the desktop connection.');
    const body = await api<{ code: string }>('/api/desktop/create-handoff', { method: 'POST', body: { state, refreshToken: session.refresh_token } });
    const link = `zevqora://auth/callback?code=${encodeURIComponent(body.code)}&state=${encodeURIComponent(state)}`;
    setDeepLink(link);
    setNote({ tone: 'success', text: 'Connected. Opening ZEVQORA Desktop…' });
    sessionStorage.removeItem(STATE_KEY);
    window.location.assign(link);
  }

  useEffect(() => {
    if (!state) return;
    if (params.get('resume') !== '1' && !params.get('state')) return;
    let active = true;
    getSupabase().then(async (sb) => {
      if (!sb) return;
      const { data } = await sb.auth.getSession();
      if (data.session && active) complete().catch((e) => setNote({ tone: 'danger', text: errorMessage(e) }));
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setNote({ tone: 'info', text: 'Signing in…' });
    const fd = new FormData(e.currentTarget);
    try {
      const sb = await getSupabase();
      if (!sb) throw new Error('Authentication is not configured on this deployment yet.');
      const { error } = await sb.auth.signInWithPassword({ email: String(fd.get('email') || ''), password: String(fd.get('password') || '') });
      if (error) throw error;
      await complete();
    } catch (err) {
      setNote({ tone: 'danger', text: errorMessage(err) });
    } finally {
      setPending(false);
    }
  }

  async function oauth(provider: 'google' | 'github') {
    const sb = await getSupabase();
    if (!sb) return setNote({ tone: 'danger', text: 'Authentication is not configured.' });
    const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: `${location.origin}/desktop-auth?resume=1&state=${encodeURIComponent(state)}` } });
    if (error) setNote({ tone: 'danger', text: error.message });
  }

  if (!state) {
    return (
      <AuthShell title="Start sign-in from ZEVQORA Desktop." subtitle="This page needs a one-time state created by the installed app.">
        <div className="flex gap-3">
          <ButtonLink to="/download">Download ZEVQORA</ButtonLink>
          <ButtonLink to="/" variant="secondary">
            Back to website
          </ButtonLink>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Connect ZEVQORA Desktop" subtitle="Authenticate here, then return through a short-lived one-time handoff. Your password never enters the desktop app.">
      {note && <InlineNotice tone={note.tone === 'info' ? 'info' : note.tone} className="mb-5">{note.text}</InlineNotice>}
      {deepLink && (
        <ButtonAnchor href={deepLink} className="mb-5 w-full">
          Open ZEVQORA Desktop
        </ButtonAnchor>
      )}
      <OAuthButtons onClick={oauth} />
      <OrDivider />
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field id="email" label="Email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field id="password" label="Password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} />
        </Field>
        <Button type="submit" size="lg" loading={pending} className="w-full">
          Continue to ZEVQORA Desktop
        </Button>
        <p className="text-technical text-center font-mono text-subtle">The handoff expires in 90 seconds and can be exchanged once.</p>
        <p className="text-caption text-center text-muted">
          New to ZEVQORA?{' '}
          <Link to={`/signup?next=${encodeURIComponent(`/desktop-auth?resume=1&state=${state}`)}`} className="text-ink underline underline-offset-4">
            Create an account
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
