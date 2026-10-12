import { ArrowRight, Mail } from 'lucide-react';
import { Link } from 'react-router';
import { ButtonLink } from '@/components/ui/Button';
import { useSiteContent } from '@/lib/site';
import { useSeo } from '@/lib/seo';
import { Zev, ZevFace } from '@/brand/Zev';
import { Section, Reveal } from './Sections';
import { PageHero } from './PageHero';

export default function CompanyPage() {
  const { company_page: page, contact, hero } = useSiteContent();
  useSeo({ title: 'Company — ZEVQORA', description: page.intro || 'ZEVQORA builds the engineer that tells AI teams which optimization is worth shipping.', path: '/company' });
  return (
    <>
      <PageHero eyebrow="Company" title={page.title} intro={page.intro} art={<Zev view="three-quarter-front" height={220} alt="Zev, the ZEVQORA mascot" />} />
      <Section rule={false}>
        <div className="container-page grid gap-10 lg:grid-cols-[1fr_1fr]">
          <Reveal>
            <p className="text-eyebrow uppercase text-accent-text">Mission</p>
            <p className="mt-4 text-[1.6rem] font-semibold leading-snug tracking-[-0.02em] text-ink">{page.mission}</p>
            <p className="mt-4 text-[14.5px] text-muted">Make AI <span className="font-semibold text-brand">lighter.</span> Calm interfaces, clear impact, and evidence for every claim.</p>
          </Reveal>
          <ul className="grid gap-3 sm:grid-cols-2">
            {page.principles.map((p) => (
              <li key={p.title} className="rounded-[18px] border border-line bg-surface p-5">
                <h2 className="text-[15px] font-semibold text-ink">{p.title}</h2>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{p.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </Section>
      <Section surface="sunken">
        <div className="container-page grid items-center gap-8 md:grid-cols-[auto_1fr_auto]">
          <ZevFace expression="warm-smile" size={72} />
          <div>
            <h2 className="text-h3 text-ink">Zev is part of the team.</h2>
            <p className="mt-2 max-w-[60ch] text-[14.5px] text-muted">Calm, curious and careful with evidence — the friendly face of a product whose job is to say no to unsafe savings.</p>
          </div>
          <Link to="/team" className="inline-flex items-center gap-1.5 text-[14px] font-medium text-accent-text">Meet the founders <ArrowRight size={14} aria-hidden /></Link>
        </div>
      </Section>
      <Section>
        <div className="container-page flex flex-wrap items-center justify-between gap-6">
          <div>
            <h2 className="text-h3 text-ink">Talk to us</h2>
            <p className="mt-2 text-[14.5px] text-muted">Design partners, investors and AI teams: <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1 font-medium text-accent-text"><Mail size={14} aria-hidden /> {contact.email}</a></p>
          </div>
          <ButtonLink to="/evaluation" size="lg" data-cta="company.evaluate">{hero.primary_cta.label}</ButtonLink>
        </div>
      </Section>
    </>
  );
}
