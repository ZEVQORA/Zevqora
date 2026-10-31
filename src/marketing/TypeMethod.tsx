import { useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";

const CHAPTERS = [
  {
    name: "Observe",
    lines: ["EVERY", "CALL COUNTS."],
    label: "01 / KNOW THE WEIGHT",
    body: "Every model call has a cost. Follow the execution, context and retries that produced the bill. A clearer baseline makes a better first move.",
    terms: ["Runtime metadata", "Local code scan", "A measured baseline"],
    action: "See a workload",
    path: "/demo",
  },
  {
    name: "Challenge",
    lines: ["SAME WORK.", "LIGHTER WAY."],
    label: "02 / QUESTION THE DEFAULT",
    body: "A smaller model. A tighter context. A better route. Replay the same representative work and give a lighter candidate a fair test.",
    terms: ["Same workload", "Bounded spend", "Measured comparison"],
    action: "Explore an opportunity",
    path: "/demo/opportunities",
  },
  {
    name: "Verify",
    lines: ["CHEAPER?", "PROVE IT."],
    label: "03 / EVIDENCE BEFORE CONFIDENCE",
    body: "A lower number only matters if the product still works. Freeze the quality floor. Check every required gate. Keep the failures in view.",
    terms: [
      "Frozen quality floor",
      "Cost and latency gates",
      "Visible failures",
    ],
    action: "Inspect the evidence",
    path: "/demo/experiments",
  },
  {
    name: "Release",
    lines: ["YOUR REVIEW.", "YOUR CALL."],
    label: "04 / HUMAN BY DESIGN",
    body: "The exact change. The result. The evidence behind it. Review them together, then decide what deserves to ship. The final say stays yours.",
    terms: ["A reviewable patch", "Evidence attached", "Human approval"],
    action: "Review a change",
    path: "/demo/changes",
  },
];
// Each phrase has room to settle before flowing into the next one.
function reelPosition(value: number) {
  const position = Math.max(0, Math.min(1, value)) * 3;
  const index = Math.floor(position);
  const local = position - index;
  const travel = Math.max(0, Math.min(1, (local - 0.24) / 0.54));
  const eased = travel * travel * (3 - 2 * travel);
  return Math.min(3, index + eased);
}

export function TypeMethod() {
  const target = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target,
    offset: ["start 84px", "end end"],
  });
  const progress = useSpring(scrollYProgress, {
    stiffness: 125,
    damping: 32,
    mass: 0.65,
  });
  const reelY = useTransform(
    progress,
    (value) => `${-reelPosition(value) * 25}%`,
  );
  useMotionValueEvent(progress, "change", (value) => {
    if (window.innerWidth > 900 && !reduced)
      setActive(Math.round(reelPosition(value)));
  });
  const chapter = CHAPTERS[active];
  function choose(index: number) {
    if (window.innerWidth > 900 && !reduced && target.current) {
      const section = target.current;
      const start = window.scrollY + section.getBoundingClientRect().top - 84;
      const travel = section.offsetHeight - window.innerHeight + 84;
      window.scrollTo({
        top: start + travel * Math.max(0.006, Math.min(0.994, index / 3)),
        behavior: "smooth",
      });
    } else setActive(index);
  }
  return (
    <section className="type-method-scroll" ref={target} id="how-it-works">
      <div className="type-method-stage" data-chapter={active}>
        <div className="type-method-meta">
          <span>HOW LIGHTER HAPPENS</span>
          <Link to="/how-it-works">
            Explore the method
            <ArrowUpRight size={15} />
          </Link>
        </div>
        <div
          className="type-method-heading"
          style={{ "--method-shift": `${-active * 25}%` } as CSSProperties}
        >
          <div className="method-reel-window">
            <motion.h2
              className="method-reel-track"
              aria-label={chapter.lines.join(" ")}
              style={{ y: reelY }}
            >
              {CHAPTERS.map((item) => (
                <span className="method-reel-slide" key={item.name} aria-hidden>
                  {item.lines.map((line) => (
                    <span className="method-line-mask" key={line}>
                      <span className="method-word">{line}</span>
                    </span>
                  ))}
                </span>
              ))}
            </motion.h2>
          </div>
          <span className="type-method-index" aria-hidden>
            <b>0{active + 1}</b>
            <span>/ 04</span>
          </span>
        </div>
        <div className="type-method-context">
          <div className="method-terms">
            <span className="method-context-label">{chapter.label}</span>
            <div>
              {chapter.terms.map((term, index) => (
                <p key={term}>
                  <span>0{index + 1}</span>
                  {term}
                </p>
              ))}
            </div>
          </div>
          <motion.div
            className="method-description"
            key={active}
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.12 }}
          >
            <p>{chapter.body}</p>
            <Link to={chapter.path}>
              {chapter.action}
              <ArrowUpRight size={18} />
            </Link>
          </motion.div>
        </div>
        <div
          className="type-method-nav"
          role="group"
          aria-label="Engineering chapters"
        >
          {CHAPTERS.map((item, index) => (
            <button
              key={item.name}
              type="button"
              aria-label={`0${index + 1} ${item.name}`}
              aria-pressed={active === index}
              onClick={() => choose(index)}
            >
              <span>0{index + 1}</span>
              <b>{item.name}</b>
              <ArrowRight size={17} />
              {active === index && (
                <motion.i
                  layoutId="method-selection-line"
                  transition={{ type: "spring", stiffness: 220, damping: 32 }}
                />
              )}
            </button>
          ))}
        </div>
        <div className="method-progress" aria-hidden>
          <motion.i style={{ scaleX: reduced ? (active + 1) / 4 : progress }} />
        </div>
      </div>
    </section>
  );
}
