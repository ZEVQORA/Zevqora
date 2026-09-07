import { useState, type FormEvent } from 'react';
import { admin } from '../data';
import { useAsync } from '@/lib/useAsync';
import { useSession } from '@/lib/session';
import { PageHeader, Panel, PanelHeader } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Table, Th, Td } from '@/components/ui/Misc';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { ErrorState, Skeleton, InlineNotice } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';

export default function AdminAdminsPage() {
  const { me } = useSession();
  const q = useAsync(() => admin.admins(), []);
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [revoking, setRevoking] = useState<{ user_id: string; email: string | null } | null>(null);
  const superadmin = me?.adminRole === 'superadmin';
  const grant = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPending(true);
    const fd = new FormData(e.currentTarget);
    try {
      await admin.grantAdmin(String(fd.get('email') || ''), String(fd.get('role') || 'admin'));
      await q.reload(true);
      toast({ tone: 'success', title: 'Admin granted' });
      (e.target as HTMLFormElement).reset();
    } catch (err) {
      toast({ tone: 'error', title: 'Could not grant', description: errorMessage(err) });
    } finally {
      setPending(false);
    }
  };
  const revoke = async () => {
    if (!revoking) return;
    setPending(true);
    try {
      await admin.revokeAdmin(revoking.user_id);
      await q.reload(true);
      setRevoking(null);
      toast({ tone: 'success', title: 'Admin revoked' });
    } catch (err) {
      toast({ tone: 'error', title: 'Could not revoke', description: errorMessage(err) });
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <PageHeader eyebrow="Internal" title="Admins" description="Admin access is a database role checked on every request. Grants and revocations are audited." />
      {!superadmin && <InlineNotice tone="info" className="mb-4">Only superadmins can grant or revoke admin access.</InlineNotice>}
      {q.error && <ErrorState message={q.error} onRetry={() => q.reload()} />}
      {!q.data ? <Skeleton className="h-48 rounded-lg" /> : (
        <Panel className="p-2">
          <Table minWidth={560}>
            <thead><tr><Th>Admin</Th><Th>Role</Th><Th>Since</Th><Th /></tr></thead>
            <tbody>
              {q.data.admins.map((a) => (
                <tr key={a.user_id}><Td>{a.display_name || a.email}<div className="font-mono text-technical text-subtle">{a.email}</div></Td><Td mono>{a.role}</Td><Td mono>{dateTime(a.created_at)}</Td><Td align="right">{superadmin && a.user_id !== me?.user.id && <Button size="xs" variant="ghost" className="text-rejected" onClick={() => setRevoking(a)}>Revoke</Button>}</Td></tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
      {superadmin && (
        <Panel className="mt-4">
          <PanelHeader title="Grant admin" description="The person must already have a ZEVQORA account." />
          <form onSubmit={grant} className="grid gap-3 p-5 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <Field id="ga-email" label="Email"><Input id="ga-email" name="email" type="email" required /></Field>
            <Field id="ga-role" label="Role"><Select id="ga-role" name="role" defaultValue="admin"><option value="admin">admin</option><option value="superadmin">superadmin</option></Select></Field>
            <Button type="submit" loading={pending}>Grant</Button>
          </form>
        </Panel>
      )}
      <ConfirmDialog open={Boolean(revoking)} onClose={() => setRevoking(null)} onConfirm={revoke} title={`Revoke admin from ${revoking?.email}?`} description="They lose access to the control centre immediately." confirmLabel="Revoke" tone="danger" loading={pending} />
    </>
  );
}
