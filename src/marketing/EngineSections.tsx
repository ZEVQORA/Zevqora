import { useRef, useState } from "react";
import { Link } from "react-router";
import {
  ArrowUpRight,
  Code2,
  Fingerprint,
  FlaskConical,
  LayoutDashboard,
  Lightbulb,
  LockKeyhole,
} from "lucide-react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";
import { Zev } from "@/brand/Zev";
import { ZevqoraMark } from "@/brand/ZevqoraMark";
import { ProductPreview } from "./ProductPreview";
import { Rise } from "./Editorial";

export function EngineTicker() {
  return (
    <div className="engine-ticker" aria-label="Less waste. More possibility.">
      <div aria-hidden>
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i}>
            LESS WASTE <i>↗</i> MORE POSSIBILITY <b>✳</b>
          </span>
        ))}
      </div>
    </div>
  );
}
export function EngineManifesto() {
  return (
    <section className="engine-manifesto" id="manifesto">
      <div className="engine-section-meta">
        <span>THE WEIGHT OF INTELLIGENCE</span>
        <span>01 / A DIFFERENT WAY</span>
      </div>
      <Rise>
        <h2>
          AI is moving
          <br />
          <span>fast.</span> Your costs
          <br />
          shouldn’t follow.
        </h2>
      </Rise>
      <div className="engine-manifesto-bottom">
        <span className="engine-asterisk" aria-hidden>
          ✳
        </span>
        <p>
          Models get bigger. Context gets longer.
          <br />
          The bill gets heavier.
        </p>
        <div>
          <p>
            ZEVQORA finds the unnecessary work hiding inside your AI system. It
            tests the alternative, checks the evidence, and keeps quality in the
            decision.
          </p>
          <Link to="/product" className="engine-inline-link">
            Meet your optimization engineer
            <ArrowUpRight size={17} />
          </Link>
        </div>
      </div>
    </section>
  );
}

export { TypeMethod as EngineChapters } from "./TypeMethod";

export function EngineProductStage() {
  const [view, setView] = useState("Overview"),
    ref = useRef<HTMLElement>(null),
    reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "center center"],
  });
  const rotate = useTransform(scrollYProgress, [0, 1], [8, 0]),
    y = useTransform(scrollYProgress, [0, 1], [60, 0]);
  return (
    <section className="engine-product" id="product" ref={ref}>
      <div className="engine-section-meta">
        <span>THE WORKSPACE</span>
        <span>02 / BUILT FOR THE WORK</span>
      </div>
      <Rise>
        <div className="engine-product-heading">
          <h2>
            Meet your
            <br />
            unfair advantage<span>.</span>
          </h2>
          <div>
            <p>
              All the complexity.
              <br />A remarkably clear view.
            </p>
            <Link to="/demo" className="engine-button engine-button-ink">
              Open interactive demo
              <ArrowUpRight size={17} />
            </Link>
          </div>
        </div>
      </Rise>
      <div
        className="engine-product-tabs"
        role="group"
        aria-label="Product preview"
      >
        {[
          {
            Icon: LayoutDashboard,
            label: "Overview",
            description: "Your system, in focus",
          },
          {
            Icon: Lightbulb,
            label: "Opportunities",
            description: "Find the lighter path",
          },
          {
            Icon: FlaskConical,
            label: "Experiments",
            description: "Let the evidence decide",
          },
        ].map(({ Icon, label, description }, i) => (
          <button
            type="button"
            key={label}
            aria-label={label}
            aria-pressed={view === label}
            onClick={() => setView(label)}
          >
            <span className="product-tab-icon">
              <Icon size={21} />
            </span>
            <span className="product-tab-copy">
              <b>{label}</b>
              <small>{description}</small>
            </span>
            <span className="product-tab-number">0{i + 1}</span>
            <ArrowUpRight size={17} />
          </button>
        ))}
      </div>
      <motion.div
        className="engine-product-window"
        style={reduced ? undefined : { rotateX: rotate, y }}
      >
        <ProductPreview view={view} />
      </motion.div>
      <div className="engine-product-footnote">
        <span>Clarity is a feature.</span>
        <span>
          Illustrative values. Internal benchmark examples retain their
          qualifiers.
        </span>
      </div>
    </section>
  );
}

export { DecisionEvidence as EngineProof } from "./DecisionEvidence";

export function EngineBoundaries() {
  return (
    <section className="engine-boundaries">
      <div className="engine-section-meta">
        <span>TRUST, ENGINEERED IN</span>
        <span>04 / YOUR BOUNDARIES</span>
      </div>
      <div className="engine-boundaries-layout">
        <Rise>
          <h2>
            Your system.
            <br />
            Your rules.
            <br />
            <span>Built in.</span>
          </h2>
          <Link to="/security" className="engine-inline-link">
            Explore the security model
            <ArrowUpRight size={17} />
          </Link>
        </Rise>
        <div className="engine-boundary-list">
          {[
            [
              Code2,
              "Code stays close.",
              "Read-only repository scans run on your machine. Secret-like files are skipped.",
            ],
            [
              Fingerprint,
              "Access has a scope.",
              "Metadata by default. Opt-in samples. Revocable, project-scoped tokens.",
            ],
            [
              LockKeyhole,
              "Shipping stays yours.",
              "Review the patch and evidence. Human approval is part of the workflow.",
            ],
          ].map(([Icon, t, b], i) => {
            const I = Icon as typeof Code2;
            return (
              <Rise key={String(t)} className="engine-boundary-row">
                <span>0{i + 1}</span>
                <I size={25} />
                <div>
                  <h3>{String(t)}</h3>
                  <p>{String(b)}</p>
                </div>
              </Rise>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function EngineZev() {
  const [wave, setWave] = useState(false);
  return (
    <section className="engine-zev">
      <div className="engine-section-meta">
        <span>A HUMAN TOUCH TO SERIOUS WORK</span>
        <span>MEET ZEV / YOUR COMPANION</span>
      </div>
      <div className="engine-zev-layout">
        <div>
          <h2>
            Big brain.
            <br />
            Soft side<span>.</span>
          </h2>
          <p>
            Good engineering can feel a little lighter, too. Zev keeps the
            evidence in view and the next step understandable.
          </p>
          <Link to="/demo/zev" className="engine-button engine-button-white">
            Say hello to Zev
            <ArrowUpRight size={17} />
          </Link>
        </div>
        <button
          type="button"
          className="engine-zev-stage"
          onClick={() => setWave((v) => !v)}
          aria-label="Say hello to Zev"
        >
          <span className="engine-zev-label">
            EVIDENCE FIRST.
            <br />
            ALWAYS.
          </span>
          <div>
            <Zev
              view={wave ? "pose-waving" : "three-quarter-front"}
              height={310}
              alt="Zev, Zevqora’s optimization companion"
            />
          </div>
          <span className="engine-zev-name">
            ZEV<span>↗</span>
          </span>
        </button>
      </div>
      <span className="engine-zev-watermark" aria-hidden>
        <ZevqoraMark height={200} />
      </span>
    </section>
  );
}

export { EngineEnd } from "./EngineEnd";
