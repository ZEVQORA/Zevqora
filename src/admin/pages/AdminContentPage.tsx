import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Eye, History, Plus, Trash2 } from 'lucide-react';
import { useAsync } from '@/lib/useAsync';
import { errorMessage } from '@/lib/api';
import { dateTime, relativeTime } from '@/lib/format';
import { SiteContentOverride, invalidateSiteCaches } from '@/lib/site';
import type { SiteContent } from '@/lib/types';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Drawer } from '@/components/ui/Overlay';
import { ErrorState, InlineNotice, LoadingState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { adminV3, type CmsField, type CmsKeyState, type CmsRevision } from '../data-v3';
import { AdminHeader } from '../shared';

const HomePage = lazy(() => import('@/marketing/HomePage'));
const ProductPage = lazy(() => import('@/marketing/ProductPage'));
const SecurityPage = lazy(() => import('@/marketing/SecurityPage'));
const EvaluationPage = lazy(() => import('@/marketing/EvaluationPage'));
const CompanyPage = lazy(() => import('@/marketing/CompanyPage'));
const PREVIEW: Record<string, React.ComponentType> = { hero: HomePage, home: HomePage, proof: HomePage, status: HomePage, contact: CompanyPage, footer: HomePage, product: ProductPage, security_page: SecurityPage, evaluation_page: EvaluationPage, company_page: CompanyPage };

type Value = Record<string, unknown>;

/** One schema field, rendered as a plain-text control. Content is never HTML. */
function FieldEditor({ id, spec, value, onChange, label }: { id: string; spec: CmsField; value: unknown; onChange: (v: unknown) => void; label: string }) {
  const hint = spec.max ? `Up to ${spec.max} characters.` : undefined;
  switch (spec.type) {
    case 'text':
    case 'href':
    case 'email':
      return (
        <Field id={id} label={`${label}${spec.required ? '' : ' (optional)'}`} hint={spec.type === 'href' ? 'A site path (/evaluation), an https:// URL or a mailto: address.' : hint}>
          <Input id={id} value={typeof value === 'string' ? value : ''} maxLength={spec.max || 300} onChange={(e) => onChange(e.target.value || null)} />
        </Field>
      );
    case 'longtext':
      return (
        <Field id={id} label={`${label}${spec.required ? '' : ' (optional)'}`} hint={hint}>
          <Textarea id={id} value={typeof value === 'string' ? value : ''} maxLength={spec.max} onChange={(e) => onChange(e.target.value || null)} />
        </Field>
      );
    case 'int':
      return (
        <Field id={id} label={label}>
          <Input id={id} type="number" min={spec.min} max={spec.max} value={typeof value === 'number' ? value : ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
        </Field>
      );
    case 'enum':
      return (
        <Field id={id} label={label}>
          <Select id={id} value={String(value ?? spec.values?.[0] ?? '')} onChange={(e) => onChange(e.target.value)}>
            {spec.values?.map((v) => <option key={v} value={v}>{v}</option>)}
          </Select>
        </Field>
      );
    case 'cta': {
      const v = (value as { label?: string; href?: string }) || {};
      return (
        <fieldset className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-2">
          <legend className="px-1 text-caption font-medium text-ink">{label}</legend>
          <Field id={`${id}-label`} label="Label"><Input id={`${id}-label`} value={v.label || ''} maxLength={40} onChange={(e) => onChange({ ...v, label: e.target.value })} /></Field>
          <Field id={`${id}-href`} label="Link"><Input id={`${id}-href`} value={v.href || ''} onChange={(e) => onChange({ ...v, href: e.target.value })} /></Field>
        </fieldset>
      );
    }
    case 'object': {
      const v = (value as Value) || {};
      return (
        <fieldset className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-2">
          <legend className="px-1 text-caption font-medium text-ink">{label}</legend>
          {Object.entries(spec.fields || {}).map(([k, s]) => <FieldEditor key={k} id={`${id}-${k}`} spec={s} label={s.label || k.replace(/_/g, ' ')} value={v[k]} onChange={(x) => onChange({ ...v, [k]: x })} />)}
        </fieldset>
      );
    }
    case 'items': {
      const list = Array.isArray(value) ? (value as Value[]) : [];
      return (
        <fieldset className="rounded-md border border-line p-3">
          <legend className="px-1 text-caption font-medium text-ink">{label} ({list.length}/{spec.max})</legend>
          <ol className="grid gap-3">
            {list.map((item, i) => (
              <li key={i} className="grid gap-2 rounded-md bg-sunken/60 p-3">
                {Object.entries(spec.fields || {}).map(([k, s]) => <FieldEditor key={k} id={`${id}-${i}-${k}`} spec={s} label={`${k.replace(/_/g, ' ')} ${i + 1}`} value={item[k]} onChange={(x) => onChange(list.map((it, j) => (j === i ? { ...it, [k]: x } : it)))} />)}
                <Button size="xs" variant="ghost" className="justify-self-start" onClick={() => onChange(list.filter((_, j) => j !== i))}><Trash2 size={12} aria-hidden /> Remove item {i + 1}</Button>
              </li>
            ))}
          </ol>
          {list.length < (spec.max || 0) && <Button size="xs" variant="secondary" className="mt-2" onClick={() => onChange([...list, Object.fromEntries(Object.keys(spec.fields || {}).map((k) => [k, '']))])}><Plus size={12} aria-hidden /> Add item</Button>}
        </fieldset>
      );
    }
    case 'strings': {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <Field id={id} label={`${label} (one per line, up to ${spec.max})`} hint={spec.itemMax ? `Each line up to ${spec.itemMax} characters.` : undefined}>
          <Textarea id={id} value={list.join('\n')} onChange={(e) => onChange(e.target.value.split('\n').filter((l) => l.trim()).slice(0, spec.max))} />
        </Field>
      );
    }
    default:
      return null;
  }
}

/**
 * Website content: draft → preview → publish, with history and restore.
 * Validation, sanitizing and publishing happen on the server; the browser
 * only edits a draft. Drafts are never readable by the public site.
 */
export default function AdminContentPage() {
  const q = useAsync(() => adminV3.cms(), []);
  const toast = useToast();
  const [key, setKey] = useState<string>('hero');
  const [value, setValue] = useState<Value | null>(null);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [confirm, setConfirm] = useState<null | { kind: 'publish' | 'discard' | 'restore'; revision?: CmsRevision }>(null);
  const [viewing, setViewing] = useState<CmsRevision | null>(null);

  const state: CmsKeyState | undefined = q.data?.keys.find((k) => k.key === key);
  const schema = q.data?.schemas.find((s) => s.key === key);
  useEffect(() => {
    if (!state) return;
    setValue((state.draft?.value as Value) || (state.live?.value as Value) || {});
    setDirty(false);
    setError(null);
    setPreview(false);
  }, [state?.key, state?.draft?.id, state?.live?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (label: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      toast({ tone: 'success', title: ok });
      invalidateSiteCaches();
      await q.reload(true);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const save = () => run('save', () => adminV3.saveDraft(key, value || {}, note || undefined), 'Draft saved').then((ok) => ok && setDirty(false));
  const Preview = PREVIEW[key] || HomePage;
  const override = useMemo(() => ({ [key]: value || {} }) as Partial<SiteContent>, [key, value]);

  return (
    <>
      <AdminHeader title="Website content" description="Edit a draft, preview it with the real pages, then publish. Every save, publish, discard and restore is audited; published versions are append-only." />
      {q.error && <ErrorState message={q.error} onRetry={() => void q.reload()} />}
      {q.loading && !q.data && <LoadingState label="Loading content" />}
      {q.data && (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[240px_1fr]">
          <nav aria-label="Content sections" className="min-w-0">
            <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
              {q.data.schemas.map((s) => {
                const st = q.data!.keys.find((k) => k.key === s.key);
                return (
                  <li key={s.key} className="shrink-0">
                    <button type="button" aria-current={s.key === key ? 'true' : undefined} onClick={() => (!dirty || window.confirm('Discard unsaved edits?')) && setKey(s.key)} className={cn('w-full rounded-md px-3 py-2 text-left transition-control', s.key === key ? 'bg-surface shadow-sm ring-1 ring-line' : 'hover:bg-surface/60')}>
                      <span className="block text-[13px] font-medium text-ink">{s.label}</span>
                      <span className="block text-[11px] text-subtle">{st?.live_revision ? `Live v${st.live_revision.version}` : st?.live ? 'Live (pre-history)' : 'Default copy'}{st?.draft ? ` · draft v${st.draft.version}` : ''}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="flex min-w-0 flex-col gap-4">
            {state && schema && value && (
              <Card>
                <CardHeader title={schema.label} description={state.draft ? `Editing draft v${state.draft.version} (saved ${relativeTime(state.draft.created_at)}). Not live until published.` : state.live ? 'No open draft: saving creates one from the live copy.' : 'Not in the database yet: the site shows the built-in default. Saving creates the first draft.'} action={
                  <>
                    <Button size="sm" variant="secondary" onClick={() => setPreview((v) => !v)} aria-pressed={preview}><Eye size={13} aria-hidden /> {preview ? 'Hide preview' : 'Preview'}</Button>
                    <Button size="sm" variant="secondary" loading={busy === 'save'} disabled={!dirty} onClick={() => void save()}>Save draft</Button>
                    <Button size="sm" disabled={!state.draft || dirty || Boolean(busy)} onClick={() => setConfirm({ kind: 'publish' })} title={dirty ? 'Save the draft first' : !state.draft ? 'Nothing to publish' : undefined}>Publish</Button>
                  </>
                } />
                <div className="grid gap-4 px-5 pb-5">
                  {error && <p role="alert" className="rounded-md border border-rejected/30 bg-rejected-bg px-3 py-2 text-[13px] text-rejected">{error}</p>}
                  {dirty && <InlineNotice tone="info">Unsaved edits. Save the draft before publishing.</InlineNotice>}
                  {Object.entries(schema.fields).map(([k, spec]) => <FieldEditor key={`${key}-${k}`} id={`cms-${key}-${k}`} spec={spec} label={spec.label || k.replace(/_/g, ' ')} value={value[k]} onChange={(v) => { setValue((cur) => ({ ...(cur || {}), [k]: v })); setDirty(true); }} />)}
                  <Field id="cms-note" label="Change note (optional, kept in history)"><Input id="cms-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
                  {state.draft && <Button size="sm" variant="danger" className="justify-self-start" onClick={() => setConfirm({ kind: 'discard' })}><Trash2 size={13} aria-hidden /> Discard draft</Button>}
                </div>
              </Card>
            )}
            {preview && value && (
              <section aria-label="Preview" className="overflow-hidden rounded-lg border-2 border-dashed border-accent/50">
                <p className="bg-accent-subtle px-4 py-2 text-[12.5px] font-medium text-accent-text">Preview of {dirty ? 'unsaved edits' : 'the draft'} — not published. Forms are disabled. Layout breakpoints follow the browser window, not this panel.</p>
                <div className="max-h-[80vh] overflow-y-auto bg-canvas">
                  <SiteContentOverride value={override}>
                    <Suspense fallback={<LoadingState label="Loading preview" className="p-6" />}>
                      <Preview />
                    </Suspense>
                  </SiteContentOverride>
                </div>
              </section>
            )}
            {state && (
              <Card>
                <CardHeader title={<span className="inline-flex items-center gap-2"><History size={15} aria-hidden /> History</span>} description="Published versions are never edited. Restoring publishes a copy of an older version as a new version." />
                <ul className="divide-y divide-line px-5 pb-3">
                  {state.history.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <div className="min-w-0">
                        <p className="text-[13px] text-ink">v{r.version} · <span className={cn('font-mono text-[11.5px] uppercase', r.status === 'published' ? 'text-verified' : 'text-subtle')}>{r.status}</span></p>
                        <p className="text-[11.5px] text-subtle">{r.published_at ? `Published ${dateTime(r.published_at)}` : `Created ${dateTime(r.created_at)}`}{r.note ? ` · ${r.note}` : ''}</p>
                      </div>
                      <div className="flex gap-1.5">
                        <Button size="xs" variant="ghost" onClick={async () => setViewing((await adminV3.revision(r.id)).revision)}>View</Button>
                        {r.status === 'superseded' && <Button size="xs" variant="secondary" disabled={Boolean(state.draft) || Boolean(busy)} title={state.draft ? 'Publish or discard the open draft first' : undefined} onClick={() => setConfirm({ kind: 'restore', revision: r })}>Restore</Button>}
                      </div>
                    </li>
                  ))}
                  {!state.history.length && <li className="py-3 text-[12.5px] text-muted">No published history yet.</li>}
                </ul>
              </Card>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        loading={Boolean(busy)}
        tone={confirm?.kind === 'discard' ? 'danger' : 'primary'}
        title={confirm?.kind === 'publish' ? `Publish draft v${state?.draft?.version} to the live website?` : confirm?.kind === 'discard' ? 'Discard this draft?' : `Restore v${confirm?.revision?.version}?`}
        description={confirm?.kind === 'publish' ? 'Visitors see it on their next page load. The current live version stays in history and can be restored.' : confirm?.kind === 'discard' ? 'The draft is closed and cannot be reopened. The live site is unchanged.' : 'A copy of that version is published as a new version. The current live version stays in history.'}
        confirmLabel={confirm?.kind === 'publish' ? 'Publish' : confirm?.kind === 'discard' ? 'Discard draft' : 'Restore and publish'}
        onConfirm={async () => {
          const c = confirm;
          if (!c || !state) return;
          if (c.kind === 'publish' && state.draft) await run('publish', () => adminV3.publish(key, state.draft!.id), `Published v${state.draft.version}`);
          if (c.kind === 'discard') await run('discard', () => adminV3.discardDraft(key), 'Draft discarded');
          if (c.kind === 'restore' && c.revision) await run('restore', () => adminV3.rollback(key, c.revision!.id), `Restored v${c.revision.version}`);
          setConfirm(null);
        }}
      />
      <Drawer open={Boolean(viewing)} onClose={() => setViewing(null)} title={viewing ? `${viewing.key} · v${viewing.version}` : ''} description={viewing ? `${viewing.status}${viewing.published_at ? ` · published ${dateTime(viewing.published_at)}` : ''}` : undefined}>
        <pre className="whitespace-pre-wrap break-words rounded-md bg-sunken p-3 font-mono text-[11.5px] text-ink">{viewing ? JSON.stringify(viewing.value, null, 2) : ''}</pre>
      </Drawer>
    </>
  );
}
