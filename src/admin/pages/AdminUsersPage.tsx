import { useState } from 'react';
import { Link } from 'react-router';
import { Search } from 'lucide-react';
import { admin } from '../data';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Panel } from '@/components/ui/Panel';
import { Input } from '@/components/ui/Field';
import { Table, Th, Td, Avatar } from '@/components/ui/Misc';
import { StatusChip } from '@/components/ui/StatusChip';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { money, relativeTime, dateOnly } from '@/lib/format';

export default function AdminUsersPage() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const q = useAsync(() => admin.users(debounced), [debounced]);
  return (
    <>
      <PageHeader eyebrow="Internal" title="Users" description="Search by email, name or username. Passwords and OAuth secrets are never shown." />
      <div className="relative mb-4 max-w-md">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
        <Input value={query} onChange={(e) => { setQuery(e.target.value); clearTimeout((window as unknown as { _t?: number })._t); (window as unknown as { _t?: number })._t = window.setTimeout(() => setDebounced(e.target.value), 300); }} placeholder="Search users" className="pl-9" aria-label="Search users" />
      </div>
      {q.error && <ErrorState message={q.error} onRetry={() => q.reload()} />}
      {!q.data ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : (
        <Panel className="p-2">
          <Table minWidth={900}>
            <thead><tr><Th>User</Th><Th>Plan</Th><Th>Credits</Th><Th>Workspaces</Th><Th>Last active</Th><Th>Joined</Th><Th>Status</Th></tr></thead>
            <tbody>
              {q.data.users.map((u) => (
                <tr key={u.id} className="hover:bg-ink/[0.02]">
                  <Td>
                    <Link to={`/admin/users/${u.id}`} className="flex items-center gap-3">
                      <Avatar name={u.display_name || u.email} src={u.avatar_url} size={28} />
                      <span className="min-w-0"><span className="block truncate font-medium text-ink">{u.display_name || u.username || '—'}</span><span className="block truncate font-mono text-technical text-subtle">{u.email}</span></span>
                      {u.admin_role && <span className="rounded-sm bg-warning-bg px-1.5 py-0.5 font-mono text-[10px] uppercase text-warning">{u.admin_role}</span>}
                    </Link>
                  </Td>
                  <Td mono>{u.plan}<div className="text-subtle">{u.subscription_status}{u.stripe_managed ? ' · stripe' : ''}</div></Td>
                  <Td mono>{u.credits ? `${money(u.credits.used_usd)} / ${money(u.credits.included_usd)}` : '—'}</Td>
                  <Td mono>{u.workspaces_owned} owned</Td>
                  <Td mono>{u.last_active_at ? relativeTime(u.last_active_at) : '—'}</Td>
                  <Td mono>{dateOnly(u.created_at)}</Td>
                  <Td>{u.suspended_at ? <StatusChip status="revoked" label="SUSPENDED" /> : <StatusChip status="active" />}</Td>
                </tr>
              ))}
              {!q.data.users.length && <tr><Td className="text-subtle" colSpan={7}>No users match.</Td></tr>}
            </tbody>
          </Table>
        </Panel>
      )}
    </>
  );
}
