import { admin } from '../data';
import { useAsync } from '@/lib/useAsync';
import { usePlans } from '@/lib/site';
import { PageHeader, Panel } from '@/components/ui/Panel';
import { Toggle, Select } from '@/components/ui/Field';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import type { FeatureFlag } from '../data';

export default function AdminFlagsPage() {
  const q = useAsync(() => admin.flags(), []);
  const { plans } = usePlans();
  const toast = useToast();
  const update = async (f: FeatureFlag, body: Partial<FeatureFlag>) => {
    try {
      await admin.saveFlag(f.key, body);
      await q.reload(true);
      toast({ tone: 'success', title: `${f.key} updated` });
    } catch (e) {
      toast({ tone: 'error', title: 'Could not update', description: errorMessage(e) });
    }
  };
  return (
    <>
      <PageHeader eyebrow="Internal" title="Feature flags" description="Global switch with optional per-plan overrides. Resolved server-side; the app receives only the outcome." />
      {q.error && <ErrorState message={q.error} onRetry={() => q.reload()} />}
      {!q.data ? <Skeleton className="h-64 rounded-lg" /> : (
        <div className="flex flex-col gap-3">
          {q.data.flags.map((f) => (
            <Panel key={f.key} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-mono text-caption text-ink">{f.key}</p>
                  <p className="text-technical mt-1 text-muted">{f.description}</p>
                  <p className="text-technical mt-1 text-subtle">updated {dateTime(f.updated_at)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-technical text-muted">Global</span>
                  <Toggle id={`flag-${f.key}`} checked={f.enabled} onChange={(v) => update(f, { enabled: v })} label={`Toggle ${f.key}`} />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
                <span className="text-technical text-subtle">Plan overrides</span>
                {(plans || []).map((p) => {
                  const v = f.plan_overrides?.[p.id];
                  return (
                    <label key={p.id} className="flex items-center gap-1.5 text-technical text-muted">
                      {p.name}
                      <Select value={v === undefined ? '' : String(v)} onChange={(e) => update(f, { plan_overrides: { ...f.plan_overrides, [p.id]: e.target.value === '' ? null : e.target.value === 'true' } as Record<string, boolean> })} className="h-7 w-28 py-0 text-technical" aria-label={`${f.key} override for ${p.name}`}>
                        <option value="">inherit</option>
                        <option value="true">on</option>
                        <option value="false">off</option>
                      </Select>
                    </label>
                  );
                })}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
