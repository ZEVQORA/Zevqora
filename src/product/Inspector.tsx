import { Activity, ExternalLink, FileSearch2, Gauge, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useProduct } from './store';
import { Button, KeyValue, StatusChip } from './ui';
import { costDeltaLabel, dateTime, money, ms, num, pct, score, shortId, STRATEGY_LABEL, titleCase, zeroCostReason } from './format';
import type { EvalGate, Evaluation, Experiment, Finding, Implementation, OptimizationExecution, OptimizationPlan } from './types';

function GateList({ gates }: { gates: EvalGate[] }) {
  return (
    <ul className="grid gap-1.5">
      {gates.map((g) => (
        <li key={g.name} className="flex items-start justify-between gap-2 text-[12px]">
          <div className="min-w-0">
            <div className="font-medium text-ink">
              {titleCase(g.name)}
              {!g.required && <span className="ml-1 text-subtle">(informational)</span>}
            </div>
            <div className="text-subtle">{g.reason}</div>
          </div>
          <StatusChip status={g.outcome} />
        </li>
      ))}
    </ul>
  );
}

function FindingBlock({ finding }: { finding: Finding }) {
  const { evaluations } = useProduct();
  const related = evaluations.filter((e) => e.finding_id === finding.id);
  return (
    <>
      <div className="pinspector-block">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-subtle">Opportunity</div>
            <div className="mt-1 text-[13.5px] font-semibold leading-snug text-ink">{finding.title}</div>
          </div>
          <StatusChip status={finding.evidence_status} />
        </div>
        <p className="text-[12px] leading-relaxed text-muted">{finding.root_cause}</p>
        <KeyValue items={[['Source', finding.file_path === 'runtime evidence' ? 'Runtime evidence' : `${finding.file_path}:${finding.line}`], ['Symbol', finding.symbol || '—'], ['Origin', titleCase(finding.origin)], ['Category', titleCase(finding.category)], ['Confidence', pct(finding.confidence * 100, 0)], ['Risk', finding.risk]]} />
      </div>
      <div className="pinspector-block">
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-subtle">What would make this verified</div>
        <ul className="grid gap-1 text-[12px] text-muted">
          <li>· Baseline execution traces for this call site (imported JSONL).</li>
          <li>· A bounded candidate replayed on those samples.</li>
          <li>· Quality, cost, latency and fallback gates all passing.</li>
        </ul>
        {related.length > 0 && (
          <div className="text-[12px] text-muted">
            {related.length} evaluation{related.length === 1 ? '' : 's'} so far · latest <StatusChip status={related[0].status} />
          </div>
        )}
      </div>
    </>
  );
}

function EvaluationBlock({ evaluation }: { evaluation: Evaluation }) {
  const { executions, plans, findings } = useProduct();
  const execution = executions.find((e) => e.id === evaluation.candidate_execution_id) || null;
  const plan = plans.find((p) => p.id === evaluation.candidate_plan_id) || null;
  const finding = findings.find((f) => f.id === evaluation.finding_id) || null;
  const rejected = evaluation.status === 'REJECTED';
  return (
    <>
      <div className="pinspector-block">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-subtle">Quality gate</div>
            <div className={`mt-1 text-[22px] font-bold leading-none tracking-tight ${evaluation.status === 'VERIFIED' ? 'text-verified' : rejected ? 'text-rejected' : 'text-warning'}`}>{evaluation.status === 'VERIFIED' ? 'PASS' : rejected ? 'FAIL' : titleCase(evaluation.status)}</div>
          </div>
          <StatusChip status={evaluation.status} />
        </div>
        {rejected && <div className="text-[12.5px] font-medium text-rejected">Cheaper isn’t verified.</div>}
        {evaluation.rejection_reason && <p className="text-[12px] text-muted">{evaluation.rejection_reason}</p>}
        <KeyValue
          items={[
            ['Strategy', STRATEGY_LABEL[plan?.strategy || ''] || plan?.strategy || '—'],
            ['Candidate', String(execution?.resolved_model || execution?.requested_model || plan?.candidate_config?.model || 'deterministic')],
            ['Samples', `${evaluation.sample_count} (${evaluation.protected_sample_count} protected)`],
            ['Quality', `${score(evaluation.candidate_quality)} vs ${score(evaluation.baseline_quality)}`],
            ['Cost', `${money(evaluation.candidate_cost_usd, { digits: 4 })} vs ${money(evaluation.baseline_cost_usd, { digits: 4 })}`],
            ['Cost delta', costDeltaLabel(evaluation, { zeroReason: zeroCostReason(execution?.cost_source) })],
            ['Latency', `${ms(evaluation.candidate_latency_ms)} vs ${ms(evaluation.baseline_latency_ms)}`],
            ['Evidence', evaluation.evidence_completeness ? 'complete' : 'incomplete'],
          ]}
        />
      </div>
      <div className="pinspector-block">
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-subtle">Gates</div>
        <GateList gates={evaluation.gates} />
      </div>
      <div className="pinspector-block">
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-subtle">Provenance</div>
        <KeyValue items={[['Evaluation', shortId(evaluation.id, 12)], ['Execution', shortId(evaluation.candidate_execution_id, 12)], ['Evidence', evaluation.evidence_version], ['Grader config', shortId(evaluation.grader_config_hash, 12)], ['Gate config', shortId(evaluation.gate_config_hash, 12)], ['Source', evaluation.verification_source === 'EXECUTION_EVALUATION' ? 'execution-proven' : 'legacy evidence'], ['Cost source', execution?.cost_source || '—'], ['Pricing', execution?.pricing_version || 'provider-reported'], ['Completed', dateTime(evaluation.completed_at)]]} />
        {finding && <div className="text-[12px] text-muted">Linked opportunity: {finding.title}</div>}
      </div>
    </>
  );
}

function ExperimentBlock({ experiment }: { experiment: Experiment }) {
  return (
    <div className="pinspector-block">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-subtle">Experiment record</div>
        <StatusChip status={experiment.status} />
      </div>
      <KeyValue items={[['Samples', String(experiment.sample_size)], ['Baseline cost', money(experiment.baseline_cost_usd, { digits: 4 })], ['Candidate cost', money(experiment.candidate_cost_usd, { digits: 4 })], ['Verified saving', money(experiment.verified_savings_usd, { digits: 4 })], ['Quality', `${score(experiment.candidate_quality)} vs ${score(experiment.baseline_quality)}`], ['Execution-proven', experiment.execution_proven ? 'yes' : 'no'], ['Evidence', experiment.evidence_version]]} />
      <ul className="grid gap-1">
        {experiment.gates.map((g) => (
          <li key={g.name} className="flex items-start justify-between gap-2 text-[12px]">
            <span className="text-muted">{titleCase(g.name)}</span>
            <StatusChip status={g.passed ? 'passed' : 'failed'} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ImplementationBlock({ implementation }: { implementation: Implementation }) {
  return (
    <div className="pinspector-block">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-subtle">Change candidate</div>
        <StatusChip status={implementation.status} />
      </div>
      <p className="text-[12.5px] text-ink">{implementation.summary}</p>
      <KeyValue items={[['Branch', implementation.branch_name], ['File', implementation.target_file], ['Model', implementation.model], ['Tests', implementation.test_command ? `${implementation.test_command} · exit ${implementation.test_exit_code ?? '—'}` : 'not run'], ['Reviewed', dateTime(implementation.reviewed_at)], ['Pushed', dateTime(implementation.pushed_at)], ['PR', implementation.pr_url || '—']]} />
      <div className="text-[12px] text-muted">Human review required. ZEVQORA never merges or deploys.</div>
    </div>
  );
}

function ExecutionBlock({ execution }: { execution: OptimizationExecution }) {
  const ok = execution.sample_results.filter((s) => s.status === 'succeeded').length;
  return (
    <div className="pinspector-block">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-subtle">Candidate execution</div>
        <StatusChip status={execution.status} />
      </div>
      <KeyValue items={[['Provider', execution.provider || '—'], ['Model', execution.resolved_model || execution.requested_model || '—'], ['Samples', `${ok}/${execution.sample_results.length} succeeded`], ['Cost', money(execution.cost_usd, { digits: 4 })], ['Cost source', execution.cost_source || '—'], ['Tokens', `${num(execution.input_tokens)} in · ${num(execution.output_tokens)} out`], ['Latency', ms(execution.latency_ms)], ['Provider calls', String(execution.provider_call_count)], ['Provenance', shortId(execution.provenance_hash, 12)]]} />
      {execution.error_detail && <p className="text-[12px] text-rejected">{execution.error_detail}</p>}
      <div className="text-[12px] text-muted">{execution.note}</div>
    </div>
  );
}

function PlanBlock({ plan }: { plan: OptimizationPlan }) {
  return (
    <div className="pinspector-block">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-subtle">Candidate plan</div>
        <StatusChip status={plan.status} />
      </div>
      <p className="text-[12.5px] text-ink">{plan.reason}</p>
      <KeyValue items={[['Strategy', STRATEGY_LABEL[plan.strategy] || plan.strategy], ['Mechanism', plan.expected_mechanism], ['Risk', plan.risk], ['Fallback', plan.fallback || '—'], ['Budget', money(plan.max_budget_usd)], ['Samples in scope', String(plan.sample_scope.length)], ['Config', shortId(plan.config_hash, 12)]]} />
      {plan.blocked_reason && <p className="text-[12px] text-warning">{plan.blocked_reason}</p>}
    </div>
  );
}

export function EvidenceInspector() {
  const store = useProduct();
  const navigate = useNavigate();
  const { inspect, selected, scan, aiCalls, findings, economics, evaluations, experiments, implementations, executions, plans, health, runtime } = store;

  let body: React.ReactNode = null;
  if (inspect?.kind === 'finding') body = (() => { const f = findings.find((x) => x.id === inspect.id); return f ? <FindingBlock finding={f} /> : null; })();
  else if (inspect?.kind === 'evaluation') body = (() => { const e = evaluations.find((x) => x.id === inspect.id); return e ? <EvaluationBlock evaluation={e} /> : null; })();
  else if (inspect?.kind === 'experiment') body = (() => { const e = experiments.find((x) => x.id === inspect.id); return e ? <ExperimentBlock experiment={e} /> : null; })();
  else if (inspect?.kind === 'implementation') body = (() => { const i = implementations.find((x) => x.id === inspect.id); return i ? <ImplementationBlock implementation={i} /> : null; })();
  else if (inspect?.kind === 'execution') body = (() => { const e = executions.find((x) => x.id === inspect.id); return e ? <ExecutionBlock execution={e} /> : null; })();
  else if (inspect?.kind === 'plan') body = (() => { const p = plans.find((x) => x.id === inspect.id); return p ? <PlanBlock plan={p} /> : null; })();

  const verified = evaluations.filter((e) => e.status === 'VERIFIED');
  const latestVerified = verified[0] || null;
  const openEvidence = (id: string) => {
    store.setInspect({ kind: 'evaluation', id });
    navigate('/app/experiments');
  };

  return (
    <aside className="pinspector" aria-label="Evidence inspector">
      <div className="pinspector-head">
        <div>
          <div className="text-[13px] font-semibold text-ink">Evidence Inspector</div>
          <div className="text-[11.5px] text-subtle">Zev explains. Verification decides.</div>
        </div>
        <Activity size={15} className="text-subtle" />
      </div>
      <div className="pinspector-body">
        {body || (
          <>
            <div className="pinspector-block">
              <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-subtle">{selected ? selected.name : 'No repository selected'}</div>
              <KeyValue items={[['Files scanned', scan ? String(scan.files_scanned) : selected?.files_scanned ? String(selected.files_scanned) : selected?.last_scan_at ? dateTime(selected.last_scan_at) : '—'], ['AI call sites', String(aiCalls.length)], ['Providers detected', Array.from(new Set(aiCalls.map((c) => c.provider))).join(', ') || '—'], ['Execution traces', String(economics?.trace_count ?? 0)], ['Observed cost', money(economics?.observed_cost_usd, { digits: 4 })], ['Opportunities', String(findings.length)], ['Evaluations', `${evaluations.length} (${verified.length} verified)`]]} />
            </div>
            <div className="pinspector-block">
              <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-subtle">Latest verdict</div>
              {latestVerified ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-verified">VERIFIED · {costDeltaLabel(latestVerified, { zeroReason: zeroCostReason(executions.find((x) => x.id === latestVerified.candidate_execution_id)?.cost_source) })}</span>
                    <StatusChip status="VERIFIED" />
                  </div>
                  <div className="text-[12px] text-muted">quality {score(latestVerified.candidate_quality)} · {latestVerified.sample_count} samples</div>
                  <Button size="xs" variant="secondary" onClick={() => openEvidence(latestVerified.id)}>Open evidence</Button>
                </>
              ) : evaluations[0] ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-rejected">{evaluations[0].status === 'REJECTED' ? 'Cheaper isn’t verified.' : titleCase(evaluations[0].status)}</span>
                    <StatusChip status={evaluations[0].status} />
                  </div>
                  <Button size="xs" variant="secondary" onClick={() => openEvidence(evaluations[0].id)}>Open evidence</Button>
                </>
              ) : (
                <p className="text-[12px] text-muted">No candidate has been tested yet. Potential savings never count as verified savings.</p>
              )}
            </div>
            <div className="pinspector-block">
              <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-subtle">Evidence sources</div>
              <ul className="grid gap-1.5 text-[12px] text-muted">
                <li className="flex items-center justify-between"><span className="flex items-center gap-2"><FileSearch2 size={13} /> Source analysis</span><b className="tnum text-ink">{scan?.files_scanned ?? selected?.files_scanned ?? '—'} files</b></li>
                <li className="flex items-center justify-between"><span className="flex items-center gap-2"><Gauge size={13} /> Runtime evidence</span><b className="tnum text-ink">{economics?.trace_count ?? 0} traces</b></li>
                <li className="flex items-center justify-between"><span className="flex items-center gap-2"><ShieldCheck size={13} /> Verification</span><b className="tnum text-ink">{evaluations.length} runs</b></li>
              </ul>
              <div className="text-[11.5px] text-subtle">{health?.status === 'ok' ? (runtime === 'desktop' ? `Local engine ${health.version}` : 'ZEVQORA platform engine') : runtime === 'desktop' ? 'Local engine offline' : 'Engine unavailable'}</div>
            </div>
          </>
        )}
        <div className="mt-auto flex items-start gap-2 rounded-xl bg-ink px-3 py-2.5 text-[11.5px] text-cloud/80">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-blue" />
          <span>
            <b className="text-cloud">Advise mode.</b> No auto-merge. No auto-deploy. Zev cannot overrule the gates.
          </span>
        </div>
        {inspect && (
          <button className="flex items-center gap-1 text-[12px] text-subtle hover:text-ink" onClick={() => store.setInspect(null)}>
            <ExternalLink size={12} /> Back to product summary
          </button>
        )}
      </div>
    </aside>
  );
}
