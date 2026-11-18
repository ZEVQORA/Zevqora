import { PageTitle } from "./Editorial";
import { AskZevV2, BoundariesV2, CloseV2, EvidenceV2, HeroV2, LoopV2 } from "./v2/HomeV2";
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
 * The homepage (Zev Light, 2026-11): one calm journey led by Zev.
 *   1. Hero — what ZEVQORA is, with Zev and the verdict vocabulary.
 *   2. Ask Zev — the only Ask Zev instance on the page.
 *   3. The loop — observe, challenge, verify, review (tabs; stacked cards on phones).
 *   4. The evidence — an honest REJECTED decision from an internal benchmark.
 *   5. Boundaries and who it is for.
 *   6. One closing call to action.
 * Pricing lives only on /pricing (the menu link), not on the homepage.
 */
export default function HomePage() {
  return (
    <div className="zv-home">
      <PageTitle title="Make AI lighter." description={DESCRIPTION} jsonLd={JSON_LD} />
      <HeroV2 />
      <AskZevV2 />
      <LoopV2 />
      <EvidenceV2 />
      <BoundariesV2 />
      <CloseV2 />
    </div>
  );
}
