import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { AuthShell } from './AuthShell';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { InlineNotice } from '@/components/ui/States';
import { getSupabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/api';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState<'checking' | 'ok' | 'missing'>('checking');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getSupabase().then(async (sb) => {
      if (!sb) return setReady('missing');
      // Give the client a moment to exchange the recovery code from the URL.
      for (let i = 0; i < 20; i += 1) {
        const { data } = await sb.auth.getSession();
        if (data.session) {
          if (active) setReady('ok');
          return;
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      if (active) setReady('missing');
    });
    return () => {
      active = false;
    };
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get('password') || '');
    const confirm = String(fd.get('confirm') || '');
    try {
      if (password.length < 10) throw new Error('Use at least 10 characters.');
      if (password !== confirm) throw new Error('Passwords do not match.');
      const sb = await getSupabase();
      if (!sb) throw new Error('Authentication is not configured.');
      const { error: err } = await sb.auth.updateUser({ password });
      if (err) throw err;
      await sb.auth.signOut();
      navigate('/login?reset=1', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <AuthShell title="Choose a new password">
      {ready === 'missing' && <InlineNotice tone="warning">This reset link is invalid or expired. Request a new one from the sign-in page.</InlineNotice>}
      {ready === 'ok' && (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field id="password" label="New password" hint="At least 10 characters.">
            <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} autoFocus />
          </Field>
          <Field id="confirm" label="Confirm password">
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={10} />
          </Field>
          {error && (
            <p role="alert" className="text-caption text-rejected">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" loading={pending} className="w-full">
            Update password
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
