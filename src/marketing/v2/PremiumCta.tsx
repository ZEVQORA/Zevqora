import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { DimensionalZ } from '@/brand/DimensionalZ';
import { useSession } from '@/lib/session';
import { Magnetic, Reveal } from './motion';

/** The closing call to action, shared by the homepage and every inner page. */
export function PremiumCta({
  kicker = 'A lighter way, with proof',
  title = 'One workload is enough to start learning.',
  body = 'Define the scope. Agree on the quality gates. Review the evidence before deciding what should change.',
  primary = { label: 'Start optimizing', to: '/signup' },
  secondary = { label: 'Explore an evaluation', to: '/evaluation' },
  fine = 'No customer savings, production deployment or integration is implied without verified evidence.',
}: {
  kicker?: string;
  title?: string;
  body?: string;
  primary?: { label: string; to: string };
  secondary?: { label: string; to: string };
  fine?: string;
}) {
  const { status } = useSession();
  const to = primary.to === '/signup' && status === 'signed_in' ? '/app' : primary.to;
  return (
    <section className="zv-close" aria-labelledby="zv-close-title">
      <div className="zv-wrap">
        <div className="zv-close-card">
          <div className="zv-close-sky" aria-hidden>
            <span className="zv-close-beam" />
            <span className="zv-grid is-ink" />
          </div>
          <Reveal className="zv-close-copy">
            <p className="zv-kicker is-light">{kicker}</p>
            <h2 id="zv-close-title" className="zv-h2 is-xl">{title}</h2>
            <p className="zv-sub">{body}</p>
            <div className="zv-hero-ctas">
              <Magnetic>
                <Link to={to} className="zv-btn is-white is-lg" data-cta="close-start">
                  {primary.label} <ArrowRight size={18} className="zv-arrow" aria-hidden />
                </Link>
              </Magnetic>
              <Link to={secondary.to} className="zv-btn is-glass is-lg">{secondary.label}</Link>
            </div>
            {fine && <p className="zv-fine">{fine}</p>}
          </Reveal>
          <div className="zv-close-mark" aria-hidden>
            <DimensionalZ size={240} />
          </div>
        </div>
      </div>
    </section>
  );
}
