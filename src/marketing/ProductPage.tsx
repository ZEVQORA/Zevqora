import {
  ArrowUpRight,
  Code2,
  FolderGit2,
  Gauge,
  Layers3,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { Link } from "react-router";
import { EndCta, Intro, Kicker, PageTitle, Rise, TextLink } from "./Editorial";
import { EngineProductStage, EngineZev } from "./EngineSections";

const FEATURES = [
  [
    "01",
    "See the execution.",
    "A single map of providers, models, operations, tokens, latency and cost. Follow the expensive call back to the work it actually performs.",
  ],
  [
    "02",
    "Find a useful candidate.",
    "Oversized models, repeated requests, prompt waste and routing problems become named opportunities with the evidence attached.",
  ],
  [
    "03",
    "Test it on the same work.",
    "Replay a bounded candidate on representative samples. Set a spend cap before execution and compare against the observed baseline.",
  ],
  [
    "04",
    "Keep quality in the decision.",
    "Named gates cover sample count, evidence, execution, quality, cost and latency. Every gate must pass before the result is verified.",
  ],
  [
    "05",
    "Review the actual change.",
    "Inspect a patch alongside the replay and gate results. The desktop app prepares an isolated branch and worktree; the browser exports the patch.",
  ],
];
export default function ProductPage() {
  return (
    <>
      <PageTitle title="Product" />
      <Intro
        kicker="YOUR AI COST OPTIMIZATION ENGINEER"
        title={
          <>
            Less guesswork.
            <br />
            <span>More engineering.</span>
          </>
        }
        body="The complete path from an expensive model call to a change you can trust. One workspace for measurement, replay, verification and review."
      >
        <div className="z-actions">
          <Link className="z-button z-button-ink" to="/demo">
            Explore the workspace
            <ArrowUpRight size={15} />
          </Link>
          <TextLink to="/download">Get the desktop app</TextLink>
        </div>
      </Intro>
      <EngineProductStage />
      <section className="z-section">
        <div className="z-wrap">
          <div className="z-section-head">
            <div>
              <Kicker>FOLLOW THE FULL PATH</Kicker>
              <h2 className="z-heading">
                A system view
                <br />
                of your AI spend.
              </h2>
            </div>
            <p>
              The provider invoice tells you what you paid. ZEVQORA helps you
              understand what to do next.
            </p>
          </div>
          <div className="feature-rows">
            {FEATURES.map(([n, t, b]) => (
              <Rise key={n} className="feature-row">
                <span>{n}</span>
                <h3>{t}</h3>
                <p>{b}</p>
              </Rise>
            ))}
          </div>
        </div>
      </section>
      <section className="z-section proof-section">
        <div className="z-wrap">
          <div className="z-section-head">
            <div>
              <Kicker>BUILT AROUND REAL WORK</Kicker>
              <h2 className="z-heading">
                Meet your code
                <br />
                where it lives.
              </h2>
            </div>
          </div>
          <div className="security-details">
            {[
              [
                FolderGit2,
                "Local repository scans",
                "Discover AI call sites in a folder you choose. Secret-like files are skipped. Browser and desktop scans run locally.",
              ],
              [
                Gauge,
                "Runtime telemetry",
                "Scoped tokens send call metadata from your runtime. Samples stay opt-in and sanitized.",
              ],
              [
                RotateCcw,
                "Bounded replay",
                "A representative workload, an explicit candidate and a configured cap. Results keep their provenance.",
              ],
              [
                ShieldCheck,
                "Evidence inspector",
                "Inspect source evidence, quality constraints and gate decisions before preparing a change.",
              ],
              [
                Code2,
                "Reviewable patches",
                "See the exact diff. Export a patch in the browser, or prepare a Git worktree with the desktop app.",
              ],
              [
                Layers3,
                "Workspace controls",
                "Projects, team roles, billing, retention and reports live alongside the engineering workflow.",
              ],
            ].map(([Icon, t, b]) => {
              const I = Icon as typeof Code2;
              return (
                <Rise className="security-detail" key={String(t)}>
                  <I size={28} />
                  <h3>{String(t)}</h3>
                  <p>{String(b)}</p>
                </Rise>
              );
            })}
          </div>
        </div>
      </section>
      <section style={{ paddingTop: 90 }}>
        <EngineZev />
      </section>
      <EndCta />
    </>
  );
}
