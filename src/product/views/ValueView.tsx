import { Link } from 'react-router';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { Card, CardHeader } from '@/components/ui/Card';
import { ClaimBadge, Unknown } from '@/components/ui/Claim';
import { DataTable } from '@/components/ui/DataTable';
import { ViewHeader } from '@/components/ui/Layout';
import { ErrorState, LoadingState, InlineNotice } from '@/components/ui/States';
import { ZevFace } from '@/brand/Zev';
import { experienceApi, fmt } from '../experience';
import { orUnknown } from '../command/parts';

/**
 * Value, kept in three separate columns that are never added together:
 * EVALUATED (replay under a frozen contract), PROJECTED (that change applied
 * to observed volume) and REALIZED (production, after shipping — not yet
 * measured by ZEVQORA).
 */
export default function ValueView() {
  const { activeWorkspace } = useSession();
  const wsId = activeWorkspace?.id || '';
  const { data: cc, error, loading, reload } = useAsync(() => experienceApi.commandCenter(wsId, 30), [wsId], { enabled: Boolean(wsId) });

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 lg:px-8 lg:py-8">
      <ViewHeader eyebrow="Value" title="Value" description="What a change was shown to do on replay, what that would mean at your observed volume, and what actually happened in production — three different claims, shown separately." />
      {loading && !cc && <LoadingState label="Loading value" />}
      {error && <ErrorState message={error} onRetry={() => void reload()} />}
      {cc && (
        <div className="flex flex-col gap-5">
          {cc.synthetic && <InlineNotice tone="warning"><b>SYNTHETIC DEMO — NOT CUSTOMER DATA.</b> Values below include the labelled demo workload.</InlineNotice>}
          <div className="grid gap-3 md:grid-cols-3">
            {[
              { claim: 'EVALUATED' as const, title: 'Evaluated improvement', body: 'Measured by replaying recorded requests under the frozen Evaluation Contract. VERIFIED means every gate passed. It is not deployed.' },
              { claim: 'PROJECTED' as const, title: 'Projected impact', body: 'The evaluated per-request change multiplied by the requests observed in the last 30 days. It assumes the evaluation set represents traffic.' },
              { claim: 'NOT_YET_MEASURED' as const, title: 'Realized production value', body: cc.value.realized.reason },
            ].map((c) => (
              <Card key={c.title} className="p-4">
                <div className="flex items-center justify-between gap-2"><h2 className="text-[13.5px] font-semibold text-ink">{c.title}</h2><ClaimBadge claim={c.claim} size="xs" /></div>
                <p className="mt-2 text-[12.5px] text-muted">{c.body}</p>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader title="Per workload" description="Only selected VERIFIED plans appear. A plan that was cheaper but failed a gate never contributes value." />
            <div className="px-5 pb-4">
              <DataTable
                caption="Evaluated and projected value per workload"
                captionHidden
                rows={cc.products}
                rowKey={(p) => p.id}
                minWidth={900}
                empty="No workloads yet."
                columns={[
                  { key: 'w', header: 'Workload', className: 'min-w-[180px]', cell: (p) => <span className="font-medium">{p.name}{p.synthetic && <ClaimBadge claim="SYNTHETIC" size="xs" className="ml-2" />}</span> },
                  { key: 'plan', header: 'Selected plan', className: 'min-w-[200px]', cell: (p) => (p.decision?.selected_plan ? <span>{p.decision.selected_plan.name}<span className="block text-[11px] text-subtle">{p.decision.policy.replace(/_/g, ' ').toLowerCase()} · risk {p.decision.selected_plan.risk_class}</span></span> : <span className="text-subtle">none selected</span>) },
                  { key: 'cpso', header: 'Cost / success (evaluated)', align: 'right', nowrap: true, cell: (p) => (p.decision?.selected_plan ? orUnknown(fmt.signedPct(p.decision.selected_plan.deltas_pct.cost_per_successful_outcome ?? null)) : '—') },
                  { key: 'p95', header: 'p95 (evaluated)', align: 'right', nowrap: true, cell: (p) => (p.decision?.selected_plan ? orUnknown(fmt.signedPct(p.decision.selected_plan.deltas_pct.p95 ?? null)) : '—') },
                  { key: 'proj', header: 'Projected / month', align: 'right', nowrap: true, cell: (p) => (p.projected.monthly_cost_change_usd === null ? <Unknown reason={p.projected.unavailable_reason} /> : fmt.usd(p.projected.monthly_cost_change_usd)) },
                  { key: 'real', header: 'Realized', nowrap: true, cell: () => <ClaimBadge claim="NOT_YET_MEASURED" size="xs" /> },
                ]}
              />
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-[13.5px] font-semibold text-ink">How a projection is computed</h2>
            <p className="mt-1 text-[12.5px] text-muted">{cc.value.evaluated[0]?.projected.basis.formula || '(candidate cost − baseline cost) ÷ evaluated cases × observed requests in the last 30 days'}.</p>
            <ul className="mt-2 list-disc pl-5 text-[12.5px] text-muted">
              {(cc.value.evaluated[0]?.projected.basis.assumptions || ['The evaluation set represents production traffic for these call sites.', 'Prices and traffic mix stay as observed.', 'Not a realized saving.']).map((a) => <li key={a}>{a}</li>)}
            </ul>
            <p className="mt-4 flex items-center gap-2 text-[12px] text-subtle"><ZevFace expression="focused" size={22} /> The earlier experiment ledger (single-candidate trials) is still in <Link to="/app/savings" className="font-medium text-accent-text">Savings</Link>.</p>
          </Card>
        </div>
      )}
    </div>
  );
}
