import { useState } from 'react';
import { GitBranch, Plug, Plus } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { relativeTime } from '@/lib/format';
import { ButtonLink, Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ClaimBadge } from '@/components/ui/Claim';
import { DataTable } from '@/components/ui/DataTable';
import { ViewHeader } from '@/components/ui/Layout';
import { SegmentedControl } from '@/components/ui/Segmented';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { PermissionGate } from '@/components/ui/PermissionGate';
import { useProductDialogs } from '../dialogs/context';
import { experienceApi, fmt } from '../experience';
import { orUnknown, useOpenWorkload } from '../command/parts';

/** Every connected AI workload with its evidence state and where it is in the proof loop. */
export default function WorkloadsView() {
  const { activeWorkspace } = useSession();
  const dialogs = useProductDialogs();
  const open = useOpenWorkload();
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const wsId = activeWorkspace?.id || '';
  const { data, error, loading, reload } = useAsync(() => experienceApi.commandCenter(wsId, Number(days)), [wsId, days], { enabled: Boolean(wsId) });

  return (
    <div className="mx-auto w-full max-w-[1320px] px-4 py-6 lg:px-8 lg:py-8">
      <ViewHeader
        eyebrow="Observe"
        title="Workloads"
        description="Each workload is an AI product or workflow whose execution evidence ZEVQORA has. Metrics are from its Verified Performance baseline; nothing here is an estimate."
        actions={
          <>
            <SegmentedControl label="Traffic window" value={days} onChange={setDays} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
            <PermissionGate min="member" fallback="hide">
              <Button size="sm" onClick={() => dialogs.openConnect()}><Plus size={14} aria-hidden /> Connect</Button>
            </PermissionGate>
          </>
        }
      />
      {loading && !data && <LoadingState label="Loading workloads" />}
      {error && <ErrorState message={error} onRetry={() => void reload()} />}
      {data && !data.products.length && (
        <EmptyState zev="pose-sitting" title="No workloads yet" description="Connect a repository, import a trace export, or load the synthetic demo to see a workload here." action={<ButtonLink to="/app/connections"><Plug size={14} aria-hidden /> Connections</ButtonLink>} />
      )}
      {data && data.products.length > 0 && (
        <Card className="p-4">
          <DataTable
            caption={`${data.products.length} workload${data.products.length === 1 ? '' : 's'} · traffic in the last ${days} days`}
            rows={data.products}
            rowKey={(p) => p.id}
            minWidth={980}
            initialSort={{ key: 'traffic', dir: 'desc' }}
            columns={[
              {
                key: 'name',
                header: 'Workload',
                sort: (p) => p.name,
                className: 'min-w-[200px]',
                cell: (p) => (
                  <div>
                    <button type="button" className="text-left font-medium text-ink hover:text-accent-text" onClick={() => open(p.id, '/app/project')}>{p.name}</button>
                    {p.synthetic && <div className="mt-1"><ClaimBadge claim="SYNTHETIC" size="xs" /></div>}
                  </div>
                ),
              },
              { key: 'traffic', header: 'Requests', align: 'right', nowrap: true, sort: (p) => p.traces_in_window, cell: (p) => p.traces_in_window.toLocaleString() },
              { key: 'last', header: 'Last request', nowrap: true, sort: (p) => p.last_trace_at, cell: (p) => (p.last_trace_at ? relativeTime(p.last_trace_at) : <span className="text-subtle">none in window</span>) },
              { key: 'contract', header: 'Contract', nowrap: true, cell: (p) => (p.contract ? <span className="font-mono text-[12px]">v{p.contract.version} frozen</span> : <span className="text-warning">not frozen</span>) },
              { key: 'cpso', header: 'Cost / success', align: 'right', nowrap: true, sort: (p) => p.baseline?.cpso_usd, cell: (p) => (p.baseline ? orUnknown(fmt.usd(p.baseline.cpso_usd)) : <span className="text-subtle">no baseline</span>) },
              { key: 'p95', header: 'p95', align: 'right', nowrap: true, sort: (p) => p.baseline?.p95_ms, cell: (p) => (p.baseline ? orUnknown(fmt.ms(p.baseline.p95_ms)) : '—') },
              { key: 'success', header: 'Task success', align: 'right', nowrap: true, sort: (p) => p.baseline?.task_success, cell: (p) => (p.baseline ? orUnknown(fmt.pct(p.baseline.task_success)) : '—') },
              { key: 'stage', header: 'Proof loop', nowrap: true, cell: (p) => <span className="text-[12px] text-muted">{p.decision?.selected_plan ? 'Plan selected' : p.search ? `Search ${p.search.status}` : p.baseline ? `${p.diagnoses.count} diagnoses` : p.contract ? 'Needs baseline' : 'Needs contract'}</span> },
              {
                key: 'go',
                header: <span className="sr-only">Open</span>,
                nowrap: true,
                cell: (p) => (
                  <span className="flex gap-1">
                    <button type="button" className="rounded-sm px-2 py-1 text-[12px] font-medium text-accent-text hover:bg-accent-subtle" onClick={() => open(p.id, '/app/optimize')}>Optimize</button>
                    <button type="button" aria-label={`Execution graph for ${p.name}`} className="rounded-sm px-2 py-1 text-[12px] font-medium text-accent-text hover:bg-accent-subtle" onClick={() => open(p.id, '/app/graph')}><GitBranch size={13} aria-hidden /></button>
                  </span>
                ),
              },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
