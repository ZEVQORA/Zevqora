import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useSession } from '@/lib/session';
import { useProjects } from '../AppShell';
import { listExperiments } from '../data';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Panel } from '@/components/ui/Panel';
import { StatusChip } from '@/components/ui/StatusChip';
import { Tabs, Table, Th, Td } from '@/components/ui/Misc';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { ButtonLink } from '@/components/ui/Button';
import { money, pct, ratio, relativeTime, shortId, STRATEGY_LABEL } from '@/lib/format';
import { cn } from '@/lib/cn';

type Filter = 'all' | 'passed' | 'failed' | 'needs_evidence' | 'error';

export default function ExperimentsPage() {
  const { activeWorkspace, activeProjectId } = useSession();
  const { projects } = useProjects();
  const [params] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all');
  const q = useAsync(() => listExperiments(activeWorkspace!.id, activeProjectId), [activeWorkspace?.id, activeProjectId], { enabled: Boolean(activeWorkspace) });
  const opportunityFilter = params.get('opportunity');
  const rows = useMemo(() => (q.data || []).filter((e) => (filter === 'all' || e.status === filter) && (!opportunityFilter || e.opportunity_id === opportunityFilter)), [q.data, filter, opportunityFilter]);
  const counts = useMemo(() => ({ passed: (q.data || []).filter((e) => e.status === 'passed').length, failed: (q.data || []).filter((e) => e.status === 'failed').length, needs: (q.data || []).filter((e) => e.status === 'needs_evidence').length, error: (q.data || []).filter((e) => e.status === 'error').length }), [q.data]);

  return (
    <>
      <PageHeader eyebrow={activeWorkspace?.name} title="Experiments" description="Every candidate replayed against your workload. Only PASS becomes Verified Savings." />
      <div className="mb-4">
        <Tabs value={filter} onChange={setFilter} items={[{ value: 'all', label: 'All', count: (q.data || []).length }, { value: 'passed', label: 'Verified', count: counts.passed }, { value: 'failed', label: 'Rejected', count: counts.failed }, { value: 'needs_evidence', label: 'Needs evidence', count: counts.needs }, { value: 'error', label: 'Errors', count: counts.error }]} />
      </div>
      {q.error && <ErrorState message={q.error} onRetry={() => q.reload()} />}
      {q.loading && !q.data ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : !rows.length ? (
        <EmptyState title="No experiments yet" description="Pick an opportunity and let Zev test it. A replay measures the candidate on your captured samples and decides PASS or FAIL with named gates." zev="pose-thinking" action={<ButtonLink to="/app/opportunities" size="sm">Go to opportunities</ButtonLink>} />
      ) : (
        <Panel className="p-2">
          <Table minWidth={860}>
            <thead>
              <tr>
                <Th>Experiment</Th>
                <Th>Baseline → candidate</Th>
                <Th align="right">Samples</Th>
                <Th align="right">Quality</Th>
                <Th align="right">Cost Δ</Th>
                <Th align="right">Latency p50</Th>
                <Th>Verdict</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="transition-control hover:bg-ink/[0.02]">
                  <Td>
                    <Link to={`/app/experiments/${e.id}`} className="font-medium text-ink hover:underline underline-offset-4">{STRATEGY_LABEL[e.strategy] || e.strategy}</Link>
                    <div className="font-mono text-technical text-subtle">{shortId(e.id)} · {relativeTime(e.created_at)}{projects.length > 1 ? ` · ${projects.find((p) => p.id === e.project_id)?.name || ''}` : ''}</div>
                  </Td>
                  <Td mono>
                    {String(e.baseline?.model || '—')}
                    <span className="text-subtle"> → </span>
                    {String(e.candidate?.model || '—')}
                  </Td>
                  <Td align="right" mono>{e.sample_size}</Td>
                  <Td align="right" mono>
                    <span className={cn(e.quality_score !== null && e.quality_score < e.quality_gate ? 'text-rejected' : 'text-ink')}>{ratio(e.quality_score, 3)}</span>
                    <span className="text-subtle"> / {ratio(e.quality_gate, 2)}</span>
                  </Td>
                  <Td align="right" mono>
                    {e.status === 'passed' ? <span className="text-verified">−{pct(e.verified_savings_pct)}</span> : e.baseline?.cost_usd && e.candidate?.cost_usd ? <span className="text-muted">{pct(((Number(e.baseline.cost_usd) - Number(e.candidate.cost_usd)) / Number(e.baseline.cost_usd)) * 100)}</span> : '—'}
                    <div className="text-subtle">{e.status === 'passed' ? money(e.verified_savings_usd, { digits: 5 }) : ''}</div>
                  </Td>
                  <Td align="right" mono>{e.candidate?.latency_p50_ms ? `${Math.round(Number(e.candidate.latency_p50_ms))} ms` : '—'}</Td>
                  <Td><StatusChip status={e.status} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </>
  );
}
