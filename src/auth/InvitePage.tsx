import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { FullPageLoader } from '@/brand/BrandLoader';
import { useSession } from '@/lib/session';
import { api, errorMessage } from '@/lib/api';
import { InlineNotice } from '@/components/ui/States';
import { ButtonLink } from '@/components/ui/Button';

export default function InvitePage() {
  const { token = '' } = useParams();
  const { status, refreshMe, setActiveWorkspaceId } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'signed_in' || !token) return;
    let active = true;
    api<{ workspace: { id: string; name: string } }>('/api/invites/accept', { method: 'POST', body: { token } })
      .then(async ({ workspace }) => {
        await refreshMe();
        if (!active) return;
        setActiveWorkspaceId(workspace.id);
        navigate('/app', { replace: true });
      })
      .catch((e) => active && setError(errorMessage(e)));
    return () => {
      active = false;
    };
  }, [status, token, refreshMe, setActiveWorkspaceId, navigate]);

  if (status === 'loading') return <FullPageLoader />;
  if (status === 'signed_out' || status === 'unconfigured') return <Navigate to={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} replace />;
  if (error) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <InlineNotice tone="danger">{error}</InlineNotice>
        <ButtonLink to="/app" variant="secondary">
          Go to your workspace
        </ButtonLink>
      </div>
    );
  }
  return <FullPageLoader label="Joining workspace" />;
}
