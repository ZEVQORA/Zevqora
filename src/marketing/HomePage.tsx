import { Hero } from "./Hero";
import { PageTitle } from "./Editorial";
import {
  EngineBoundaries,
  EngineChapters,
  EngineEnd,
  EngineManifesto,
  EngineProductStage,
  EngineProof,
  EngineTicker,
  EngineZev,
} from "./EngineSections";
import { PricingGrid } from "./Pricing";
import { SupportZevLauncher } from "./SupportZevLauncher";
import { SITE_URL } from "@/lib/seo";

const DESCRIPTION =
  "Verified AI optimization: understand how an AI system executes, find expensive or unreliable paths, and prove which changes are worth shipping.";

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
      <Hero />
      <EngineTicker />
      <EngineManifesto />
      <EngineChapters />
      <EngineProductStage />
      <EngineProof />
      <EngineBoundaries />
      <EngineZev />
      <section className="engine-home-pricing">
        <PricingGrid />
      </section>
      <EngineEnd />
      <SupportZevLauncher afterHero />
    </>
  );
}
