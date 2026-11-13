import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { useSiteContent } from '@/lib/site';

/** Both decisions remain visible. Passing a benchmark is not a production savings claim. */
export function DecisionEvidence() {
  const { proof } = useSiteContent();
  return <section className="atelier-evidence" id="evidence" aria-labelledby="evidence-title">
    <div className="atelier-evidence-heading">
      <div><h2 id="evidence-title">Cheaper is easy.<br /><span>Better is the point.</span></h2></div>
      <p>Every candidate faces the same quality floor.<br />A lower bill alone doesn’t earn a pass.</p>
    </div>
    <div className="atelier-verdicts" aria-label="Internal benchmark comparison">
      <article className="atelier-verdict is-rejected">
        <p className="atelier-verdict-name">Rejected candidate</p>
        <p className="atelier-verdict-number">{proof.rejected.cost_reduction}<span>less inference cost</span></p>
        <div className="atelier-verdict-detail"><strong>Cheaper. Still rejected.</strong><p>Quality {proof.rejected.quality} missed the {proof.rejected.quality_floor} floor.</p></div>
      </article>
      <article className="atelier-verdict is-passed">
        <p className="atelier-verdict-name">Candidate D</p>
        <p className="atelier-verdict-number">{proof.verified.cost_reduction}<span>less inference cost</span></p>
        <div className="atelier-verdict-detail"><strong>Quality passed.</strong><p>Quality {proof.verified.quality} cleared the {proof.verified.quality_floor} floor.</p></div>
      </article>
    </div>
    <div className="atelier-evidence-note"><p>{proof.cases} internal replay cases. Candidate D is a point estimate; its 95% confidence interval crosses zero. These are not customer results.</p><Link to="/proof">Inspect the evidence<ArrowRight size={17} /></Link></div>
  </section>;
}
