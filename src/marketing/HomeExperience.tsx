import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Check, GitBranch, LockKeyhole } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { ZevqoraMark } from '@/brand/ZevqoraMark';
import { openZevSupport } from './SupportZevLauncher';

const STAGES = [
  { name: 'Observe', title: 'The whole execution.\nIn full view.', body: 'Follow the calls, context and retries behind a workload. Find the expensive path before deciding what to change.', label: 'Execution view', detail: 'Find the opportunity', note: 'Repeated context is worth investigating. A finding is a starting point, not a savings claim.' },
  { name: 'Replay', title: 'A better route.\nA fair comparison.', body: 'Test a candidate against the same representative work. Keep the baseline, inputs and replay budget together.', label: 'Candidate replay', detail: 'Change one thing', note: 'Compare the original route with a candidate that reuses context. Measure the difference before making a decision.' },
  { name: 'Verify', title: 'A lower bill.\nThe same standard.', body: 'Check cost and latency against a quality floor set before the run. Keep the result and its evidence attached to the change.', label: 'Evaluation gates', detail: 'Let the evidence decide', note: 'Passing a quality gate earns a review. Missing it keeps the candidate from becoming a verified recommendation.' },
] as const;

function RouteLane({ candidate = false, highlighted = false }: { candidate?: boolean; highlighted?: boolean }) {
  return <div className={`atelier-route-lane ${candidate ? 'is-candidate' : ''}`}>
    <p>{candidate ? 'Candidate' : 'Baseline'}</p>
    <div className="atelier-route-nodes">
      <div><span>Input</span><strong>Request</strong></div><i aria-hidden="true" />
      <div className={highlighted ? 'is-focus' : ''}><span>{candidate ? 'Reuse' : 'Retrieve'}</span><strong>Context</strong></div><i aria-hidden="true" />
      <div><span>Generate</span><strong>Response</strong></div>
    </div>
  </div>;
}

export function WorkflowShowcase() {
  const [active, setActive] = useState(0);
  const reduced = useReducedMotion();
  const stage = STAGES[active];
  return <section className="atelier-workflow" id="workflow" aria-labelledby="workflow-title">
    <header className="atelier-workflow-heading">
      <p className="atelier-section-label">Inside ZEVQORA</p>
      <h2 id="workflow-title">A clearer picture.<br /><span>A lighter system.</span></h2>
      <p>From the first finding to the final decision.<br />One connected workflow.</p>
    </header>
    <div className="atelier-workflow-selector" role="group" aria-label="Explore the optimization workflow">
      {STAGES.map((item, index) => <button key={item.name} type="button" aria-pressed={active === index} aria-controls="workflow-demo" onClick={() => setActive(index)}>{item.name}</button>)}
    </div>
    <div className="atelier-workflow-demo" id="workflow-demo">
      <div className="atelier-demo-toolbar"><span><ZevqoraMark height={23} />{stage.label}</span><span>Illustrative workflow</span></div>
      <motion.div className="atelier-demo-content" key={active} initial={reduced ? false : { opacity: .4, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .3 }}>
        <div className="atelier-demo-visual" data-stage={active}>
          <div className="atelier-demo-project"><GitBranch size={17} /><span>Support workload</span></div>
          {active < 2 ? <><RouteLane highlighted={active === 0} />{active === 1 ? <RouteLane candidate highlighted /> : <div className="atelier-context-note"><span aria-hidden="true" /><p>Context travels with every call.<br /><strong>See where it repeats.</strong></p></div>}</> : <div className="atelier-gate-sheet">
            <p>Candidate evaluation</p><h3>Every condition.<br />Considered.</h3>
            <dl><div><dt>Cost</dt><dd>Against the baseline</dd></div><div><dt>Latency</dt><dd>On the same inputs</dd></div><div><dt>Quality</dt><dd>Against a fixed floor</dd></div></dl>
            <span>Evidence stays with the decision.</span>
          </div>}
        </div>
        <div className="atelier-demo-inspector"><span>{stage.detail}</span><h3>{stage.title.split('\n').map((line, index) => <span key={line}>{index > 0 && <br />}{line}</span>)}</h3><p>{stage.body}</p><p className="atelier-demo-note">{stage.note}</p></div>
      </motion.div>
    </div>
    <Link to="/product" className="atelier-workflow-link">Explore the workspace<ArrowRight size={17} /></Link>
  </section>;
}

export function ControlSection() {
  return <section className="atelier-control" aria-labelledby="control-title">
    <header><p className="atelier-section-label">Built around your boundaries</p><h2 id="control-title">Start small.<br /><span>Stay in control.</span></h2><p>Your project. Your quality standard.<br />Your decision to ship.</p></header>
    <div className="atelier-control-panels">
      <article className="atelier-scope-panel"><div className="atelier-scope-art" aria-hidden="true"><div><GitBranch size={24} /><span>One project</span></div><div><LockKeyhole size={23} /><span>Scoped access</span></div><div><Check size={24} /><span>Your permission</span></div></div><div><h3>Connect what matters.</h3><p>Start with a repository, runtime metadata or an exported trace. Choose the evidence you share and keep access revocable.</p><Link to="/security">See the data boundaries<ArrowRight size={16} /></Link></div></article>
      <article className="atelier-review-panel"><div className="atelier-review-art" aria-hidden="true"><div className="atelier-review-document"><ZevqoraMark height={25} /><span>Proposed change</span><p>Baseline<br /><b>Candidate</b><br />Evaluation evidence</p></div><div className="atelier-review-stamp"><Check size={17} />Human review</div></div><div><h3>You make the final call.</h3><p>Inspect the proposed change beside its replay results. A verified recommendation is ready for your review. Your team decides what ships.</p><Link to="/how-it-works">Follow the method<ArrowRight size={16} /></Link></div></article>
    </div>
  </section>;
}

export function HomeClosing({ target, signedIn }: { target: string; signedIn: boolean }) {
  return <>
    <section className="atelier-zev-feature" aria-labelledby="zev-feature-title">
      <div className="atelier-zev-feature-copy"><ZevqoraMark height={51} /><p className="atelier-section-label">Meet Zev</p><h2 id="zev-feature-title">A little guidance.<br /><span>A clearer next step.</span></h2><p>Get help choosing your first workload, understanding a finding or reading the evidence. Keep the conversation close to the work.</p><button type="button" className="atelier-text-button" onClick={openZevSupport}>Talk to Zev<ArrowRight size={18} /></button></div>
      <div className="atelier-zev-example" aria-label="Example of Zev setup guidance"><p className="atelier-zev-question">Where should I start?</p><div className="atelier-zev-answer"><ZevqoraMark height={23} /><div><span>Zev · Example guidance</span><p>Start with one workload<br />you know well.</p><p>Bring a representative trace. Set the quality you need to keep. Then test a single, focused change.</p></div></div><div className="atelier-zev-topics"><span>Setup</span><span>Your stack</span><span>The evidence</span></div></div>
    </section>
    <section className="atelier-start" aria-labelledby="atelier-start-title"><p className="atelier-section-label">Your next move</p><h2 id="atelier-start-title">Make room<br /><span>for what’s next.</span></h2><p>Start with one workload.<br />Build a clearer case for a better way.</p><Link to={target} className="atelier-button atelier-button-light">{signedIn ? 'Open workspace' : 'Get started'}<ArrowRight size={18} /></Link><div className="atelier-start-details"><div><h3>Bring your work.</h3><p>A repository or representative trace.</p></div><div><h3>Set your standard.</h3><p>The quality floor you need to keep.</p></div><div><h3>Take a measured step.</h3><p>A candidate. A replay. A decision.</p></div></div></section>
  </>;
}
