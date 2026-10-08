import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowRight, GitBranch, Stethoscope } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { trackProductView } from '@/lib/analytics';
import { cn } from '@/lib/cn';
import { Card, CardHeader } from '@/components/ui/Card';
import { ClaimBadge, VerdictBadge } from '@/components/ui/Claim';
import { CopyableHash, EvidenceLink } from '@/components/ui/Evidence';
import { ViewHeader } from '@/components/ui/Layout';
import { EmptyState, ErrorState, LoadingState, InlineNotice } from '@/components/ui/States';
import { ButtonLink } from '@/components/ui/Button';
import { useProduct } from '../store';
import { NoProject, ProductFrame } from '../Frame';
import { optimizeApi, type Diagnosis, type ExecutionPlan } from '../optimize';
import { fmt } from '../experience';

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

function severityChip(s: Diagnosis['severity']) {
  return <span className={cn('rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide', s === 'high' ? 'bg-rejected-bg text-rejected' : s === 'medium' ? 'bg-warning-bg text-warning' : 'bg-sunken text-muted')}>{s} severity</span>;
}

function planBadge(p: ExecutionPlan) {
  if (p.verdict) return <VerdictBadge verdict={p.verdict} size="xs" />;
  if (p.status === 'CALIBRATION_REJECTED') return <ClaimBadge claim="REJECTED" label="REJECTED IN CALIBRATION" size="xs" />;
  if (p.status === 'CONFLICTED') return <ClaimBadge claim="UNKNOWN" label="CONFLICTED" size="xs" title="Two of its changes conflict; it was never run." />;
  if (p.status === 'PRUNED') return <ClaimBadge claim="UNKNOWN" label="PRUNED" size="xs" title="Another plan answers every request the same way with less risk." />;
  if (p.executable_status !== 'EXECUTABLE') return <ClaimBadge claim="UNKNOWN" label="NOT REPLAYABLE YET" size="xs" title="ZEVQORA cannot replay this kind of change yet, so it is never offered for execution." />;
  return <ClaimBadge claim="ESTIMATED" size="xs" />;
}

/**
 * The developer's chain from a diagnosis to a verdict:
 * diagnosis → affected graph nodes → source evidence → candidate plans →
 * replay result → verdict. Every link opens the real record.
 */
function DiagnosisDetail({ d, plans, workspaceId }: { d: Diagnosis; plans: ExecutionPlan[]; workspaceId: string }) {
  useEffect(() => {
    trackProductView('diagnosis_viewed', workspaceId, d.id, { family: d.family, surface: 'diagnoses' });
  }, [d.id, d.family, workspaceId]);
  // Plans with a verdict first (VERIFIED, REJECTED, INCOMPLETE), then the ones still in the pipeline, then blocked.
  const rank = (p: ExecutionPlan) => (p.verdict === 'VERIFIED' ? 0 : p.verdict === 'REJECTED' ? 1 : p.verdict === 'INCOMPLETE' ? 2 : p.status === 'CALIBRATION_REJECTED' ? 3 : p.executable_status === 'EXECUTABLE' ? 4 : 5);
  const related = plans.filter((p) => p.explanation?.supporting_diagnoses?.some((s) => s.id === d.id)).sort((a, b) => rank(a) - rank(b));
  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {severityChip(d.severity)}
          <span className="font-mono text-[12px] text-muted">{d.family}</span>
          <span className="font-mono text-[11.5px] text-subtle">confidence {(d.confidence * 100).toFixed(0)}% · risk {d.risk_class}</span>
        </div>
        <h2 className="mt-2 text-[1.15rem] font-semibold tracking-[-0.015em] text-ink">{d.symptom}</h2>
        <p className="mt-1 text-[13px] text-muted">{d.root_cause}</p>
        <p className="mt-2 text-[12px] text-subtle">Scope: <span className="font-mono">{d.scope}</span> · <CopyableHash value={d.diagnosis_hash} label="diagnosis hash" /></p>
      </div>

      <ol className="relative flex flex-col gap-4 border-l border-line pl-5">
        <li>
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-subtle">1 · Affected graph nodes</h3>
          {d.affected_nodes.length ? (
            <ul className="mt-1.5 flex flex-col gap-1">
              {d.affected_nodes.slice(0, 12).map((n) => (
                <li key={`${n.graph_id}-${n.node_id}`} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  <span className="font-mono text-ink">{n.kind}{n.name ? ` · ${n.name}` : ''}</span>
                  <EvidenceLink to={`/app/graph?graph=${n.graph_id}&node=${n.node_id}`}>Open in graph</EvidenceLink>
                </li>
              ))}
              {d.affected_nodes.length > 12 && <li className="text-[12px] text-subtle">and {d.affected_nodes.length - 12} more</li>}
            </ul>
          ) : (
            <p className="mt-1 text-[12.5px] text-muted">This diagnosis is not tied to individual graph nodes.</p>
          )}
        </li>
        <li>
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-subtle">2 · Source evidence</h3>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {d.evidence_refs.slice(0, 16).map((r, i) => (
              <li key={i} className="rounded-sm border border-line bg-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink">{r.type}{r.request_id ? ` ${r.request_id}` : r.stable_key ? ` ${r.stable_key}` : r.id ? ` ${r.id.slice(0, 8)}` : ''}</li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11.5px] text-subtle">Hashes and identifiers only; prompts and outputs are not stored.</p>
        </li>
        <li>
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-subtle">3 · Candidate plans and their verdicts</h3>
          {related.length ? (
            <>
            <p className="mt-1 text-[11.5px] text-subtle">{related.length} plan{related.length === 1 ? '' : 's'} include a change for this diagnosis; showing the 10 most decided.</p>
            <ul className="mt-1.5 flex flex-col divide-y divide-line rounded-md border border-line">
              {related.slice(0, 10).map((p) => {
                const m = p.verified_effects || p.evaluated_effects;
                return (
                  <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="break-words text-[13px] font-medium text-ink">{p.name}</p>
                      <p className="text-[11.5px] text-subtle">{p.stage} · {p.executable_status.replace(/_/g, ' ').toLowerCase()}{m ? ` · cost/success ${fmt.signedPct(m.deltas_pct?.cost_per_successful_outcome) ?? 'unknown'} · p95 ${fmt.signedPct(m.deltas_pct?.p95) ?? 'unknown'}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {planBadge(p)}
                      <Link to="/app/optimize#step-search" className="text-[12px] font-medium text-accent-text">Details</Link>
                    </div>
                  </li>
                );
              })}
            </ul>
            </>
          ) : (
            <p className="mt-1 text-[12.5px] text-muted">No plan search has proposed a change for this diagnosis yet. Suggested passes: {d.suggested_optimization_passes.join(', ') || 'none'}.</p>
          )}
        </li>
        <li>
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-subtle">4 · What would prove this wrong</h3>
          <p className="mt-1 text-[12.5px] text-ink">{d.falsifier}</p>
          {d.required_additional_evidence.length > 0 && <p className="mt-1 text-[12px] text-warning">Still needed: {d.required_additional_evidence.join(', ')}</p>}
        </li>
      </ol>
    </div>
  );
}

export default function DiagnosesView() {
  const { selected, canEdit } = useProduct();
  const { activeWorkspace } = useSession();
  const [params, setParams] = useSearchParams();
  const productId = selected?.id || '';
  const status = useAsync(() => optimizeApi.status(productId), [productId], { enabled: Boolean(productId) });
  const run = status.data?.runs?.[0] || null;
  const diagnoses = useAsync(() => (run ? optimizeApi.diagnoses(run.id) : Promise.resolve([] as Diagnosis[])), [run?.id], { enabled: Boolean(status.data) });
  const searches = useAsync(() => (run && status.data?.intelligence ? optimizeApi.searches(run.id) : Promise.resolve({ searches: [] })), [run?.id, status.data?.intelligence], { enabled: Boolean(status.data) });
  const latest = searches.data?.searches?.[0] || null;
  const report = useAsync(() => (latest ? optimizeApi.searchReport(latest.id) : Promise.resolve(null)), [latest?.id], { enabled: Boolean(searches.data) });
  const list = useMemo(() => [...(diagnoses.data || [])].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.confidence - a.confidence), [diagnoses.data]);
  const activeId = params.get('diagnosis') || list[0]?.id || null;
  const active = list.find((d) => d.id === activeId) || list[0] || null;

  if (!selected) return <NoProject><EmptyState zev="pose-thinking" title="No workload selected" description="Connect a workload or load the demo, then diagnoses appear here." action={<ButtonLink to="/app/connections">Connect evidence</ButtonLink>} /></NoProject>;

  return (
    <ProductFrame inspector={false}>
      <ViewHeader eyebrow="Diagnose" title="Diagnoses" description="Deterministic, evidence-based findings about cost, latency and reliability. A diagnosis is not a saving — only a VERIFIED plan is evidence of an improvement." actions={<ButtonLink to="/app/optimize#step-diagnoses" variant="secondary" size="sm"><Stethoscope size={14} aria-hidden /> Run diagnoses</ButtonLink>} />
      {status.error && <ErrorState message={status.error} onRetry={() => void status.reload()} />}
      {status.data && !status.data.enabled && <InlineNotice tone="info">Verified Optimization is not enabled for this workspace, so no diagnoses are produced yet.</InlineNotice>}
      {(status.loading || diagnoses.loading) && <LoadingState label="Loading diagnoses" />}
      {status.data?.enabled && !run && <EmptyState zev="pose-sitting" title="No optimization run yet" description="Freeze an Evaluation Contract and build a baseline first; diagnoses are computed from that baseline." action={canEdit ? <ButtonLink to="/app/optimize#step-contract">Start in Optimization</ButtonLink> : undefined} />}
      {run && diagnoses.data && !list.length && <EmptyState zev="pose-thinking" title="No diagnoses yet" description="Run diagnoses on the latest baseline. If none fire, the evidence did not show a waste pattern ZEVQORA can prove." action={canEdit ? <ButtonLink to="/app/optimize#step-diagnoses">Run diagnoses</ButtonLink> : undefined} />}
      {diagnoses.error && <ErrorState message={diagnoses.error} onRetry={() => void diagnoses.reload()} />}
      {list.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[minmax(260px,340px)_1fr]">
          <Card as="div" className="h-max">
            <CardHeader title={`${list.length} diagnos${list.length === 1 ? 'is' : 'es'}`} description={run ? `Run ${run.id.slice(0, 8)} · contract ${run.contract_hash.slice(0, 8)}` : undefined} />
            <ul className="max-h-[70vh] overflow-y-auto px-2 pb-2" aria-label="Diagnoses">
              {list.map((d) => (
                <li key={d.id}>
                  <button type="button" aria-current={d.id === active?.id ? 'true' : undefined} onClick={() => setParams({ diagnosis: d.id })} className={cn('w-full rounded-md px-3 py-2.5 text-left transition-control', d.id === active?.id ? 'bg-accent-subtle' : 'hover:bg-ink/[0.03]')}>
                    <span className="flex items-center gap-2">{severityChip(d.severity)}<span className="font-mono text-[11px] text-subtle">{d.family}</span></span>
                    <span className="mt-1 block text-[13px] text-ink">{d.symptom}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-5">
            {active && <DiagnosisDetail d={active} plans={report.data?.plans || []} workspaceId={activeWorkspace?.id || ''} />}
            {!status.data?.intelligence && <p className="mt-4 text-[12px] text-subtle">Plan search (Optimization Intelligence) is not enabled for this workspace, so candidate plans are not linked here.</p>}
            <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
              <ButtonLink to="/app/graph" variant="secondary" size="sm"><GitBranch size={13} aria-hidden /> Execution graph</ButtonLink>
              <ButtonLink to="/app/optimize#step-search" variant="secondary" size="sm">Plan search <ArrowRight size={13} aria-hidden /></ButtonLink>
            </div>
          </Card>
        </div>
      )}
    </ProductFrame>
  );
}
