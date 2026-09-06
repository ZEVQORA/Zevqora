import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { AuthShell } from './AuthShell';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { InlineNotice } from '@/components/ui/States';
import { getSupabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const email = String(new FormData(e.currentTarget).get('email') || '').trim();
    try {
      const sb = await getSupabase();
      if (!sb) throw new Error('Authentication is not configured on this deployment yet.');
      const { error: err } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset-password` });
      if (err) throw err;
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }
  return (
    <AuthShell
      title="Reset your password"
      subtitle="We will email you a link to choose a new password."
      footer={
        <Link to="/login" className="text-caption text-muted underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {done ? (
        <InlineNotice tone="success">If an account exists for that address, a reset link is on its way.</InlineNotice>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field id="email" label="Email">
            <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
          </Field>
          {error && (
            <p role="alert" className="text-caption text-rejected">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" loading={pending} className="w-full">
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
