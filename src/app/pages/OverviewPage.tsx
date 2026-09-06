import { Link } from 'react-router';
import { ArrowRight, Radio, RefreshCw } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { app } from '../data';
import { useProjects } from '../AppShell';
import { useInspector } from '../Inspector';
import { Panel, PanelHeader, PageHeader } from '@/components/ui/Panel';
import { Metric } from '@/components/ui/Metric';
import { Sparkline, ShareBars } from '@/components/ui/Charts';
import { StatusChip, LiveDot } from '@/components/ui/StatusChip';
import { Skeleton, EmptyState, ErrorState } from '@/components/ui/States';
import { Button, ButtonLink } from '@/components/ui/Button';
import { money, compactNum, pct, ms, relativeTime, STRATEGY_LABEL, shortId } from '@/lib/format';
import { cn } from '@/lib/cn';

export default function OverviewPage() {
  const { activeWorkspace, activeProjectId } = useSession();
  const { projects, loading: projectsLoading } = useProjects();
  const inspector = useInspector();
  const q = useAsync(() => app.overview(activeWorkspace!.id, 30), [activeWorkspace?.id], { enabled: Boolean(activeWorkspace) });
  const o = q.data;

  if (!projectsLoading && !projects.length) {
    return (
      <>
        <PageHeader eyebrow={activeWorkspace?.name} title="Overview" description="Your AI spend, opportunities and verified results in one place." />
        <EmptyState title="No projects yet" description="Connect your first AI workload. A project holds its telemetry, opportunities, experiments and evidence." zev="pose-waving" action={<ButtonLink to="/app/projects?new=1">Add a project <ArrowRight size={14} /></ButtonLink>} />
      </>
    );
  }

  const filteredModels = o?.models || [];
  const m = o?.metrics;
  const spendSeries = (o?.daily || []).map((d) => d.cost_usd);
  const reqSeries = (o?.daily || []).map((d) => d.requests);

  return (
    <>
      <PageHeader
        eyebrow={activeWorkspace?.name}
        title="Overview"
        description={`Last ${o?.window_days || 30} days${activeProjectId ? ' · filtered project view applies to Opportunities and Runtime' : ''}.`}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => q.reload(true)} loading={q.loading && Boolean(o)}>
              <RefreshCw size={14} /> Refresh
            </Button>
            <ButtonLink to="/app/opportunities?analyze=1" size="sm">
              Run analysis
            </ButtonLink>
          </>
        }
      />
      {q.error && !o && <ErrorState message={q.error} onRetry={() => q.reload()} />}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Panel tone="glass-strong" className="p-5 xl:col-span-2">
          {!o ? <Skeleton className="h-[92px]" /> : (
            <div className="grid gap-6 sm:grid-cols-2">
              <Metric label="Verified savings" value={m!.verified_savings_usd} format={(v) => money(v, { digits: 4 })} tone="verified" size="lg" hint={m!.experiments_passed ? `${m!.experiments_passed} passed experiment${m!.experiments_passed === 1 ? '' : 's'} · projected ${money(m!.projected_monthly_savings_usd)} / month` : 'Appears only after a candidate passes your quality gate.'} />
              <Metric label="Potential savings" value={m!.potential_savings_usd} format={(v) => money(v, { digits: 4 })} tone="accent" size="lg" hint={`${m!.opportunities_open} open opportunit${m!.opportunities_open === 1 ? 'y' : 'ies'} · estimates, not results`} />
            </div>
          )}
        </Panel>
        <Panel className="p-5">
          {!o ? <Skeleton className="h-[92px]" /> : (
            <Metric label="AI spend" value={m!.ai_spend_usd} format={(v) => money(v)} hint={m!.requests ? `${Math.round(m!.cost_coverage * 100)}% of calls have cost evidence` : 'No telemetry yet'}>
              <Sparkline values={spendSeries} height={40} className="mt-1" />
            </Metric>
          )}
        </Panel>
        <Panel className="p-5">
          {!o ? <Skeleton className="h-[92px]" /> : (
            <Metric label="Requests" value={m!.requests} format={(v) => compactNum(Math.round(v))} hint={`${compactNum(m!.input_tokens + m!.output_tokens)} tokens · ${m!.errors} errors`}>
              <Sparkline values={reqSeries} height={40} className="mt-1" stroke="#565e6d" fill="rgba(86,94,109,0.12)" />
            </Metric>
          )}
        </Panel>
        <Panel className="p-5">
          {!o ? <Skeleton className="h-[72px]" /> : <Metric label="Quality pass rate" value={m!.quality_pass_rate === null ? null : m!.quality_pass_rate * 100} format={(v) => pct(v, 0)} hint={m!.quality_pass_rate === null ? 'No completed experiments yet' : `${m!.experiments_passed} of ${m!.experiments_passed + m!.experiments_failed} candidates passed`} />}
        </Panel>
        <Panel className="p-5">
          {!o ? <Skeleton className="h-[72px]" /> : <Metric label="Optimizations tested" value={m!.experiments_total} format={(v) => String(Math.round(v))} hint={`${m!.experiments_failed} rejected · cheaper isn't verified`} />}
        </Panel>
        <Panel className="p-5">
          {!o ? <Skeleton className="h-[72px]" /> : <Metric label="Connected projects" value={m!.connected_projects} format={(v) => String(Math.round(v))} hint={`${o.runtime.connections.length} active connection${o.runtime.connections.length === 1 ? '' : 's'}`} />}
        </Panel>
        <Panel className="p-5">
          {!o ? <Skeleton className="h-[72px]" /> : (
            <Metric label="Live runtime" raw={<span className="inline-flex items-center gap-2"><LiveDot status={o.runtime.status} /><span className="text-h3 capitalize">{o.runtime.status === 'waiting' ? 'Waiting' : o.runtime.status}</span></span>} hint={o.runtime.last_seen ? `Last trace ${relativeTime(o.runtime.last_seen)} · ${o.runtime.requests_5m} in 5 min` : 'Waiting for telemetry.'} />
          )}
        </Panel>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <Panel>
          <PanelHeader title="Top opportunities" description="Ranked by estimated savings. Estimates are potential, not verified." action={<Link to="/app/opportunities" className="text-caption text-accent-text underline-offset-4 hover:underline">View all</Link>} />
          <div className="p-2">
            {!o ? <div className="p-3"><Skeleton className="h-40" /></div> : !o.top_opportunities.length ? (
              <EmptyState compact zev={null} title="No opportunities yet" description="Run an analysis once telemetry has arrived." action={<ButtonLink to="/app/opportunities?analyze=1" size="sm">Run analysis</ButtonLink>} />
            ) : (
              <ul className="divide-y divide-line">
                {o.top_opportunities.map((opp) => (
                  <li key={opp.id}>
                    <button type="button" onClick={() => inspector.open({ kind: 'opportunity', id: opp.id })} className="flex w-full items-center gap-4 rounded-md px-3 py-3 text-left transition-control hover:bg-ink/[0.03]">
                      <div className="min-w-0 flex-1">
                        <p className="text-caption truncate font-medium text-ink">{opp.title}</p>
                        <p className="text-technical mt-0.5 truncate font-mono text-subtle">{STRATEGY_LABEL[opp.candidate_strategy]} · {opp.current_model || 'project-wide'} · confidence {opp.confidence}</p>
                      </div>
                      <span className="text-caption tnum shrink-0 font-mono text-ink">{money(opp.estimated_savings_usd, { digits: 4 })}</span>
                      <StatusChip status={opp.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Recent experiments" description="Replay results. Only PASS produces verified savings." action={<Link to="/app/experiments" className="text-caption text-accent-text underline-offset-4 hover:underline">View all</Link>} />
          <div className="p-2">
            {!o ? <div className="p-3"><Skeleton className="h-40" /></div> : !o.recent_experiments.length ? (
              <EmptyState compact zev={null} title="No experiments yet" description="Pick an opportunity and let Zev test it." />
            ) : (
              <ul className="divide-y divide-line">
                {o.recent_experiments.map((e) => (
                  <li key={e.id}>
                    <Link to={`/app/experiments/${e.id}`} className="flex items-center gap-4 rounded-md px-3 py-3 transition-control hover:bg-ink/[0.03]">
                      <div className="min-w-0 flex-1">
                        <p className="text-caption truncate font-medium text-ink">{STRATEGY_LABEL[e.strategy] || e.strategy} · {String(e.candidate?.model || '')}</p>
                        <p className="text-technical mt-0.5 font-mono text-subtle">{shortId(e.id)} · {relativeTime(e.created_at)}</p>
                      </div>
                      <span className={cn('text-caption tnum shrink-0 font-mono', e.status === 'passed' ? 'text-verified' : 'text-muted')}>{e.status === 'passed' ? `−${pct(e.verified_savings_pct)}` : e.quality_score !== null ? `q ${e.quality_score}` : '—'}</span>
                      <StatusChip status={e.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Providers" description="Spend, requests and latency by provider." />
          <div className="p-5">
            {!o ? <Skeleton className="h-32" /> : (
              <ShareBars rows={o.providers.map((p) => ({ label: p.provider, value: p.cost_usd, sub: `${compactNum(p.requests)} requests · ${compactNum(p.input_tokens + p.output_tokens)} tokens · p50 ${ms(p.latency_p50_ms)}` }))} format={(v) => money(v)} />
            )}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Models" description="Where the money goes." action={<Link to="/app/runtime" className="text-caption inline-flex items-center gap-1 text-accent-text underline-offset-4 hover:underline"><Radio size={12} /> Live runtime</Link>} />
          <div className="p-5">
            {!o ? <Skeleton className="h-32" /> : (
              <ShareBars rows={filteredModels.map((mm) => ({ label: mm.model, value: mm.cost_usd, sub: `${compactNum(mm.requests)} requests · ${compactNum(mm.output_tokens)} out tokens · ${mm.samples} samples captured` }))} format={(v) => money(v)} />
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}
