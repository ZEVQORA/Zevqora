import { useEffect, useMemo, useState } from 'react';
import { FlaskConical, Gauge, Lock, PlayCircle, ShieldCheck } from 'lucide-react';
import { NoProject, ProductFrame } from '../Frame';
import { useProduct } from '../store';
import { useSession } from '@/lib/session';
import { errorMessage } from '@/lib/api';
import { Button, Chip, Empty, KeyValue, Note, StatusChip, cn, useAsyncValue, useProductToast } from '../ui';
import { relativeTime } from '../format';
import { msLabel, pctLabel, Step, Tile, unknown, usd } from './optimize-parts';
import PlanSearchSection from './PlanSearchSection';
import { optimizeApi, type Candidate, type ContractRequirements, type Diagnosis, type EvaluationContract, type RunEvaluation, type RunReport, type Snapshot } from '../optimize';

const VERDICT_TONE: Record<string, string> = { VERIFIED: 'verified', REJECTED: 'rejected', INCOMPLETE: 'missing' };
const EXEC_TONE: Record<string, 'verified' | 'warning' | 'neutral'> = { EXECUTABLE: 'verified', NOT_EXECUTABLE: 'neutral', NEEDS_IMPLEMENTATION: 'warning' };
const EXEC_ORDER: Record<string, number> = { EXECUTABLE: 0, NOT_EXECUTABLE: 1, NEEDS_IMPLEMENTATION: 2 };
const FAMILY: Record<string, string> = { redundant_call: 'Redundant calls', retry_amplification: 'Retry amplification', context_amplification: 'Context amplification', model_overprovisioning: 'Model overprovisioning', latency_critical_path: 'Latency critical path' };
const STRATEGY: Record<string, string> = { exact_reuse: 'Reuse identical answers', model_substitution: 'Smaller model', retry_policy: 'Bounded retry policy', prompt_cache: 'Provider prompt caching', context_window_cap: 'Cap conversation history' };

const VOCAB: Array<[string, string]> = [
  ['Observed', 'read from your recorded traces'],
  ['Evaluated', 'compared on replayed cases under the frozen contract'],
  ['Verified', 'evaluated and every required gate passed'],
  ['Projected', 'an expectation, not evidence'],
  ['Realized', 'measured in production after shipping — not measured here'],
];

// ---- A/B. contract ------------------------------------------------------------------------
function ContractEditor({ contract, onSave, onFreeze, busy }: { contract: EvaluationContract; onSave: (r: ContractRequirements) => void; onFreeze: () => void; busy: boolean }) {
  const [r, setR] = useState<ContractRequirements>(contract.requirements);
  useEffect(() => setR(contract.requirements), [contract]);
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const field = (label: string, value: number | null, set: (v: number | null) => void, hint?: string) => (
    <label className="grid gap-1 text-[12.5px]">
      <span className="font-medium text-ink">{label}</span>
      <input className="h-9 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink tnum" inputMode="decimal" value={value ?? ''} onChange={(e) => set(num(e.target.value))} />
      {hint && <span className="text-subtle">{hint}</span>}
    </label>
  );
  const toggle = (metric: string) => setR({ ...r, required_metrics: r.required_metrics.includes(metric) ? r.required_metrics.filter((m) => m !== metric) : [...r.required_metrics, metric].sort() });
  const dirty = JSON.stringify(r) !== JSON.stringify(contract.requirements);
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {field('Quality floor (0.5–1)', r.quality_floor, (v) => setR({ ...r, quality_floor: v ?? 0.95 }))}
        {field('Minimum task success (0–1)', r.min_task_success_rate, (v) => setR({ ...r, min_task_success_rate: v }), 'Empty = not required')}
        {field('Max p95 latency (ms)', r.latency.max_p95_ms, (v) => setR({ ...r, latency: { ...r.latency, max_p95_ms: v } }), 'Empty = no absolute budget')}
        {field('Max p95 regression (%)', r.latency.max_regression_pct, (v) => setR({ ...r, latency: { ...r.latency, max_regression_pct: v } }))}
        {field('Minimum evaluated cases', r.evidence.min_samples, (v) => setR({ ...r, evidence: { ...r.evidence, min_samples: v ?? 5 } }))}
        {field('Required cost coverage (0–1)', r.cost.min_coverage, (v) => setR({ ...r, cost: { ...r.cost, min_coverage: v ?? 0.9 } }))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="font-medium text-ink">Required metrics</span>
        {['cost', 'quality', 'task_success', 'latency', 'reliability', 'protected'].map((m) => (
          <label key={m} className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1', r.required_metrics.includes(m) ? 'border-blue-700/30 bg-blue-050 text-blue-700' : 'border-line text-muted')}>
            <input type="checkbox" className="sr-only" checked={r.required_metrics.includes(m)} onChange={() => toggle(m)} />
            {m.replace('_', ' ')}
          </label>
        ))}
        <label className="ml-1 inline-flex items-center gap-1.5 text-muted"><input type="checkbox" checked={r.protected.require_cases} onChange={(e) => setR({ ...r, protected: { ...r.protected, require_cases: e.target.checked } })} /> require protected cases</label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={!dirty || busy} onClick={() => onSave(r)}>Save draft</Button>
        <Button size="sm" disabled={dirty || busy} loading={busy} onClick={onFreeze}><Lock size={14} /> Freeze contract</Button>
        {dirty && <span className="self-center text-[12px] text-subtle">Save the draft before freezing — what is frozen is exactly what is saved.</span>}
      </div>
    </div>
  );
}

function ContractSummary({ c }: { c: EvaluationContract }) {
  const r = c.requirements;
  return (
    <KeyValue items={[
      ['Version', <span>v{c.version} · <Chip tone="verified">FROZEN</Chip> {c.frozen_at ? relativeTime(c.frozen_at) : ''}</span>],
      ['Quality floor', String(r.quality_floor)],
      ['Task success', r.min_task_success_rate === null ? 'not required' : `≥ ${r.min_task_success_rate}`],
      ['Latency', [r.latency.max_p95_ms !== null && `p95 ≤ ${r.latency.max_p95_ms} ms`, r.latency.max_regression_pct !== null && `p95 regression ≤ ${r.latency.max_regression_pct}%`].filter(Boolean).join(' · ') || 'not required'],
      ['Protected cases', r.protected.require_cases ? `required (min ${Math.max(1, r.protected.min_cases)})` : 'evaluated when present'],
      ['Minimum evidence', `${r.evidence.min_samples} cases · cost coverage ≥ ${r.cost.min_coverage} · outcome coverage ≥ ${r.evidence.min_outcome_coverage}`],
      ['Required metrics', r.required_metrics.join(', ')],
      ['Contract hash', <span className="mono break-all">{c.contract_hash}</span>],
    ]} />
  );
}

// ---- C/D. baseline --------------------------------------------------------------------------
function Baseline({ s }: { s: Snapshot }) {
  const m = s.metrics;
  const e = m.economics;
  const lat = m.latency.request.samples ? m.latency.request : m.latency.attempt;
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Tile label="AI cost" tag="Observed" value={usd(e.total_known_cost_usd)} hint={<>known for {e.known_cost_count} of {m.samples.executed_attempts} attempts ({pctLabel(e.cost_coverage)}){e.cost_basis ? ` · ${e.cost_basis}` : ''}</>} />
        <Tile label="Cost / successful outcome" tag="Observed" value={e.cost_per_successful_outcome_usd === null ? <span className="text-[16px] text-subtle">Unavailable</span> : usd(e.cost_per_successful_outcome_usd, 5)} hint={e.cost_per_successful_outcome_usd === null ? e.cpso.unavailable_reasons[0] : `${e.cpso.successful_outcomes} successes · numerator coverage ${pctLabel(e.cpso.numerator_coverage)}`} />
        <Tile label="p95 latency" tag="Observed" value={msLabel(lat.p95_ms)} hint={<>p50 {msLabel(lat.p50_ms)} · p99 {msLabel(lat.p99_ms)} · {lat.samples} samples{lat.low_evidence ? ' · LOW EVIDENCE' : ''}</>} />
        <Tile label="Task success" tag="Observed" value={pctLabel(m.quality.task_success.rate)} hint={`${m.quality.task_success.succeeded} of ${m.quality.task_success.known} known · ${m.quality.task_success.unknown} unknown (not counted)`} />
        <Tile label="Reliability" tag="Observed" value={<>{pctLabel(m.reliability.failure_rate)} <span className="text-[13px] font-normal text-subtle">failures</span></>} hint={`attempts per request ×${m.reliability.retry_amplification === null ? 'unknown' : m.reliability.retry_amplification.toFixed(2)} · ${m.reliability.retried_requests} retried · rate limits ${m.reliability.rate_limit_count ?? 'unknown'} · timeouts ${m.reliability.timeout_count ?? 'unknown'}`} />
        <Tile label="Evidence coverage" value={<StatusChip status={s.completeness === 'complete' ? 'ok' : 'missing'} label={s.completeness.toUpperCase()} />} hint={s.metrics.evidence.missing.length ? s.metrics.evidence.missing.join('; ') : `${s.trace_count} traces · ${m.evidence.graph_count} ZevIR graphs`} />
      </div>
      <div className="rounded-xl border border-line p-4 text-[12.5px]">
        <div className="pmetric-label">Observed risk — bad-day profile</div>
        <div className="mt-2 grid gap-1 text-muted sm:grid-cols-2">
          <span>p99 request latency: <b className="text-ink">{msLabel(m.bad_day.p99_request_latency_ms)}</b> (max {msLabel(m.bad_day.max_request_latency_ms)})</span>
          <span>Worst attempts per request: <b className="text-ink">{m.bad_day.worst_retry_amplification ?? 'unknown'}</b></span>
          <span>Costliest request: <b className="text-ink">{m.bad_day.costliest_requests[0] ? usd(m.bad_day.costliest_requests[0].cost_usd, 5) : unknown}</b></span>
          <span>Wasted retry cost (known): <b className="text-ink">{usd(e.wasted_attempt_known_cost_usd, 5)}</b></span>
        </div>
        <p className="mt-2 text-subtle">{m.bad_day.note}</p>
      </div>
    </div>
  );
}

function Hotspots({ s }: { s: Snapshot }) {
  const a = s.latency_analysis;
  if (!a.hotspots.length) return <Note>No timed execution nodes in the ZevIR graphs yet.</Note>;
  return (
    <div className="grid gap-2">
      <ol className="grid gap-1.5 text-[13px]">
        {a.hotspots.slice(0, 5).map((h, i) => (
          <li key={h.class} className="flex flex-wrap items-baseline gap-x-2 rounded-lg border border-line px-3 py-2">
            <span className="tnum text-subtle">{i + 1}.</span>
            <b className="text-ink">{h.kind}</b>
            <span className="mono text-muted">{h.name}</span>
            <span className="tnum">— p95 {msLabel(h.p95_ms)}</span>
            <span className="text-subtle">{h.mean_share_of_root === null ? 'share of request latency: unknown (no request-level timing)' : `${Math.round(h.mean_share_of_root * 100)}% of observed root latency on the critical path`}</span>
          </li>
        ))}
        {a.retry && <li className="rounded-lg border border-line px-3 py-2"><b className="text-ink">Retry path</b> — +{msLabel(a.retry.mean_added_ms)} per retried request ({a.retry.retried_requests} requests)</li>}
      </ol>
      {a.status !== 'complete' && <p className="text-[12px] text-subtle">Critical path {a.status}: {a.incomplete_reasons[0] || 'no complete analyses'}. No path is inferred without timestamps.</p>}
    </div>
  );
}

// ---- E. diagnoses ------------------------------------------------------------------------------
function DiagnosisCard({ d }: { d: Diagnosis }) {
  return (
    <div className="rounded-xl border border-line p-4 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-[14px] text-ink">{FAMILY[d.family] || d.family}</b>
        <span className="mono text-subtle">{d.scope}</span>
        <Chip tone={d.severity === 'high' ? 'rejected' : d.severity === 'medium' ? 'warning' : 'neutral'}>{d.severity} severity</Chip>
        <Chip tone="neutral">confidence {d.confidence.toFixed(2)}</Chip>
        <Chip tone="neutral">Observed — not savings</Chip>
      </div>
      <dl className="mt-3 grid gap-2">
        <div><dt className="pmetric-label">What we observed</dt><dd className="mt-0.5 text-ink">{d.symptom}</dd></div>
        <div><dt className="pmetric-label">Why it matters</dt><dd className="mt-0.5 text-muted">{d.root_cause}</dd></div>
        <div><dt className="pmetric-label">Causal path</dt><dd className="mt-0.5 mono text-muted">{d.causal_path.join(' → ')}</dd></div>
        <div><dt className="pmetric-label">Evidence</dt><dd className="mt-0.5 text-muted">{d.evidence_refs.filter((r) => r.type === 'engine_trace').length} trace(s) · {d.affected_nodes.length} ZevIR node(s) · hash <span className="mono">{d.diagnosis_hash.slice(0, 12)}</span></dd></div>
        <div><dt className="pmetric-label">What would falsify it</dt><dd className="mt-0.5 text-muted">{d.falsifier}</dd></div>
        <div><dt className="pmetric-label">Suggested candidate · risk</dt><dd className="mt-0.5 text-muted">{d.suggested_optimization_passes.length ? d.suggested_optimization_passes.join(', ') : 'diagnosis only — no safe generic change in v0.1'} · {d.risk_class}</dd></div>
        {d.required_additional_evidence.length > 0 && <div><dt className="pmetric-label">Evidence still needed</dt><dd className="mt-0.5 text-muted">{d.required_additional_evidence.join('; ')}</dd></div>}
      </dl>
    </div>
  );
}

// ---- F/G. candidates ------------------------------------------------------------------------------
function CandidateCard({ c, evaluation, onReplay, busy, canEdit }: { c: Candidate; evaluation?: RunEvaluation; onReplay: () => void; busy: boolean; canEdit: boolean }) {
  const effects = c.lineage.expected_effects || {};
  return (
    <div className="rounded-xl border border-line p-4 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-[14px] text-ink">{STRATEGY[c.strategy] || c.strategy}</b>
        <Chip tone={EXEC_TONE[c.executable_status]}>{c.executable_status.replace('_', ' ')}</Chip>
        {evaluation ? <StatusChip status={VERDICT_TONE[evaluation.status]} label={evaluation.status} /> : <Chip tone="warning">NOT VERIFIED</Chip>}
        <Chip tone="neutral">{c.risk} risk</Chip>
      </div>
      <p className="mt-2 text-muted">{c.expected_mechanism}</p>
      <dl className="mt-2 grid gap-1.5 sm:grid-cols-2">
        <div><dt className="pmetric-label">Expected effects (projected)</dt><dd className="mt-0.5 text-muted">{Object.entries(effects).map(([k, v]) => `${k.replace('_', ' ')}: ${v.direction.replace(/_/g, ' ')}`).join(' · ') || '—'}</dd></div>
        <div><dt className="pmetric-label">Required replay</dt><dd className="mt-0.5 text-muted">{c.executable_status === 'EXECUTABLE' ? `${c.sample_count} representative case(s), same inputs as the baseline` : c.lineage.not_executable_reason}</dd></div>
        <div><dt className="pmetric-label">Rollback</dt><dd className="mt-0.5 text-muted">{c.lineage.rollback}</dd></div>
        <div><dt className="pmetric-label">Falsified by</dt><dd className="mt-0.5 text-muted">{c.lineage.falsifier}</dd></div>
      </dl>
      {c.executable_status === 'EXECUTABLE' && canEdit && !evaluation && <div className="mt-3"><Button size="sm" onClick={onReplay} loading={busy}><PlayCircle size={14} /> Run replay</Button></div>}
      {evaluation && evaluation.status !== 'VERIFIED' && <p className="mt-2 text-[12px] text-rejected">{evaluation.rejection_reason}</p>}
    </div>
  );
}

// ---- I. report ------------------------------------------------------------------------------------
function Executive({ report }: { report: RunReport }) {
  const e = report.executive;
  return (
    <div className="grid gap-3 text-[12.5px]">
      <p className="text-[14px] font-medium text-ink">{e.headline}</p>
      {e.results.map((r) => {
        const ev = report.evaluations.find((x) => x.id === r.evaluation_id);
        const c = ev?.performance_comparison;
        return (
          <div key={r.evaluation_id} className="overflow-x-auto rounded-xl border border-line">
            <div className="flex flex-wrap items-center gap-2 px-4 pt-3"><StatusChip status={VERDICT_TONE[r.verdict]} label={r.verdict} /><b className="text-ink">{STRATEGY[r.strategy || ''] || r.strategy}</b><span className="text-subtle">{r.label} · {r.scope}</span></div>
            <table className="ptable mt-2">
              <thead><tr><th>Evaluated metric</th><th>Baseline</th><th>Candidate</th><th>Change</th></tr></thead>
              <tbody>
                <tr><td>Known cost</td><td>{usd(c?.baseline.cost_usd)}</td><td>{usd(c?.candidate.cost_usd)}</td><td className="tnum">{r.evaluated_cost_change ?? 'unknown'}</td></tr>
                <tr><td>Cost / successful outcome</td><td>{usd(c?.baseline.cost_per_successful_outcome_usd, 5)}</td><td>{usd(c?.candidate.cost_per_successful_outcome_usd, 5)}</td><td className="tnum">{r.evaluated_cpso_change ?? 'unknown'}</td></tr>
                <tr><td>p95 latency</td><td>{msLabel(c?.baseline.p95_ms)}</td><td>{msLabel(c?.candidate.p95_ms)}</td><td className="tnum">{r.evaluated_p95_change ?? 'unknown'}</td></tr>
                <tr><td>Task success</td><td>{pctLabel(c?.baseline.task_success_rate)}</td><td>{pctLabel(c?.candidate.task_success_rate)}</td><td /></tr>
                <tr><td>Quality</td><td>{c?.baseline.quality === null || c?.baseline.quality === undefined ? unknown : c.baseline.quality.toFixed(3)}</td><td>{c?.candidate.quality === null || c?.candidate.quality === undefined ? unknown : c.candidate.quality.toFixed(3)}</td><td /></tr>
                <tr><td>Reliability (replay failures)</td><td>—</td><td>{c?.candidate.replay_failures ?? '—'}</td><td /></tr>
                <tr><td>Production realized result</td><td colSpan={3} className="font-medium text-ink">{r.production_realized_result}</td></tr>
              </tbody>
            </table>
            {r.reason && <p className="px-4 pb-3 text-rejected">{r.reason}</p>}
          </div>
        );
      })}
      <ul className="list-disc pl-5 text-subtle">{e.not_claimed.map((x) => <li key={x}>{x}</li>)}</ul>
    </div>
  );
}

function Developer({ report }: { report: RunReport }) {
  return (
    <div className="grid gap-3 text-[12.5px]">
      <KeyValue items={[
        ['ZevIR evidence', report.developer.zevir ? `${report.developer.zevir.graph_count} graphs · set ${report.developer.zevir.graph_set_hash?.slice(0, 12) ?? '—'} · critical path ${report.developer.zevir.latency_status}` : '—'],
        ['Contract', <span className="mono break-all">{report.run.contract_hash}</span>],
        ['Baseline snapshot', <span className="mono break-all">{report.baseline?.snapshot_hash ?? '—'}</span>],
      ]} />
      {report.diagnoses.map((d) => (
        <details key={d.id} className="rounded-lg border border-line px-3 py-2">
          <summary className="cursor-pointer font-medium text-ink">{FAMILY[d.family]} · {d.scope} — {d.affected_nodes.length} ZevIR node(s)</summary>
          <ul className="mt-2 grid gap-0.5 mono text-[11.5px] text-muted">{d.affected_nodes.slice(0, 8).map((n) => <li key={n.node_id}>{n.kind} {n.name} · node {n.node_id.slice(0, 8)} · key {n.stable_key.slice(0, 12)}</li>)}</ul>
        </details>
      ))}
      {report.evaluations.map((ev) => {
        const cand = report.candidates.find((c) => c.id === ev.candidate_plan_id);
        const lineage = report.developer.lineage.find((l) => l.candidate_id === ev.candidate_plan_id);
        return (
          <div key={ev.id} className="overflow-x-auto rounded-lg border border-line">
            <div className="flex flex-wrap items-center gap-2 px-3 pt-2"><StatusChip status={VERDICT_TONE[ev.status]} label={ev.status} /><b>{STRATEGY[cand?.strategy || ''] || cand?.strategy}</b><span className="mono text-subtle">{lineage?.pass} · config {lineage?.candidate_config_hash.slice(0, 12)}</span></div>
            <table className="ptable mt-1">
              <thead><tr><th>Gate</th><th>Required</th><th>Outcome</th><th>Reason</th></tr></thead>
              <tbody>{ev.gates.map((g) => <tr key={g.name}><td className="mono">{g.name}</td><td>{g.required ? 'yes' : 'no'}</td><td><StatusChip status={g.outcome === 'informational' ? 'informational' : g.outcome} /></td><td className="max-w-[420px] text-muted">{g.reason}</td></tr>)}</tbody>
            </table>
            <p className="px-3 py-2 text-subtle">{ev.cases.length} replayed case(s): {ev.cases.filter((c) => c.candidate_passed).length} candidate passes, {ev.cases.filter((c) => c.protected).length} protected · rollback: {lineage?.rollback}</p>
          </div>
        );
      })}
    </div>
  );
}

// ---- page -------------------------------------------------------------------------------------
export default function OptimizeView() {
  const { selected, canEdit, refreshProducts, selectProduct, engine } = useProduct();
  const { activeWorkspace } = useSession();
  const toast = useProductToast();
  const productId = selected?.id || '';
  const cloud = engine.kind === 'cloud';
  // Freezing a contract and loading the demo are admin actions on the server too.
  const isAdmin = activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin';
  const intelligenceWorkspace = Boolean(activeWorkspace?.features?.optimization_intelligence_vnext);
  const status = useAsyncValue(() => optimizeApi.status(productId), [productId], { enabled: Boolean(productId) && cloud });
  const run = status.data?.runs[0] || null;
  const report = useAsyncValue(() => optimizeApi.report(run!.id), [run?.id], { enabled: Boolean(run) });
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<'executive' | 'developer'>('executive');

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast({ tone: 'ok', title: ok });
      status.reload();
      report.reload();
    } catch (error) {
      toast({ tone: 'err', title: 'That step did not complete', description: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };
  const loadDemo = async () => {
    if (!activeWorkspace) return;
    setBusy('demo');
    try {
      const out = await optimizeApi.loadDemo(activeWorkspace.id, intelligenceWorkspace ? 'intelligence' : undefined);
      await refreshProducts();
      selectProduct(out.product_id);
      toast({ tone: 'ok', title: 'Demo workload loaded', description: intelligenceWorkspace ? 'SYNTHETIC DEMO — NOT CUSTOMER DATA.' : 'DEMO / SYNTHETIC — NOT CUSTOMER DATA.' });
    } catch (error) {
      toast({ tone: 'err', title: 'Could not load the demo', description: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const contracts = status.data?.contracts || [];
  const frozen = contracts.find((c) => c.status === 'frozen') || null;
  const draft = contracts.find((c) => c.status === 'draft') || null;
  const r = report.data;
  const evalByPlan = useMemo(() => new Map((r?.evaluations || []).map((e) => [e.candidate_plan_id, e])), [r]);
  const runContract = r?.contract || null;
  const demoButton = isAdmin ? <Button size="sm" variant="secondary" onClick={() => void loadDemo()} loading={busy === 'demo'}><FlaskConical size={14} /> Load demo workload</Button> : undefined;

  const header = (
    <div className="mb-2 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="peyebrow">Verified Optimization Run</div>
        <h1 className="ph1">{selected?.name || 'Optimize'}</h1>
        <p className="plede">What makes this workload expensive, slow or unreliable, which supported change to test, and the evidence that decides whether it is safe.</p>
      </div>
      {demoButton}
    </div>
  );

  if (!selected) return <NoProject><Empty title="Select a workload" description="Pick a project or workload to optimize, or load the synthetic demo." action={demoButton} /></NoProject>;
  if (!cloud) return <ProductFrame>{header}<Note>Optimization Runs are evaluated by the platform engine. Open this project in the web app.</Note></ProductFrame>;
  if (status.loading && !status.data) return <ProductFrame>{header}<p className="text-[13px] text-subtle">Loading…</p></ProductFrame>;
  if (status.error) return <ProductFrame>{header}<Note tone="error">{status.error}</Note></ProductFrame>;
  if (!status.data?.enabled) return <ProductFrame>{header}<Empty title="Not enabled for this workspace" description="Verified Optimization is rolling out workspace by workspace." /></ProductFrame>;

  const synthetic = selected.name.includes('DEMO / SYNTHETIC') || selected.name.includes('SYNTHETIC DEMO');
  const intelligence = Boolean(status.data?.intelligence);
  return (
    <ProductFrame>
      {header}
      {synthetic && <Note tone="warn">{selected.name.includes('SYNTHETIC DEMO') ? 'SYNTHETIC DEMO — NOT CUSTOMER DATA' : 'DEMO / SYNTHETIC — NOT CUSTOMER DATA'}. Every number on this page is invented to demonstrate the product and is not evidence about any real system.</Note>}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-subtle">{VOCAB.map(([k, v]) => <span key={k}><b className="text-muted">{k}</b> — {v}</span>)}</div>

      <Step n={1} title="Evaluation Contract" done={Boolean(frozen)} description="Freeze what success means before any result is known. Frozen contracts never change; a change is a new version.">
        {frozen && <ContractSummary c={runContract && runContract.id === frozen.id ? runContract : frozen} />}
        {draft ? (
          <div className={frozen ? 'mt-4 border-t border-line pt-4' : ''}>
            <p className="mb-3 text-[12.5px] text-muted">Draft v{draft.version} — not yet frozen.</p>
            {isAdmin ? <ContractEditor contract={draft} busy={busy === 'contract'} onSave={(req) => void act('contract', () => optimizeApi.saveDraft(selected.id, req), 'Draft saved')} onFreeze={() => void act('contract', () => optimizeApi.freeze(selected.id, draft.id), 'Contract frozen')} /> : <Note>An admin freezes the contract.</Note>}
          </div>
        ) : isAdmin ? (
          <div className="mt-3"><Button size="sm" variant="secondary" onClick={() => void act('contract', () => optimizeApi.saveDraft(selected.id, null))} loading={busy === 'contract'}>{frozen ? 'New contract version' : 'Draft a contract'}</Button></div>
        ) : null}
      </Step>

      <Step n={2} title="Verified Performance baseline" done={Boolean(r?.baseline)} description="Computed only from recorded evidence. Unknown stays unknown."
        action={canEdit && frozen && (!run || run.contract_hash !== frozen.contract_hash) ? <Button size="sm" onClick={() => void act('run', () => optimizeApi.startRun(selected.id, frozen.id), 'Optimization Run started')} loading={busy === 'run'}><ShieldCheck size={14} /> Start run</Button> : canEdit && run && !r?.baseline ? <Button size="sm" onClick={() => void act('baseline', () => optimizeApi.baseline(run.id))} loading={busy === 'baseline'}><Gauge size={14} /> Build baseline</Button> : undefined}>
        {!frozen && <p className="text-[12.5px] text-subtle">Freeze a contract first.</p>}
        {frozen && !run && <p className="text-[12.5px] text-subtle">Start a run on contract v{frozen.version}.</p>}
        {run && r?.baseline && <Baseline s={r.baseline} />}
        {run && !r?.baseline && <p className="text-[12.5px] text-subtle">Run started under contract <span className="mono">{run.contract_hash.slice(0, 12)}</span>. Build the baseline.</p>}
      </Step>

      {r?.baseline && (
        <Step n={3} title="Latency and execution hotspots" done description="From ZevIR execution graphs. A critical path is only computed where timestamps allow.">
          <Hotspots s={r.baseline} />
        </Step>
      )}

      {r?.baseline && (
        <Step n={4} title="Diagnoses" done={r.diagnoses.length > 0} description="Deterministic and evidence-based. A diagnosis is not a saving."
          action={canEdit && !r.diagnoses.length ? <Button size="sm" onClick={() => void act('diagnose', () => optimizeApi.diagnose(run!.id))} loading={busy === 'diagnose'}>Run diagnoses</Button> : undefined}>
          {r.diagnoses.length ? <div className="grid gap-3 lg:grid-cols-2">{r.diagnoses.map((d) => <DiagnosisCard key={d.id} d={d} />)}</div> : <p className="text-[12.5px] text-subtle">No diagnoses yet.</p>}
        </Step>
      )}

      {r && run && r.baseline && r.diagnoses.length > 0 && intelligence && <PlanSearchSection run={run} productId={selected.id} canEdit={canEdit} first={5} />}

      {r && r.diagnoses.length > 0 && (!intelligence || r.candidates.length > 0) && (
        <Step n={intelligence ? 11 : 5} title={intelligence ? 'Single-change candidates' : 'Candidates'} done={r.candidates.length > 0} description="At most three per diagnosis. Only supported candidates can be replayed; none is verified until it is."
          action={canEdit && !r.candidates.length ? <Button size="sm" onClick={() => void act('candidates', () => optimizeApi.candidates(run!.id))} loading={busy === 'candidates'}>Generate candidates</Button> : undefined}>
          {r.candidates.length ? <div className="grid gap-3 lg:grid-cols-2">{[...r.candidates].sort((a, b) => EXEC_ORDER[a.executable_status] - EXEC_ORDER[b.executable_status]).map((c) => <CandidateCard key={c.id} c={c} evaluation={evalByPlan.get(c.id)} canEdit={canEdit} busy={busy === c.id} onReplay={() => void act(c.id, () => optimizeApi.replay(run!.id, c.id))} />)}</div> : <p className="text-[12.5px] text-subtle">No candidates yet.</p>}
        </Step>
      )}

      {r && r.evaluations.length > 0 && (
        <Step n={intelligence ? 12 : 6} title="Verdict and report" done description="Evaluated on replayed cases under the frozen contract. Production results are not yet measured.">
          <div role="tablist" aria-label="Report mode" className="mb-3 inline-flex rounded-lg border border-line p-0.5 text-[12px]">{(['executive', 'developer'] as const).map((m) => <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cn('rounded-md px-3 py-1.5 capitalize', mode === m ? 'bg-ink text-white' : 'text-muted')}>{m}</button>)}</div>
          {mode === 'executive' ? <Executive report={r} /> : <Developer report={r} />}
        </Step>
      )}
      {report.error && <Note tone="error" className="mt-4">{report.error}</Note>}
    </ProductFrame>
  );
}
