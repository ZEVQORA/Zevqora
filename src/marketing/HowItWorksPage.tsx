import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { PageTitle } from './Editorial';

export default function HowItWorksPage() {
  return <>
    <PageTitle title="How it works" />
    <header className="atelier-document-intro"><p className="atelier-section-label">How it works</p><h1>From spend<br /><span>to a sound decision.</span></h1><p>One workload. A measured baseline.<br />A better alternative, tested before it ships.</p></header>
    <section className="atelier-method" aria-label="The optimization workflow">
      {[
        ['Connect one workload.', 'Bring a repository, runtime metadata or representative traces. ZEVQORA maps the calls, context and retries behind your AI spend. Access stays scoped and revocable.'],
        ['Test a lighter route.', 'Turn a finding into a candidate. Replay the same representative work with a bounded budget, then compare cost, latency and quality against the baseline.'],
        ['Keep the evidence.', 'Frozen evaluation gates decide whether a candidate passes, fails or needs more evidence. Review the change and its results together. Your team decides what ships.'],
      ].map(([title, body]) => <article key={title}><h2>{title}</h2><p>{body}</p></article>)}
    </section>
    <section className="atelier-method-ready"><h2>A fair test starts<br />with the right inputs.</h2><div><p>Representative traces from the work you actually run. A quality floor agreed before replay. A clear budget and a human reviewer.</p><p>Static findings are opportunities. Passing evaluation gates earns verification. Neither is a promise of production savings.</p><Link to="/signup" className="atelier-button atelier-button-dark">Start optimizing<ArrowRight size={18} /></Link></div></section>
  </>;
}
