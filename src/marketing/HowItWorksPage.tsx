import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";
import { EndCta, FAQ, Intro, Kicker, PageTitle } from "./Editorial";
import { EngineChapters } from "./EngineSections";

export default function HowItWorksPage() {
  return (
    <>
      <PageTitle title="How it works" />
      <Intro
        kicker="MEASURE. REPLAY. VERIFY. THEN OPTIMIZE."
        title={
          <>
            The shortest path
            <br />
            to <span>a sound decision.</span>
          </>
        }
        body="One loop, in order. Nothing is recommended until it has survived the same work it is meant to replace."
      >
        <div className="z-actions">
          <Link className="z-button z-button-ink" to="/demo/opportunities">
            Try the workflow
            <ArrowUpRight size={15} />
          </Link>
        </div>
      </Intro>
      <EngineChapters />
      <section className="z-section proof-section">
        <div className="z-wrap">
          <Kicker>SEVEN STEPS. ONE AUDITABLE PATH.</Kicker>
          <div className="feature-rows" style={{ marginTop: 35 }}>
            {[
              [
                "01",
                "Connect",
                "Choose your repository, runtime or imported traces. Connections define exactly what can be read and revoked.",
              ],
              [
                "02",
                "Map",
                "Models, calls, tokens, cost drivers and latency become a consistent baseline.",
              ],
              [
                "03",
                "Diagnose",
                "Deterministic analysis attaches evidence to a specific source of waste.",
              ],
              [
                "04",
                "Experiment",
                "Create a candidate model, route, cache or context change with bounded scope.",
              ],
              [
                "05",
                "Replay",
                "Run representative captured cases through the candidate and compare with the baseline.",
              ],
              [
                "06",
                "Verify",
                "Apply named, versioned gates. A failure remains visible and blocks verification.",
              ],
              [
                "07",
                "Review",
                "Read the diff and evidence together. Your team decides whether the change ships.",
              ],
            ].map(([n, t, b]) => (
              <div key={n} className="feature-row">
                <span>{n}</span>
                <h3>{t}</h3>
                <p>{b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="z-section">
        <div className="z-wrap loop-layout">
          <div>
            <Kicker>BEFORE YOUR FIRST REPLAY</Kicker>
            <h2 className="z-heading" style={{ marginTop: 22 }}>
              Good inputs.
              <br />
              Useful evidence.
            </h2>
          </div>
          <FAQ
            items={[
              [
                "What do I need to start?",
                "One workload and its captured execution metadata. For a replay, import representative request and baseline output samples that you are allowed to process.",
              ],
              [
                "What if the candidate fails?",
                "The failed gate and supporting evidence stay in the experiment. The candidate does not become a verified recommendation.",
              ],
              [
                "Can ZEVQORA change production?",
                "ZEVQORA prepares reviewable changes. A person approves, merges and deploys them through your existing process.",
              ],
              [
                "Is a replay the same as a production result?",
                "No. A replay is evidence about the selected workload and configured gates. You still review the change and observe its production behaviour.",
              ],
            ]}
          />
        </div>
      </section>
      <EndCta />
    </>
  );
}
