import { useMemo, useState } from 'react';
import { useSession } from '@/lib/session';
import { useProjects } from '../AppShell';
import { useInspector } from '../Inspector';
import { listExperiments, listOpportunities } from '../data';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Panel } from '@/components/ui/Panel';
import { StatusChip } from '@/components/ui/StatusChip';
import { Tabs } from '@/components/ui/Misc';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { dateTime, shortId, STRATEGY_LABEL, ratio } from '@/lib/format';
import { Shield } from 'lucide-react';

export default function EvidencePage() {
  const { activeWorkspace, activeProjectId } = useSession();
  const { projects } = useProjects();
  const inspector = useInspector();
  const [tab, setTab] = useState<'experiments' | 'opportunities'>('experiments');
  const exps = useAsync(() => listExperiments(activeWorkspace!.id, activeProjectId), [activeWorkspace?.id, activeProjectId], { enabled: Boolean(activeWorkspace) });
  const opps = useAsync(() => listOpportunities(activeWorkspace!.id, activeProjectId), [activeWorkspace?.id, activeProjectId], { enabled: Boolean(activeWorkspace) });
  const name = (pid: string) => projects.find((p) => p.id === pid)?.name || shortId(pid);
  const items = useMemo(() => (tab === 'experiments' ? exps.data || [] : opps.data || []), [tab, exps.data, opps.data]);
  const loading = tab === 'experiments' ? exps.loading && !exps.data : opps.loading && !opps.data;
  const error = tab === 'experiments' ? exps.error : opps.error;

  return (
    <>
      <PageHeader eyebrow={activeWorkspace?.name} title="Evidence" description="Every conclusion traces back to the evidence that produced it: source, runtime, baseline, candidate, quality, pricing, provenance." />
      <div className="mb-4">
        <Tabs value={tab} onChange={setTab} items={[{ value: 'experiments', label: 'Experiment evidence', count: exps.data?.length }, { value: 'opportunities', label: 'Diagnosis evidence', count: opps.data?.length }]} />
      </div>
      {error && <ErrorState message={error} onRetry={() => (tab === 'experiments' ? exps.reload() : opps.reload())} />}
      {loading ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : !items.length ? (
        <EmptyState icon={<Shield size={28} />} title="No evidence recorded yet" description="Evidence appears once an analysis or a replay has run. ZEVQORA never implies evidence that does not exist." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((it) => {
            const isExp = 'gates' in it;
            return (
              <li key={it.id}>
                <button type="button" onClick={() => inspector.open({ kind: isExp ? 'experiment' : 'opportunity', id: it.id })} className="w-full text-left">
                  <Panel className="h-full p-4 transition-control hover:shadow-panel">
                    <div className="flex items-center justify-between gap-2">
                      <StatusChip status={it.status} />
                      <span className="font-mono text-technical text-subtle">{shortId(it.id)}</span>
                    </div>
                    <p className="text-caption mt-3 font-medium text-ink">{isExp ? `${STRATEGY_LABEL[(it as { strategy: string }).strategy]} · ${String((it as { candidate?: { model?: string } }).candidate?.model || '')}` : (it as { title: string }).title}</p>
                    <dl className="mt-3 space-y-1 font-mono text-technical text-subtle">
                      <div>project <span className="text-ink">{name(it.project_id)}</span></div>
                      {isExp ? (
                        <>
                          <div>quality <span className="text-ink">{ratio((it as { quality_score: number | null }).quality_score, 3)}</span> · hash <span className="text-ink">{(it as { evidence_hash: string | null }).evidence_hash?.slice(0, 10) || '—'}</span></div>
                          <div>{dateTime((it as { completed_at: string | null }).completed_at)}</div>
                        </>
                      ) : (
                        <>
                          <div>evidence <span className="text-ink">{(it as { evidence_completeness: string }).evidence_completeness}</span> · confidence <span className="text-ink">{(it as { confidence: number }).confidence}</span></div>
                          <div>{dateTime(it.created_at)}</div>
                        </>
                      )}
                    </dl>
                  </Panel>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
