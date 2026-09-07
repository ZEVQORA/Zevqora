import { useEffect } from 'react';
import { Hero } from './Hero';
import { DesignPartnerCta, FinalCta, HowItWorks, ProductSurface, Proof, Section, SecurityTeaser, VerifiedSavings } from './Sections';
import { PricingGrid } from './Pricing';

export default function HomePage() {
  useEffect(() => {
    document.title = 'ZEVQORA — Make AI lighter.';
  }, []);
  return (
    <>
      <Hero />
      <TrustStrip />
      <ProductSurface />
      <HowItWorks />
      <VerifiedSavings />
      <Proof />
      <SecurityTeaser />
      <DesignPartnerCta />
      <Section id="pricing">
        <PricingGrid />
      </Section>
      <FinalCta />
    </>
  );
}

function TrustStrip() {
  const items = [
    ['Measure', 'Real execution, real cost, real latency.'],
    ['Replay', 'The same workload, on the candidate.'],
    ['Verify', 'Named gates. All must pass.'],
    ['Then optimize', 'A reviewable change, approved by a person.'],
  ];
  return (
    <div className="border-b border-line bg-surface/60">
      <div className="container-page grid gap-6 py-8 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(([k, v], i) => (
          <div key={k} className="flex items-start gap-3">
            <span className="font-mono text-technical text-subtle tnum">0{i + 1}</span>
            <div>
              <p className="text-caption font-semibold text-ink">{k}</p>
              <p className="text-technical mt-0.5 text-muted">{v}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
