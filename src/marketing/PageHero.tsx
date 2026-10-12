import type { ReactNode } from 'react';
import { Reveal } from './Sections';

/** Interior page header: eyebrow, title, introduction, optional actions and art. */
export function PageHero({ eyebrow, title, intro, actions, art }: { eyebrow: string; title: ReactNode; intro?: ReactNode; actions?: ReactNode; art?: ReactNode }) {
  return (
    <section className="hero-env border-b border-line">
      <div className="container-page grid items-center gap-10 py-14 lg:grid-cols-[1.2fr_0.8fr] lg:py-20">
        <Reveal>
          <p className="text-eyebrow uppercase text-accent-text">{eyebrow}</p>
          <h1 className="text-h1 mt-4 max-w-[20ch] text-ink">{title}</h1>
          {intro && <p className="text-body-lg mt-5 max-w-[60ch] text-muted">{intro}</p>}
          {actions && <div className="mt-8 flex flex-wrap gap-3">{actions}</div>}
        </Reveal>
        {art && <div className="hidden justify-center lg:flex">{art}</div>}
      </div>
    </section>
  );
}
