import { PremiumCta } from "./v2/PremiumCta";

/** The closing call to action on every inner page (same component as the homepage close). */
export function EngineEnd() {
  return (
    <PremiumCta
      kicker="Your next lighter step"
      title="Go build something lighter."
      body="Start with one workload. See what your AI could stop carrying — and keep the evidence for every decision."
      primary={{ label: "Let’s get lighter", to: "/signup" }}
      secondary={{ label: "Take a look inside", to: "/product" }}
      fine=""
    />
  );
}
