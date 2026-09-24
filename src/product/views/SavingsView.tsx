import { useNavigate } from 'react-router';
import { ProductFrame } from '../Frame';
import { useProduct } from '../store';
import { useProductDialogs } from '../dialogs/context';
import { Button, Card, CardHeader, Empty, StatusChip } from '../ui';
import { dateTime, money, score, STRATEGY_LABEL, titleCase } from '../format';
import { canonicalEvaluations, countsAsMeasuredSaving, ledgerSummary } from '../evidence';
import type { Evaluation } from '../types';

function whyNotCounted(e: Evaluation) {
  if (e.status === 'REJECTED') return 'Rejected: not savings';
  if (e.status !== 'VERIFIED') return 'Incomplete: not savings';
  if (!e.execution_proven) return 'Not execution-proven';
  if (e.raw_cost_delta_usd === null) return 'Cost unknown';
  return 'No cost reduction';
}

export default function SavingsView() {
  const { selected, evaluations, executions, plans, economics, setInspect } = useProduct();
  const dialogs = useProductDialogs();
  const navigate = useNavigate();

  if (!selected) {
    return (
      <ProductFrame>
        <Empty title="No project selected" description="Savings only exist after a verified experiment on a connected workload." action={<Button onClick={dialogs.openConnect}>Connect evidence</Button>} />
      </ProductFrame>
    );
  }

  const summary = ledgerSummary(evaluations);
  const rows = canonicalEvaluations(evaluations);
  const baselineSources = economics?.baseline?.cost.sources ? Object.keys(economics.baseline.cost.sources).join(', ') : null;

  return (
    <ProductFrame>
      <div className="mb-6">
        <div className="peyebrow">Savings</div>
        <h1 className="ph1">Measured, projected and realized, kept apart.</h1>
        <p className="plede">Only a VERIFIED, execution-proven experiment with a known cost reduction counts as measured. A finding, a rejected candidate or an incomplete run is never savings.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <div className="pmetric-label">A · Measured on evaluated cases</div>
          <div className={`pmetric-value ${summary.measured.count ? 'text-verified' : ''}`}>{summary.measured.savedUsd === null ? '—' : money(summary.measured.savedUsd, { digits: 6 })}</div>
          <div className="pmetric-hint">
            {summary.measured.count
              ? `${summary.measured.count} verified experiment${summary.measured.count === 1 ? '' : 's'} · ${summary.measured.evaluatedCases} evaluated cases · point estimates, no confidence interval computed`
              : 'Nothing verified yet. Unknown is shown as —, never as $0.'}
          </div>
        </Card>
        <Card className="p-5">
          <div className="pmetric-label">B · Projected production impact</div>
          <div className="pmetric-value text-subtle">Not modelled</div>
          <div className="pmetric-hint">A projection needs production volume and traffic mix modelled explicitly. ZEVQORA does not scale a sample result up on its own.</div>
        </Card>
        <Card className="p-5">
          <div className="pmetric-label">C · Realized after the change</div>
          <div className="pmetric-value text-subtle">No evidence yet</div>
          <div className="pmetric-hint">Realized impact needs traces recorded after the change shipped, evaluated the same way as the baseline.</div>
        </Card>
      </div>

      {(summary.excluded.rejected > 0 || summary.excluded.incomplete > 0 || summary.excluded.unproven > 0) && (
        <p className="mt-3 text-[12.5px] text-muted">
          Excluded from savings: {summary.excluded.rejected} rejected · {summary.excluded.incomplete} incomplete{summary.excluded.unproven ? ` · ${summary.excluded.unproven} verified without execution proof` : ''}.
        </p>
      )}

      <Card className="mt-6">
        <CardHeader title="Ledger" description="One line per candidate execution, its latest evaluation. Scope and provenance travel with every number." />
        {!rows.length ? (
          <div className="pcard-body">
            <Empty title="No experiments yet" description="Run an experiment from an opportunity. Its line appears here with its verdict, whatever the verdict is." action={<Button size="sm" onClick={() => navigate('/app/opportunities')}>Go to opportunities</Button>} />
          </div>
        ) : (
          <div className="pcard-body overflow-x-auto p-0">
            <table className="ptable">
              <thead>
                <tr>
                  <th>Evaluated</th>
                  <th>Candidate</th>
                  <th className="right">Cases</th>
                  <th>Quality</th>
                  <th>Cost provenance</th>
                  <th className="right">Measured saving</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const plan = plans.find((p) => p.id === e.candidate_plan_id);
                  const execution = executions.find((x) => x.id === e.candidate_execution_id);
                  const counted = countsAsMeasuredSaving(e);
                  const floor = e.gates.find((g) => g.name === 'quality_floor')?.threshold;
                  return (
                    <tr key={e.id} className="is-clickable" onClick={() => { setInspect({ kind: 'evaluation', id: e.id }); navigate('/app/evidence'); }}>
                      <td className="whitespace-nowrap">{dateTime(e.completed_at || e.created_at)}</td>
                      <td>
                        <div className="font-semibold">{STRATEGY_LABEL[plan?.strategy || ''] || titleCase(plan?.strategy || 'candidate')}</div>
                        <div className="mono text-[11.5px] text-subtle">{execution?.resolved_model || execution?.requested_model || (plan?.strategy === 'exact_reuse' ? 'deterministic reuse' : '—')}</div>
                      </td>
                      <td className="right tnum">{e.sample_count}{e.protected_sample_count ? <span className="text-subtle"> · {e.protected_sample_count}p</span> : null}</td>
                      <td className="tnum">{score(e.baseline_quality)} → {score(e.candidate_quality)}{typeof floor === 'number' ? <span className="text-subtle"> (floor {score(floor)})</span> : null}</td>
                      <td className="text-[12px] text-muted">baseline: {baselineSources || 'unknown'}<br />candidate: {execution?.cost_source || 'unknown'}</td>
                      <td className={`right tnum ${counted ? 'font-semibold text-verified' : 'text-subtle'}`}>{counted ? money(-(e.raw_cost_delta_usd as number), { digits: 6 }) : whyNotCounted(e)}</td>
                      <td><StatusChip status={e.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </ProductFrame>
  );
}
