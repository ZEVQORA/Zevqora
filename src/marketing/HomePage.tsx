import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowDown, ArrowRight, Pause, Play } from 'lucide-react';
import { motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { WeightlessEngine } from '@/brand/WeightlessEngine';
import { useSession } from '@/lib/session';
import { SITE_URL } from '@/lib/seo';
import { PageTitle } from './Editorial';
import { DecisionEvidence } from './DecisionEvidence';
import { ControlSection, HomeClosing, WorkflowShowcase } from './HomeExperience';

const DESCRIPTION = 'Find wasted AI spend, replay a better approach and verify quality before you ship.';
const JSON_LD = { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'ZEVQORA', applicationCategory: 'DeveloperApplication', operatingSystem: 'Web, Windows', url: SITE_URL, description: DESCRIPTION };

export default function HomePage() {
  const { status } = useSession();
  const section = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const [phase, setPhase] = useState(0);
  const phaseRef = useRef(0);
  const { scrollYProgress } = useScroll({ target: section, offset: ['start start', 'end end'] });
  const heroY = useTransform(scrollYProgress, [0, .29], [0, -75]);
  const findY = useTransform(scrollYProgress, [.22, .38, .71], [60, 0, -55]);
  const keepY = useTransform(scrollYProgress, [.64, .83], [55, 0]);
  useMotionValueEvent(scrollYProgress, 'change', (value) => {
    const next = value < .18 ? 0 : value < .35 ? 3 : value < .58 ? 1 : value < .83 ? 3 : 2;
    if (phaseRef.current !== next) { phaseRef.current = next; setPhase(next); }
  });
  const target = status === 'signed_in' ? '/app' : '/signup';
  return <>
    <PageTitle title="Make AI lighter." description={DESCRIPTION} jsonLd={JSON_LD} />
    <section className="atelier-cinema" ref={section} aria-label="A lighter way to run AI">
      <div className="atelier-screen" data-phase={reduced ? 'static' : phase}>
        <WeightlessEngine progress={scrollYProgress} paused={paused} />
        <div className="atelier-screen-shade" />
        <motion.div className="atelier-hero-copy" style={reduced ? undefined : { y: heroY }} aria-hidden={!reduced && phase !== 0} inert={!reduced && phase !== 0}>
          <p className="atelier-intro">AI optimization. With evidence.</p>
          <h1>Less spend.<br /><span>More possibility.</span></h1>
          <p className="atelier-hero-description">Find wasted AI spend. Test a better way.<br />Keep the quality.</p>
          <Link className="atelier-button atelier-button-light" to={target} data-cta="hero-get-started">{status === 'signed_in' ? 'Open workspace' : 'Start optimizing'}<ArrowRight size={18} /></Link>
        </motion.div>
        <motion.div className="atelier-story-copy atelier-story-find" style={reduced ? undefined : { y: findY }} aria-hidden={!reduced && phase !== 1}>
          <h2>Find<br />the weight.</h2>
          <p>See which calls, retries and context<br className="desktop-break" /> make your workload expensive.</p>
        </motion.div>
        <motion.div className="atelier-story-copy atelier-story-keep" style={reduced ? undefined : { y: keepY }} aria-hidden={!reduced && phase !== 2}>
          <h2>Keep<br />what matters.</h2>
          <p>Replay the alternative. Verify the quality.<br />You decide what ships.</p>
        </motion.div>
        <div className="atelier-film-controls">
          {!reduced && <button type="button" onClick={() => setPaused(value => !value)} aria-label={paused ? 'Play visual motion' : 'Pause visual motion'} aria-pressed={paused}>{paused ? <Play size={14} /> : <Pause size={14} />}<span>{paused ? 'Play' : 'Pause'}</span></button>}
          <a href="#workflow" aria-label="Explore the workflow"><ArrowDown size={20} /></a>
        </div>
      </div>
    </section>
    <WorkflowShowcase />
    <DecisionEvidence />
    <ControlSection />
    <HomeClosing target={target} signedIn={status === 'signed_in'} />
  </>;
}
