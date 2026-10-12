import { useState } from 'react';
import { admin, type FeatureFlag } from '../data';
import { adminV3, type FlagTargeting } from '../data-v3';
import { useAsync } from '@/lib/useAsync';
import { errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Input, Select } from '@/components/ui/Field';
import { usePlans } from '@/lib/site';
import { SegmentedControl } from '@/components/ui/Segmented';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { AdminHeader } from '../shared';

const GLOBAL = new Set(['visitor_intelligence', 'product_analytics']);
type Mode = 'legacy' | FlagTargeting;
const MODE_HELP: Record<Mode, string> = {
  legacy: 'Pre-019 behaviour: the global switch, with per-workspace overrides.',
  off: 'Off everywhere (explicit workspace overrides still win).',
  internal: 'Only workspaces owned by a ZEVQORA admin.',
  selected: 'Only workspaces listed below as on.',
  limited: 'A deterministic share of workspaces: the same workspace always gets the same answer.',
  on: 'On everywhere (explicit workspace overrides still win).',
};

type Pending = { flag: FeatureFlag; label: string; body: () => Promise<unknown> };

function FlagCard({ f, reach, onChange }: { f: FeatureFlag; reach?: { workspaces_on: number; workspaces_total: number; internal_workspaces: number }; onChange: (p: Pending) => void }) {
  const isGlobal = GLOBAL.has(f.key);
  const mode: Mode = f.targeting ?? 'legacy';
  const [pct, setPct] = useState(String(f.rollout_percent ?? 10));
  const [ws, setWs] = useState('');
  const overrides = Object.entries(f.workspace_overrides || {});
  const { plans } = usePlans();
  const modes: Mode[] = isGlobal ? ['legacy', 'off', 'on'] : ['legacy', 'off', 'internal', 'selected', 'limited', 'on'];
  return (
    <Card as="article" className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-mono text-[13.5px] text-ink">{f.key}</h2>
          <p className="mt-1 text-[12.5px] text-muted">{f.description}</p>
          <p className="mt-1 text-[11.5px] text-subtle">{isGlobal ? 'Platform-wide switch' : 'Per workspace'} · updated {dateTime(f.updated_at)}{reach && !isGlobal ? ` · on for ${reach.workspaces_on} of ${reach.workspaces_total} workspaces` : ''}</p>
        </div>
        {mode === 'legacy' && <span className="font-mono text-[11.5px] text-muted">global switch: <b className="text-ink">{f.enabled ? 'on' : 'off'}</b></span>}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SegmentedControl label={`Targeting for ${f.key}`} size="sm" value={mode} onChange={(m) => {
          if (m === mode) return;
          if (m === 'limited') return onChange({ flag: f, label: `Roll ${f.key} out to ${pct}% of workspaces`, body: () => adminV3.setTargeting(f.key, 'limited', Number(pct)) });
          if (m === 'legacy') return onChange({ flag: f, label: `Return ${f.key} to its global switch (${f.enabled ? 'on' : 'off'})`, body: () => adminV3.setTargeting(f.key, null) });
          onChange({ flag: f, label: `Set ${f.key} to ${m}`, body: () => adminV3.setTargeting(f.key, m) });
        }} options={modes.map((m) => ({ value: m, label: m === 'legacy' ? 'Global switch' : m[0].toUpperCase() + m.slice(1) }))} />
        {mode === 'legacy' && <Button size="xs" variant="secondary" onClick={() => onChange({ flag: f, label: `Turn ${f.key} ${f.enabled ? 'off' : 'on'} globally`, body: () => admin.saveFlag(f.key, { enabled: !f.enabled }) })}>Turn {f.enabled ? 'off' : 'on'}</Button>}
        {mode === 'limited' && (
          <span className="flex items-center gap-2 text-[12.5px]">
            <label htmlFor={`pct-${f.key}`} className="text-muted">Percent</label>
            <Input id={`pct-${f.key}`} type="number" min={0} max={100} value={pct} onChange={(e) => setPct(e.target.value)} className="h-8 w-20" />
            <Button size="xs" variant="secondary" disabled={!/^\d{1,3}$/.test(pct) || Number(pct) > 100 || Number(pct) === f.rollout_percent} onClick={() => onChange({ flag: f, label: `Change ${f.key} rollout to ${pct}%`, body: () => adminV3.setTargeting(f.key, 'limited', Number(pct)) })}>Apply</Button>
          </span>
        )}
      </div>
      <p className="mt-2 text-[12px] text-subtle">{MODE_HELP[mode]}</p>
      {mode === 'legacy' && (plans || []).length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-[12px] text-subtle">Plan overrides (account-level flags)</span>
          {(plans || []).map((pl) => {
            const v = f.plan_overrides?.[pl.id];
            return (
              <label key={pl.id} className="flex items-center gap-1.5 text-[12px] text-muted">
                {pl.name}
                <Select aria-label={`${f.key} override for plan ${pl.name}`} value={v === undefined ? '' : String(v)} className="h-7 w-24 py-0 text-[12px]" onChange={(e) => onChange({ flag: f, label: `Set ${f.key} for plan ${pl.name} to ${e.target.value || 'inherit'}`, body: () => admin.saveFlag(f.key, { plan_overrides: { ...f.plan_overrides, [pl.id]: e.target.value === '' ? null : e.target.value === 'true' } as unknown as Record<string, boolean> }) })}>
                  <option value="">inherit</option>
                  <option value="true">on</option>
                  <option value="false">off</option>
                </Select>
              </label>
            );
          })}
        </div>
      )}
      {!isGlobal && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-[12px] font-medium text-ink">Workspace overrides <span className="font-normal text-subtle">(always win over targeting)</span></p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {overrides.map(([id, on]) => (
              <li key={id} className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-sunken px-2 py-1 font-mono text-[11px]">
                {id.slice(0, 8)} → {on ? 'on' : 'off'}
                <button type="button" aria-label={`Remove override for ${id}`} className="text-subtle hover:text-rejected" onClick={() => onChange({ flag: f, label: `Remove ${f.key} override for workspace ${id.slice(0, 8)}`, body: () => admin.saveFlag(f.key, { workspace_overrides: { ...f.workspace_overrides, [id]: null } as unknown as Record<string, boolean> }) })}>×</button>
              </li>
            ))}
            {!overrides.length && <li className="text-[12px] text-muted">None.</li>}
          </ul>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label htmlFor={`ws-${f.key}`} className="sr-only">Workspace id</label>
            <Input id={`ws-${f.key}`} placeholder="Workspace id (uuid)" value={ws} onChange={(e) => setWs(e.target.value.trim())} className="h-8 w-72 max-w-full font-mono text-[12px]" />
            {(['on', 'off'] as const).map((v) => (
              <Button key={v} size="xs" variant="secondary" disabled={!/^[0-9a-f-]{36}$/i.test(ws)} onClick={() => onChange({ flag: f, label: `Force ${f.key} ${v} for workspace ${ws.slice(0, 8)}`, body: async () => { await admin.saveFlag(f.key, { workspace_overrides: { ...f.workspace_overrides, [ws.toLowerCase()]: v === 'on' } }); setWs(''); } })}>Force {v}</Button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

/** Feature flags: server-resolved, audited; the client never decides access. */
export default function AdminFlagsPage() {
  const q = useAsync(() => admin.flags(), []);
  const reach = useAsync(() => adminV3.flagReach(), []);
  const toast = useToast();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <AdminHeader title="Feature flags" description="Targeting is resolved on the server for every request; a flag shown in the browser never grants access by itself. Every change is written to the audit log with before and after." />
      {q.error && <ErrorState message={q.error} onRetry={() => void q.reload()} />}
      {q.loading && !q.data && <LoadingState label="Loading flags" />}
      <div className="flex flex-col gap-3">
        {q.data?.flags.map((f) => <FlagCard key={`${f.key}-${f.updated_at}`} f={f} reach={reach.data?.reach[f.key]} onChange={setPending} />)}
      </div>
      <ConfirmDialog
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        loading={busy}
        title={pending?.label || ''}
        description="This changes who gets the feature on their next request. The change is audited and can be reverted from this page."
        confirmLabel="Apply change"
        onConfirm={async () => {
          if (!pending) return;
          setBusy(true);
          try {
            await pending.body();
            toast({ tone: 'success', title: 'Flag updated', description: pending.flag.key });
            await Promise.all([q.reload(true), reach.reload(true)]);
            setPending(null);
          } catch (e) {
            toast({ tone: 'error', title: 'Could not update', description: errorMessage(e) });
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
