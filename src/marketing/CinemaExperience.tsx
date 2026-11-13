import { useEffect, useRef, type CSSProperties } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";
import { ArrowDownRight, AudioLines, Focus, ShieldCheck } from "lucide-react";
import { ZevqoraMark } from "@/brand/ZevqoraMark";

const chapters = [
  {
    number: "01",
    label: "THE NOISE",
    title: (
      <>
        Big ideas.
        <br />
        <em>Too much noise.</em>
      </>
    ),
    description: "Models. Calls. Costs. Context. It adds up fast.",
    Icon: AudioLines,
  },
  {
    number: "02",
    label: "THE SIGNAL",
    title: (
      <>
        Find your
        <br />
        <em>moment of clarity.</em>
      </>
    ),
    description:
      "Bring the evidence together. Let the important things come into focus.",
    Icon: Focus,
  },
  {
    number: "03",
    label: "THE POSSIBILITY",
    title: (
      <>
        Less friction.
        <br />
        <em>More possibility.</em>
      </>
    ),
    description:
      "Measure. Replay. Verify. A clearer way to decide what comes next.",
    Icon: ShieldCheck,
  },
];

// Deterministic particles keep the scene stable across renders. Animation stays
// outside React and stops when this section or the document is out of view.
function SignalField({ progress }: { progress: MotionValue<number> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const element = canvas.current;
    if (!element || reduced || typeof ResizeObserver === "undefined") return;
    const context = element.getContext("2d");
    if (!context) return;
    let width = 1;
    let height = 1;
    let frame = 0;
    let visible = false;
    let last = 0;
    let elapsed = 0;
    let previousTime = 0;
    const particles = Array.from({ length: 100 }, (_, index) => ({
      angle: index * 2.399963,
      radius: 0.18 + ((index * 37) % 97) / 95,
      speed: 0.12 + ((index * 13) % 19) / 70,
      size: index % 5 === 0 ? 1.8 : 0.8,
    }));
    const resize = new ResizeObserver(() => {
      const bounds = element.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    });
    resize.observe(element);

    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);
      if (time - last < 33) return;
      elapsed += previousTime ? Math.min(time - previousTime, 50) : 0;
      previousTime = time;
      last = time;
      const p = progress.get();
      const clock = elapsed * 0.00012;
      const centerX = width * (width < 700 ? 0.5 : 0.69);
      const centerY = height * (width < 700 ? 0.36 : 0.48);
      const unit = Math.min(width * 0.57, height * 0.72);
      const convergence = Math.min(Math.max((p - 0.1) / 0.55, 0), 1);
      context.clearRect(0, 0, width, height);

      particles.forEach((particle, index) => {
        if (width < 700 && index % 2) return;
        const angle =
          particle.angle + clock * particle.speed + convergence * 1.5;
        const radius = particle.radius * unit * (1 - convergence * 0.52);
        const perspective = 0.68 + Math.sin(angle + clock) * 0.26;
        const x = centerX + Math.cos(angle) * radius;
        const y =
          centerY + Math.sin(angle) * radius * (0.58 + convergence * 0.15);
        const alpha = (0.2 + perspective * 0.5) * (1 - convergence * 0.35);
        context.beginPath();
        context.strokeStyle = `rgba(${index % 3 ? "73,156,255" : "152,111,255"},${alpha * 0.25})`;
        context.lineWidth = 0.6;
        context.moveTo(x, y);
        context.lineTo(
          x + Math.sin(angle) * (10 + p * 55),
          y - Math.cos(angle) * (5 + p * 25),
        );
        context.stroke();
        context.beginPath();
        context.fillStyle = `rgba(175,211,255,${alpha})`;
        context.arc(x, y, particle.size * perspective, 0, Math.PI * 2);
        context.fill();
      });
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      previousTime = 0;
      if (visible && !document.hidden) frame = requestAnimationFrame(draw);
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        sync();
      },
      { threshold: 0 },
    );
    observer.observe(element);
    document.addEventListener("visibilitychange", sync);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [progress, reduced]);

  return <canvas ref={canvas} className="cinema-field" aria-hidden="true" />;
}

function Chapter({
  index,
  progress,
}: {
  index: number;
  progress: MotionValue<number>;
}) {
  const chapter = chapters[index];
  const start = index / 3;
  const opacity = useTransform(progress, (value) => {
    const enter =
      index === 0 ? 1 : Math.min(1, Math.max(0, (value - start + 0.04) / 0.08));
    const leave =
      index === 2
        ? 1
        : 1 - Math.min(1, Math.max(0, (value - start - 0.24) / 0.07));
    return enter * leave;
  });
  const y = useTransform(
    progress,
    [start, start + 0.1, start + 0.33],
    [24, 0, -32],
  );
  const filter = useTransform(
    opacity,
    (value) => `blur(${(1 - value) * 10}px)`,
  );
  return (
    <motion.div
      className="cinema-chapter"
      inherit={false}
      style={{ opacity, y, filter }}
      aria-hidden="true"
    >
      <span className="cinema-kicker">
        <chapter.Icon size={15} /> {chapter.number} / {chapter.label}
      </span>
      <h3>{chapter.title}</h3>
      <p>{chapter.description}</p>
    </motion.div>
  );
}

function SignalChip({
  index,
  progress,
  label,
}: {
  index: number;
  progress: MotionValue<number>;
  label: string;
}) {
  const angle = (index / 8) * Math.PI * 2;
  const x = useTransform(
    progress,
    [0, 0.2, 0.64, 1],
    [
      Math.cos(angle) * 230,
      Math.cos(angle + 0.2) * 250,
      Math.cos(angle + 1) * 85,
      0,
    ],
  );
  const y = useTransform(
    progress,
    [0, 0.2, 0.64, 1],
    [
      Math.sin(angle) * 190,
      Math.sin(angle + 0.2) * 210,
      Math.sin(angle + 1) * 75,
      0,
    ],
  );
  const opacity = useTransform(
    progress,
    [0, 0.3, 0.55, 0.7],
    [0.65, 0.9, 0.3, 0],
  );
  const scale = useTransform(progress, [0, 0.5, 0.75], [1, 0.85, 0.2]);
  return (
    <motion.span className="cinema-chip" style={{ x, y, opacity, scale }}>
      {label}
    </motion.span>
  );
}

export function ScrollCinema() {
  const section = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: section,
    offset: ["start start", "end end"],
  });
  const coreScale = useTransform(
    scrollYProgress,
    [0, 0.25, 0.65, 1],
    [0.5, 0.65, 1, 1.2],
  );
  const coreOpacity = useTransform(
    scrollYProgress,
    [0, 0.25, 0.55],
    [0.15, 0.4, 1],
  );
  const ringRotate = useTransform(scrollYProgress, [0, 1], [-35, 145]);
  const bloomScale = useTransform(
    scrollYProgress,
    [0, 0.6, 1],
    [0.65, 1.15, 1.75],
  );
  const bloomOpacity = useTransform(
    scrollYProgress,
    [0, 0.5, 1],
    [0.3, 0.65, 0.85],
  );
  const progressWidth = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);

  return (
    <section
      id="cinema"
      ref={section}
      className={`cinema-scroll${reduced ? " cinema-reduced" : ""}`}
      aria-labelledby="cinema-title"
    >
      <h2 id="cinema-title" className="sr-only">
        From noise to clarity. From clarity to possibility.
      </h2>
      <p className="sr-only">
        Bring your AI evidence together, understand what matters, and verify
        your next decision with ZEVQORA.
      </p>
      <div className="cinema-stage">
        <div className="cinema-letterbox cinema-letterbox-top" />
        <div className="cinema-grain" aria-hidden="true" />
        <div className="cinema-stage-top" aria-hidden="true">
          <span>ZEVQORA / A NEW PERSPECTIVE</span>
          <span>
            SCROLL TO EXPLORE <ArrowDownRight size={14} />
          </span>
        </div>
        <SignalField progress={scrollYProgress} />
        <motion.div
          className="cinema-bloom"
          style={
            reduced ? undefined : { scale: bloomScale, opacity: bloomOpacity }
          }
          aria-hidden="true"
        />
        <div className="cinema-system" aria-hidden="true">
          <motion.div
            className="cinema-orbits"
            style={reduced ? undefined : { rotate: ringRotate }}
          >
            <i />
            <i />
            <i />
          </motion.div>
          {!reduced &&
            [
              "Models",
              "Context",
              "Latency",
              "Tokens",
              "Retries",
              "Tools",
              "Cost",
              "Quality",
            ].map((label, index) => (
              <SignalChip
                key={label}
                label={label}
                index={index}
                progress={scrollYProgress}
              />
            ))}
          <motion.div
            className="cinema-core"
            style={
              reduced ? undefined : { scale: coreScale, opacity: coreOpacity }
            }
          >
            <span />
            <ZevqoraMark height={96} />
          </motion.div>
        </div>
        <div className="cinema-copy">
          {reduced ? (
            <div className="cinema-chapter">
              <span className="cinema-kicker">A NEW PERSPECTIVE</span>
              <h3>
                Less friction.
                <br />
                <em>More possibility.</em>
              </h3>
              <p>
                Bring your AI evidence together. Find clarity. Verify your next
                move.
              </p>
            </div>
          ) : (
            chapters.map((_, index) => (
              <Chapter key={index} index={index} progress={scrollYProgress} />
            ))
          )}
        </div>
        <div className="cinema-stage-bottom" aria-hidden="true">
          <div className="cinema-timeline">
            <div>
              {chapters.map((chapter) => (
                <span key={chapter.number}>
                  {chapter.number} <b>{chapter.label.replace("THE ", "")}</b>
                </span>
              ))}
            </div>
            <div className="cinema-track">
              <motion.i style={{ width: reduced ? "100%" : progressWidth }} />
            </div>
          </div>
          <span className="cinema-caption">
            A visual story of clarity.
            <br />
            Concept visualization
          </span>
        </div>
        <div className="cinema-letterbox cinema-letterbox-bottom" />
      </div>
    </section>
  );
}

const statement =
  "Great technology should feel like nothing is in your way.".split(" ");

function RevealWord({
  word,
  index,
  progress,
}: {
  word: string;
  index: number;
  progress: MotionValue<number>;
}) {
  const color = useTransform(
    progress,
    [(index / statement.length) * 0.7, (index / statement.length) * 0.7 + 0.2],
    ["#353b51", "#f3f5ff"],
  );
  return (
    <motion.span style={{ color }} aria-hidden="true">
      {word}{" "}
    </motion.span>
  );
}

export function ClarityStatement() {
  const section = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: section,
    offset: ["start 85%", "end 45%"],
  });
  return (
    <section ref={section} className="cinema-statement">
      <span className="nova-kicker">
        <span /> THIS IS WHAT LIGHTER FEELS LIKE
      </span>
      <h2 aria-label={statement.join(" ")}>
        {reduced
          ? statement.join(" ")
          : statement.map((word, index) => (
              <RevealWord
                key={index}
                word={word}
                index={index}
                progress={scrollYProgress}
              />
            ))}
      </h2>
      <span className="cinema-statement-line" />
    </section>
  );
}

export function CinemaFrame() {
  return (
    <div className="cinema-hero-frame" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <i key={index} style={{ "--corner": index } as CSSProperties} />
      ))}
      <span>IDEAS WITHOUT THE WEIGHT.</span>
    </div>
  );
}
