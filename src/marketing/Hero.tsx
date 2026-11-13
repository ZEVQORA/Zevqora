import { useEffect, useState } from "react";
import { ArrowUpRight, Pause, Play } from "lucide-react";
import { Link } from "react-router";
import { motion, useReducedMotion } from "motion/react";
import { EngineFilm } from "@/brand/EngineFilm";
import { useSession } from "@/lib/session";

export function Hero() {
  const { status } = useSession();
  const [phase, setPhase] = useState(0),
    [playing, setPlaying] = useState(true);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!playing || reduced) return;
    const timer = setInterval(() => {
      if (!document.hidden) setPhase((p) => (p + 1) % 4);
    }, 5500);
    return () => clearInterval(timer);
  }, [playing, reduced]);
  return (
    <>
      <section className="engine-hero" aria-label="Zevqora. Make AI lighter.">
        <div className="engine-hero-art">
          <EngineFilm playing={playing} phase={phase} />
        </div>
        <div className="engine-hero-scrim" />
        <motion.div
          className="engine-hero-title"
          initial={reduced ? false : { opacity: 0, y: 55 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.95, ease: [0.16, 1, 0.3, 1], delay: 0.18 }}
        >
          <p className="hero-eyebrow">AI COST OPTIMIZATION, WITH EVIDENCE</p>
          <h1 aria-label="Make AI lighter.">
            <span>Make AI</span>
            <span>
              lighter<span className="engine-period">.</span>
            </span>
          </h1>
        </motion.div>
        <div className="engine-hero-bottom">
          <div className="engine-hero-pitch">
            <p>Less AI spend. The quality you need.</p>
            <span>
              Find expensive calls, test better alternatives, and verify
              the results before you ship.
            </span>
            <div>
              <Link to={status === "signed_in" ? "/app" : "/signup"} className="engine-button engine-button-white" data-cta="hero-get-started">
                {status === "signed_in" ? "Open workspace" : "Start optimizing"}
                <ArrowUpRight size={18} />
              </Link>
              <Link to="/product" className="engine-inline-link">
                Explore the product
                <ArrowUpRight size={14} />
              </Link>
            </div>
          </div>
        </div>
        <div className="engine-hero-transport">
          <span>Measure. Replay. Verify.</span>
          {!reduced && <div>
            <button
              type="button"
              onClick={() => setPlaying((v) => !v)}
              aria-label={playing ? "Pause hero motion" : "Play hero motion"}
              aria-pressed={!playing}
            >
              {playing ? <Pause size={13} /> : <Play size={13} />}
              <span>{playing ? "Pause motion" : "Play motion"}</span>
            </button>
          </div>}
        </div>
      </section>
    </>
  );
}
