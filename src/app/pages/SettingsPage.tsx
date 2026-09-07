import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useSession } from '@/lib/session';
import { app } from '../data';
import { PageHeader, Panel, PanelHeader, KeyValue } from '@/components/ui/Panel';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Field, Input, Select, Toggle } from '@/components/ui/Field';
import { Tabs, Avatar } from '@/components/ui/Misc';
import { InlineNotice } from '@/components/ui/States';
import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api';
import { getSupabase } from '@/lib/supabase';
import { dateOnly, titleCase } from '@/lib/format';

type Tab = 'profile' | 'workspace' | 'security';

function timezones() {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') || ['UTC'];
  } catch {
    return ['UTC'];
  }
}

export default function SettingsPage() {
  const { me, refreshMe, activeWorkspace, setActiveWorkspaceId } = useSession();
  const { tab: tabParam } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const tab: Tab = tabParam === 'workspace' || tabParam === 'security' ? tabParam : 'profile';
  const [pending, setPending] = useState(false);
  const [createOpen, setCreateOpen] = useState(params.get('create') === '1');
  const zones = useMemo(timezones, []);
  const isAdmin = activeWorkspace && ['owner', 'admin'].includes(activeWorkspace.role);

  useEffect(() => {
    if (params.get('create') === '1') {
      params.delete('create');
      setParams(params, { replace: true });
      setCreateOpen(true);
    }
  }, [params, setParams]);

  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const fd = new FormData(e.currentTarget);
    try {
      await app.updateMe({ display_name: String(fd.get('display_name') || ''), username: String(fd.get('username') || ''), timezone: String(fd.get('timezone') || ''), avatar_url: String(fd.get('avatar_url') || '') });
      await refreshMe();
      toast({ tone: 'success', title: 'Profile saved' });
    } catch (err) {
      toast({ tone: 'error', title: 'Could not save', description: errorMessage(err) });
    } finally {
      setPending(false);
    }
  }

  async function togglePref(key: string, value: boolean) {
    try {
      await app.updateMe({ notification_prefs: { [key]: value } });
      await refreshMe();
    } catch (err) {
      toast({ tone: 'error', title: 'Could not update', description: errorMessage(err) });
    }
  }

  async function saveWorkspace(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setPending(true);
    const fd = new FormData(e.currentTarget);
    try {
      await app.updateWorkspace(activeWorkspace.id, { name: String(fd.get('name') || ''), data_retention_days: Number(fd.get('retention')), settings: { quality_gate: Number(fd.get('quality_gate')), max_latency_regression_pct: Number(fd.get('max_latency')) } });
      await refreshMe();
      toast({ tone: 'success', title: 'Workspace saved' });
    } catch (err) {
      toast({ tone: 'error', title: 'Could not save', description: errorMessage(err) });
    } finally {
      setPending(false);
    }
  }

  async function createWorkspace(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const fd = new FormData(e.currentTarget);
    try {
      const { workspace } = await app.createWorkspace(String(fd.get('name') || ''));
      await refreshMe();
      setActiveWorkspaceId(workspace.id);
      setCreateOpen(false);
      toast({ tone: 'success', title: 'Workspace created' });
      navigate('/app/projects?new=1');
    } catch (err) {
      toast({ tone: 'error', title: 'Could not create workspace', description: errorMessage(err) });
    } finally {
      setPending(false);
    }
  }

  async function signOutEverywhere() {
    const sb = await getSupabase();
    await sb?.auth.signOut({ scope: 'global' });
    navigate('/login');
  }

  if (!me) return null;
  const p = me.profile;
  const prefs = p.notification_prefs || {};

  return (
    <>
      <PageHeader eyebrow={activeWorkspace?.name} title="Settings" description="Your profile, this workspace, and account security." />
      <div className="mb-5">
        <Tabs value={tab} onChange={(t) => navigate(`/app/settings/${t}`)} items={[{ value: 'profile', label: 'Profile' }, { value: 'workspace', label: 'Workspace' }, { value: 'security', label: 'Security' }]} />
      </div>

      {tab === 'profile' && (
        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <Panel>
            <PanelHeader title="Profile" description="Shown to your teammates." />
            <form onSubmit={saveProfile} className="flex flex-col gap-4 p-5">
              <div className="flex items-center gap-4">
                <Avatar name={p.display_name || p.username || me.user.email} src={p.avatar_url} size={56} />
                <div className="min-w-0">
                  <p className="text-caption font-medium text-ink">{p.display_name || p.username}</p>
                  <p className="text-technical font-mono text-subtle">{me.user.email}</p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="display_name" label="Name"><Input id="display_name" name="display_name" defaultValue={p.display_name || ''} maxLength={60} /></Field>
                <Field id="username" label="Username" hint="Used to sign in."><Input id="username" name="username" defaultValue={p.username || ''} pattern="[A-Za-z0-9._-]{3,30}" /></Field>
              </div>
              <Field id="email" label="Email" hint="Managed by your login provider."><Input id="email" value={me.user.email || ''} disabled /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="timezone" label="Timezone">
                  <Select id="timezone" name="timezone" defaultValue={p.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}>
                    {zones.map((z) => <option key={z} value={z}>{z}</option>)}
                  </Select>
                </Field>
                <Field id="avatar_url" label="Avatar URL" hint="https only."><Input id="avatar_url" name="avatar_url" defaultValue={p.avatar_url || ''} placeholder="https://…" /></Field>
              </div>
              <div className="flex justify-end"><Button type="submit" loading={pending}>Save profile</Button></div>
            </form>
          </Panel>
          <div className="flex flex-col gap-4">
            <Panel>
              <PanelHeader title="Linked login" />
              <div className="px-5 pb-5">
                <KeyValue items={[{ k: 'Providers', v: (me.user.providers || []).map(titleCase).join(', ') || 'Email' }, { k: 'Member since', v: dateOnly(me.user.created_at) }, { k: 'Last sign-in', v: dateOnly(me.user.last_sign_in_at) }]} />
              </div>
            </Panel>
            <Panel>
              <PanelHeader title="Notifications" description="Email delivery is not configured on this deployment; preferences are stored for when it is." />
              <ul className="divide-y divide-line px-5">
                {[
                  ['experiment_completed', 'Experiment completed', 'When a replay passes or is rejected.'],
                  ['weekly_summary', 'Weekly summary', 'Spend, opportunities and verified savings.'],
                  ['telemetry_alerts', 'Telemetry alerts', 'When a connected runtime goes quiet or errors spike.'],
                  ['product_updates', 'Product updates', 'Occasional notes from the founders.'],
                ].map(([key, label, desc]) => (
                  <li key={key} className="flex items-center justify-between gap-4 py-3">
                    <div><p className="text-caption text-ink">{label}</p><p className="text-technical text-subtle">{desc}</p></div>
                    <Toggle id={`pref-${key}`} checked={Boolean(prefs[key] ?? (key === 'experiment_completed' || key === 'weekly_summary'))} onChange={(v) => togglePref(key, v)} label={label} />
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      )}

      {tab === 'workspace' && activeWorkspace && (
        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <Panel>
            <PanelHeader title="Workspace" description="Defaults apply to new projects; each project can override its gates." />
            {!isAdmin && <div className="px-5 pt-4"><InlineNotice tone="info">Only workspace admins can change these settings.</InlineNotice></div>}
            <form onSubmit={saveWorkspace} className="flex flex-col gap-4 p-5">
              <Field id="ws-name" label="Workspace name"><Input id="ws-name" name="name" defaultValue={activeWorkspace.name} disabled={!isAdmin} required minLength={2} /></Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field id="retention" label="Telemetry retention (days)" hint="Capped by your plan."><Input id="retention" name="retention" type="number" min={7} max={730} defaultValue={activeWorkspace.data_retention_days} disabled={!isAdmin} /></Field>
                <Field id="ws-qg" label="Default quality gate"><Input id="ws-qg" name="quality_gate" type="number" step="0.01" min={0.5} max={1} defaultValue={Number(activeWorkspace.settings?.quality_gate ?? 0.95)} disabled={!isAdmin} /></Field>
                <Field id="ws-lat" label="Max latency regression %"><Input id="ws-lat" name="max_latency" type="number" min={0} max={500} defaultValue={Number(activeWorkspace.settings?.max_latency_regression_pct ?? 50)} disabled={!isAdmin} /></Field>
              </div>
              {isAdmin && <div className="flex justify-end"><Button type="submit" loading={pending}>Save workspace</Button></div>}
            </form>
          </Panel>
          <div className="flex flex-col gap-4">
            <Panel>
              <PanelHeader title="Plan & billing" />
              <div className="px-5 pb-5">
                <KeyValue items={[{ k: 'Plan', v: titleCase(activeWorkspace.plan) }, { k: 'Your role', v: titleCase(activeWorkspace.role) }, { k: 'Slug', v: activeWorkspace.slug }, { k: 'Created', v: dateOnly(activeWorkspace.created_at) }]} />
                <div className="mt-4 flex flex-wrap gap-2">
                  <ButtonLink to="/app/usage" variant="secondary" size="sm">Usage & credits</ButtonLink>
                  <ButtonLink to="/app/team" variant="secondary" size="sm">Members</ButtonLink>
                  <ButtonLink to="/app/connections" variant="secondary" size="sm">Integrations</ButtonLink>
                </div>
              </div>
            </Panel>
            <Panel>
              <PanelHeader title="Data retention & privacy" description="What ZEVQORA keeps, and for how long." />
              <div className="px-5 pb-5">
                <KeyValue mono={false} items={[{ k: 'Telemetry', v: `Purged after ${activeWorkspace.data_retention_days} days or the plan window, whichever is shorter.` }, { k: 'Samples', v: 'Opt-in per connection, sanitized, size-capped.' }, { k: 'Experiments', v: 'Output hashes and short previews only.' }, { k: 'Revocation', v: 'Revoke any connection from Connections; effect is immediate.' }]} />
              </div>
            </Panel>
            <Panel>
              <PanelHeader title="More workspaces" />
              <div className="px-5 pb-5"><Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>Create workspace</Button></div>
            </Panel>
          </div>
        </div>
      )}

      {tab === 'security' && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel>
            <PanelHeader title="Sessions" description="Sign out of every device, including ZEVQORA Desktop." />
            <div className="px-5 pb-5"><Button variant="danger" size="sm" onClick={signOutEverywhere}>Sign out everywhere</Button></div>
          </Panel>
          <Panel>
            <PanelHeader title="Password" description="Password resets are sent by email." />
            <div className="px-5 pb-5"><ButtonLink to="/forgot-password" variant="secondary" size="sm">Reset password</ButtonLink></div>
          </Panel>
          <Panel className="xl:col-span-2">
            <PanelHeader title="How ZEVQORA protects this account" />
            <div className="px-5 pb-5">
              <KeyValue mono={false} items={[{ k: 'Auth', v: 'Supabase Auth with PKCE. Google and GitHub OAuth, email and password.' }, { k: 'Isolation', v: 'Row-level security on every workspace table; every write re-checks your role on the server.' }, { k: 'Tokens', v: 'Connection tokens are hashed at rest and shown once.' }, { k: 'Admin', v: 'Internal admin actions are server-authorized and audit-logged.' }]} />
            </div>
          </Panel>
        </div>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="Create a workspace" description="A workspace holds a team, its projects, evidence and usage." size="sm">
        <form onSubmit={createWorkspace} className="flex flex-col gap-4">
          <Field id="new-ws" label="Workspace name"><Input id="new-ws" name="name" required minLength={2} maxLength={80} autoFocus placeholder="Acme AI" /></Field>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={pending}>Cancel</Button><Button type="submit" loading={pending}>Create</Button></div>
        </form>
      </Dialog>
    </>
  );
}
