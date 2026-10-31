import { usePlans } from "@/lib/site";
import { useSession } from "@/lib/session";
import { FAQ, Kicker, PageTitle } from "./Editorial";
import { ArrowUpRight } from "lucide-react";
import { useSiteContent } from "@/lib/site";
import { PricingGrid } from "./Pricing";

export default function PricingPage() {
  const { contact } = useSiteContent();
  const { plans } = usePlans({ referenceFallback: true }),
    { me } = useSession(),
    visible = (plans || []).filter((p) => p.visible);
  const rows: Array<[string, string]> = [
    ["Projects", "projects"],
    ["Zev credit / month", "credits_usd"],
    ["Replay samples / experiment", "replay_samples"],
    ["Team seats", "team_members"],
    ["Telemetry retention", "telemetry_retention_days"],
    ["GitHub connection", "github"],
    ["PDF report export", "pdf_export"],
  ];
  return (
    <>
      <PageTitle title="Pricing" />
      <section className="pricing-page-intro">
        <PricingGrid page currentPlanId={me?.account.plan} />
      </section>
      <section className="z-section pricing-detail-section">
        <div className="z-wrap">
          <Kicker>THE DETAILS, UP FRONT</Kicker>
          <h2 className="z-heading" style={{ marginTop: 23 }}>
            Know your room to work.
          </h2>
          <div style={{ overflowX: "auto" }}>
            <table className="pricing-comparison">
              <thead>
                <tr>
                  <th>Workspace limits</th>
                  {visible.map((p) => (
                    <th key={p.id}>{p.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, key]) => (
                  <tr key={key}>
                    <td>{label}</td>
                    {visible.map((p) => {
                      const v = (
                        p.limits as unknown as Record<string, unknown>
                      )[key];
                      return (
                        <td key={p.id}>
                          {v === null
                            ? "Unlimited"
                            : typeof v === "boolean"
                              ? v
                                ? "Included"
                                : "Coming soon"
                              : key === "credits_usd"
                                ? `$${v}`
                                : key === "telemetry_retention_days"
                                  ? `${v} days`
                                  : String(v ?? "—")}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <section className="z-section pricing-faq-section">
        <div className="z-wrap loop-layout">
          <div>
            <Kicker>A FEW GOOD QUESTIONS</Kicker>
            <h2 className="z-heading" style={{ marginTop: 23 }}>
              Clear costs.
              <br />
              Clear expectations.
            </h2>
          </div>
          <FAQ
            items={[
              [
                "What is Zev credit?",
                "Zev credit covers provider cost when you replay your samples on candidate models. It is accounted for on the server. Analysis, telemetry and reports do not consume replay credit.",
              ],
              [
                "Do I need my own model provider key?",
                "No. Platform replays run through your ZEVQORA account. Your existing production runtime keeps its own provider keys; ZEVQORA receives scoped metadata.",
              ],
              [
                "What happens at a plan limit?",
                "The server declines the protected operation and the app explains the limit. You can review your usage and choose a plan with more capacity.",
              ],
              [
                "Are savings guaranteed?",
                "No. Results apply to the replayed samples and configured gates. Point estimates, confidence intervals and evidence limitations remain visible.",
              ],
            ]}
          />
        </div>
      </section>
      <section className="pricing-help">
        <div>
          <Kicker>LET’S FIND YOUR STARTING POINT</Kicker>
          <h2>
            A bigger team?
            <br />
            Let’s make room.
          </h2>
          <p>
            Talk through workloads, verification gates and your team’s needs.
          </p>
        </div>
        <a
          className="engine-button engine-button-ink"
          href={`mailto:${contact.email}`}
        >
          Talk to the team
          <ArrowUpRight size={17} />
        </a>
      </section>
    </>
  );
}
