import { useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  FlaskConical,
  LayoutDashboard,
  Lightbulb,
  LockKeyhole,
  ShieldCheck,
  X,
} from "lucide-react";
import { Zev } from "@/brand/Zev";
import { useSiteContent } from "@/lib/site";
import { EndCta, Kicker, Rise, TextLink } from "./Editorial";
import { ProductPreview } from "./ProductPreview";

export function ProductShowcase() {
  const [view, setView] = useState("Overview");
  return (
    <section className="home-product" id="product">
      <div className="z-wrap">
        <Rise className="z-section-head">
          <div>
            <Kicker number="01">THE PRODUCT</Kicker>
            <h2 className="z-heading">
              A clear view.
              <br />
              <span>A lighter system.</span>
            </h2>
          </div>
          <p>
            See what your AI actually does, where the cost goes, and which
            changes are worth testing.
          </p>
        </Rise>
        <Rise>
          <div
            className="product-tabs"
            role="group"
            aria-label="Product preview"
          >
            {[
              [LayoutDashboard, "Overview"],
              [Lightbulb, "Opportunities"],
              [FlaskConical, "Experiments"],
            ].map(([Icon, label]) => {
              const I = Icon as typeof LayoutDashboard;
              return (
                <button
                  type="button"
                  key={String(label)}
                  aria-pressed={view === label}
                  onClick={() => setView(String(label))}
                >
                  <I size={14} />
                  {String(label)}
                </button>
              );
            })}
            <TextLink to="/product">Explore the product</TextLink>
          </div>
          <ProductPreview view={view} />
        </Rise>
        <p className="preview-disclaimer">
          Illustrative product data. Experiment examples are labelled internal
          benchmarks.
        </p>
      </div>
    </section>
  );
}

const LOOP = [
  {
    title: "Measure the real work.",
    body: "Connect call metadata and map model, token, cost and latency data to the operation that produced it. Code scans stay on your machine.",
    detail: "Trace metadata → spend map → cost drivers",
  },
  {
    title: "Replay the alternative.",
    body: "Turn a diagnosed opportunity into a bounded candidate. Run the same captured workload against it, with a spend cap you control.",
    detail: "Observed baseline → bounded candidate → replay",
  },
  {
    title: "Make quality the gate.",
    body: "Cost, quality, latency and protected behaviour are checked together. Every named gate must pass. Cheaper alone never gets through.",
    detail: "Frozen constraints → named gates → evidence",
  },
  {
    title: "Review. Then optimize.",
    body: "Get the diff, the result and the evidence behind it. A person decides what ships. No automatic merges or deployments.",
    detail: "Verified result → reviewable patch → your approval",
  },
];
export function LoopExplorer({ full = false }: { full?: boolean }) {
  const [active, setActive] = useState(0);
  return (
    <section className="z-section" id="how-it-works">
      <div className="z-wrap loop-layout">
        <Rise>
          <Kicker number="02">THE ENGINEERING LOOP</Kicker>
          <h2 className="z-heading" style={{ marginTop: 24 }}>
            Nothing changes
            <br />
            until the evidence does.
          </h2>
          <div className="loop-list">
            {LOOP.map((s, i) => (
              <div
                className={`loop-item ${i === active ? "active" : ""}`}
                key={s.title}
              >
                <button
                  type="button"
                  aria-expanded={i === active}
                  aria-controls={`loop-detail-${i}`}
                  onClick={() => setActive(i)}
                >
                  <span>0{i + 1}</span>
                  <b>{s.title}</b>
                  {i === active ? (
                    <ChevronDown size={15} />
                  ) : (
                    <ArrowRight size={15} />
                  )}
                </button>
                {i === active && <p id={`loop-detail-${i}`}>{s.body}</p>}
              </div>
            ))}
          </div>
          {!full && (
            <div style={{ marginTop: 23 }}>
              <TextLink to="/how-it-works">Explore the full loop</TextLink>
            </div>
          )}
        </Rise>
        <Rise delay={0.08}>
          <div
            className="loop-terminal"
            role="region"
            aria-label={`${LOOP[active].title} demonstration`}
          >
            <div className="terminal-top">
              <span>
                ZEVQORA /{" "}
                {
                  [
                    "EXECUTION TRACE",
                    "REPLAY ENGINE",
                    "VERIFICATION",
                    "CHANGE REVIEW",
                  ][active]
                }
              </span>
              <span>0{active + 1} — 04</span>
            </div>
            {active === 0 ? (
              <>
                <pre className="terminal-code">
                  {"{\n  "}
                  <b>operation</b>
                  {
                    ': "classify.intent",\n  provider:  "openai",\n  model:     "gpt-4o",\n  tokens:    { input: 812, output: 14 },\n  latency:   1980,\n  cost_usd:  0.0188,\n  samples:   "opt-in, sanitized"\n}'
                  }
                </pre>
                <div className="terminal-result">
                  Real execution. A traceable baseline.
                  <span>01 / MEASURED</span>
                </div>
              </>
            ) : active === 1 ? (
              <>
                <p className="terminal-big">
                  Same work.
                  <br />
                  New candidate.
                </p>
                <pre className="terminal-code">
                  {
                    "baseline    → captured request + output\ncandidate   → bounded model alternative\ncomparison  → same representative cases\nspend cap   → set before execution"
                  }
                </pre>
                <div className="terminal-result">
                  Run the workload, not a prediction.<span>02 / REPLAY</span>
                </div>
              </>
            ) : active === 2 ? (
              <>
                <div className="terminal-gates">
                  {[
                    "Minimum sample count",
                    "Evidence completeness",
                    "Execution success",
                    "Quality floor",
                    "Cost improvement",
                    "Latency regression",
                  ].map((g) => (
                    <div key={g}>
                      {g}
                      <span>
                        <Check size={12} /> PASS
                      </span>
                    </div>
                  ))}
                </div>
                <p className="terminal-small">
                  Illustrative gate display. A result requires every configured
                  gate.
                </p>
              </>
            ) : (
              <>
                <pre className="terminal-code">
                  {"diff --git a/src/classify.ts b/src/classify.ts\n\n"}
                  <span style={{ color: "#c98885" }}>
                    {"- model: baselineModel\n"}
                  </span>
                  <b>{"+ model: verifiedCandidate\n"}</b>
                  {
                    "\nattached evidence\n  ↳ replay report\n  ↳ gate decisions\n  ↳ provenance hash"
                  }
                </pre>
                <div className="terminal-result">
                  <span>
                    <ShieldCheck size={14} className="mr-2 inline" />
                    Human approval required
                  </span>
                  <span>04 / REVIEW</span>
                </div>
              </>
            )}
            <div className="terminal-small" style={{ marginTop: 20 }}>
              {LOOP[active].detail}
            </div>
          </div>
        </Rise>
      </div>
    </section>
  );
}

export function ProofCards() {
  const { proof } = useSiteContent();
  return (
    <div className="proof-grid">
      {(["rejected", "verified"] as const).map((kind) => {
        const value = proof[kind],
          verified = kind === "verified";
        return (
          <Rise
            className={`proof-card ${kind}`}
            key={kind}
            delay={verified ? 0.08 : 0}
          >
            <div className="proof-status">
              <span className={`z-status ${kind}`}>
                {verified ? <Check size={11} /> : <X size={11} />}
                {kind.toUpperCase()}
              </span>
              <span>{verified ? "CANDIDATE D" : "REJECTED CANDIDATE"}</span>
            </div>
            <div className="proof-number">
              {value.cost_reduction.replace("%", "")}
              <span>%</span>
            </div>
            <p>
              {verified
                ? "lower measured inference cost · point estimate"
                : "lower measured inference cost · still rejected"}
            </p>
            <div className="quality-track">
              <div className="quality-label">
                <span>QUALITY {value.quality}</span>
                <span>FLOOR {value.quality_floor}</span>
              </div>
              <div className="quality-bar">
                <span style={{ width: `${Number(value.quality) * 100}%` }} />
                <i />
              </div>
            </div>
            <div className="proof-explanation">
              {verified
                ? "Quality held. Every configured gate passed. The 95% confidence interval crosses zero, so the saving remains a point estimate."
                : "Quality missed the frozen floor. The largest measured saving was rejected. It never became a recommendation."}
            </div>
          </Rise>
        );
      })}
    </div>
  );
}
export function ProofFeature() {
  const { proof } = useSiteContent();
  return (
    <section className="z-section proof-section" id="proof">
      <div className="z-wrap">
        <Rise className="z-section-head">
          <div>
            <Kicker number="03">EVIDENCE OVER OPTIMISM</Kicker>
            <h2 className="z-heading">
              Cheaper isn’t
              <br />
              <span>verified.</span>
            </h2>
          </div>
          <p>
            The candidate that saved the most is the one we rejected. A useful
            optimization has to protect the product, too.
          </p>
        </Rise>
        <ProofCards />
        <div className="proof-linkrow">
          <p className="proof-qualifier">{proof.qualifier}</p>
          <TextLink to="/proof">Read the evidence</TextLink>
        </div>
      </div>
    </section>
  );
}
export function SecurityBoundary() {
  return (
    <div className="boundary-art">
      <div className="boundary-inner">
        <div className="boundary-top">
          <span>YOUR WORKSPACE</span>
          <ShieldCheck size={13} />
        </div>
        <div className="boundary-lock">
          <LockKeyhole size={29} strokeWidth={1.2} />
        </div>
        <div className="boundary-permissions">
          <div>
            Call metadata<b>SCOPED</b>
          </div>
          <div>
            Request samples<b>OPT-IN</b>
          </div>
          <div>
            Connection tokens<b>REVOCABLE</b>
          </div>
          <div>
            Shipping a change<b>YOUR APPROVAL</b>
          </div>
        </div>
      </div>
    </div>
  );
}
export function SecurityFeature() {
  return (
    <section className="z-section">
      <div className="z-wrap security-layout">
        <Rise>
          <Kicker number="04">TRUST IS A DESIGN DECISION</Kicker>
          <h2 className="z-heading">
            Your system.
            <br />
            Your boundaries.
          </h2>
          <p className="z-body">
            Read-only repository scans. Scoped telemetry. Opt-in samples.
            Evidence you can inspect, and changes you approve.
          </p>
          <TextLink to="/security">Explore security</TextLink>
        </Rise>
        <Rise delay={0.1}>
          <SecurityBoundary />
        </Rise>
      </div>
    </section>
  );
}
export function ZevFeature() {
  return (
    <section className="z-wrap" style={{ paddingBottom: 95 }}>
      <Rise className="zev-feature">
        <div className="zev-portrait">
          <Zev
            height={285}
            view="three-quarter-front"
            alt="Zev, Zevqora’s white and blue companion"
          />
          <div className="zev-note">
            <b>“Let’s check the evidence.”</b>Small steps. Clear decisions.
          </div>
        </div>
        <div>
          <Kicker>MEET ZEV</Kicker>
          <h2 className="z-heading">
            A little help.
            <br />
            <span>A lighter workload.</span>
          </h2>
          <p className="z-body">
            Zev keeps the loop understandable: what was observed, what is being
            tested, and what the evidence actually supports. A friendly face for
            serious engineering.
          </p>
          <TextLink to="/product">Meet your companion</TextLink>
        </div>
      </Rise>
    </section>
  );
}
export { EndCta };
