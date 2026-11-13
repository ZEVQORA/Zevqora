import { ArrowRight, ArrowUpRight, Check, CircleHelp, GitPullRequest, Radar, ScanSearch, ShieldCheck } from "lucide-react";
import { Link } from "react-router";
import "./premium-narrative.css";

const PROCESS = [
  {
    number: "01",
    label: "Understand",
    heading: "Map the work, not just the bill.",
    description: "Look at the model calls, tool steps, retries and context behind one authorized AI workflow. A meaningful baseline starts with the whole task.",
    signal: "Execution + cost evidence",
    Icon: Radar,
  },
  {
    number: "02",
    label: "Challenge",
    heading: "Find a lighter possibility.",
    description: "Consider a bounded change: a different model, less context, fewer repeated steps or a simpler execution path. Every idea remains a candidate.",
    signal: "Candidate, not a promise",
    Icon: ScanSearch,
  },
  {
    number: "03",
    label: "Verify",
    heading: "Make quality the deciding factor.",
    description: "Replay representative cases against agreed requirements. Inspect cost and latency together with quality and protected failure cases.",
    signal: "VERIFIED / REJECTED / INCOMPLETE",
    Icon: ShieldCheck,
  },
  {
    number: "04",
    label: "Review",
    heading: "Let an engineer make the call.",
    description: "Share the evidence and a reviewable recommendation. A passing experiment is not permission to change production automatically.",
    signal: "Human approval before any ship",
    Icon: GitPullRequest,
  },
] as const;

export function ClarityIntro() {
  return (
    <section className="zq-clarity-intro" id="manifesto" aria-labelledby="zq-clarity-heading">
      <div className="zq-premium-wrap">
        <div className="zq-premium-meta">
          <span>01 / THE PROBLEM</span>
          <span>BETTER ENGINEERING, NOT JUST A LOWER TOKEN BILL</span>
        </div>
        <div className="zq-clarity-split">
          <div>
            <p className="zq-premium-kicker">THE PART MOST OPTIMIZERS MISS</p>
            <h2 id="zq-clarity-heading">
              Cheaper AI means nothing
              <span> if the answer gets worse.</span>
            </h2>
          </div>
          <div className="zq-clarity-aside">
            <p>
              Switching models is easy. Knowing whether the switch is safe for your real
              users is the difficult part.
            </p>
            <p>
              ZEVQORA is building an evidence-first optimization engineer: measure the
              workload, test a lighter alternative, and explain whether it deserves to ship.
            </p>
            <Link to="/how-it-works" className="zq-premium-text-link">
              Understand the method <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </div>
        <div className="zq-clarity-rule" aria-label="What a sound optimization decision needs">
          <div>
            <span className="zq-clarity-symbol" aria-hidden="true">01</span>
            <strong>Real workload</strong>
            <small>Not an isolated price comparison</small>
          </div>
          <div>
            <span className="zq-clarity-symbol" aria-hidden="true">02</span>
            <strong>Quality requirements</strong>
            <small>Fixed before the experiment</small>
          </div>
          <div>
            <span className="zq-clarity-symbol" aria-hidden="true">03</span>
            <strong>Evidence and verdict</strong>
            <small>Including rejected changes</small>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ClarityFlow() {
  return (
    <section className="zq-clarity-flow" id="how-it-works" aria-labelledby="zq-flow-heading">
      <div className="zq-premium-wrap">
        <div className="zq-premium-meta">
          <span>02 / HOW IT WORKS</span>
          <span>MEASURE. REPLAY. VERIFY. THEN OPTIMIZE.</span>
        </div>
        <div className="zq-flow-heading-row">
          <div>
            <p className="zq-premium-kicker">ONE WORKLOAD. A DEFENSIBLE DECISION.</p>
            <h2 id="zq-flow-heading">
              Don't guess what to change.
              <span> Prove what deserves to change.</span>
            </h2>
          </div>
          <p>
            A repeatable loop from an observed problem to a human-reviewed decision.
            Each step makes the next one more trustworthy.
          </p>
        </div>
        <ol className="zq-flow-stages">
          {PROCESS.map(({ number, label, heading, description, signal, Icon }) => (
            <li key={number} className="zq-flow-stage">
              <div className="zq-flow-stage-number" aria-hidden="true">{number}<span /></div>
              <div className="zq-flow-stage-title">
                <div className="zq-flow-icon"><Icon size={22} strokeWidth={1.6} aria-hidden="true" /></div>
                <span>{label}</span>
                <h3>{heading}</h3>
              </div>
              <div className="zq-flow-stage-detail">
                <p>{description}</p>
                <small><Check size={14} aria-hidden="true" /> {signal}</small>
              </div>
            </li>
          ))}
        </ol>
        <div className="zq-flow-foot">
          <div>
            <CircleHelp size={19} strokeWidth={1.6} aria-hidden="true" />
            <p>
              This is ZEVQORA's intended product workflow. Specific integrations,
              replay and automated shipping capabilities depend on current implementation,
              configuration and feature flags.
            </p>
          </div>
          <Link to="/product" className="zq-premium-text-link">
            Explore the actual product <ArrowUpRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}

export function ClarityAudience() {
  return (
    <section className="zq-clarity-audience" aria-labelledby="zq-audience-heading">
      <div className="zq-premium-wrap">
        <div className="zq-premium-meta">
          <span>05 / WHO IT'S FOR</span>
          <span>BUILT AROUND REAL CUSTOMER WORKLOADS</span>
        </div>
        <div className="zq-audience-heading-row">
          <div>
            <p className="zq-premium-kicker">FOR PEOPLE WHO OWN THE OUTCOME</p>
            <h2 id="zq-audience-heading">
              You ship the AI.
              <span> You live with the consequences.</span>
            </h2>
          </div>
          <p>
            Start with one recurring workflow and the requirements your users
            already expect it to meet. Keep the scope explicit.
          </p>
        </div>
        <div className="zq-audience-rails">
          <article>
            <span>01 / AI PRODUCT TEAMS</span>
            <h3>Move beyond model-by-model savings.</h3>
            <p>Understand retries, chained calls and agent tools that can make a cheap request expensive in practice.</p>
            <Link to="/evaluation">Explore a scoped evaluation <ArrowRight size={17} aria-hidden="true" /></Link>
          </article>
          <article>
            <span>02 / RAG AND AGENT ENGINEERS</span>
            <h3>Protect the answer while changing the path.</h3>
            <p>Compare retrieval, context and execution choices against representative tasks rather than a single happy-path prompt.</p>
            <Link to="/proof">See how decisions are evaluated <ArrowRight size={17} aria-hidden="true" /></Link>
          </article>
        </div>
      </div>
    </section>
  );
}

export function ClarityClose() {
  return (
    <section className="zq-clarity-close" aria-labelledby="zq-close-heading">
      <div className="zq-premium-wrap zq-close-layout">
        <div>
          <p className="zq-premium-kicker">A LIGHTER WAY, WITH PROOF</p>
          <h2 id="zq-close-heading">One workload is enough to start learning.</h2>
          <p>Define the scope. Agree on the quality gates. Review the evidence before deciding what should change.</p>
        </div>
        <div className="zq-close-actions">
          <Link to="/evaluation" className="zq-close-primary">Explore an evaluation <ArrowUpRight size={19} aria-hidden="true" /></Link>
          <Link to="/product" className="zq-close-secondary">View current capabilities <ArrowRight size={18} aria-hidden="true" /></Link>
          <small>No customer savings, production deployment or integration is implied without verified evidence.</small>
        </div>
      </div>
    </section>
  );
}
