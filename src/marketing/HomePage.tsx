import { useEffect } from 'react';
import { Hero } from './Hero';
import { DesignPartnerCta, HowItWorks, Problem, Proof, SecurityTeaser, Surfaces } from './Sections';

export default function HomePage() {
  useEffect(() => {
    document.title = 'ZEVQORA — Make AI cheaper without guessing.';
  }, []);
  return (
    <>
      <Hero />
      <Problem />
      <HowItWorks />
      <Proof />
      <Surfaces />
      <SecurityTeaser />
      <DesignPartnerCta />
    </>
  );
}
