import { Hero } from "./Hero";
import { AskZevStage } from "./AskZevStage";
import { WorkbenchStage, ZevirMap } from "./HomeStory";
import { PageTitle } from "./Editorial";
import { EngineBoundaries, EngineProof } from "./EngineSections";
import { ClarityAudience, ClarityClose } from "./PremiumNarrative";
import { PricingGrid } from "./Pricing";
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

/**
 * The homepage as one journey, each section with a single job:
 *   1. Hero — what ZEVQORA is (film + dimensional Z, no chat).
 *   2. Ask Zev — a calm place to ask; the only Ask Zev instance on the page.
 *   3. The work — the problem and the loop, driving the real product preview.
 *   4. The evidence — an honest REJECTED decision from an internal benchmark.
 *   5. Under the hood — ZevIR in plain language.
 *   6. Boundaries — security and human review.
 *   7. Who it is for, pricing, and one closing call to action.
 */
export default function HomePage() {
  return (
    <>
      <PageTitle title="Make AI lighter." description={DESCRIPTION} jsonLd={JSON_LD} />
      <Hero />
      <AskZevStage />
      <WorkbenchStage />
      <EngineProof />
      <ZevirMap />
      <EngineBoundaries />
      <ClarityAudience />
      <section className="engine-home-pricing">
        <PricingGrid />
      </section>
      <ClarityClose />
    </>
  );
}
