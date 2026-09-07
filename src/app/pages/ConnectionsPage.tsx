import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Plus, Radio, Server, FolderGit2, Github, KeyRound, RotateCw, Ban } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useProjects } from '../AppShell';
import { app, listConnections } from '../data';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Panel, KeyValue } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { StatusChip, LiveDot } from '@/components/ui/StatusChip';
import { Dialog, ConfirmDialog } from '@/components/ui/Dialog';
import { Field, Input, Select, Checkbox, Toggle } from '@/components/ui/Field';
import { EmptyState, ErrorState, Skeleton, InlineNotice } from '@/components/ui/States';
import { CopyButton, Code } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api';
import { relativeTime, dateTime } from '@/lib/format';
import type { Connection } from '@/lib/types';
import { cn } from '@/lib/cn';

const KINDS = [
  { kind: 'server_telemetry', label: 'Server telemetry', Icon: Server, body: 'A signed, read-only stream of AI call metadata from your server.', available: true },
  { kind: 'runtime_api', label: 'Runtime API', Icon: Radio, body: 'Instrument your application code with the HTTP ingest endpoint.', available: true },
  { kind: 'repository', label: 'Repository / Local', Icon: FolderGit2, body: 'Scan code locally with the desktop engine. Only findings are published.', available: true },
  { kind: 'github', label: 'GitHub', Icon: Github, body: 'GitHub App for repository evidence and change handoff.', available: false },
];

function liveStatus(c: Connection): 'live' | 'idle' | 'stale' | 'waiting' {
  if (!c.last_seen_at) return 'waiting';
  const age = Date.now() - new Date(c.last_seen_at).getTime();
  return age < 5 * 60_000 ? 'live' : age < 24 * 60 * 60_000 ? 'idle' : 'stale';
}

export default function ConnectionsPage() {
  const { activeWorkspace, activeProjectId, me } = useSession();
  const { projects, activeProject } = useProjects();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const q = useAsync(() => listConnections(activeWorkspace!.id), [activeWorkspace?.id], { enabled: Boolean(activeWorkspace) });
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('server_telemetry');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ token: string; connection: Connection } | null>(null);
  const [revoking, setRevoking] = useState<Connection | null>(null);
  const [rotating, setRotating] = useState<Connection | null>(null);
  const canWrite = activeWorkspace && ['owner', 'admin', 'member'].includes(activeWorkspace.role);

  useEffect(() => {
    if (params.get('new') === '1') {
      setOpen(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const rows = useMemo(() => (q.data || []).filter((c) => !activeProjectId || c.project_id === activeProjectId), [q.data, activeProjectId]);
  const origin = window.location.origin;

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const projectId = String(fd.get('project_id') || '');
    try {
      const res = await app.createConnection(projectId, { kind, name: String(fd.get('name') || ''), capture_samples: fd.get('capture') === 'on' });
      await q.reload(true);
      setOpen(false);
      if (res.token) setIssued({ token: res.token, connection: res.connection });
      else toast({ tone: 'success', title: 'Connection created', description: res.connection.metadata?.instructions });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  async function revoke() {
    if (!revoking) return;
    setPending(true);
    try {
      await app.revokeConnection(revoking.id);
      await q.reload(true);
      setRevoking(null);
      toast({ tone: 'success', title: 'Connection revoked', description: 'The token no longer authenticates.' });
    } catch (err) {
      toast({ tone: 'error', title: 'Could not revoke', description: errorMessage(err) });
    } finally {
      setPending(false);
    }
  }

  async function rotate() {
    if (!rotating) return;
    setPending(true);
    try {
      const res = await app.rotateConnection(rotating.id);
      await q.reload(true);
      setRotating(null);
      setIssued({ token: res.token, connection: res.connection });
    } catch (err) {
      toast({ tone: 'error', title: 'Could not rotate', description: errorMessage(err) });
    } finally {
      setPending(false);
    }
  }

  async function toggleCapture(c: Connection, value: boolean) {
    try {
      await app.updateConnection(c.id, { capture_samples: value });
      await q.reload(true);
    } catch (err) {
      toast({ tone: 'error', title: 'Could not update', description: errorMessage(err) });
    }
  }

  const snippet = (token: string) => `curl -X POST ${origin}/api/telemetry/ingest \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"events":[{"trace_id":"req_1","provider":"openai","model":"gpt-4o","operation":"classify.intent","status":"ok","input_tokens":812,"output_tokens":14,"latency_ms":1980}]}'`;

  return (
    <>
      <PageHeader eyebrow={activeWorkspace?.name} title="Connections" description="Every connection shows what it reads, when it was last used, and how to revoke it. Tokens are shown once." actions={canWrite && <Button onClick={() => setOpen(true)}><Plus size={14} /> New connection</Button>} />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {KINDS.map((k) => (
          <button key={k.kind} type="button" disabled={!k.available || !canWrite} onClick={() => { setKind(k.kind); setOpen(true); }} className={cn('rounded-lg border border-line bg-surface/70 p-4 text-left transition-control hover:bg-surface hover:shadow-lift disabled:cursor-not-allowed disabled:opacity-70')}>
            <div className="flex items-center justify-between">
              <k.Icon size={18} className="text-accent-text" aria-hidden />
              {!k.available && <span className="rounded-sm bg-sunken px-1.5 py-0.5 font-mono text-[10px] uppercase text-subtle">Coming soon</span>}
            </div>
            <p className="text-caption mt-3 font-medium text-ink">{k.label}</p>
            <p className="text-technical mt-1 text-muted">{k.body}</p>
          </button>
        ))}
      </div>

      {q.error && <ErrorState message={q.error} onRetry={() => q.reload()} />}
      {q.loading && !q.data ? (
        <Skeleton className="h-40 rounded-lg" />
      ) : !rows.length ? (
        <EmptyState title="No connections yet" description="Connect your first AI workload. A telemetry token is scoped to one project, hashed at rest and revocable at any time." zev="pose-waving" action={canWrite && <Button onClick={() => setOpen(true)}><Plus size={14} /> New connection</Button>} />
      ) : (
        <ul className="grid gap-3 xl:grid-cols-2">
          {rows.map((c) => {
            const project = projects.find((p) => p.id === c.project_id);
            const status = liveStatus(c);
            const K = KINDS.find((k) => k.kind === c.kind);
            return (
              <li key={c.id}>
                <Panel className={cn('p-5', c.status === 'revoked' && 'opacity-70')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {K && <K.Icon size={18} className="shrink-0 text-accent-text" aria-hidden />}
                      <div className="min-w-0">
                        <p className="text-h4 truncate text-ink">{c.name}</p>
                        <p className="text-technical font-mono text-subtle">{K?.label} · {project?.name || 'workspace'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {c.status === 'active' && ['server_telemetry', 'runtime_api'].includes(c.kind) && <LiveDot status={status} />}
                      <StatusChip status={c.status} />
                    </div>
                  </div>
                  <KeyValue className="mt-4" items={[{ k: 'Token', v: c.token_prefix ? `zqt_${c.token_prefix}_••••${c.token_last4}` : '—' }, { k: 'Permissions', v: (c.permissions?.reads || []).join(', ') || '—' }, { k: 'Never reads', v: (c.permissions?.never || []).join(', ') || '—' }, { k: 'Created', v: dateTime(c.created_at) }, { k: 'Last used', v: c.last_used_at ? relativeTime(c.last_used_at) : 'never' }, { k: 'Last seen', v: c.last_seen_at ? relativeTime(c.last_seen_at) : 'waiting for telemetry' }]} />
                  {c.metadata?.instructions && <InlineNotice tone="info" className="mt-3">{c.metadata.instructions}</InlineNotice>}
                  {c.status === 'active' && ['server_telemetry', 'runtime_api'].includes(c.kind) && (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                      <div className="flex items-center gap-3">
                        <Toggle id={`cap-${c.id}`} checked={Boolean(c.metadata?.capture_samples)} onChange={(v) => toggleCapture(c, v)} label="Capture sanitized samples" disabled={!canWrite} />
                        <span className="text-technical text-muted">Capture sanitized samples for replay</span>
                      </div>
                      {canWrite && (
                        <div className="flex gap-2">
                          <Button size="sm" variant="secondary" onClick={() => setRotating(c)}><RotateCw size={13} /> Rotate</Button>
                          <Button size="sm" variant="ghost" className="text-rejected" onClick={() => setRevoking(c)}><Ban size={13} /> Revoke</Button>
                        </div>
                      )}
                    </div>
                  )}
                </Panel>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title="New connection" description="Scoped to one project. The token is shown exactly once.">
        <form onSubmit={create} className="flex flex-col gap-4">
          <Field id="kind" label="Kind">
            <Select id="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.filter((k) => k.available).map((k) => (
                <option key={k.kind} value={k.kind}>{k.label}</option>
              ))}
            </Select>
          </Field>
          <Field id="project_id" label="Project">
            <Select id="project_id" name="project_id" defaultValue={activeProject?.id || projects[0]?.id || ''} required>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
          <Field id="cname" label="Name" hint="Where it runs, e.g. production-api-eu.">
            <Input id="cname" name="name" required minLength={2} maxLength={80} autoFocus />
          </Field>
          {kind !== 'repository' && <Checkbox id="capture" name="capture" defaultChecked={Boolean(me?.flags?.cloud_replay)} label="Capture sanitized request and response samples" description="Needed for replay on real requests. Secrets redacted, non-text dropped, size capped." />}
          {kind === 'repository' && <InlineNotice tone="info">Repository connections use the ZEVQORA desktop engine. Code is scanned on your machine; only findings and evidence are published here.</InlineNotice>}
          {!projects.length && <InlineNotice tone="warning">Create a project first.</InlineNotice>}
          {error && <p role="alert" className="text-caption text-rejected">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" loading={pending} disabled={!projects.length}><KeyRound size={14} /> Create</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={Boolean(issued)} onClose={() => setIssued(null)} title="Connection token" description="Copy it now. For your security it will never be shown again." size="lg">
        {issued && (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-accent/30 bg-accent-subtle p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-eyebrow uppercase text-accent-text">{issued.connection.name}</p>
                <CopyButton value={issued.token} label="Copy token" size="xs" />
              </div>
              <code className="mt-2 block break-all font-mono text-technical text-ink">{issued.token}</code>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-caption font-medium text-ink">Send your first event</p>
                <CopyButton value={snippet(issued.token)} label="Copy" size="xs" />
              </div>
              <Code block>{snippet(issued.token)}</Code>
              <p className="text-technical mt-2 text-subtle">Payload reference and SDK snippets in <Link to="/app/docs" className="underline underline-offset-4">Docs</Link>.</p>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setIssued(null)}>I saved the token</Button>
            </div>
          </div>
        )}
      </Dialog>

      <ConfirmDialog open={Boolean(revoking)} onClose={() => setRevoking(null)} onConfirm={revoke} title={`Revoke ${revoking?.name}?`} description="The token stops authenticating immediately. Telemetry already received is kept." confirmLabel="Revoke" tone="danger" loading={pending} />
      <ConfirmDialog open={Boolean(rotating)} onClose={() => setRotating(null)} onConfirm={rotate} title={`Rotate ${rotating?.name}?`} description="A new token is issued and the old one stops working immediately." confirmLabel="Rotate token" loading={pending} />
    </>
  );
}
