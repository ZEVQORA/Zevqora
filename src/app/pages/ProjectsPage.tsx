import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Plus, Archive, Settings2 } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useProjects } from '../AppShell';
import { app } from '../data';
import { PageHeader, Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Dialog, ConfirmDialog } from '@/components/ui/Dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { EmptyState, Skeleton, InlineNotice } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { ApiClientError, errorMessage } from '@/lib/api';
import { relativeTime, titleCase } from '@/lib/format';
import type { Project } from '@/lib/types';
import { cn } from '@/lib/cn';

export default function ProjectsPage() {
  const { activeWorkspace, setActiveProjectId, activeProjectId } = useSession();
  const { projects, loading, reload } = useProjects();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.get('new') === '1');
  const [editing, setEditing] = useState<Project | null>(null);
  const [archiving, setArchiving] = useState<Project | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planLimit, setPlanLimit] = useState<string | null>(null);
  const toast = useToast();
  const navigate = useNavigate();
  const canWrite = activeWorkspace && ['owner', 'admin', 'member'].includes(activeWorkspace.role);

  useEffect(() => {
    if (params.get('new') === '1') {
      setOpen(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const { project } = await app.createProject(activeWorkspace.id, { name: String(fd.get('name') || ''), description: String(fd.get('description') || ''), source_kind: String(fd.get('source_kind') || 'runtime'), repo_url: String(fd.get('repo_url') || '') });
      await reload();
      setActiveProjectId(project.id);
      setOpen(false);
      toast({ tone: 'success', title: 'Project created', description: 'Next: connect a runtime so telemetry can arrive.' });
      navigate('/app/connections?new=1');
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'PLAN_LIMIT') setPlanLimit(err.message);
      else setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      await app.updateProject(editing.id, { name: String(fd.get('name') || ''), description: String(fd.get('description') || ''), repo_url: String(fd.get('repo_url') || ''), settings: { quality_gate: Number(fd.get('quality_gate')), max_latency_regression_pct: Number(fd.get('max_latency')) } });
      await reload();
      setEditing(null);
      toast({ tone: 'success', title: 'Project updated' });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  async function archive() {
    if (!archiving) return;
    setPending(true);
    try {
      await app.archiveProject(archiving.id);
      if (activeProjectId === archiving.id) setActiveProjectId(null);
      await reload();
      setArchiving(null);
      toast({ tone: 'success', title: 'Project archived', description: 'Evidence is preserved. Active connections were revoked.' });
    } catch (err) {
      toast({ tone: 'error', title: 'Could not archive', description: errorMessage(err) });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <PageHeader eyebrow={activeWorkspace?.name} title="Projects" description="One project per AI product or service. Telemetry, opportunities, experiments and evidence stay together." actions={canWrite && <Button onClick={() => setOpen(true)}><Plus size={14} /> Add project</Button>} />
      {planLimit && <InlineNotice tone="warning" className="mb-4">{planLimit} <a href="/app/usage" className="ml-1 underline underline-offset-4">See plans</a></InlineNotice>}
      {loading && !projects.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-lg" />)}</div>
      ) : !projects.length ? (
        <EmptyState title="No projects yet" description="Connect your first AI workload. ZEVQORA reads telemetry from your runtime; it never needs your source code." zev="pose-waving" action={canWrite && <Button onClick={() => setOpen(true)}><Plus size={14} /> Add project</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <Panel key={p.id} className={cn('flex flex-col p-5 transition-control', activeProjectId === p.id && 'ring-2 ring-accent/40')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-h4 truncate text-ink">{p.name}</h3>
                  <p className="text-technical mt-1 font-mono text-subtle">{p.slug} · {titleCase(p.source_kind)}</p>
                </div>
                {canWrite && (
                  <button type="button" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-subtle transition-control hover:bg-ink/5 hover:text-ink">
                    <Settings2 size={15} />
                  </button>
                )}
              </div>
              <p className="text-caption mt-3 line-clamp-2 flex-1 text-muted">{p.description || 'No description.'}</p>
              <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-3 font-mono text-technical text-subtle">
                <div>quality gate <span className="text-ink">{p.settings?.quality_gate ?? 0.95}</span></div>
                <div>latency cap <span className="text-ink">+{p.settings?.max_latency_regression_pct ?? 50}%</span></div>
                <div className="col-span-2">created {relativeTime(p.created_at)}</div>
              </dl>
              <div className="mt-4 flex items-center gap-2">
                <Button size="sm" variant={activeProjectId === p.id ? 'secondary' : 'primary'} onClick={() => { setActiveProjectId(p.id); navigate('/app/runtime'); }}>
                  {activeProjectId === p.id ? 'Selected' : 'Select'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setActiveProjectId(p.id); navigate('/app/connections'); }}>
                  Connections
                </Button>
                {activeWorkspace && ['owner', 'admin'].includes(activeWorkspace.role) && (
                  <Button size="sm" variant="ghost" className="ml-auto text-subtle" onClick={() => setArchiving(p)} aria-label={`Archive ${p.name}`}>
                    <Archive size={14} />
                  </Button>
                )}
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title="Add a project" description="Name the AI product or service you want to optimize.">
        <form onSubmit={create} className="flex flex-col gap-4" id="create-project">
          <Field id="name" label="Project name">
            <Input id="name" name="name" required minLength={2} maxLength={80} autoFocus placeholder="support-assistant" />
          </Field>
          <Field id="description" label="Description" hint="Optional.">
            <Textarea id="description" name="description" maxLength={400} placeholder="Customer support assistant: intent classification, thread summaries, reply drafts." />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="source_kind" label="Primary source">
              <Select id="source_kind" name="source_kind" defaultValue="runtime">
                <option value="runtime">Runtime API</option>
                <option value="server">Server telemetry</option>
                <option value="repository">Repository (desktop engine)</option>
                <option value="manual">Manual import</option>
              </Select>
            </Field>
            <Field id="repo_url" label="Repository URL" hint="Optional, for reference.">
              <Input id="repo_url" name="repo_url" placeholder="https://github.com/org/repo" />
            </Field>
          </div>
          {error && <p role="alert" className="text-caption text-rejected">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" loading={pending}>Create project</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={Boolean(editing)} onClose={() => setEditing(null)} title="Project settings" description="Quality gate and latency cap apply to every experiment in this project.">
        {editing && (
          <form onSubmit={save} className="flex flex-col gap-4">
            <Field id="e-name" label="Project name">
              <Input id="e-name" name="name" defaultValue={editing.name} required minLength={2} maxLength={80} />
            </Field>
            <Field id="e-desc" label="Description">
              <Textarea id="e-desc" name="description" defaultValue={editing.description} maxLength={400} />
            </Field>
            <Field id="e-repo" label="Repository URL">
              <Input id="e-repo" name="repo_url" defaultValue={editing.repo_url || ''} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="e-qg" label="Quality gate" hint="Candidate quality must reach this floor (0.5–1).">
                <Input id="e-qg" name="quality_gate" type="number" step="0.01" min={0.5} max={1} defaultValue={editing.settings?.quality_gate ?? 0.95} />
              </Field>
              <Field id="e-lat" label="Max latency regression %" hint="Candidate p50 may exceed baseline by this much.">
                <Input id="e-lat" name="max_latency" type="number" step="1" min={0} max={500} defaultValue={editing.settings?.max_latency_regression_pct ?? 50} />
              </Field>
            </div>
            {error && <p role="alert" className="text-caption text-rejected">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)} disabled={pending}>Cancel</Button>
              <Button type="submit" loading={pending}>Save</Button>
            </div>
          </form>
        )}
      </Dialog>

      <ConfirmDialog open={Boolean(archiving)} onClose={() => setArchiving(null)} onConfirm={archive} title={`Archive ${archiving?.name}?`} description="Evidence and experiments are preserved. Active connections are revoked immediately and the project leaves plan limits." confirmLabel="Archive project" tone="danger" loading={pending} />
    </>
  );
}
