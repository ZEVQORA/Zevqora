import { useEffect } from 'react';
import { Section, Reveal } from './Sections';
import { Zev } from '@/brand/Zev';
import { useSiteContent } from '@/lib/site';

const FOUNDERS = [
  {
    name: 'Bayarbayasgalan Enkhtulga',
    role: 'Co-founder & CEO',
    focus: 'Product · company direction · early technical foundation',
    body: 'Leads product direction, customer problem definition, company strategy, fundraising and significant parts of the early product build.',
    links: [
      ['LinkedIn', 'https://www.linkedin.com/in/bayarbayasgalan-enkhtulga-2219a13b9/'],
      ['GitHub', 'https://github.com/BeBecpp/'],
      ['X', 'https://x.com/nero_4040'],
    ],
  },
  {
    name: 'Khuslen Ganbat',
    role: 'Co-founder & CTO',
    focus: 'Engineering · infrastructure · security · technical execution',
    body: 'Owns the long-term engineering direction: core systems, infrastructure, security, reliability, testing and technical architecture review.',
    links: [
      ['LinkedIn', 'https://www.linkedin.com/in/khuslen-ganbat-void/'],
      ['GitHub', 'https://github.com/FluxKnight'],
      ['X', 'https://x.com/v01d_4040'],
    ],
  },
];

export default function TeamPage() {
  const { contact } = useSiteContent();
  useEffect(() => {
    document.title = 'Team — ZEVQORA';
  }, []);
  return (
    <>
      <Section rule={false} className="studio pt-14 lg:pt-20">
        <div className="container-page grid items-end gap-10 lg:grid-cols-[1.4fr_auto]">
          <Reveal>
            <p className="text-eyebrow uppercase text-muted">Founders</p>
            <h1 className="text-display mt-5 max-w-[14ch] text-ink">Two technical founders building from Mongolia.</h1>
            <p className="text-body-lg mt-6 max-w-[54ch] text-muted">ZEVQORA is built by Bayarbayasgalan Enkhtulga and Khuslen Ganbat. The product started from a constraint they felt directly: when compute is limited, every unnecessary model call matters.</p>
          </Reveal>
          <Zev view="three-quarter-front" height={220} className="hidden lg:block" />
        </div>
      </Section>
      <Section surface="sunken">
        <div className="container-page grid gap-6 lg:grid-cols-2">
          {FOUNDERS.map((f) => (
            <Reveal key={f.name}>
              <div className="h-full rounded-xl border border-line bg-surface p-7">
                <p className="text-eyebrow uppercase text-muted">{f.role}</p>
                <h2 className="text-h3 mt-3 text-ink">{f.name}</h2>
                <p className="text-technical mt-2 font-mono text-subtle">{f.focus}</p>
                <p className="text-caption mt-4 text-muted">{f.body}</p>
                <div className="mt-5 flex gap-4">
                  {f.links.map(([label, href]) => (
                    <a key={label} href={href} target="_blank" rel="noreferrer" className="text-caption text-ink underline-offset-4 hover:underline">
                      {label}
                    </a>
                  ))}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>
      <Section>
        <div className="container-page">
          <p className="text-eyebrow uppercase text-muted">Why we built it</p>
          <h2 className="text-h2 mt-4 max-w-[20ch] text-ink">Resource pressure turned into a product thesis.</h2>
          <div className="mt-10 grid gap-8 lg:grid-cols-3">
            {[
              ['01', 'We felt the pain', 'Limited budget made model choice, retries, context and failed experiments immediately visible to us.'],
              ['02', 'We built the tool', 'Instead of accepting the bill, we built an engineering loop around evidence, experiments and verification.'],
              ['03', 'We dogfood it', 'ZEVQORA runs on its own workflow. Our internal benchmark rejected the candidate that saved the most and verified the one that held quality. Both results are published with their qualifiers.'],
            ].map(([n, t, b]) => (
              <div key={n}>
                <span className="font-mono text-technical text-subtle">{n}</span>
                <h3 className="text-h4 mt-2 text-ink">{t}</h3>
                <p className="text-caption mt-2 text-muted">{b}</p>
              </div>
            ))}
          </div>
          <p className="text-caption mt-10 text-muted">
            Contact the founders at <a href={`mailto:${contact.email}`} className="text-ink underline underline-offset-4">{contact.email}</a>.
          </p>
        </div>
      </Section>
    </>
  );
}
