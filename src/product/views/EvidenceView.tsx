import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Download, FileText } from 'lucide-react';
import { NoProject, ProductFrame } from '../Frame';
import { useProduct } from '../store';
import { useProductDialogs } from '../dialogs/context';
import { Button, Card, CardHeader, Empty, KeyValue, StatusChip, saveTextFile, useProductToast } from '../ui';
import { dateTime, money, ms, observedLabel, relativeTime, score, shortId, STRATEGY_LABEL, titleCase } from '../format';
import { explainEvaluation, evidenceReportMarkdown, GATE_LABEL, orderedGates } from '../evidence';
import type { Evaluation } from '../types';

function VerdictExplained({ evaluation }: { evaluation: Evaluation }) {
  const x = explainEvaluation(evaluation);
  const tone = evaluation.status === 'VERIFIED' ? 'border-verified/30 bg-verified-bg' : evaluation.status === 'REJECTED' ? 'border-rejected/30 bg-rejected-bg' : 'border-warning/30 bg-warning-bg';
  const text = evaluation.status === 'VERIFIED' ? 'text-verified' : evaluation.status === 'REJECTED' ? 'text-rejected' : 'text-warning';
  return (
    <div className={`rounded-xl border px-5 py-4 ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusChip status={evaluation.status} />
        <span className="text-[12px] text-subtle">{evaluation.sample_count} evaluated cases · {evaluation.protected_sample_count} protected</span>
      </div>
      <p className={`mt-3 text-[16px] font-semibold ${text}`}>{x.headline}</p>
      {evaluation.status === 'VERIFIED' && (
        <ul className="mt-3 grid gap-1 text-[13px] text-ink sm:grid-cols-2">
          {x.passed.map((g) => <li key={g.name}>✓ {GATE_LABEL[g.name] || g.name}</li>)}
        </ul>
      )}
      {evaluation.status === 'REJECTED' && (
        <ul className="mt-3 space-y-1.5 text-[13px]">
          {x.failed.map((g) => (
            <li key={g.name} className="text-rejected"><b className="font-semibold">{GATE_LABEL[g.name] || g.name}:</b> {g.reason || `observed ${observedLabel(g.observed)}, threshold ${observedLabel(g.threshold)}`}</li>
          ))}
          <li className="text-muted">A rejected candidate is never counted as savings, however much cheaper it was.</li>
        </ul>
      )}
      {x.nextEvidence.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">Evidence still required</p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[13px] text-ink">
            {x.nextEvidence.map((s) => <li key={s}>{s}</li>)}
          </ol>
        </div>
      )}
    </div>
  );
}

export default function EvidenceView() {
  const { selected, evaluations, executions, plans, findings, inspect, setInspect } = useProduct();
  const dialogs = useProductDialogs();
  const navigate = useNavigate();
  const toast = useProductToast();
  const [chosen, setChosen] = useState<string | null>(null);
  const current = useMemo(() => {
    const id = inspect?.kind === 'evaluation' ? inspect.id : chosen;
    return evaluations.find((e) => e.id === id) || evaluations[0] || null;
  }, [evaluations, inspect, chosen]);

  if (!selected) {
    return (
      <NoProject>
        <Empty title="No project selected" description="Connect a repository or a workload first. Evidence appears here once a candidate has been replayed and graded." action={<Button onClick={dialogs.openConnect}>Connect evidence</Button>} />
      </NoProject>
    );
  }

  const execution = current ? executions.find((e) => e.id === current.candidate_execution_id) || null : null;
  const plan = current ? plans.find((p) => p.id === current.candidate_plan_id) || null : null;
  const finding = current ? findings.find((f) => f.id === current.finding_id) || null : null;
  const strategy = plan ? STRATEGY_LABEL[plan.strategy] || titleCase(plan.strategy) : null;
  const candidateModel = execution?.resolved_model || execution?.requested_model || (plan?.strategy === 'exact_reuse' ? 'deterministic reuse' : String(plan?.candidate_config?.model || '')) || null;
  const floor = current?.gates.find((g) => g.name === 'quality_floor')?.threshold;

  const exportReport = async () => {
    if (!current) return;
    const md = evidenceReportMarkdown({ productName: selected.name, evaluation: current, strategy, candidateModel, costSource: execution?.cost_source || null });
    const path = await saveTextFile(`zevqora-evidence-${shortId(current.id, 10)}.md`, md, 'text/markdown');
    if (path) toast({ tone: 'ok', title: 'Evidence report saved', description: path });
  };

  return (
    <ProductFrame>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="peyebrow">Evidence</div>
          <h1 className="ph1">What each verdict rests on.</h1>
          <p className="plede">Every gate, its threshold and what was observed. VERIFIED lists what passed, REJECTED shows what failed, INCOMPLETE says which evidence to add next.</p>
        </div>
      </div>

      {!evaluations.length ? (
        <Empty
          icon={<FileText size={28} className="text-subtle" />}
          title="No evidence yet"
          description="Evidence is produced when a candidate is replayed on your cases and graded. Findings on their own are signals, not evidence."
          action={<Button size="sm" onClick={() => navigate('/app/opportunities')}>Go to opportunities</Button>}
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
          <div className="grid content-start gap-2">
            {evaluations.map((e) => {
              const p = plans.find((x) => x.id === e.candidate_plan_id);
              return (
                <button key={e.id} type="button" className={`plist-row is-clickable ${current?.id === e.id ? 'is-selected' : ''}`} onClick={() => { setChosen(e.id); setInspect({ kind: 'evaluation', id: e.id }); }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold text-ink">{STRATEGY_LABEL[p?.strategy || ''] || titleCase(p?.strategy || 'candidate')}</span>
                    <StatusChip status={e.status} />
                  </div>
                  <span className="text-[11.5px] text-subtle">{e.sample_count} cases · {relativeTime(e.created_at)}</span>
                </button>
              );
            })}
          </div>

          {current && (
            <div className="grid content-start gap-4">
              <VerdictExplained evaluation={current} />

              <Card>
                <CardHeader
                  title="Frozen for this verdict"
                  description={finding ? finding.title : 'The inputs the gates were applied to. Changing any of them means a new experiment.'}
                  action={<Button size="xs" variant="secondary" onClick={() => void exportReport()}><Download size={12} /> Evidence report (.md)</Button>}
                />
                <div className="pcard-body">
                  <KeyValue
                    items={[
                      ['Strategy', strategy || '—'],
                      ['Candidate', candidateModel || '—'],
                      ['Evaluated cases', `${current.sample_count} (${current.protected_sample_count} protected)`],
                      ['Quality floor', observedLabel(floor)],
                      ['Quality baseline → candidate', `${score(current.baseline_quality)} → ${score(current.candidate_quality)}`],
                      ['Cost baseline → candidate', `${money(current.baseline_cost_usd, { digits: 6 })} → ${money(current.candidate_cost_usd, { digits: 6 })}`],
                      ['Candidate cost source', execution?.cost_source || 'unknown'],
                      ['Latency baseline → candidate', `${ms(current.baseline_latency_ms)} → ${ms(current.candidate_latency_ms)}`],
                      ['Execution proven', current.execution_proven ? 'yes' : 'no'],
                      ['Evaluated', dateTime(current.completed_at || current.created_at)],
                      ['Gate config', <span key="g" className="mono">{shortId(current.gate_config_hash, 12) || '—'}</span>],
                      ['Grader config', <span key="r" className="mono">{shortId(current.grader_config_hash, 12) || '—'}</span>],
                    ]}
                  />
                </div>
              </Card>

              <Card>
                <CardHeader title="Gates" description="Required gates decide the verdict. Informational gates are recorded but assert nothing." />
                <div className="pcard-body overflow-x-auto p-0">
                  <table className="ptable">
                    <thead><tr><th>Gate</th><th>Outcome</th><th className="right">Observed</th><th className="right">Threshold</th><th>Why</th></tr></thead>
                    <tbody>
                      {orderedGates(current).map((g) => (
                        <tr key={g.name}>
                          <td className="font-semibold">{GATE_LABEL[g.name] || g.name}{!g.required && <span className="ml-1 text-[11px] font-normal text-subtle">(info)</span>}</td>
                          <td><StatusChip status={g.outcome} /></td>
                          <td className="right mono">{observedLabel(g.observed)}</td>
                          <td className="right mono">{observedLabel(g.threshold)}</td>
                          <td className="text-[12.5px] text-muted">{g.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}
        </div>
      )}
    </ProductFrame>
  );
}
