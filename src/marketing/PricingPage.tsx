import { useEffect } from 'react';
import { Section } from './Sections';
import { PricingGrid } from './Pricing';
import { usePlans } from '@/lib/site';
import { Table, Th, Td } from '@/components/ui/Misc';
import { useSession } from '@/lib/session';

export default function PricingPage() {
  const { plans } = usePlans();
  const { me } = useSession();
  useEffect(() => {
    document.title = 'Pricing — ZEVQORA';
  }, []);
  const visible = (plans || []).filter((p) => p.visible);
  const rows: Array<{ label: string; key: keyof NonNullable<(typeof visible)[number]['limits']>; fmt: (v: unknown) => string }> = [
    { label: 'Projects', key: 'projects', fmt: (v) => (v === null ? 'Unlimited' : String(v)) },
    { label: 'Zev credit / month', key: 'credits_usd', fmt: (v) => `$${v}` },
    { label: 'Replay samples per experiment', key: 'replay_samples', fmt: (v) => String(v) },
    { label: 'Team seats', key: 'team_members', fmt: (v) => (v === null ? 'Unlimited' : String(v)) },
    { label: 'Telemetry retention', key: 'telemetry_retention_days', fmt: (v) => `${v} days` },
    { label: 'GitHub connection', key: 'github', fmt: (v) => (v ? 'Included' : 'Coming soon') },
    { label: 'PDF report export', key: 'pdf_export', fmt: (v) => (v ? 'Included' : '—') },
  ];
  return (
    <>
      <Section rule={false} className="studio pt-14 lg:pt-20">
        <PricingGrid currentPlanId={me?.account.plan} />
      </Section>
      <Section surface="sunken">
        <div className="container-page">
          <p className="text-eyebrow uppercase text-muted">Plan limits</p>
          <h2 className="text-h2 mt-4 text-ink">Enforced on the server, visible up front.</h2>
          <p className="text-body mt-3 max-w-[56ch] text-muted">Limits are configuration, not marketing. The same table drives the app, the API and this page.</p>
          <div className="mt-8 rounded-xl border border-line bg-surface p-5">
            <Table minWidth={560}>
              <thead>
                <tr>
                  <Th>Limit</Th>
                  {visible.map((p) => (
                    <Th key={p.id} align="right">
                      {p.name}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <Td>{r.label}</Td>
                    {visible.map((p) => (
                      <Td key={p.id} align="right" mono>
                        {r.fmt(p.limits?.[r.key] ?? null)}
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </div>
      </Section>
      <Section>
        <div className="container-page grid gap-10 lg:grid-cols-3">
          {[
            ['What is Zev credit?', 'Zev credit pays for provider cost when ZEVQORA replays your samples on candidate models. Analysis, telemetry and reports do not consume credit. Credit is accounted server-side; you cannot be charged twice for a retried run.'],
            ['Do I need my own provider key?', 'No. Replays run on the ZEVQORA platform credential, which never leaves the server. Your runtime keeps using your own keys; ZEVQORA only receives call metadata.'],
            ['What happens when I exceed a limit?', 'The server declines the protected operation and the app explains which limit applied and what plan lifts it. Nothing is silently dropped.'],
          ].map(([q, a]) => (
            <div key={q}>
              <h3 className="text-h4 text-ink">{q}</h3>
              <p className="text-caption mt-2 text-muted">{a}</p>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
