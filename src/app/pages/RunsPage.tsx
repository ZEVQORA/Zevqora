import { Link } from 'react-router';
import { useSession } from '@/lib/session';
import { useProjects } from '../AppShell';
import { listRuns, listExperiments } from '../data';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Panel, PanelHeader } from '@/components/ui/Panel';
import { StatusChip } from '@/components/ui/StatusChip';
import { Table, Th, Td } from '@/components/ui/Misc';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { ButtonLink } from '@/components/ui/Button';
import { dateTime, money, relativeTime, shortId, STRATEGY_LABEL } from '@/lib/format';

export default function RunsPage() {
  const { activeWorkspace, activeProjectId } = useSession();
  const { projects } = useProjects();
  const runs = useAsync(() => listRuns(activeWorkspace!.id, activeProjectId), [activeWorkspace?.id, activeProjectId], { enabled: Boolean(activeWorkspace) });
  const replays = useAsync(() => listExperiments(activeWorkspace!.id, activeProjectId, 30), [activeWorkspace?.id, activeProjectId], { enabled: Boolean(activeWorkspace) });
  const name = (pid: string) => projects.find((p) => p.id === pid)?.name || shortId(pid);
  return (
    <>
      <PageHeader eyebrow={activeWorkspace?.name} title="Runs / Replay" description="Analysis runs read telemetry deterministically. Replays execute candidates on captured samples." />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="p-2">
          <PanelHeader title="Analysis runs" description="No model calls. No credit consumed." className="px-3" action={<ButtonLink to="/app/opportunities?analyze=1" size="sm">Run analysis</ButtonLink>} />
          {runs.error && <div className="p-3"><ErrorState message={runs.error} onRetry={() => runs.reload()} compact /></div>}
          {runs.loading && !runs.data ? <div className="p-3"><Skeleton className="h-40" /></div> : !runs.data?.length ? (
            <div className="p-3"><EmptyState compact zev={null} title="No analysis runs yet" description="Run an analysis from Opportunities once telemetry has arrived." /></div>
          ) : (
            <Table minWidth={560}>
              <thead><tr><Th>Run</Th><Th>Project</Th><Th align="right">Events</Th><Th align="right">Found</Th><Th>Status</Th></tr></thead>
              <tbody>
                {runs.data.map((r) => (
                  <tr key={r.id}>
                    <Td><span className="font-mono text-technical">{shortId(r.id)}</span><div className="text-technical text-subtle">{dateTime(r.created_at)}</div></Td>
                    <Td>{name(r.project_id)}</Td>
                    <Td align="right" mono>{r.events_analyzed}</Td>
                    <Td align="right" mono>{r.opportunities_found}</Td>
                    <Td><StatusChip status={r.status} />{r.error && <div className="text-technical mt-1 text-rejected">{r.error}</div>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
        <Panel className="p-2">
          <PanelHeader title="Replays" description="Candidate executions with their verdicts." className="px-3" action={<Link to="/app/experiments" className="text-caption text-accent-text underline-offset-4 hover:underline">All experiments</Link>} />
          {replays.error && <div className="p-3"><ErrorState message={replays.error} onRetry={() => replays.reload()} compact /></div>}
          {replays.loading && !replays.data ? <div className="p-3"><Skeleton className="h-40" /></div> : !replays.data?.length ? (
            <div className="p-3"><EmptyState compact zev={null} title="No replays yet" description="Test an opportunity to run the first replay." /></div>
          ) : (
            <Table minWidth={560}>
              <thead><tr><Th>Replay</Th><Th>Candidate</Th><Th align="right">Samples</Th><Th align="right">Credit</Th><Th>Verdict</Th></tr></thead>
              <tbody>
                {replays.data.map((e) => (
                  <tr key={e.id}>
                    <Td><Link to={`/app/experiments/${e.id}`} className="font-mono text-technical text-ink hover:underline">{shortId(e.id)}</Link><div className="text-technical text-subtle">{relativeTime(e.created_at)} · {name(e.project_id)}</div></Td>
                    <Td mono>{STRATEGY_LABEL[e.strategy]}<div className="text-subtle">{String(e.candidate?.model || '')}</div></Td>
                    <Td align="right" mono>{e.sample_size}</Td>
                    <Td align="right" mono>{money(e.credits_usd, { digits: 4 })}</Td>
                    <Td><StatusChip status={e.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>
    </>
  );
}
