/**
 * Optimization Intelligence (vNext Part 2B) steps of /app/optimize:
 * plan search → calibration → full replay → Pareto frontier → selected plan →
 * report. Every number carries its claim label (ESTIMATED / CALIBRATED /
 * EVALUATED / VERIFIED / BAD-DAY REPLAY); unknown is shown as unknown.
 */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { trackProductView } from '@/lib/analytics';
import { ChevronDown, ChevronRight, FlaskConical, Layers, PlayCircle, Scale, Square } from 'lucide-react';
import { errorMessage } from '@/lib/api';
import { Button, Chip, Note, StatusChip, cn, useAsyncValue, useProductToast } from '../ui';
import { optimizeApi, type BadDayResult, type Decision, type ExecutionPlan, type OptimizationRun, type Policy, type SearchReport } from '../optimize';
import { ClaimTag, msLabel, num3, pctLabel, Segmented, signedPct, Step, unknown, usd } from './optimize-parts';

const STAGE_TONE: Record<string, 'neutral' | 'accent' | 'verified' | 'rejected' | 'warning'> = {
  PROPOSED: 'neutral', BLOCKED: 'warning', NEEDS_EVIDENCE: 'warning', CONFLICTED: 'neutral', PRUNED: 'neutral', CALIBRATION_READY: 'neutral', CALIBRATING: 'accent',
  CALIBRATION_REJECTED: 'rejected', FULL_REPLAY_READY: 'accent', REPLAYING: 'accent', REJECTED: 'rejected', INCOMPLETE: 'warning', VERIFIED: 'verified', PARETO_FRONTIER: 'verified', SELECTED: 'verified',
};
const RISK_TONE = { low: 'neutral', medium: 'warning', high: 'rejected' } as const;
const DIMENSION: Record<string, string> = { cpso_usd: 'cost per successful outcome', p95_ms: 'p95 latency', task_success: 'task success', quality: 'quality', failure_rate: 'failure rate', provider_concentration: 'provider concentration', risk: 'risk', implementation_complexity: 'implementation complexity', rollback_complexity: 'rollback complexity' };
const dims = (keys: string[]) => (keys.length ? keys.map((k) => DIMENSION[k] || k).join(', ') : 'nothing');
const POLICY_LABEL: Array<[Policy, string]> = [['MARGIN_FIRST', 'Margin first'], ['LATENCY_FIRST', 'Latency first'], ['RELIABILITY_FIRST', 'Reliability first'], ['BALANCED', 'Balanced'], ['CUSTOM_CONSTRAINTS', 'Custom']];
const SCENARIOS: Array<[string, string, Record<string, number>]> = [
  ['PROVIDER_RATE_LIMIT', 'Provider 429 (20%, retry after 500 ms)', { rate: 0.2, retry_after_ms: 500 }],
  ['PROVIDER_TIMEOUT', 'Provider timeout (10%, 30 s)', { rate: 0.1, timeout_ms: 30_000 }],
  ['MODEL_LATENCY_MULTIPLIER', 'Model latency × 2', { multiplier: 2 }],
  ['CACHE_MISS', 'Every cache / lookup hit misses', { rate: 1 }],
];
type Filter = 'all' | 'executable' | 'blocked' | 'conflicted' | 'evaluated';
const FILTERS: Array<[Filter, string]> = [['all', 'All'], ['executable', 'Executable'], ['blocked', 'Blocked'], ['conflicted', 'Conflicted / pruned'], ['evaluated', 'Evaluated']];

const stageChip = (p: ExecutionPlan) => <Chip tone={STAGE_TONE[p.status]}>{p.stage}</Chip>;
const est = (p: ExecutionPlan, key: string) => p.estimated_effects?.[key] as { value: number | null } | undefined;

function Counters({ r }: { r: SearchReport }) {
  const c = r.counts;
  const items: Array<[string, number, string?]> = [['Generated', c.generated], ['Conflicted', c.conflicted], ['Blocked', c.blocked], ['Needs evidence', c.needs_evidence], ['Pruned', c.pruned], ['Calibrated', c.calibrated], ['Full replay', c.fully_replayed], ['Verified', c.verified, 'verified'], ['Rejected', c.rejected, 'rejected'], ['Frontier', c.frontier, 'verified']];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {items.map(([k, v, tone]) => (
        <div key={k} className="rounded-lg border border-line px-3 py-2">
          <dt className="pmetric-label">{k}</dt>
          <dd className={cn('mt-0.5 text-[20px] font-semibold tnum', tone === 'verified' && v > 0 && 'text-verified', tone === 'rejected' && v > 0 && 'text-rejected')}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Label / prose pairs: stacked on phones, two columns from sm up. */
function Facts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[160px_1fr]">
      {items.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="pmetric-label sm:pt-0.5">{k}</dt>
          <dd className="text-ink">{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function List({ title, items }: { title: string; items: ReactNode[] | null | undefined }) {
  if (!items || !items.length) return null;
  return (
    <div>
      <div className="pmetric-label">{title}</div>
      <ul className="mt-1 grid gap-0.5 text-muted">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

/** Everything a reviewer asks about one plan. */
function PlanDetail({ p }: { p: ExecutionPlan }) {
  const e = p.explanation;
  return (
    <div className="grid gap-3 text-[12.5px] md:grid-cols-2">
      <List title="Why generated" items={e.why_generated} />
      <List title="Passes composed (in order)" items={e.passes_composed} />
      <List title="Conflicts checked" items={e.conflicts_checked} />
      <List title="ZevIR nodes changed" items={e.zevir_nodes_changed.slice(0, 6).map((n) => <span key={n.stable_key} className="mono text-[11.5px]">{n.kind} {n.name} · {n.stable_key.slice(0, 10)}</span>)} />
      <List title="Missing evidence" items={e.missing_evidence} />
      <List title="Why it entered calibration" items={e.why_calibration ? [e.why_calibration] : null} />
      <List title="Why it got more replay budget" items={e.why_more_budget} />
      <List title="Calibration (CALIBRATION — NOT VERIFIED)" items={e.calibration.map((c) => `round ${c.round}: ${c.outcome} on ${c.sample_size} case(s) · sample ${c.sample_hash.slice(0, 10)} — ${c.reasons.join('; ')}`)} />
      <List title="Why rejected" items={e.why_rejected?.filter(Boolean) as string[]} />
      <List title="Why dominated" items={e.why_dominated ? [e.why_dominated] : null} />
      <List title="Why on the frontier" items={e.why_frontier ? [e.why_frontier] : null} />
      <List title="Why selected" items={e.why_selected ? [e.why_selected] : null} />
      <List title="What could falsify it" items={e.falsifiers} />
      <List title="Rollback (reverse order)" items={e.rollback.map((x) => `${x.label}: ${x.rollback}`)} />
      <List title="Not proven" items={e.not_proven} />
      {p.passes.some((x) => x.not_executable_reason) && <List title="Why not executable" items={p.passes.filter((x) => x.not_executable_reason).map((x) => `${x.label}: ${x.not_executable_reason}`)} />}
    </div>
  );
}

function PlanTable({ plans }: { plans: ExecutionPlan[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const shown = plans.filter((p) => (filter === 'all' ? true : filter === 'executable' ? p.executable_status === 'EXECUTABLE' && !['CONFLICTED', 'PRUNED'].includes(p.status) : filter === 'blocked' ? ['BLOCKED', 'NEEDS_EVIDENCE'].includes(p.status) : filter === 'conflicted' ? ['CONFLICTED', 'PRUNED'].includes(p.status) : Boolean(p.verdict || p.calibrated_effects)));
  const order = ['SELECTED', 'PARETO_FRONTIER', 'VERIFIED', 'REJECTED', 'INCOMPLETE', 'CALIBRATION_REJECTED', 'FULL_REPLAY_READY', 'REPLAYING', 'CALIBRATING', 'CALIBRATION_READY', 'PRUNED', 'NEEDS_EVIDENCE', 'BLOCKED', 'CONFLICTED', 'PROPOSED'];
  const sorted = [...shown].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.name.localeCompare(b.name));
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented label="Filter plans" value={filter} options={FILTERS} onChange={setFilter} />
        <span className="text-[12px] text-subtle">{shown.length} of {plans.length} plans · effects are <b>ESTIMATED</b> (search priority only)</span>
      </div>
      <div className="max-h-[560px] overflow-auto rounded-xl border border-line">
        <table className="ptable">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr><th aria-label="Expand" /><th>Plan</th><th>Stage · executable</th><th className="right">Nodes</th><th className="right">Estimated effect</th><th>Risk</th><th>Evidence · budget</th></tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const isOpen = open === p.id;
              const change = est(p, 'cost_change_usd')?.value;
              const removed = est(p, 'provider_calls_removed')?.value;
              return (
                <Fragment key={p.id}>
                  <tr className="is-clickable" onClick={() => setOpen(isOpen ? null : p.id)}>
                    <td><button type="button" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} details for ${p.name}`} className="text-subtle" onClick={(ev) => { ev.stopPropagation(); setOpen(isOpen ? null : p.id); }}>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button></td>
                    <td className="min-w-[200px]"><div className="flex flex-wrap gap-1">{p.passes.map((x) => <span key={x.transformation_hash} className="rounded-md bg-ink/5 px-1.5 py-0.5 text-[11.5px] text-ink">{x.label}<span className="text-subtle"> · {x.scope}</span></span>)}</div></td>
                    <td><span className="flex flex-wrap gap-1">{stageChip(p)}<Chip tone={p.executable_status === 'EXECUTABLE' ? 'accent' : p.executable_status === 'NEEDS_IMPLEMENTATION' ? 'warning' : 'neutral'}>{p.executable_status.replace('_', ' ')}</Chip></span></td>
                    <td className="right">{p.affected_node_count}</td>
                    <td className="right">{p.estimated_effects?.label === 'NOT ESTIMATED' ? <span className="text-subtle">not estimated</span> : <span className="grid">{change === null || change === undefined ? unknown : usd(change, 5)}<span className="text-[11px] text-subtle">{removed ?? 0} call(s) removed</span></span>}</td>
                    <td><Chip tone={RISK_TONE[p.risk_class]}>{p.risk_class}</Chip></td>
                    <td className="text-muted"><span className="grid">{p.evidence_completeness === 'complete' ? 'evidence complete' : <span className="text-warning">missing {p.missing_evidence.length}</span>}<span className="text-[11px] text-subtle">{p.replay_budget.round ? `round ${p.replay_budget.round} · ${p.replay_budget.sample_size} cases` : p.replay_budget.full_replay_samples ? `${p.replay_budget.full_replay_samples} cases replayed` : 'no replay budget'}</span></span></td>
                  </tr>
                  {isOpen && <tr><td /><td colSpan={6} className="bg-ink/[0.02]"><PlanDetail p={p} /></td></tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CalibrationTable({ plans }: { plans: ExecutionPlan[] }) {
  const rows = plans.filter((p) => p.calibrated_effects);
  if (!rows.length) return <p className="text-[12.5px] text-subtle">No plan has been calibrated yet.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="ptable">
        <thead><tr><th>Plan</th><th>Outcome</th><th className="right">Round · cases</th><th className="right">Cost Δ</th><th>Next · why</th></tr></thead>
        <tbody>
          {rows.map((p) => {
            const m = p.calibrated_effects!.metrics as { cost_delta_usd?: number | null };
            return (
              <tr key={p.id}>
                <td><div className="min-w-[160px] max-w-[230px]">{p.name}</div></td>
                <td><span className="flex flex-wrap gap-1"><ClaimTag kind="CALIBRATED" /><Chip tone={p.calibrated_effects!.outcome === 'FAILED_HARD_GATE' ? 'rejected' : p.calibrated_effects!.outcome === 'PROMISING' ? 'accent' : 'warning'}>{p.calibrated_effects!.outcome.replace(/_/g, ' ')}</Chip></span></td>
                <td className="right">{p.calibrated_effects!.round} · {p.replay_budget.sample_size ?? '—'}</td>
                <td className="right">{usd(m.cost_delta_usd ?? null, 5)}</td>
                <td className="text-muted"><div className="max-w-[300px]"><b className="font-medium text-ink">{p.replay_budget.decision?.replace(/_/g, ' ') || '—'}</b> — {(p.replay_budget.why || []).join('; ')}</div></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReplayTable({ plans }: { plans: ExecutionPlan[] }) {
  const rows = plans.filter((p) => p.verdict);
  if (!rows.length) return <p className="text-[12.5px] text-subtle">No plan has been fully replayed yet.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="ptable">
        <thead><tr><th>Plan</th><th>Verdict</th><th className="right">CPSO</th><th className="right">Cost</th><th className="right">p95</th><th className="right">Success</th><th className="right">Quality</th><th className="right">Fail</th><th>Reason</th></tr></thead>
        <tbody>
          {rows.map((p) => {
            const m = p.evaluated_effects;
            return (
              <tr key={p.id}>
                <td><div className="min-w-[160px] max-w-[230px]">{p.name}</div></td>
                <td><span className="grid justify-items-start gap-0.5"><StatusChip status={p.verdict!} /><span className="text-[11px] text-subtle">{p.verdict === 'VERIFIED' ? 'all gates passed' : 'EVALUATED · not verified'}</span></span></td>
                <td className="right">{usd(m?.cpso_usd, 5)}</td>
                <td className="right">{usd(m?.cost_usd, 4)}</td>
                <td className="right">{msLabel(m?.p95_ms)}</td>
                <td className="right">{pctLabel(m?.task_success)}</td>
                <td className="right">{num3(m?.quality)}</td>
                <td className="right">{pctLabel(m?.failure_rate)}</td>
                <td className="text-rejected"><div className="max-w-[220px] [overflow-wrap:anywhere]">{p.verdict !== 'VERIFIED' ? (p.explanation.why_rejected || []).filter(Boolean).join('; ') : ''}</div></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Small CPSO × p95 scatter (no chart dependency). Frontier plans are filled. */
function Scatter({ plans }: { plans: ExecutionPlan[] }) {
  const pts = plans.filter((p) => p.verified_effects && p.verified_effects.cpso_usd !== null && p.verified_effects.p95_ms !== null);
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p.verified_effects!.cpso_usd!);
  const ys = pts.map((p) => p.verified_effects!.p95_ms!);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  // A dimension on which every plan is equal is drawn through the middle and said in the caption.
  const sx = (v: number) => (x1 === x0 ? 152 : 44 + ((v - x0) / (x1 - x0)) * 212);
  const sy = (v: number) => (y1 === y0 ? 78 : 128 - ((v - y0) / (y1 - y0)) * 100);
  return (
    <figure className="rounded-xl border border-line p-3">
      <svg viewBox="0 0 280 160" className="h-auto w-full max-w-[360px]" role="img" aria-label={`Verified plans by cost per successful outcome and p95 latency; ${pts.filter((p) => p.frontier_state === 'FRONTIER').length} on the frontier`}>
        <line x1="36" y1="140" x2="270" y2="140" stroke="currentColor" className="text-line" />
        <line x1="36" y1="16" x2="36" y2="140" stroke="currentColor" className="text-line" />
        <text x="152" y="156" textAnchor="middle" fontSize="9" fill="currentColor" className="text-subtle">cost per successful outcome →</text>
        <text x="10" y="80" fontSize="9" fill="currentColor" className="text-subtle" transform="rotate(-90 10 80)" textAnchor="middle">p95 →</text>
        {pts.map((p) => {
          const front = p.frontier_state === 'FRONTIER';
          return <circle key={p.id} cx={sx(p.verified_effects!.cpso_usd!)} cy={sy(p.verified_effects!.p95_ms!)} r={front ? 5 : 4} className={front ? 'fill-verified stroke-verified' : 'fill-transparent stroke-subtle'} strokeWidth="1.5"><title>{`${p.name}${front ? ' (frontier)' : ''}`}</title></circle>;
        })}
      </svg>
      <figcaption className="mt-1 text-[11.5px] text-subtle">Filled: Pareto frontier. Lower-left is cheaper and faster. Overlapping points are plans with equal values.{y1 === y0 ? ` Every verified plan has the same p95 (${msLabel(y0)}).` : ''}{x1 === x0 ? ' Every verified plan has the same cost per successful outcome.' : ''}</figcaption>
    </figure>
  );
}

function FrontierTable({ plans }: { plans: ExecutionPlan[] }) {
  const rows = plans.filter((p) => p.verdict === 'VERIFIED').sort((a, b) => (a.frontier_state === 'FRONTIER' ? 0 : 1) - (b.frontier_state === 'FRONTIER' ? 0 : 1) || (a.verified_effects?.cpso_usd ?? Infinity) - (b.verified_effects?.cpso_usd ?? Infinity));
  if (!rows.length) return <p className="text-[12.5px] text-subtle">No VERIFIED plan yet: the frontier is empty. Nothing is recommended.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="ptable">
        <thead><tr><th>Plan</th><th className="right">CPSO</th><th className="right">Cost</th><th className="right">p95</th><th className="right">Task success</th><th className="right">Quality</th><th className="right">Failures</th><th className="right">Complexity</th><th>Risk</th><th>Frontier</th></tr></thead>
        <tbody>
          {rows.map((p) => {
            const m = p.verified_effects!;
            const front = p.frontier_state === 'FRONTIER';
            return (
              <tr key={p.id} className={front ? 'bg-verified-bg/40' : undefined}>
                <td className="min-w-[180px]">{p.name}{p.status === 'SELECTED' && <Chip tone="ink" className="ml-1.5">SELECTED</Chip>}</td>
                <td className="right">{usd(m.cpso_usd, 5)}</td>
                <td className="right">{usd(m.cost_usd, 4)}</td>
                <td className="right">{msLabel(m.p95_ms)}</td>
                <td className="right">{pctLabel(m.task_success)}</td>
                <td className="right">{num3(m.quality)}</td>
                <td className="right">{pctLabel(m.failure_rate)}</td>
                <td className="right">{p.implementation_complexity} / {p.rollback_complexity}</td>
                <td><Chip tone={RISK_TONE[p.risk_class]}>{p.risk_class}</Chip></td>
                <td title={p.dominance_state?.frontier_reason}>{front ? <Chip tone="verified">FRONTIER</Chip> : <Chip tone="neutral">{p.frontier_state}</Chip>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11.5px] text-subtle">Every row is VERIFIED. Values are measured on the replayed evaluation set under the frozen contract. Complexity = implementation / rollback. Hover a frontier cell for the dominance reasoning.</p>
    </div>
  );
}

function BadDay({ results }: { results: BadDayResult[] }) {
  if (!results.length) return <p className="text-[12.5px] text-subtle">No Bad-Day Replay yet for this plan.</p>;
  return (
    <div className="grid gap-2">
      {results.map((r) => (
        <div key={r.id} className="overflow-x-auto rounded-lg border border-line">
          <div className="flex flex-wrap items-center gap-2 px-3 pt-2"><ClaimTag kind="BAD-DAY REPLAY" /><span className="text-[12.5px] text-ink">{r.metrics.description}</span><span className="text-[12px] text-subtle">normal</span><StatusChip status={r.normal_verdict} /><span className="text-[12px] text-subtle">bad day</span><StatusChip status={r.bad_day_verdict} /></div>
          {r.metrics.bad_day && (
            <table className="ptable mt-1">
              <thead><tr><th>Under the scenario</th><th className="right">Normal</th><th className="right">Bad day</th><th className="right">Baseline bad day</th></tr></thead>
              <tbody>
                <tr><td>Known cost</td><td className="right">{usd(r.metrics.normal?.cost_usd)}</td><td className="right">{usd(r.metrics.bad_day.cost_usd)}</td><td className="right">{usd(r.metrics.baseline_bad_day?.cost_usd)}</td></tr>
                <tr><td>p95</td><td className="right">{msLabel(r.metrics.normal?.p95_ms)}</td><td className="right">{msLabel(r.metrics.bad_day.p95_ms)}</td><td className="right">{msLabel(r.metrics.baseline_bad_day?.p95_ms)}</td></tr>
                <tr><td>Task success</td><td className="right">{pctLabel(r.metrics.normal?.task_success)}</td><td className="right">{pctLabel(r.metrics.bad_day.task_success)}</td><td className="right">{pctLabel(r.metrics.baseline_bad_day?.task_success)}</td></tr>
                <tr><td>Retry amplification</td><td className="right">{r.metrics.normal?.retry_amplification?.toFixed(2) ?? unknown}</td><td className="right">{r.metrics.bad_day.retry_amplification?.toFixed(2) ?? unknown}</td><td className="right">{r.metrics.baseline_bad_day?.retry_amplification?.toFixed(2) ?? unknown}</td></tr>
                <tr><td>Fallback used</td><td className="right">—</td><td className="right">{r.metrics.bad_day.fallback_used}</td><td className="right">{r.metrics.baseline_bad_day?.fallback_used ?? '—'}</td></tr>
              </tbody>
            </table>
          )}
          <p className="px-3 py-2 text-[12px] text-muted">{r.metrics.statement}{/production guarantee/.test(r.metrics.statement) ? null : <span className="text-subtle"> {r.metrics.not_claimed}</span>}</p>
        </div>
      ))}
    </div>
  );
}

function SelectedPlan({ plan, decision, onBadDay, busy, canEdit }: { plan: ExecutionPlan; decision: Decision; onBadDay: (scenario: string) => void; busy: boolean; canEdit: boolean }) {
  const [scenario, setScenario] = useState(SCENARIOS[0][0]);
  const m = plan.verified_effects!;
  const row = (label: string, b: ReactNode, c: ReactNode, d: ReactNode) => <tr><td>{label}</td><td className="right">{b}</td><td className="right">{c}</td><td className="right tnum">{d}</td></tr>;
  return (
    <div className="grid gap-4 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2"><Chip tone="ink">SELECTED</Chip><b className="text-[15px] text-ink">{plan.name}</b><ClaimTag kind="VERIFIED" /></div>
      <Facts items={[
        ['Business objective', `${decision.policy.replace(/_/g, ' ').toLowerCase()} — ${decision.explanation.rule}`],
        ['Why selected', decision.explanation.why],
        ['Hard gates', decision.explanation.hard_gates],
        ['Tradeoffs', decision.explanation.tradeoffs.length ? <ul className="grid gap-1">{decision.explanation.tradeoffs.map((t) => <li key={t.versus}>vs <i>{t.versus}</i>: better on {dims(t.selected_better_on)}; worse on {dims(t.selected_worse_on)}</li>)}</ul> : 'the only frontier plan'],
        ['Passes', plan.passes.map((x) => `${x.label} (${x.pass}@${x.pass_version})`).join(' → ')],
        ['Affected path', `${plan.affected_node_count} ZevIR node(s): ${plan.explanation.zevir_nodes_changed.slice(0, 3).map((n) => `${n.kind} ${n.name ?? ''}`).join(', ')}`],
      ]} />
      <div className="overflow-x-auto rounded-xl border border-line">
        <div className="flex flex-wrap items-center gap-2 px-3 pt-2.5 text-[12px] text-muted"><ClaimTag kind="VERIFIED" />Replay evidence on the evaluation set, same frozen contract</div>
        <table className="ptable">
          <thead><tr><th>Metric</th><th className="right">Baseline</th><th className="right">Plan</th><th className="right">Change</th></tr></thead>
          <tbody>
            {row('Cost / success', usd(m.baseline.cpso_usd, 5), usd(m.cpso_usd, 5), signedPct(m.deltas_pct.cost_per_successful_outcome))}
            {row('Known cost', usd(m.baseline.cost_usd), usd(m.cost_usd), signedPct(m.deltas_pct.cost))}
            {row('p95 latency', msLabel(m.baseline.p95_ms), msLabel(m.p95_ms), signedPct(m.deltas_pct.p95))}
            {row('Task success', pctLabel(m.baseline.task_success), pctLabel(m.task_success), m.task_success !== null && m.baseline.task_success !== null ? `${((m.task_success - m.baseline.task_success) * 100).toFixed(1)} pp` : unknown)}
            {row('Quality', num3(m.baseline.quality), num3(m.quality), m.quality !== null && m.baseline.quality !== null ? (m.quality - m.baseline.quality).toFixed(3) : unknown)}
            <tr><td>Realized in production</td><td colSpan={3} className="font-medium text-ink">NOT YET MEASURED</td></tr>
          </tbody>
        </table>
      </div>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="pmetric-label">Bad-Day Replay</span>
          <label className="sr-only" htmlFor="bad-day-scenario">Scenario</label>
          <select id="bad-day-scenario" className="h-8 rounded-md border border-line bg-surface px-2 text-[12.5px]" value={scenario} onChange={(e) => setScenario(e.target.value)}>
            {SCENARIOS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          {canEdit && <Button size="sm" variant="secondary" loading={busy} onClick={() => onBadDay(scenario)}><FlaskConical size={14} /> Run Bad-Day Replay</Button>}
          <span className="text-[11.5px] text-subtle">Simulated faults over the replayed cases — never production traffic.</span>
        </div>
        <BadDay results={plan.bad_day} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <List title="Implementation requirements" items={plan.materializer_hints.map((h) => `${h.label}: ${[h.kind, h.target, h.notes].filter(Boolean).join(' — ')}`)} />
        <List title="Rollback (reverse order)" items={plan.rollback.map((r) => `${r.label}: ${r.rollback}`)} />
        <List title="What could falsify it" items={plan.explanation.falsifiers} />
        <List title="What is NOT proven" items={plan.explanation.not_proven} />
      </div>
    </div>
  );
}

function Executive({ r }: { r: SearchReport }) {
  const e = r.executive;
  const rec = e.recommendation;
  return (
    <div className="grid gap-3 text-[12.5px]">
      <p className="text-[14px] font-medium text-ink">{e.headline}</p>
      <List title="What was wrong (observed)" items={e.what_was_wrong.map((w) => `${w.family.replace(/_/g, ' ')} · ${w.scope}: ${w.symptom}`)} />
      <List title="Tradeoff frontier (VERIFIED)" items={e.frontier.map((f) => <span key={f.id}>{f.name} — CPSO {usd(f.cpso_usd, 5)}, p95 {msLabel(f.p95_ms)}, task success {pctLabel(f.task_success)}, {f.risk_class} risk</span>)} />
      {rec ? (
        <div className="overflow-x-auto rounded-xl border border-line">
          <div className="px-4 pt-3"><b className="text-ink">Recommended for {rec.policy.replace(/_/g, ' ').toLowerCase()}:</b> {rec.name} <ClaimTag kind="VERIFIED" /></div>
          <table className="ptable mt-2">
            <tbody>
              <tr><td>Evaluated cost per successful outcome</td><td className="right tnum">{signedPct(rec.evaluated_cpso_change_pct)}</td></tr>
              <tr><td>Evaluated cost</td><td className="right tnum">{signedPct(rec.evaluated_cost_change_pct)}</td></tr>
              <tr><td>Evaluated p95 latency</td><td className="right tnum">{signedPct(rec.evaluated_p95_change_pct)}</td></tr>
              <tr><td>Task success</td><td className="right tnum">{rec.task_success_change_pp === null ? unknown : `${rec.task_success_change_pp > 0 ? '+' : ''}${rec.task_success_change_pp.toFixed(1)} pp`}</td></tr>
              <tr><td>Quality</td><td className="right tnum">{rec.quality_change === null ? unknown : rec.quality_change === 0 ? 'unchanged' : rec.quality_change.toFixed(3)}</td></tr>
              <tr><td>Realized production result</td><td className="right font-medium text-ink">{rec.realized_production_result}</td></tr>
            </tbody>
          </table>
          <p className="px-4 pb-3 text-muted">{rec.why}</p>
        </div>
      ) : (
        <Note>No plan is recommended yet: apply a decision policy to a completed frontier.</Note>
      )}
      <p className="text-subtle">Evidence: {e.evidence.label}.{e.budget ? ` Budget: ${e.budget.reason}. ${e.budget.note}` : ''}</p>
      <ul className="list-disc pl-5 text-subtle">{e.not_claimed.map((x) => <li key={x}>{x}</li>)}</ul>
    </div>
  );
}

function Developer({ r }: { r: SearchReport }) {
  return (
    <div className="grid gap-2 text-[12.5px]">
      {r.developer.plans.map((p) => (
        <details key={p.id} className="rounded-lg border border-line px-3 py-2">
          <summary className="cursor-pointer font-medium text-ink">{p.name} <span className="mono text-[11px] text-subtle">{p.plan_hash.slice(0, 12)}</span>{p.full_replay && <StatusChip status={p.full_replay.status} className="ml-2" />}</summary>
          <div className="mt-2 grid gap-2">
            <List title="Composition order" items={p.composition_order.map((c) => <span key={c.transformation_hash}>{c.label} · {c.layer} · {c.scope} <span className="mono text-[11px] text-subtle">{c.transformation_hash.slice(0, 10)}</span></span>)} />
            <List title="Config changes" items={p.config_changes.map((c) => <span key={c.label} className="mono text-[11.5px]">{JSON.stringify(c.settings)}</span>)} />
            <List title="Calibration cases" items={p.calibration.map((c) => `round ${c.round}: ${c.outcome} · ${c.sample_size} case(s) · sample ${c.sample_hash.slice(0, 12)}`)} />
            {p.full_replay && (
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="ptable">
                  <thead><tr><th>Gate</th><th>Required</th><th>Outcome</th><th>Reason</th></tr></thead>
                  <tbody>{p.full_replay.gates.map((g) => <tr key={g.name}><td className="mono">{g.name}</td><td>{g.required ? 'yes' : 'no'}</td><td><StatusChip status={g.outcome} /></td><td className="max-w-[420px] text-muted">{g.reason}</td></tr>)}</tbody>
                </table>
              </div>
            )}
            <List title="Pareto reasoning" items={p.pareto ? [p.pareto.frontier_reason] : null} />
            <List title="Falsifiers" items={p.falsifiers} />
          </div>
        </details>
      ))}
    </div>
  );
}

export default function PlanSearchSection({ run, productId, canEdit, first }: { run: OptimizationRun; productId: string; canEdit: boolean; first: number }) {
  const toast = useProductToast();
  const searches = useAsyncValue(() => optimizeApi.searches(run.id), [run.id]);
  const current = searches.data?.searches[0] || null;
  const report = useAsyncValue(() => optimizeApi.searchReport(current!.id), [current?.id], { enabled: Boolean(current) });
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [mode, setMode] = useState<'executive' | 'developer'>('executive');
  const [policy, setPolicy] = useState<Policy>('MARGIN_FIRST');
  const [custom, setCustom] = useState<{ max_p95_ms: string; max_risk: string; objective: string }>({ max_p95_ms: '', max_risk: '', objective: 'MARGIN_FIRST' });
  const r = report.data;
  const { activeWorkspace } = useSession();
  const wsId = activeWorkspace?.id;
  const frontierCount = r?.counts.frontier ?? 0;
  // View events for the activation funnel: recorded once per user, search and day (server-deduplicated).
  useEffect(() => {
    if (wsId && current?.id && frontierCount > 0) trackProductView('pareto_viewed', wsId, current.id, { frontier: frontierCount, surface: 'optimize' });
  }, [wsId, current?.id, frontierCount]);
  // "Report opened" = the report step was actually on screen, not merely loaded.
  useEffect(() => {
    const el = document.getElementById('step-report');
    if (!wsId || !current?.id || !r || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        trackProductView('report_opened', wsId, `${current.id}:${mode}`, { view: mode, surface: 'optimize' });
        io.disconnect();
      }
    }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [wsId, current?.id, mode, r]);
  const reload = () => {
    searches.reload();
    report.reload();
  };
  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast({ tone: 'ok', title: ok });
    } catch (error) {
      toast({ tone: 'err', title: 'That step did not complete', description: errorMessage(error) });
    } finally {
      setBusy(null);
      setProgress(null);
      reload();
    }
  };
  /** Bounded synchronous stages: keep calling until the server says done (it persists state between calls). */
  const drive = (stage: 'calibrate' | 'replay') => act(stage, async () => {
    let processed = 0;
    for (let i = 0; i < 40; i += 1) {
      const out = await optimizeApi.stage(current!.id, stage);
      processed += out.processed.length;
      setProgress(`${stage === 'calibrate' ? 'Calibrating' : 'Replaying'} — ${processed} step(s) done${out.continuation ? ', continuing…' : ''}`);
      if (out.budget) toast({ tone: 'info', title: 'Search budget reached', description: `${out.budget.reason}. Unevaluated plans have no verdict.` });
      if (out.done) break;
    }
  });
  const decision = r?.decisions.find((d) => r.plans.some((p) => p.id === d.selected_plan_id && p.status === 'SELECTED')) || null;
  const selected = decision ? r!.plans.find((p) => p.id === decision.selected_plan_id) || null : null;
  const pendingCalibration = useMemo(() => (r ? r.plans.some((p) => p.status === 'CALIBRATION_READY' && !p.calibrated_effects) : false), [r]);
  const terminal = r ? ['completed', 'budget_exhausted', 'cancelled', 'failed'].includes(r.search.status) : false;
  const n = (k: number) => first + k;
  const decide = () => {
    const params: Record<string, unknown> = {};
    if (policy === 'CUSTOM_CONSTRAINTS') {
      if (custom.max_p95_ms.trim()) params.max_p95_ms = Number(custom.max_p95_ms);
      if (custom.max_risk) params.max_risk = custom.max_risk;
      params.objective = custom.objective;
    }
    void act('decide', () => optimizeApi.decide(current!.id, policy, params), 'Decision recorded');
  };
  const badDay = (scenario: string) => act('badday', async () => {
    const [, , parameters] = SCENARIOS.find(([k]) => k === scenario)!;
    const profile = await optimizeApi.createProfile(productId, scenario, parameters);
    await optimizeApi.badDay(selected!.id, profile.id);
  }, 'Bad-Day Replay recorded');

  return (
    <>
      <Step id="step-search" n={n(0)} title="Plan search" done={Boolean(r)} description="Bounded, deterministic composition of the passes’ changes. Estimates only prioritise the search; nothing here is evidence."
        action={canEdit && !current ? <Button size="sm" onClick={() => void act('start', () => optimizeApi.startSearch(run.id), 'Plan search generated')} loading={busy === 'start'}><Layers size={14} /> Start plan search</Button> : canEdit && r && !terminal ? <Button size="sm" variant="ghost" onClick={() => void act('cancel', () => optimizeApi.cancelSearch(current!.id), 'Search cancelled')} loading={busy === 'cancel'}><Square size={13} /> Cancel search</Button> : undefined}>
        {searches.error && <Note tone="error">{searches.error}</Note>}
        {!current && !searches.loading && <p className="text-[12.5px] text-subtle">No plan search yet for this run.</p>}
        {r && (
          <div className="grid gap-3">
            <Counters r={r} />
            <p className="text-[12px] text-subtle">
              Evaluation set: {r.search.evaluation_set.size} of {r.search.evaluation_set.final_requests} final requests{r.search.evaluation_set.excluded.length ? ` (${r.search.evaluation_set.excluded.length} excluded: ${[...new Set(r.search.evaluation_set.excluded.flatMap((x) => x.reasons))].join(', ')})` : ''} · {r.search.evaluation_set.protected} protected · search <span className="mono">{r.search.search_hash.slice(0, 12)}</span> · status <b>{r.search.status.replace('_', ' ')}</b>
              {r.search.generation.truncation_note ? ` · ${r.search.generation.truncation_note}` : ''}
            </p>
            {r.search.status === 'cancelled' && <Note tone="warn">This search was cancelled. Nothing further runs; start a new search to continue.</Note>}
            {r.search.budget_report && <Note tone="warn">SEARCH BUDGET EXHAUSTED — {r.search.budget_report.reason}. {r.search.budget_report.note}</Note>}
            <PlanTable plans={r.plans} />
          </div>
        )}
      </Step>

      {r && (
        <Step id="step-calibration" n={n(1)} title="Calibration" done={!pendingCalibration && r.counts.calibrated > 0} description="A cheap, seeded, outcome-blind sample per plan. It decides who earns full-replay budget — it is never a verdict (CALIBRATION — NOT VERIFIED)."
          action={canEdit && !terminal && pendingCalibration ? <Button size="sm" onClick={() => void drive('calibrate')} loading={busy === 'calibrate'}><PlayCircle size={14} /> Run calibration</Button> : undefined}>
          {progress && busy === 'calibrate' && <p role="status" className="mb-2 text-[12.5px] text-muted">{progress}</p>}
          <CalibrationTable plans={r.plans} />
        </Step>
      )}

      {r && r.counts.calibrated > 0 && (
        <Step id="step-replay" n={n(2)} title="Full replay" done={r.counts.fully_replayed > 0 && !r.plans.some((p) => p.status === 'FULL_REPLAY_READY' && !p.verdict && r.search.status !== 'completed')} description="Promoted plans replay the whole evaluation set under the SAME frozen Evaluation Contract, through the existing engine and evaluator."
          action={canEdit && !terminal && !pendingCalibration ? <Button size="sm" onClick={() => void drive('replay')} loading={busy === 'replay'}><PlayCircle size={14} /> Run full replay</Button> : undefined}>
          {progress && busy === 'replay' && <p role="status" className="mb-2 text-[12.5px] text-muted">{progress}</p>}
          <ReplayTable plans={r.plans} />
        </Step>
      )}

      {r && r.counts.fully_replayed > 0 && (
        <Step id="step-frontier" n={n(3)} title="Pareto frontier" done={r.counts.frontier > 0} description="Only VERIFIED plans are compared. A plan is on the frontier when no other is at least as good on every dimension. Unknown is never better or worse.">
          <div className="grid gap-3">
            <FrontierTable plans={r.plans} />
            <Scatter plans={r.plans} />
          </div>
        </Step>
      )}

      {r && r.counts.frontier > 0 && (
        <Step id="step-selected" n={n(4)} title="Selected plan" done={Boolean(selected)} description="State the business objective. The policy chooses from the VERIFIED frontier by an explicit rule; it can never reach a plan that failed a gate.">
          <div className="mb-4 flex flex-wrap items-end gap-2">
            <Segmented label="Decision policy" value={policy} options={POLICY_LABEL} onChange={setPolicy} />
            {policy === 'CUSTOM_CONSTRAINTS' && (
              <>
                <label className="grid gap-1 text-[12px]"><span className="text-muted">Max p95 (ms)</span><input className="h-8 w-28 rounded-md border border-line bg-surface px-2 tnum" inputMode="numeric" value={custom.max_p95_ms} onChange={(e) => setCustom({ ...custom, max_p95_ms: e.target.value })} /></label>
                <label className="grid gap-1 text-[12px]"><span className="text-muted">Max risk</span><select className="h-8 rounded-md border border-line bg-surface px-2" value={custom.max_risk} onChange={(e) => setCustom({ ...custom, max_risk: e.target.value })}><option value="">any</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></label>
                <label className="grid gap-1 text-[12px]"><span className="text-muted">Then rank by</span><select className="h-8 rounded-md border border-line bg-surface px-2" value={custom.objective} onChange={(e) => setCustom({ ...custom, objective: e.target.value })}><option value="MARGIN_FIRST">margin</option><option value="LATENCY_FIRST">latency</option><option value="RELIABILITY_FIRST">reliability</option></select></label>
              </>
            )}
            {canEdit && <Button size="sm" onClick={decide} loading={busy === 'decide'}><Scale size={14} /> Apply policy</Button>}
          </div>
          {r.decisions[0]?.outcome === 'NO_ELIGIBLE_PLAN' && !selected && <Note tone="warn">No frontier plan satisfies that policy. {r.decisions[0].explanation.why}</Note>}
          {selected && decision ? <SelectedPlan plan={selected} decision={decision} onBadDay={(s) => void badDay(s)} busy={busy === 'badday'} canEdit={canEdit} /> : <p className="text-[12.5px] text-subtle">No plan selected yet.</p>}
        </Step>
      )}

      {r && r.counts.fully_replayed > 0 && (
        <Step id="step-report" n={n(5)} title="Optimization Intelligence report" done description="Executive: what to ship and what is still unknown. Developer: lineage, gates and reasoning for every evaluated plan.">
          <div className="mb-3"><Segmented label="Report mode" value={mode} options={[['executive', 'Executive'], ['developer', 'Developer']]} onChange={setMode} /></div>
          {mode === 'executive' ? <Executive r={r} /> : <Developer r={r} />}
        </Step>
      )}
      {report.error && <Note tone="error" className="mt-4">{report.error}</Note>}
    </>
  );
}
