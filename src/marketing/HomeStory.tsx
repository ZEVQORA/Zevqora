import { useRef, useState } from "react";
import { ArrowUpRight, Check, GitPullRequest, Radar, ScanSearch, ShieldCheck } from "lucide-react";
import { Link } from "react-router";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { ProductPreview } from "./ProductPreview";
import "./home-story.css";

/** The four stages of the loop. The first three open the matching product view. */
export const STAGES = [
  {
    number: "01",
    label: "Observe",
    view: "Overview",
    heading: "Map the work, not just the bill.",
    description: "See the model calls, tool steps, retries and context behind one AI workflow — the real baseline.",
    signal: "Execution + cost evidence",
    Icon: Radar,
  },
  {
    number: "02",
    label: "Challenge",
    view: "Opportunities",
    heading: "Find a lighter possibility.",
    description: "A different model, less context, fewer repeated steps. Every idea stays a candidate until tested.",
    signal: "Candidate, not a promise",
    Icon: ScanSearch,
  },
  {
    number: "03",
    label: "Verify",
    view: "Experiments",
    heading: "Let quality decide.",
    description: "Replay representative cases against requirements frozen in advance. Cost, latency and quality together.",
    signal: "VERIFIED / REJECTED / INCOMPLETE",
    Icon: ShieldCheck,
  },
  {
    number: "04",
    label: "Review",
    view: null,
    heading: "An engineer makes the call.",
    description: "Evidence and a reviewable recommendation. A passing experiment never changes production by itself.",
    signal: "Human approval before any ship",
    Icon: GitPullRequest,
  },
] as const;

/**
 * Scene 3 — the work itself. States the problem, then shows the loop as a
 * stepper that drives the real product preview (labelled sample data), so the
 * visitor sees the product rather than another slogan.
 */
export function WorkbenchStage() {
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "start start"] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [10, 0]);
  const y = useTransform(scrollYProgress, [0, 1], [70, 0]);
  const stage = STAGES[active];
  const view = stage.view ?? "Experiments";
  return (
    <section ref={ref} className="zq-workbench" id="workbench" aria-labelledby="zq-workbench-title">
      <div className="zq-story-wrap">
        <div className="zq-story-meta">
          <span>02 / THE WORK</span>
          <span>MEASURE · REPLAY · VERIFY · REVIEW</span>
        </div>
        <div className="zq-workbench-head">
          <h2 id="zq-workbench-title">
            Cheaper AI means nothing
            <span> if the answer gets worse.</span>
          </h2>
          <div>
            <p>
              Switching models is easy. Knowing whether the switch is safe for your real users is the hard part.
            </p>
            <p>
              ZEVQORA measures one workload, tests a lighter alternative against quality you set in advance, and shows
              whether it deserves to ship.
            </p>
          </div>
        </div>

        <ol className="zq-stepper" aria-label="How ZEVQORA works">
          {STAGES.map((s, i) => (
            <li key={s.number}>
              <button
                type="button"
                className={i === active ? "is-active" : ""}
                aria-pressed={i === active}
                onClick={() => setActive(i)}
              >
                <span className="zq-stepper-top">
                  <span className="zq-stepper-num">{s.number}</span>
                  <s.Icon size={18} strokeWidth={1.7} aria-hidden />
                </span>
                <b>{s.label}</b>
                <span className="zq-stepper-heading">{s.heading}</span>
              </button>
            </li>
          ))}
        </ol>

        <div className="zq-workbench-stage">
          <div className="zq-workbench-caption" aria-live="polite">
            <p>{stage.description}</p>
            <small>
              <Check size={14} aria-hidden /> {stage.signal}
            </small>
          </div>
          <motion.div className="zq-workbench-window" style={reduced ? undefined : { rotateX, y }}>
            <ProductPreview view={view} />
            {stage.view === null && (
              <div className="zq-review-overlay" role="note">
                <GitPullRequest size={18} aria-hidden />
                <div>
                  <b>Human review</b>
                  <span>Approve, request changes or reject. Approval is a decision record — not a deployment.</span>
                </div>
              </div>
            )}
          </motion.div>
          <div className="zq-workbench-foot">
            <span>Illustrative values · product preview with sample data</span>
            <Link to="/product">
              Explore the product <ArrowUpRight size={15} aria-hidden />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

const NODES = [
  { kind: "Task", label: "Answer a support ticket", col: 1, row: 2 },
  { kind: "Agent", label: "Support agent", col: 2, row: 2 },
  { kind: "Retrieval", label: "Policy search", col: 3, row: 1 },
  { kind: "ModelCall", label: "Large model · 3.1k tokens", col: 3, row: 2, hot: true },
  { kind: "ToolCall", label: "Order lookup", col: 3, row: 3 },
  { kind: "Outcome", label: "Resolved · quality 0.96", col: 4, row: 2 },
] as const;

/**
 * ZevIR, explained without jargon: every request becomes one graph of the
 * steps that produced the answer. Shows the honest rules (unknown is not
 * zero, no prompt content by default) and the real rollout state.
 */
export function ZevirMap() {
  return (
    <section className="zq-zevir" aria-labelledby="zq-zevir-title">
      <div className="zq-story-wrap">
        <div className="zq-story-meta">
          <span>04 / UNDER THE HOOD</span>
          <span>ZEVIR · EXECUTION GRAPH</span>
        </div>
        <div className="zq-zevir-layout">
          <div className="zq-zevir-copy">
            <h2 id="zq-zevir-title">
              One map of how
              <span> your AI actually runs.</span>
            </h2>
            <p>
              ZevIR turns each request into a graph of the steps behind the answer: the task, agents, model calls,
              retrieval, tools, functions, runtime and outcome. Optimization starts from that map, not from a price
              list.
            </p>
            <ul className="zq-zevir-rules">
              <li>
                <b>Unknown stays unknown.</b> A missing cost or latency is shown as missing — never as zero.
              </li>
              <li>
                <b>Structure, not secrets.</b> Prompt and output content are not captured by default; the graph keeps
                hashes, sizes and timings.
              </li>
              <li>
                <b>Real paths, including loops.</b> Retries and back-edges are kept, because that is often where the
                cost hides.
              </li>
            </ul>
            <p className="zq-zevir-status">
              <span>Status</span> In controlled preview behind a per-workspace feature flag. It informs analysis; it
              never changes a verdict.
            </p>
          </div>
          <figure className="zq-zevir-graph" aria-label="Example execution graph with six steps">
            <div className="zq-zevir-grid">
              {NODES.map((n) => (
                <div
                  key={n.kind}
                  className={`zq-zevir-node${"hot" in n && n.hot ? " is-hot" : ""}`}
                  style={{ gridColumn: n.col, gridRow: n.row }}
                >
                  <small>{n.kind}</small>
                  <span>{n.label}</span>
                </div>
              ))}
              <svg className="zq-zevir-edges" viewBox="0 0 400 300" preserveAspectRatio="none" aria-hidden>
                <path d="M88 150 H112" />
                <path d="M188 150 C200 150 200 50 212 50" />
                <path d="M188 150 H212" />
                <path d="M188 150 C200 150 200 250 212 250" />
                <path d="M288 150 H312" />
                <path className="is-retry" d="M260 176 C260 205 230 205 230 176" />
              </svg>
            </div>
            <figcaption>
              Illustrative graph. The highlighted model call is where this example spends most; the loop is a retry.
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
