import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Play, Sparkles, Ban, RotateCcw, ArrowRight } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useProjects } from '../AppShell';
import { useInspector, OpportunityEvidence } from '../Inspector';
import { app, listOpportunities } from '../data';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Panel, PanelHeader } from '@/components/ui/Panel';
import { Button, ButtonLink } from '@/components/ui/Button';
import { StatusChip } from '@/components/ui/StatusChip';
import { Tabs } from '@/components/ui/Misc';
import { EmptyState, ErrorState, Skeleton, InlineNotice } from '@/components/ui/States';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ApiClientError, errorMessage } from '@/lib/api';
import { money, pct, ratio, STRATEGY_LABEL, titleCase, relativeTime } from '@/lib/format';
import type { Opportunity } from '@/lib/types';
import { cn } from '@/lib/cn';

type Filter = 'active' | 'verified' | 'rejected' | 'dismissed' | 'all';

export default function OpportunitiesPage() {
  const { activeWorkspace, activeProjectId, me } = useSession();
  const { projects, activeProject, loading: projectsLoading } = useProjects();
  const inspector = useInspector();
  const toast = useToast();
  const navigate = useNavigate();
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('active');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisNote, setAnalysisNote] = useState<string | null>(null);
  const [testing, setTesting] = useState<Opportunity | null>(null);
  const [runPending, setRunPending] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const q = useAsync(() => listOpportunities(activeWorkspace!.id, activeProjectId), [activeWorkspace?.id, activeProjectId], { enabled: Boolean(activeWorkspace) });
  const rows = useMemo(() => {
    const all = q.data || [];
    if (filter === 'all') return all;
    if (filter === 'active') return all.filter((o) => ['open', 'testing', 'needs_evidence'].includes(o.status));
    return all.filter((o) => o.status === filter);
  }, [q.data, filter]);
  const selected = useMemo(() => (id ? (q.data || []).find((o) => o.id === id) || null : null), [id, q.data]);

  const targetProject = activeProject || (projects.length === 1 ? projects[0] : null);

  const runAnalysis = async () => {
    if (!targetProject) {
      toast({ tone: 'info', title: 'Select a project', description: 'Choose a project in the top bar to run its analysis.' });
      return;
    }
    setAnalyzing(true);
    setAnalysisNote(null);
    try {
      const res = await app.analyze(targetProject.id);
      await q.reload(true);
      setAnalysisNote(res.events_analyzed ? `Analyzed ${res.events_analyzed} events · ${res.opportunities.length} opportunit${res.opportunities.length === 1 ? 'y' : 'ies'} found.` : 'No telemetry in the analysis window yet. Connect a runtime and send events, then run again.');
      toast({ tone: 'success', title: 'Analysis complete', description: `${res.opportunities.length} opportunities · ${res.events_analyzed} events` });
    } catch (e) {
      toast({ tone: 'error', title: 'Analysis failed', description: errorMessage(e) });
    } finally {
      setAnalyzing(false);
    }
  };

  // `?analyze=1` (command palette, overview, onboarding) runs once the project
  // list has loaded, so the auto-run never fires against an empty project set.
  const [autoAnalyze, setAutoAnalyze] = useState(params.get('analyze') === '1');
  useEffect(() => {
    if (!autoAnalyze || projectsLoading) return;
    setAutoAnalyze(false);
    params.delete('analyze');
    setParams(params, { replace: true });
    void runAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAnalyze, projectsLoading]);

  const startTest = async (sampleSize?: number, qualityGate?: number) => {
    if (!testing) return;
    setRunPending(true);
    setRunError(null);
    try {
      const { experiment } = await app.runExperiment(testing.id, { sample_size: sampleSize, quality_gate: qualityGate });
      setTesting(null);
      await q.reload(true);
      toast({ tone: experiment.status === 'passed' ? 'success' : 'info', title: experiment.status === 'passed' ? 'Candidate verified' : experiment.status === 'failed' ? 'Candidate rejected' : titleCase(experiment.status), description: experiment.status === 'passed' ? `${pct(experiment.verified_savings_pct)} cheaper on ${experiment.sample_size} samples.` : experiment.error || undefined });
      navigate(`/app/experiments/${experiment.id}`);
    } catch (e) {
      setRunError(e instanceof ApiClientError && e.code === 'INSUFFICIENT_CREDITS' ? `${e.message} Add credit from Usage.` : errorMessage(e));
      await q.reload(true);
    } finally {
      setRunPending(false);
    }
  };

  const dismiss = async (o: Opportunity, status: 'dismissed' | 'open') => {
    try {
      await app.setOpportunityStatus(o.id, status);
      await q.reload(true);
    } catch (e) {
      toast({ tone: 'error', title: 'Could not update', description: errorMessage(e) });
    }
  };

  const canWrite = activeWorkspace && ['owner', 'admin', 'member'].includes(activeWorkspace.role);
  const replayConfigured = me?.flags?.cloud_replay !== false;

  if (selected) {
    return (
      <>
        <PageHeader eyebrow={<Link to="/app/opportunities" className="hover:underline">Opportunities</Link> as unknown as string} title={selected.title} description={selected.issue}
          actions={
            <>
              {['open', 'needs_evidence', 'rejected'].includes(selected.status) && canWrite && <Button onClick={() => setTesting(selected)}><Play size={14} /> Let Zev test it</Button>}
              {selected.status === 'open' && canWrite && <Button variant="secondary" onClick={() => dismiss(selected, 'dismissed')}><Ban size={14} /> Dismiss</Button>}
              {selected.status === 'dismissed' && canWrite && <Button variant="secondary" onClick={() => dismiss(selected, 'open')}><RotateCcw size={14} /> Reopen</Button>}
            </>
          }
        />
        <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
          <div className="flex flex-col gap-4">
            <Panel className="p-5">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={selected.status} size="md" />
                <span className="text-technical font-mono text-subtle">{STRATEGY_LABEL[selected.candidate_strategy]}</span>
                <span className="text-technical font-mono text-subtle">· {titleCase(selected.risk)} risk · evidence {selected.evidence_completeness}</span>
              </div>
              <div className="mt-5 grid gap-5 sm:grid-cols-3">
                <div>
                  <p className="text-eyebrow uppercase text-subtle">Estimated savings</p>
                  <p className="text-metric mt-1 text-accent-text tnum">{money(selected.estimated_savings_usd, { digits: 4 })}</p>
                  <p className="text-technical text-subtle">{pct(selected.estimated_savings_pct)} of {money(selected.baseline_cost_usd)} · potential</p>
                </div>
                <div>
                  <p className="text-eyebrow uppercase text-subtle">Confidence</p>
                  <p className="text-metric mt-1 text-ink tnum">{ratio(selected.confidence, 2)}</p>
                  <p className="text-technical text-subtle">deterministic analysis</p>
                </div>
                <div>
                  <p className="text-eyebrow uppercase text-subtle">Current</p>
                  <p className="text-h4 mt-1 truncate font-mono text-ink">{selected.current_model || 'project-wide'}</p>
                  <p className="text-technical text-subtle">{selected.cost_driver}</p>
                </div>
              </div>
              <div className="mt-5 border-t border-line pt-4">
                <p className="text-eyebrow uppercase text-subtle">Root cause</p>
                <p className="text-caption mt-1.5 text-muted">{selected.root_cause}</p>
              </div>
              <div className="mt-4">
                <p className="text-eyebrow uppercase text-subtle">Candidate</p>
                <p className="text-caption mt-1.5 text-muted">{Object.entries(selected.candidate_config).map(([k, v]) => `${titleCase(k)}: ${v}`).join(' · ')}</p>
              </div>
              {selected.status === 'needs_evidence' && <InlineNotice tone="warning" className="mt-4">This candidate needs more evidence before it can be replayed on the platform. Open the latest experiment for the exact reason.</InlineNotice>}
            </Panel>
            <Panel>
              <PanelHeader title="Experiments" description="Every replay for this opportunity." action={<Link to="/app/experiments" className="text-caption text-accent-text underline-offset-4 hover:underline">All experiments</Link>} />
              <div className="p-5">
                <ButtonLink to={`/app/experiments?opportunity=${selected.id}`} variant="secondary" size="sm">View experiments <ArrowRight size={13} /></ButtonLink>
              </div>
            </Panel>
          </div>
          <Panel tone="glass" className="p-5">
            <p className="text-eyebrow mb-3 uppercase text-subtle">Evidence inspector</p>
            <OpportunityEvidence opportunity={selected} />
          </Panel>
        </div>
        <TestDialog opportunity={testing} onClose={() => setTesting(null)} onRun={startTest} pending={runPending} error={runError} planSamples={activeWorkspace ? Number((me?.account.planLimits.replay_samples as number) || 8) : 8} replayConfigured={replayConfigured} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={activeWorkspace?.name}
        title="Opportunities"
        description={targetProject ? `Deterministic diagnosis for ${targetProject.name}. Estimates are potential savings until a replay verifies them.` : 'Select a project to run analysis. Showing opportunities across all projects.'}
        actions={
          canWrite && (
            <Button onClick={runAnalysis} loading={analyzing}>
              <Sparkles size={14} /> Run analysis
            </Button>
          )
        }
      />
      {analysisNote && <InlineNotice tone="info" className="mb-4">{analysisNote}</InlineNotice>}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={filter} onChange={setFilter} items={[{ value: 'active', label: 'Active', count: (q.data || []).filter((o) => ['open', 'testing', 'needs_evidence'].includes(o.status)).length }, { value: 'verified', label: 'Verified', count: (q.data || []).filter((o) => o.status === 'verified').length }, { value: 'rejected', label: 'Rejected', count: (q.data || []).filter((o) => o.status === 'rejected').length }, { value: 'dismissed', label: 'Dismissed' }, { value: 'all', label: 'All' }]} />
      </div>
      {q.error && <ErrorState message={q.error} onRetry={() => q.reload()} />}
      {q.loading && !q.data ? (
        <div className="flex flex-col gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-lg" />)}</div>
      ) : !rows.length ? (
        <EmptyState title={filter === 'active' ? 'No opportunities yet' : `No ${filter} opportunities`} description={filter === 'active' ? 'Run an analysis. ZEVQORA reads the last 30 days of telemetry and names the waste it can support with evidence.' : 'Nothing here for this filter.'} action={filter === 'active' && canWrite && <Button onClick={runAnalysis} loading={analyzing}><Sparkles size={14} /> Run analysis</Button>} />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((o) => (
            <li key={o.id}>
              <Panel className={cn('p-5 transition-control hover:shadow-panel', o.status === 'verified' && 'border-verified/30')}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip status={o.status} />
                      <span className="text-technical font-mono text-subtle">{STRATEGY_LABEL[o.candidate_strategy]}</span>
                      {projects.length > 1 && <span className="text-technical font-mono text-subtle">· {projects.find((p) => p.id === o.project_id)?.name}</span>}
                    </div>
                    <Link to={`/app/opportunities/${o.id}`} className="text-h4 mt-2 block text-ink hover:underline underline-offset-4">{o.title}</Link>
                    <p className="text-caption mt-1.5 line-clamp-2 text-muted">{o.issue}</p>
                    <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-technical text-subtle">
                      <div>model <span className="text-ink">{o.current_model || 'project-wide'}</span></div>
                      <div>confidence <span className="text-ink">{ratio(o.confidence, 2)}</span></div>
                      <div>risk <span className="text-ink">{o.risk}</span></div>
                      <div>evidence <span className={o.evidence_completeness === 'complete' ? 'text-verified' : 'text-warning'}>{o.evidence_completeness}</span></div>
                      <div>updated <span className="text-ink">{relativeTime(o.updated_at)}</span></div>
                    </dl>
                  </div>
                  <div className="flex shrink-0 flex-row items-center gap-4 lg:flex-col lg:items-end">
                    <div className="text-right">
                      <p className="text-eyebrow uppercase text-subtle">Est. savings</p>
                      <p className="text-h3 text-accent-text tnum">{money(o.estimated_savings_usd, { digits: 4 })}</p>
                      <p className="text-technical text-subtle">{pct(o.estimated_savings_pct)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="secondary" onClick={() => inspector.open({ kind: 'opportunity', id: o.id })}>Evidence</Button>
                      {['open', 'needs_evidence', 'rejected'].includes(o.status) && canWrite && (
                        <Button size="sm" onClick={() => setTesting(o)}><Play size={13} /> Let Zev test it</Button>
                      )}
                      {o.status === 'testing' && <StatusChip status="running" />}
                    </div>
                  </div>
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      )}
      <TestDialog opportunity={testing} onClose={() => setTesting(null)} onRun={startTest} pending={runPending} error={runError} planSamples={Number((me?.account.planLimits.replay_samples as number) || 8)} replayConfigured={replayConfigured} />
    </>
  );
}

function TestDialog({ opportunity, onClose, onRun, pending, error, planSamples, replayConfigured }: { opportunity: Opportunity | null; onClose: () => void; onRun: (sampleSize?: number, qualityGate?: number) => void; pending: boolean; error: string | null; planSamples: number; replayConfigured: boolean }) {
  const { projects } = useProjects();
  const project = projects.find((p) => p.id === opportunity?.project_id);
  const replayable = opportunity && ['exact_reuse', 'model_substitution', 'bounded_routing'].includes(opportunity.candidate_strategy);
  const [samples, setSamples] = useState(planSamples);
  const [gate, setGate] = useState<number>(Number(project?.settings?.quality_gate ?? 0.95));
  useEffect(() => {
    setSamples(planSamples);
    setGate(Number(project?.settings?.quality_gate ?? 0.95));
  }, [planSamples, project, opportunity]);
  return (
    <Dialog open={Boolean(opportunity)} onClose={onClose} title="Let Zev test it" description={opportunity ? `${STRATEGY_LABEL[opportunity.candidate_strategy]} · ${opportunity.current_model || 'project-wide'}` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={() => onRun(samples, gate)} loading={pending}><Play size={14} /> {replayable ? 'Run replay' : 'Record experiment'}</Button>
        </>
      }
    >
      {opportunity && (
        <div className="flex flex-col gap-4">
          {replayable ? (
            <p className="text-caption text-muted">{opportunity.candidate_strategy === 'exact_reuse' ? 'Deterministic replay over repeated prompts in the last 30 days. No provider calls, no credit consumed. Outputs are compared by hash; if the same prompt produced different outputs, the cache candidate is rejected.' : `Replays up to ${samples} captured samples on ${String(opportunity.candidate_config.candidate_model || opportunity.candidate_config.cheap_model)} using the ZEVQORA platform credential. Provider cost is charged to Zev credit exactly once.`}</p>
          ) : (
            <InlineNotice tone="warning">This strategy needs a code-level change and cannot be replayed on the platform alone. The experiment will be recorded as “needs evidence” with the exact next step.</InlineNotice>
          )}
          {replayable && opportunity.candidate_strategy !== 'exact_reuse' && !replayConfigured && <InlineNotice tone="warning">Cloud replay is not configured on this deployment yet. The run will be declined until the platform provider credential is set.</InlineNotice>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="samples" label="Samples" hint={`Plan allows up to ${planSamples}.`}>
              <Input id="samples" type="number" min={5} max={planSamples} value={samples} onChange={(e) => setSamples(Math.max(5, Math.min(planSamples, Number(e.target.value) || 5)))} disabled={!replayable} />
            </Field>
            <Field id="gate" label="Quality gate" hint="Frozen before the run.">
              <Input id="gate" type="number" step="0.01" min={0.5} max={1} value={gate} onChange={(e) => setGate(Number(e.target.value))} disabled={!replayable} />
            </Field>
          </div>
          <ul className="text-technical space-y-1 font-mono text-subtle">
            <li>gates · minimum_samples, evidence_completeness, execution_success, quality_floor, cost_improvement, latency_regression</li>
            <li>result · VERIFIED only if every gate passes</li>
          </ul>
          {error && <p role="alert" className="text-caption text-rejected">{error}</p>}
        </div>
      )}
    </Dialog>
  );
}
