import { useEffect, useState } from "react";
import { ArrowDown, ArrowUpRight, Pause, Play } from "lucide-react";
import { Link } from "react-router";
import { motion, useReducedMotion } from "motion/react";
import { ENGINE_CHAPTERS, EngineFilm } from "@/brand/EngineFilm";

export function Hero() {
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
          <h1 aria-label="Make AI lighter.">
            <span>Make AI</span>
            <span>
              lighter<span className="engine-period">.</span>
            </span>
          </h1>
        </motion.div>
        <div className="engine-hero-bottom">
          <div className="engine-hero-pitch">
            <p>Big ideas shouldn’t carry unnecessary weight.</p>
            <span>
              Find expensive AI execution. Test a lighter way.
              <br />
              Keep the quality that makes your product yours.
            </span>
            <div>
              <Link to="/signup" className="engine-button engine-button-white">
                Start optimizing
                <ArrowUpRight size={18} />
              </Link>
              <Link to="/demo" className="engine-inline-link">
                Inside the product
                <ArrowUpRight size={14} />
              </Link>
            </div>
          </div>
        </div>
        <div className="engine-hero-transport">
          <a href="#manifesto" aria-label="Scroll to explore">
            <ArrowDown size={14} />
            <span>SCROLL TO GET LIGHTER</span>
          </a>
          <div>
            <span>
              0{phase + 1} / {ENGINE_CHAPTERS[phase].toUpperCase()}
            </span>
            <i className={playing && !reduced ? "is-playing" : ""} />
            <button
              type="button"
              onClick={() => setPlaying((v) => !v)}
              aria-label={playing ? "Pause hero motion" : "Play hero motion"}
            >
              {playing ? <Pause size={13} /> : <Play size={13} />}
            </button>
          </div>
          <span aria-hidden />
        </div>
      </section>
    </>
  );
}
