import { ArrowUpRight } from "lucide-react";
import { Zev } from "@/brand/Zev";
import { useSiteContent } from "@/lib/site";
import { EndCta, Kicker, PageTitle, Rise } from "./Editorial";

const FOUNDERS = [
  {
    name: "Bayarbayasgalan Enkhtulga",
    initials: "BE",
    role: "Co-founder & CEO",
    focus: "PRODUCT / DIRECTION",
    body: "Leads product direction, customer problem definition, company strategy, fundraising and significant parts of the early product build.",
    links: [
      [
        "LinkedIn",
        "https://www.linkedin.com/in/bayarbayasgalan-enkhtulga-2219a13b9/",
      ],
      ["GitHub", "https://github.com/BeBecpp/"],
      ["X", "https://x.com/nero_4040"],
    ],
  },
  {
    name: "Khuslen Ganbat",
    initials: "KG",
    role: "Co-founder & CTO",
    focus: "ENGINEERING / SYSTEMS",
    body: "Owns the long-term engineering direction: core systems, infrastructure, security, reliability, testing and technical architecture review.",
    links: [
      ["LinkedIn", "https://www.linkedin.com/in/khuslen-ganbat-void/"],
      ["GitHub", "https://github.com/FluxKnight"],
      ["X", "https://x.com/v01d_4040"],
    ],
  },
  {
    name: "Bat-Ochir",
    initials: "BO",
    role: "Co-founder & CMO",
    focus: "GO-TO-MARKET / POSITIONING",
    body: "Leads go-to-market: how ZEVQORA is positioned, explained and brought to the AI teams it is built for.",
    links: [] as string[][],
  },
];
export default function TeamPage() {
  const { contact } = useSiteContent();
  return (
    <>
      <PageTitle title="Our team" />
      <section className="z-wrap z-page-intro team-banner">
        <Rise>
          <Kicker>SMALL TEAM. A CLEAR CONVICTION.</Kicker>
          <h1 className="z-display" style={{ marginTop: 28 }}>
            Great AI should
            <br />
            carry <span>less weight.</span>
          </h1>
          <p className="z-lede" style={{ marginTop: 28 }}>
            Three founders, building from Mongolia. ZEVQORA started with a
            constraint we felt directly: when compute is limited, every
            unnecessary call matters.
          </p>
        </Rise>
        <div className="team-mascot">
          <Zev height={260} view="pose-waving" alt="Zev waving hello" />
        </div>
      </section>
      <section className="z-section">
        <div className="z-wrap">
          <Kicker>THE FOUNDERS</Kicker>
          <div className="founder-grid" style={{ marginTop: 32 }}>
            {FOUNDERS.map((f) => (
              <Rise key={f.name} className="founder-card">
                <div className="founder-art" aria-hidden="true">
                  <b>{f.initials}</b>
                  <span>
                    {f.focus}
                    <br />
                    ULAANBAATAR / MONGOLIA
                  </span>
                </div>
                <h2>{f.name}</h2>
                <p className="founder-role">{f.role}</p>
                <p className="z-body">{f.body}</p>
                {f.links.length > 0 && (
                  <div className="founder-links">
                    {f.links.map(([label, href]) => (
                      <a href={href} key={label} target="_blank" rel="noreferrer">
                        {label}
                        <ArrowUpRight size={12} />
                      </a>
                    ))}
                  </div>
                )}
              </Rise>
            ))}
          </div>
        </div>
      </section>
      <section className="z-section proof-section">
        <div className="z-wrap">
          <Kicker>WHY THIS EXISTS</Kicker>
          <h2 className="z-heading" style={{ marginTop: 24 }}>
            Resource pressure.
            <br />
            <span>An engineering answer.</span>
          </h2>
          <div className="feature-rows" style={{ marginTop: 40 }}>
            {[
              [
                "01",
                "We felt the constraint.",
                "Limited budget made model choice, retries, context and failed experiments immediately visible.",
              ],
              [
                "02",
                "We built the loop.",
                "We put measurement, representative replay and quality gates around the decisions that affect AI spend.",
              ],
              [
                "03",
                "We show our own work.",
                "Our internal benchmark rejected the candidate that saved the most. Both the failed and passed results remain visible, with their limitations.",
              ],
            ].map(([n, t, b]) => (
              <div key={n} className="feature-row">
                <span>{n}</span>
                <h3>{t}</h3>
                <p>{b}</p>
              </div>
            ))}
          </div>
          <a
            href={`mailto:${contact.email}`}
            className="z-text-link"
            style={{ marginTop: 20 }}
          >
            Talk to the founders
            <ArrowUpRight size={15} />
          </a>
        </div>
      </section>
      <EndCta />
    </>
  );
}
