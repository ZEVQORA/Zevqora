import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowDown, ArrowRight, Pause, Play } from 'lucide-react';
import { motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { WeightlessEngine } from '@/brand/WeightlessEngine';
import { useSession } from '@/lib/session';
import { SITE_URL } from '@/lib/seo';
import { PageTitle } from './Editorial';
import { DecisionEvidence } from './DecisionEvidence';
import { openZevSupport } from './SupportZevLauncher';

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
    const next = value < .24 ? 0 : value < .56 ? 1 : value < .82 ? 3 : 2;
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
          <a href="#evidence" aria-label="Explore the evidence"><ArrowDown size={20} /></a>
        </div>
      </div>
    </section>
    <DecisionEvidence />
    <section className="atelier-next" aria-labelledby="atelier-next-title">
      <div className="atelier-next-main">
        <h2 id="atelier-next-title">Make room<br />for more.</h2>
        <p>Start with one workload. See what it could do better.</p>
        <Link to={target} className="atelier-button atelier-button-dark">{status === 'signed_in' ? 'Open workspace' : 'Get started'}<ArrowRight size={18} /></Link>
      </div>
      <div className="atelier-zev-intro">
        <button type="button" className="atelier-zev-portrait" onClick={openZevSupport} aria-label="Meet Zev"><span className="zev-lens"><i /></span></button>
        <h3>A clearer next step.<br />Meet Zev.</h3>
        <p>Help with setup, your stack, and the evidence.</p>
        <button type="button" className="atelier-text-button" onClick={openZevSupport}>Ask Zev<ArrowRight size={17} /></button>
      </div>
    </section>
  </>;
}
