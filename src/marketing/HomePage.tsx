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

export default function HomePage() {
  return (
    <>
      <PageTitle title="Make AI lighter." />
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
    </>
  );
}
