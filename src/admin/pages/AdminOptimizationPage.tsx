import { useAsync } from '@/lib/useAsync';
import { dateTime } from '@/lib/format';
import { Card, CardHeader, StatTile } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { adminV3 } from '../data-v3';
import { AdminHeader } from '../shared';

/** Cross-workspace view of plan searches and ZevIR ingestion (ids and counts only, never trace content). */
export default function AdminOptimizationPage() {
  const q = useAsync(() => adminV3.optimizationAdmin(), []);
  const d = q.data;
  return (
    <>
      <AdminHeader title="Optimization & ZevIR" description="Recent plan searches and graph ingestion across all workspaces. Admins see counts and statuses; prompts, outputs and trace content are never shown here." />
      {q.error && <ErrorState message={q.error} onRetry={() => void q.reload()} />}
      {q.loading && !d && <LoadingState label="Loading optimization activity" />}
      {d && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <StatTile label="Optimization runs" value={d.runs === null ? 'unknown' : d.runs.toLocaleString()} />
            <StatTile label="Recent plan searches" value={d.searches.length} hint="latest 40" />
            <StatTile label="ZevIR graphs" value={d.zevir.graphs === null ? 'unknown' : d.zevir.graphs.toLocaleString()} />
            <StatTile label="Recent ingest runs" value={d.zevir.ingest_runs.length} hint="latest 20" />
          </div>
          <Card>
            <CardHeader title="Plan searches" />
            <div className="px-5 pb-4">
              <DataTable caption="Recent plan searches" captionHidden rows={d.searches} rowKey={(s) => s.id} minWidth={820} empty="No plan search has run yet." columns={[
                { key: 'at', header: 'Started', nowrap: true, cell: (s) => dateTime(s.created_at), sort: (s) => s.created_at },
                { key: 'ws', header: 'Workspace', cell: (s) => s.workspace || s.id.slice(0, 8) },
                { key: 'st', header: 'Status', cell: (s) => <span className="font-mono text-[12px]">{s.status}</span> },
                { key: 'p', header: 'Plans', align: 'right', cell: (s) => s.plans },
                { key: 'v', header: 'VERIFIED', align: 'right', cell: (s) => <span className="text-verified">{s.verified}</span> },
                { key: 'r', header: 'REJECTED', align: 'right', cell: (s) => <span className="text-rejected">{s.rejected}</span> },
                { key: 'f', header: 'Frontier', align: 'right', cell: (s) => s.frontier },
                { key: 'sel', header: 'Selected', align: 'right', cell: (s) => s.selected },
              ]} />
            </div>
          </Card>
          <Card>
            <CardHeader title="ZevIR ingestion" description={d.zevir.ingest_error ? 'Ingest runs are unavailable on this database.' : 'OpenTelemetry / OpenInference / engine projections.'} />
            <div className="px-5 pb-4">
              <DataTable caption="Recent ZevIR ingest runs" captionHidden rows={d.zevir.ingest_runs} rowKey={(r) => r.id} minWidth={560} empty="No ingestion yet." columns={[
                { key: 'at', header: 'Received', nowrap: true, cell: (r) => dateTime(r.created_at) },
                { key: 'ws', header: 'Workspace', cell: (r) => r.workspace || '—' },
                { key: 'src', header: 'Source', cell: (r) => <span className="font-mono text-[12px]">{r.source_kind}</span> },
                { key: 'st', header: 'Status', cell: (r) => <span className="font-mono text-[12px]">{r.status}</span> },
              ]} />
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
