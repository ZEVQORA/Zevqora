import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";
import { Zev } from "@/brand/Zev";
import { useSiteContent } from "@/lib/site";
import { EndCta, Kicker, PageTitle, Rise } from "./Editorial";

export default function CompanyPage() {
  const { company_page: page, contact } = useSiteContent();
  return (
    <>
      <PageTitle
        title="Company"
        description={page.intro || "ZEVQORA builds the engineer that tells AI teams which optimization is worth shipping."}
      />
      {/* Same banner composition as the Team page. */}
      <section className="z-wrap z-page-intro team-banner">
        <Rise>
          <Kicker>BEHIND ZEVQORA</Kicker>
          <h1 className="z-display" style={{ marginTop: 28 }}>{page.title}</h1>
          <p className="z-lede" style={{ marginTop: 28 }}>{page.intro}</p>
        </Rise>
        <div className="team-mascot">
          <Zev height={240} view="three-quarter-front" alt="Zev, the ZEVQORA mascot" />
        </div>
      </section>
      <section className="z-section proof-section">
        <div className="z-wrap">
          <div className="z-section-head">
            <div>
              <Kicker>THE MISSION</Kicker>
              <h2 className="z-heading">{page.mission}</h2>
            </div>
            <p>Calm interfaces, clear impact, and evidence for every claim.</p>
          </div>
          <div className="feature-rows">
            {page.principles.map((p, i) => (
              <Rise key={p.title} className="feature-row">
                <span>{String(i + 1).padStart(2, "0")}</span>
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </Rise>
            ))}
          </div>
          <div className="z-actions" style={{ marginTop: 32 }}>
            <Link className="z-button z-button-ink" to="/team">
              Meet the founders
              <ArrowUpRight size={15} />
            </Link>
            <a className="z-text-link" href={`mailto:${contact.email}`}>
              {contact.email}
              <ArrowUpRight size={15} />
            </a>
          </div>
        </div>
      </section>
      <EndCta />
    </>
  );
}
