import { Hero } from "./Hero";
import { PageTitle } from "./Editorial";
import {
  EngineBoundaries,
  EngineEnd,
  EngineProductStage,
  EngineProof,
} from "./EngineSections";
import {
  ClarityAudience,
  ClarityClose,
  ClarityFlow,
  ClarityIntro,
} from "./PremiumNarrative";
import { PricingGrid } from "./Pricing";
import { AskZev } from "./askzev/AskZev";
import { SITE_URL } from "@/lib/seo";

const DESCRIPTION =
  "ZEVQORA tests AI cost and performance optimizations against quality requirements. Observe a workload, replay candidate changes, examine the evidence, and keep the human in control.";

const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", name: "ZEVQORA", url: SITE_URL, logo: `${SITE_URL}/favicon.png`, slogan: "Make AI lighter." },
    { "@type": "SoftwareApplication", name: "ZEVQORA", applicationCategory: "DeveloperApplication", operatingSystem: "Web, Windows", url: SITE_URL, description: DESCRIPTION },
  ],
};

export default function HomePage() {
  return (
    <>
      <PageTitle title="Make AI lighter." description={DESCRIPTION} jsonLd={JSON_LD} />
      {/* Retain the single Ask Zev instance as it moves from the hero into the dock. */}
      <Hero composer={<AskZev />} />

      {/* Lead with customer clarity instead of a repeating ticker and abstract manifesto. */}
      <ClarityIntro />
      <ClarityFlow />

      {/* Existing functional product preview and evidence remain intact. */}
      <EngineProductStage />
      <EngineProof />

      <ClarityAudience />
      <EngineBoundaries />

      <section className="engine-home-pricing">
        <PricingGrid />
      </section>

      <ClarityClose />
      <EngineEnd />
    </>
  );
}
