import { useEffect, useState } from 'react';
import { admin } from '../data';
import { useAsync } from '@/lib/useAsync';
import { invalidateSiteCaches } from '@/lib/site';
import { PageHeader, Panel, PanelHeader } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea, Select } from '@/components/ui/Field';
import { ErrorState, Skeleton, InlineNotice } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';

type Value = Record<string, unknown>;

function useEditor(initial: Value) {
  const [v, setV] = useState<Value>(initial);
  useEffect(() => setV(initial), [initial]);
  const get = (path: string) => path.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Value)[k] : undefined), v);
  const set = (path: string, value: unknown) =>
    setV((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as Value;
      const keys = path.split('.');
      let cur: Value = next;
      keys.slice(0, -1).forEach((k) => {
        if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
        cur = cur[k] as Value;
      });
      cur[keys[keys.length - 1]] = value;
      return next;
    });
  return { v, get, set };
}

function TextField({ id, label, path, editor, hint, textarea = false }: { id: string; label: string; path: string; editor: ReturnType<typeof useEditor>; hint?: string; textarea?: boolean }) {
  const value = editor.get(path);
  const str = value === null || value === undefined ? '' : String(value);
  return (
    <Field id={id} label={label} hint={hint}>
      {textarea ? <Textarea id={id} value={str} onChange={(e) => editor.set(path, e.target.value)} className="min-h-[72px]" /> : <Input id={id} value={str} onChange={(e) => editor.set(path, e.target.value || null)} />}
    </Field>
  );
}

function Block({ title, description, initial, keyName, updatedAt, onSaved, children }: { title: string; description: string; initial: Value; keyName: string; updatedAt: string; onSaved: () => void; children: (editor: ReturnType<typeof useEditor>) => React.ReactNode }) {
  const editor = useEditor(initial);
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const save = async () => {
    setPending(true);
    try {
      await admin.saveContent(keyName, editor.v);
      invalidateSiteCaches();
      toast({ tone: 'success', title: `${title} saved` });
      onSaved();
    } catch (e) {
      toast({ tone: 'error', title: 'Could not save', description: errorMessage(e) });
    } finally {
      setPending(false);
    }
  };
  return (
    <Panel>
      <PanelHeader title={title} description={`${description} · updated ${dateTime(updatedAt)}`} action={<Button size="sm" onClick={save} loading={pending}>Save</Button>} />
      <div className="grid gap-4 p-5 lg:grid-cols-2">{children(editor)}</div>
    </Panel>
  );
}

export default function AdminContentPage() {
  const q = useAsync(() => admin.content(), []);
  const byKey = Object.fromEntries((q.data?.content || []).map((c) => [c.key, c]));
  return (
    <>
      <PageHeader eyebrow="Internal" title="Website content" description="Structured, validated fields only. No HTML. Changes are live on the next page load." />
      <InlineNotice tone="warning" className="mb-4">Claim safety: the proof block must never describe the 42.01% figure as production savings, and the verified figure must keep its confidence-interval qualifier.</InlineNotice>
      {q.error && <ErrorState message={q.error} onRetry={() => q.reload()} />}
      {!q.data ? <Skeleton className="h-96 rounded-lg" /> : (
        <div className="flex flex-col gap-4">
          {byKey.hero && (
            <Block title="Hero" description="Announcement, headline and calls to action." initial={byKey.hero.value} keyName="hero" updatedAt={byKey.hero.updated_at} onSaved={() => q.reload(true)}>
              {(ed) => (
                <>
                  <TextField id="h-ann" label="Announcement (optional)" path="announcement" editor={ed} hint="Shown as a pill above the headline. Leave blank to hide." />
                  <TextField id="h-annh" label="Announcement link" path="announcement_href" editor={ed} />
                  <TextField id="h-head" label="Headline" path="headline" editor={ed} />
                  <TextField id="h-sub" label="Subheadline" path="subheadline" editor={ed} />
                  <div className="lg:col-span-2"><TextField id="h-sup" label="Supporting text" path="supporting" editor={ed} textarea /></div>
                  <TextField id="h-p1" label="Primary CTA label" path="primary_cta.label" editor={ed} />
                  <TextField id="h-p2" label="Primary CTA destination" path="primary_cta.href" editor={ed} />
                  <TextField id="h-s1" label="Secondary CTA label" path="secondary_cta.label" editor={ed} />
                  <TextField id="h-s2" label="Secondary CTA destination" path="secondary_cta.href" editor={ed} />
                  <div className="lg:col-span-2"><TextField id="h-tl" label="Trust line" path="trust_line" editor={ed} /></div>
                </>
              )}
            </Block>
          )}
          {byKey.proof && (
            <Block title="Proof block" description="Rejected and verified benchmark figures." initial={byKey.proof.value} keyName="proof" updatedAt={byKey.proof.updated_at} onSaved={() => q.reload(true)}>
              {(ed) => (
                <>
                  <TextField id="p-kind" label="Benchmark kind" path="kind" editor={ed} />
                  <Field id="p-cases" label="Cases"><Input id="p-cases" type="number" value={String(ed.get('cases') ?? '')} onChange={(e) => ed.set('cases', Number(e.target.value))} /></Field>
                  <TextField id="p-rc" label="Rejected · cost reduction" path="rejected.cost_reduction" editor={ed} />
                  <TextField id="p-rq" label="Rejected · quality" path="rejected.quality" editor={ed} />
                  <TextField id="p-rf" label="Rejected · quality floor" path="rejected.quality_floor" editor={ed} />
                  <TextField id="p-rr" label="Rejected · reason" path="rejected.reason" editor={ed} />
                  <TextField id="p-vc" label="Verified · cost reduction" path="verified.cost_reduction" editor={ed} />
                  <TextField id="p-vq" label="Verified · quality" path="verified.quality" editor={ed} />
                  <TextField id="p-vf" label="Verified · quality floor" path="verified.quality_floor" editor={ed} />
                  <TextField id="p-vci" label="Verified · 95% CI" path="verified.ci95" editor={ed} />
                  <div className="lg:col-span-2"><TextField id="p-q" label="Qualifier" path="qualifier" editor={ed} textarea /></div>
                </>
              )}
            </Block>
          )}
          {byKey.status && (
            <Block title="Status" description="Site banner and public status." initial={byKey.status.value} keyName="status" updatedAt={byKey.status.updated_at} onSaved={() => q.reload(true)}>
              {(ed) => (
                <>
                  <TextField id="s-b" label="Banner (optional)" path="banner" editor={ed} hint="Shown above the site header. Leave blank to hide." />
                  <Field id="s-ps" label="Public status"><Select id="s-ps" value={String(ed.get('public_status') || 'operational')} onChange={(e) => ed.set('public_status', e.target.value)}><option value="operational">Operational</option><option value="degraded">Degraded</option><option value="maintenance">Maintenance</option></Select></Field>
                </>
              )}
            </Block>
          )}
          {byKey.contact && (
            <Block title="Contact" description="Address used across the site." initial={byKey.contact.value} keyName="contact" updatedAt={byKey.contact.updated_at} onSaved={() => q.reload(true)}>
              {(ed) => <TextField id="c-e" label="Email" path="email" editor={ed} />}
            </Block>
          )}
        </div>
      )}
    </>
  );
}
