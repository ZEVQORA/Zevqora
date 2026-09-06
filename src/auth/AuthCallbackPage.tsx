import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { FullPageLoader } from '@/brand/BrandLoader';
import { getSupabase } from '@/lib/supabase';
import { safeNext } from '@/lib/site';
import { InlineNotice } from '@/components/ui/States';
import { ButtonLink } from '@/components/ui/Button';

/** OAuth and email-link landing. The Supabase client exchanges the code; we wait for the session. */
export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const next = safeNext(params.get('next'));
    const errorDescription = params.get('error_description');
    if (errorDescription) {
      setFailed(errorDescription);
      return;
    }
    getSupabase().then(async (sb) => {
      if (!sb) return setFailed('Authentication is not configured on this deployment.');
      for (let i = 0; i < 40; i += 1) {
        const { data } = await sb.auth.getSession();
        if (data.session) {
          if (active) navigate(next, { replace: true });
          return;
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      if (active) setFailed('We could not complete sign-in. Please try again.');
    });
    return () => {
      active = false;
    };
  }, [navigate, params]);
  if (failed) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <InlineNotice tone="danger">{failed}</InlineNotice>
        <ButtonLink to="/login" variant="secondary">
          Back to sign in
        </ButtonLink>
      </div>
    );
  }
  return <FullPageLoader label="Completing sign-in" />;
}
