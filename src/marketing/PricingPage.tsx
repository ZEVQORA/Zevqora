import { useEffect } from 'react';
import { Section } from './Sections';
import { PricingGrid } from './Pricing';
import { usePlans } from '@/lib/site';
import { Table, Th, Td } from '@/components/ui/Misc';
import { useSession } from '@/lib/session';
import { ButtonLink } from '@/components/ui/Button';

export default function PricingPage() {
  const { plans } = usePlans();
  const { me } = useSession();
  useEffect(() => {
    document.title = 'Pricing — ZEVQORA';
  }, []);
  const visible = (plans || []).filter((p) => p.visible);
  // Only limits the server enforces on the current product path are listed here.
  const rows: Array<{ label: string; key: keyof NonNullable<(typeof visible)[number]['limits']>; fmt: (v: unknown) => string }> = [
    { label: 'Zev credit / month', key: 'credits_usd', fmt: (v) => (v === null ? '—' : `$${v}`) },
    { label: 'Team seats', key: 'team_members', fmt: (v) => (v === null ? 'Unlimited' : String(v)) },
  ];
  return (
    <>
      <Section rule={false} className="studio pt-14 lg:pt-20">
        <div className="container-page mb-14">
          <div className="grid gap-6 rounded-xl border border-accent/25 bg-accent-subtle/60 p-6 lg:grid-cols-[1fr_auto] lg:items-center lg:p-8">
            <div>
              <p className="text-eyebrow uppercase text-accent-text">Start with an evaluation</p>
              <h1 className="text-h2 mt-3 max-w-[28ch] text-ink">Most teams begin with one bounded evaluation of one workload.</h1>
              <p className="text-body mt-3 max-w-[60ch] text-muted">We agree the data boundary and success criteria, establish the baseline, test candidates and hand over the evidence report. Evaluation terms are agreed per engagement while we validate pricing; the plans below are for self-serve use.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <ButtonLink to="/#design-partners" size="lg">Apply for an evaluation</ButtonLink>
              <ButtonLink to="/signup?intent=evaluation" size="lg" variant="secondary">Run one yourself</ButtonLink>
            </div>
          </div>
        </div>
        <PricingGrid currentPlanId={me?.account.plan} />
      </Section>
      <Section surface="sunken">
        <div className="container-page">
          <p className="text-eyebrow uppercase text-muted">Plan limits</p>
          <h2 className="text-h2 mt-4 text-ink">Enforced on the server, visible up front.</h2>
          <p className="text-body mt-3 max-w-[56ch] text-muted">Only limits the server enforces today are listed. The same plan data drives the app, the API and this page.</p>
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
            ['What is Zev credit?', 'Zev credit pays for provider cost when ZEVQORA replays your cases on candidate models. Analysis, imports and reports do not consume credit. Credit is accounted server-side; you cannot be charged twice for a retried run.'],
            ['Do I need my own provider key?', 'No. Replays run on the ZEVQORA platform credential, which never leaves the server. Your runtime keeps using your own keys; ZEVQORA sees only the evidence you connect: call locations from a scan and the traces you import.'],
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
