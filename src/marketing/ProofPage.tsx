import { ArrowRight } from 'lucide-react';
import { PageTitle } from './Editorial';
import { DecisionEvidence } from './DecisionEvidence';
import { useSiteContent } from '@/lib/site';

export default function ProofPage() {
  const { proof } = useSiteContent();
  return <>
    <PageTitle title="The evidence" />
    <header className="atelier-document-intro"><p className="atelier-section-label">Evidence, with its limits</p><h1>Show the work.<br /><span>Keep the context.</span></h1><p>What our internal replay found, what it rejected,<br />and what it does not prove.</p></header>
    <DecisionEvidence />
    <section className="atelier-proof-method"><div><h2>A passed gate<br />isn’t a guarantee.</h2><p>Candidate D met the frozen quality floor. Its cost reduction is a point estimate, with a confidence interval that includes zero.</p><a href="https://github.com/ZEVQORA/Zevqora/tree/main/docs/evidence/candidate-d" target="_blank" rel="noreferrer">Read the evidence pack<ArrowRight size={17} /></a></div>
      <dl><div><dt>Internal replay cases</dt><dd>{proof.cases}</dd></div><div><dt>Frozen quality floor</dt><dd>{proof.verified.quality_floor}</dd></div><div><dt>Candidate D quality</dt><dd>{proof.verified.quality}</dd></div><div><dt>95% confidence interval</dt><dd>{proof.verified.ci95}</dd></div><div><dt>Customer production result</dt><dd>No</dd></div></dl>
    </section>
    <section className="atelier-proof-disclosure"><h2>Real workloads.<br />Honest attribution.</h2><p>The DUREM evaluation is an affiliated design-partner pilot. The founder built the partner system. Its results should be read with that affiliation and its evaluation protocol.</p><a href="https://github.com/ZEVQORA/Zevqora/tree/main/docs/evidence/durem-affiliated-eval-v1" target="_blank" rel="noreferrer">Inspect the evaluation<ArrowRight size={17} /></a></section>
  </>;
}
