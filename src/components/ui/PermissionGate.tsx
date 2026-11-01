import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { useSession } from '@/lib/session';

const RANK: Record<string, number> = { viewer: 1, member: 2, admin: 3, owner: 4 };

/**
 * Hides or explains an action the current workspace role cannot take. This is
 * presentation only: every API checks the role again on the server.
 */
export function PermissionGate({ min, children, fallback = 'explain' }: { min: 'viewer' | 'member' | 'admin' | 'owner'; children: ReactNode; fallback?: 'hide' | 'explain' }) {
  const { activeWorkspace } = useSession();
  const role = activeWorkspace?.role || 'viewer';
  if ((RANK[role] || 0) >= RANK[min]) return <>{children}</>;
  if (fallback === 'hide') return null;
  return (
    <span role="note" className="inline-flex items-center gap-1.5 rounded-md border border-line bg-sunken px-2.5 py-1.5 text-[12px] text-muted">
      <Lock size={12} aria-hidden /> Needs the {min} role (you are {role}).
    </span>
  );
}

export function useWorkspaceRole() {
  const { activeWorkspace } = useSession();
  const role = activeWorkspace?.role || 'viewer';
  return { role, atLeast: (min: 'viewer' | 'member' | 'admin' | 'owner') => (RANK[role] || 0) >= RANK[min] };
}
