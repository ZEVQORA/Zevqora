import { Link } from 'react-router';
import { FileText, ArrowRight } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useProjects } from '../AppShell';
import { listExperiments } from '../data';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Panel } from '@/components/ui/Panel';
import { StatusChip } from '@/components/ui/StatusChip';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { ButtonLink } from '@/components/ui/Button';
import { dateTime, money, pct, ratio, shortId, STRATEGY_LABEL } from '@/lib/format';
import { cn } from '@/lib/cn';

export default function ReportsPage() {
  const { activeWorkspace, activeProjectId } = useSession();
  const { projects } = useProjects();
  const q = useAsync(() => listExperiments(activeWorkspace!.id, activeProjectId), [activeWorkspace?.id, activeProjectId], { enabled: Boolean(activeWorkspace) });
  const rows = (q.data || []).filter((e) => ['passed', 'failed', 'needs_evidence'].includes(e.status));
  return (
    <>
      <PageHeader eyebrow={activeWorkspace?.name} title="Reports" description="One report per evaluation: baseline, candidate, cost, latency, quality, threshold, verdict, evidence, limitations. Export as JSON, CSV or PDF." />
      {q.error && <ErrorState message={q.error} onRetry={() => q.reload()} />}
      {q.loading && !q.data ? (
        <Skeleton className="h-48 rounded-lg" />
      ) : !rows.length ? (
        <EmptyState icon={<FileText size={28} />} title="No reports yet" description="Reports are generated from completed evaluations. Run an experiment to produce the first one." action={<ButtonLink to="/app/opportunities" size="sm">Go to opportunities</ButtonLink>} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((e) => (
            <li key={e.id}>
              <Link to={`/app/reports/${e.id}`} className="block h-full">
                <Panel className={cn('flex h-full flex-col p-5 transition-control hover:shadow-panel', e.status === 'passed' && 'border-verified/30')}>
                  <div className="flex items-center justify-between gap-2">
                    <StatusChip status={e.status} />
                    <span className="font-mono text-technical text-subtle">{shortId(e.id)}</span>
                  </div>
                  <p className="text-h4 mt-3 text-ink">{STRATEGY_LABEL[e.strategy] || e.strategy}</p>
                  <p className="text-technical mt-1 font-mono text-subtle">{String(e.baseline?.model || '—')} → {String(e.candidate?.model || '—')}</p>
                  <dl className="mt-4 grid flex-1 grid-cols-2 gap-2 font-mono text-technical text-subtle">
                    <div>project <span className="text-ink">{projects.find((p) => p.id === e.project_id)?.name || '—'}</span></div>
                    <div>quality <span className="text-ink">{ratio(e.quality_score, 3)} / {ratio(e.quality_gate, 2)}</span></div>
                    <div>samples <span className="text-ink">{e.sample_size}</span></div>
                    <div>savings <span className={e.status === 'passed' ? 'text-verified' : 'text-ink'}>{e.status === 'passed' ? `${pct(e.verified_savings_pct)} · ${money(e.verified_savings_usd, { digits: 5 })}` : 'not verified'}</span></div>
                  </dl>
                  <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                    <span className="text-technical text-subtle">{dateTime(e.completed_at || e.created_at)}</span>
                    <span className="text-caption inline-flex items-center gap-1 text-accent-text">Open report <ArrowRight size={13} /></span>
                  </div>
                </Panel>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
