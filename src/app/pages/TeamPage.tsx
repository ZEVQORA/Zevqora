import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { UserPlus, Trash2, Mail } from 'lucide-react';
import { useSession } from '@/lib/session';
import { app } from '../data';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Panel, PanelHeader } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Dialog, ConfirmDialog } from '@/components/ui/Dialog';
import { Field, Input, Select } from '@/components/ui/Field';
import { Table, Th, Td, Avatar, CopyButton } from '@/components/ui/Misc';
import { StatusChip } from '@/components/ui/StatusChip';
import { ErrorState, Skeleton, InlineNotice } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { ApiClientError, errorMessage } from '@/lib/api';
import { relativeTime, dateOnly, titleCase } from '@/lib/format';
import type { Member } from '@/lib/types';

export default function TeamPage() {
  const { activeWorkspace, me, refreshMe } = useSession();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const q = useAsync(() => app.members(activeWorkspace!.id), [activeWorkspace?.id], { enabled: Boolean(activeWorkspace) });
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const role = q.data?.role || activeWorkspace?.role || 'viewer';
  const isAdmin = role === 'owner' || role === 'admin';
  const isOwner = role === 'owner';

  useEffect(() => {
    if (params.get('invite') === '1') {
      setOpen(true);
      params.delete('invite');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await app.invite(activeWorkspace.id, { email: String(fd.get('email') || ''), role: String(fd.get('role') || 'member') });
      await q.reload(true);
      if (res.added) {
        setOpen(false);
        toast({ tone: 'success', title: 'Member added', description: `${res.email} already had an account and was added directly.` });
      } else {
        setInviteLink(res.invite_url || null);
      }
    } catch (err) {
      setError(err instanceof ApiClientError && err.code === 'PLAN_LIMIT' ? `${err.message}` : errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  async function changeRole(m: Member, next: string) {
    if (!activeWorkspace) return;
    try {
      await app.setRole(activeWorkspace.id, m.user_id, next);
      await q.reload(true);
      toast({ tone: 'success', title: 'Role updated' });
    } catch (err) {
      toast({ tone: 'error', title: 'Could not change role', description: errorMessage(err) });
    }
  }

  async function remove() {
    if (!activeWorkspace || !removing) return;
    setPending(true);
    try {
      await app.removeMember(activeWorkspace.id, removing.user_id);
      const self = removing.user_id === me?.user.id;
      setRemoving(null);
      if (self) await refreshMe();
      else await q.reload(true);
      toast({ tone: 'success', title: self ? 'You left the workspace' : 'Member removed' });
    } catch (err) {
      toast({ tone: 'error', title: 'Could not remove', description: errorMessage(err) });
    } finally {
      setPending(false);
    }
  }

  const seatLimit = q.data?.seat_limit ?? null;
  const seatsUsed = (q.data?.members.length || 0) + (q.data?.invites.length || 0);

  return (
    <>
      <PageHeader eyebrow={activeWorkspace?.name} title="Team" description="Roles are enforced on the server. Only the owner can grant or revoke admin." actions={isAdmin && <Button onClick={() => setOpen(true)}><UserPlus size={14} /> Invite</Button>} />
      {seatLimit !== null && seatsUsed >= seatLimit && <InlineNotice tone="warning" className="mb-4">All {seatLimit} seat{seatLimit === 1 ? '' : 's'} on this plan are in use. <a href="/app/usage" className="ml-1 underline underline-offset-4">See plans</a></InlineNotice>}
      {q.error && <ErrorState message={q.error} onRetry={() => q.reload()} />}
      {!q.data ? (
        <Skeleton className="h-56 rounded-lg" />
      ) : (
        <>
          <Panel className="p-2">
            <PanelHeader title="Members" description={`${q.data.members.length} member${q.data.members.length === 1 ? '' : 's'}${seatLimit !== null ? ` · ${seatLimit} seats on plan` : ''}`} className="px-3" />
            <Table minWidth={720}>
              <thead><tr><Th>Member</Th><Th>Role</Th><Th>Status</Th><Th>Last active</Th><Th>Joined</Th><Th /></tr></thead>
              <tbody>
                {q.data.members.map((m) => {
                  const self = m.user_id === me?.user.id;
                  const canEdit = isAdmin && m.role !== 'owner' && (isOwner || m.role !== 'admin');
                  return (
                    <tr key={m.user_id}>
                      <Td>
                        <div className="flex items-center gap-3">
                          <Avatar name={m.display_name || m.email} src={m.avatar_url} size={30} />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-ink">{m.display_name || m.username || m.email}{self && <span className="ml-2 font-mono text-technical text-subtle">you</span>}</p>
                            <p className="truncate font-mono text-technical text-subtle">{m.email}</p>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        {canEdit ? (
                          <Select value={m.role} onChange={(e) => changeRole(m, e.target.value)} className="h-8 w-32 text-caption" aria-label={`Role for ${m.email}`}>
                            {isOwner && <option value="admin">Admin</option>}
                            <option value="member">Member</option>
                            <option value="viewer">Viewer</option>
                          </Select>
                        ) : (
                          <span className="font-mono text-technical uppercase text-ink">{m.role}</span>
                        )}
                      </Td>
                      <Td><StatusChip status="active" /></Td>
                      <Td mono>{m.last_active_at ? relativeTime(m.last_active_at) : '—'}</Td>
                      <Td mono>{dateOnly(m.joined_at)}</Td>
                      <Td align="right">
                        {m.role !== 'owner' && (self || (isAdmin && (isOwner || m.role !== 'admin'))) && (
                          <Button size="xs" variant="ghost" className="text-rejected" onClick={() => setRemoving(m)} aria-label={self ? 'Leave workspace' : `Remove ${m.email}`}>
                            <Trash2 size={13} /> {self ? 'Leave' : 'Remove'}
                          </Button>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Panel>
          {isAdmin && (
            <Panel className="mt-4 p-2">
              <PanelHeader title="Pending invites" description="Invitees join automatically when they sign in with the invited address, or via the link." className="px-3" />
              {!q.data.invites.length ? (
                <p className="text-technical px-3 pb-4 text-subtle">No pending invites.</p>
              ) : (
                <Table minWidth={560}>
                  <thead><tr><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th>Expires</Th><Th /></tr></thead>
                  <tbody>
                    {q.data.invites.map((i) => (
                      <tr key={i.id}>
                        <Td mono><Mail size={12} className="mr-1.5 inline text-subtle" />{i.email}</Td>
                        <Td mono>{i.role}</Td>
                        <Td><StatusChip status="pending" label="INVITED" /></Td>
                        <Td mono>{dateOnly(i.expires_at)}</Td>
                        <Td align="right"><Button size="xs" variant="ghost" onClick={async () => { await app.cancelInvite(activeWorkspace!.id, i.id); await q.reload(true); }}>Cancel</Button></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Panel>
          )}
        </>
      )}

      <Dialog open={open} onClose={() => { setOpen(false); setInviteLink(null); setError(null); }} title="Invite a teammate" description="Existing accounts are added immediately. Others receive a link to share.">
        {inviteLink ? (
          <div className="flex flex-col gap-4">
            <InlineNotice tone="success">Invite created. No email provider is configured on this deployment, so share the link directly. It expires in 7 days.</InlineNotice>
            <div className="flex items-center gap-2 rounded-md border border-line bg-sunken p-3">
              <code className="min-w-0 flex-1 truncate font-mono text-technical text-ink">{inviteLink}</code>
              <CopyButton value={inviteLink} size="xs" label="Copy link" />
            </div>
            <div className="flex justify-end"><Button onClick={() => { setOpen(false); setInviteLink(null); }}>Done</Button></div>
          </div>
        ) : (
          <form onSubmit={invite} className="flex flex-col gap-4">
            <Field id="email" label="Email">
              <Input id="email" name="email" type="email" required autoFocus />
            </Field>
            <Field id="role" label="Role" hint={isOwner ? 'Admins can manage members and projects.' : 'Only the owner can grant admin.'}>
              <Select id="role" name="role" defaultValue="member">
                {isOwner && <option value="admin">Admin</option>}
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </Select>
            </Field>
            <div className="rounded-md border border-line bg-sunken p-3 text-technical text-muted">
              <p><span className="text-ink">Admin</span> · manage members, projects, connections, settings</p>
              <p><span className="text-ink">Member</span> · create projects, connections, run analysis and experiments</p>
              <p><span className="text-ink">Viewer</span> · read everything, change nothing</p>
            </div>
            {error && <p role="alert" className="text-caption text-rejected">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
              <Button type="submit" loading={pending}>Send invite</Button>
            </div>
          </form>
        )}
      </Dialog>

      <ConfirmDialog open={Boolean(removing)} onClose={() => setRemoving(null)} onConfirm={remove} title={removing?.user_id === me?.user.id ? 'Leave this workspace?' : `Remove ${removing?.display_name || removing?.email}?`} description="Access ends immediately. Their past actions and evidence are kept." confirmLabel={removing?.user_id === me?.user.id ? 'Leave' : 'Remove'} tone="danger" loading={pending} />
      <p className="text-technical mt-4 font-mono text-subtle">Roles: {['owner', 'admin', 'member', 'viewer'].map(titleCase).join(' › ')}</p>
    </>
  );
}
