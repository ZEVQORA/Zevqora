import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { Check, X, Download, FileJson, Printer, ArrowLeft } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useSession } from '@/lib/session';
import { useProjects } from '../AppShell';
import { getExperiment, app } from '../data';
import { ExperimentEvidence } from '../Inspector';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Panel, PanelHeader, KeyValue } from '@/components/ui/Panel';
import { Button, ButtonAnchor } from '@/components/ui/Button';
import { Table, Th, Td } from '@/components/ui/Misc';
import { ErrorState, Skeleton, InlineNotice } from '@/components/ui/States';
import { NumberTicker } from '@/components/ui/Metric';
import { money, ms, pct, ratio, dateTime, shortId, STRATEGY_LABEL, titleCase } from '@/lib/format';
import { accessToken } from '@/lib/supabase';
import { cn } from '@/lib/cn';
import type { Experiment } from '@/lib/types';

function Column({ title, e, side }: { title: string; e: Experiment; side: 'baseline' | 'candidate' }) {
  const data = side === 'baseline' ? e.baseline : e.candidate;
  const rows = [
    { k: 'Provider', v: side === 'baseline' ? String(data.provider || '—') : String(e.evidence?.provider || 'openrouter') },
    { k: 'Model', v: String(data.model || '—') },
    { k: 'Requests', v: String(data.samples ?? e.sample_size) },
    { k: 'Cost (samples)', v: money(data.cost_usd as number | null, { digits: 6 }) },
    { k: 'Latency p50', v: ms(data.latency_p50_ms as number | null) },
    { k: 'Quality', v: side === 'baseline' ? 'reference' : ratio(e.quality_score, 4) },
  ];
  return (
    <Panel tone={side === 'candidate' ? 'glass-strong' : 'plane'} className="p-5">
      <p className="text-eyebrow uppercase text-subtle">{title}</p>
      <p className="text-h4 mt-1 truncate font-mono text-ink">{String(data.model || '—')}</p>
      <KeyValue className="mt-3" items={rows} />
    </Panel>
  );
}

export default function ExperimentPage({ report = false }: { report?: boolean }) {
  const { id = '' } = useParams();
  const { activeWorkspace } = useSession();
  const { projects } = useProjects();
  const reduced = useReducedMotion();
  const q = useAsync(() => getExperiment(id), [id]);
  const e = q.data?.experiment || null;
  const cases = q.data?.cases || [];
  const project = useMemo(() => projects.find((p) => p.id === e?.project_id), [projects, e]);

  const downloadJson = async () => {
    const data = await app.report(id);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zevqora-report-${shortId(id)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const downloadCsv = async () => {
    const token = await accessToken();
    const res = await fetch(`/api/experiments/${id}/report.csv`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zevqora-experiment-${shortId(id)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (q.loading && !e) return <Skeleton className="h-96 rounded-lg" />;
  if (q.error) return <ErrorState message={q.error} onRetry={() => q.reload()} />;
  if (!e) return <ErrorState message="Experiment not found." />;

  const passed = e.status === 'passed';
  const failed = e.status === 'failed';
  const baseCost = Number(e.baseline?.cost_usd ?? 0);
  const candCost = Number(e.candidate?.cost_usd ?? 0);
  const rawDelta = baseCost > 0 ? ((baseCost - candCost) / baseCost) * 100 : null;

  return (
    <div className="print-page">
      <PageHeader
        eyebrow={report ? 'Report' : 'Experiment'}
        title={`${STRATEGY_LABEL[e.strategy] || e.strategy} · ${shortId(e.id)}`}
        description={`${project?.name || 'Project'} · evaluated ${dateTime(e.completed_at || e.created_at)}`}
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={downloadJson}><FileJson size={14} /> JSON</Button>
            <Button variant="secondary" size="sm" onClick={downloadCsv}><Download size={14} /> CSV</Button>
            <Button variant="secondary" size="sm" onClick={() => window.print()}><Printer size={14} /> PDF</Button>
          </div>
        }
      >
        <Link to={report ? '/app/reports' : '/app/experiments'} className="text-caption no-print mt-3 inline-flex items-center gap-1 text-muted hover:text-ink"><ArrowLeft size={13} /> Back</Link>
      </PageHeader>

      {/* Verdict */}
      <motion.div initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.2, 0, 0, 1] }} className={cn('rounded-xl border p-6', passed ? 'border-verified/40 bg-verified-bg/40' : failed ? 'border-rejected/30 bg-rejected-bg/40' : 'border-warning/30 bg-warning-bg/40')}>
        <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className={cn('inline-flex h-10 w-10 items-center justify-center rounded-full', passed ? 'bg-verified text-white' : failed ? 'bg-rejected text-white' : 'bg-warning text-white')}>{passed ? <Check size={20} strokeWidth={3} /> : <X size={20} strokeWidth={3} />}</span>
              <div>
                <p className="text-eyebrow uppercase text-subtle">Quality gate</p>
                <p className={cn('text-h2', passed ? 'text-verified' : failed ? 'text-rejected' : 'text-warning')}>{passed ? 'PASS' : failed ? 'FAIL' : titleCase(e.status)}</p>
              </div>
            </div>
            <p className="text-caption mt-4 max-w-[60ch] text-ink">
              {passed
                ? `Every gate passed on ${e.sample_size} samples. Quality ${ratio(e.quality_score, 4)} against a frozen floor of ${ratio(e.quality_gate, 2)}.`
                : failed
                  ? `Candidate rejected. ${e.error || 'A gate failed.'} Cheaper isn't verified.`
                  : e.error || 'This experiment did not produce a verdict.'}
            </p>
          </div>
          <div className="text-left lg:text-right">
            <p className="text-eyebrow uppercase text-subtle">{passed ? 'Verified savings' : 'Raw cost delta'}</p>
            <p className={cn('text-[2.75rem] font-semibold leading-none tracking-[-0.035em]', passed ? 'text-verified' : 'text-muted')}>{passed && e.verified_savings_pct !== null ? <NumberTicker value={e.verified_savings_pct} format={(v) => `−${v.toFixed(2)}%`} /> : rawDelta !== null ? `${rawDelta > 0 ? '−' : '+'}${Math.abs(rawDelta).toFixed(2)}%` : '—'}</p>
            <p className="text-technical mt-1 font-mono text-subtle">{passed ? `${money(e.verified_savings_usd, { digits: 6 })} on samples · projected ${money(e.projected_monthly_savings_usd)} / month` : failed ? 'not verified · not reported as savings' : ''}</p>
          </div>
        </div>
      </motion.div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Column title="Baseline" e={e} side="baseline" />
        <Column title="Candidate" e={e} side="candidate" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel>
          <PanelHeader title="Gates" description="Every gate is named, frozen before the run, and recorded." />
          <ul className="divide-y divide-line px-5">
            {e.gates.map((g) => (
              <li key={g.name} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="font-mono text-caption text-ink">{g.name}</p>
                  <p className="text-technical mt-0.5 text-muted">{g.detail}</p>
                </div>
                <span className={cn('inline-flex shrink-0 items-center gap-1 font-mono text-technical', g.passed ? 'text-verified' : 'text-rejected')}>{g.passed ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={3} />}{g.passed ? 'PASS' : 'FAIL'}</span>
              </li>
            ))}
            {!e.gates.length && <li className="py-4"><InlineNotice tone="warning">No gates were evaluated. {e.error}</InlineNotice></li>}
          </ul>
        </Panel>
        <Panel tone="glass" className="p-5">
          <p className="text-eyebrow mb-2 uppercase text-subtle">Evidence</p>
          <ExperimentEvidence experiment={e} cases={cases} />
        </Panel>
      </div>

      {cases.length > 0 && (
        <Panel className="mt-4 p-2">
          <PanelHeader title="Evaluation cases" description="Outputs are stored as hashes with a short candidate preview. Nothing is implied where evidence is absent." className="px-3" />
          <Table minWidth={900}>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Grader</Th>
                <Th align="right">Score</Th>
                <Th>Candidate</Th>
                <Th align="right">Baseline cost</Th>
                <Th align="right">Candidate cost</Th>
                <Th align="right">Latency</Th>
                <Th>Hashes</Th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id}>
                  <Td mono>{c.case_index + 1}</Td>
                  <Td mono>{c.grader}</Td>
                  <Td align="right" mono><span className={c.passed ? 'text-verified' : c.score === null ? 'text-subtle' : 'text-rejected'}>{c.score === null ? '—' : c.score.toFixed(3)}</span></Td>
                  <Td>
                    <span className="font-mono text-technical text-muted">{c.candidate_model || '—'}</span>
                    {typeof c.details?.candidate_preview === 'string' && <div className="text-technical mt-0.5 max-w-[280px] truncate text-subtle">{String(c.details.candidate_preview)}</div>}
                    {c.error && <div className="text-technical mt-0.5 text-rejected">{c.error}</div>}
                  </Td>
                  <Td align="right" mono>{money(c.baseline_cost_usd, { digits: 6 })}</Td>
                  <Td align="right" mono>{money(c.candidate_cost_usd, { digits: 6 })}</Td>
                  <Td align="right" mono>{ms(c.baseline_latency_ms)} → {ms(c.candidate_latency_ms)}</Td>
                  <Td mono><span className="text-subtle">{c.baseline_output_hash?.slice(0, 8) || '—'} / {c.candidate_output_hash?.slice(0, 8) || '—'}</span></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}

      {report && (
        <Panel className="mt-4 p-5">
          <p className="text-eyebrow uppercase text-subtle">Report metadata</p>
          <KeyValue className="mt-2" items={[{ k: 'Workspace', v: activeWorkspace?.name || '—' }, { k: 'Project', v: project?.name || '—' }, { k: 'Verification status', v: passed ? 'VERIFIED' : failed ? 'REJECTED' : e.status.toUpperCase() }, { k: 'Source', v: 'ZEVQORA platform replay' }, { k: 'Generated', v: dateTime(new Date().toISOString()) }]} />
          <p className="text-technical mt-4 text-subtle">Limitations: {(e.evidence?.limitations || []).join(' ')}</p>
          <div className="no-print mt-4">
            <ButtonAnchor href={`/app/experiments/${e.id}`} variant="ghost" size="sm">Open experiment</ButtonAnchor>
          </div>
        </Panel>
      )}
      <p className="text-technical mt-4 font-mono text-subtle">{pct(e.verified_savings_pct)} verified · evidence hash {e.evidence_hash?.slice(0, 16) || '—'}</p>
    </div>
  );
}
