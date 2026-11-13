import { useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUpRight, Pause, Play } from "lucide-react";
import { Link } from "react-router";
import { DimensionalZ } from "@/brand/DimensionalZ";
import { EngineFilm } from "@/brand/EngineFilm";

const COMPACT = "(max-width: 940px)";
const compactNow = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(COMPACT).matches;

/** The mark's size follows the layout: large beside the copy, small above it. */
function useMarkSize() {
  const [compact, setCompact] = useState(compactNow);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(COMPACT);
    const update = () => setCompact(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return compact ? 96 : 430;
}

/**
 * First viewport, in layers: main's flowing blue EngineFilm (WebGL, with
 * its canvas and still-image fallbacks) fills the hero; a scrim keeps the
 * copy legible; the dimensional Z stands in front; the headline, the Ask Zev
 * slot and the CTAs sit on top. The composer is passed in and mounted once in
 * the slot; it docks on scroll without being remounted. Text and CTAs are
 * plain markup with no entrance animation, so nothing waits on the film or
 * the mark. The film can be paused (WCAG 2.2.2); it already stops offscreen,
 * in hidden tabs and under prefers-reduced-motion.
 */
export function Hero({ composer }: { composer: ReactNode }) {
  const markSize = useMarkSize();
  const [playing, setPlaying] = useState(true);
  return (
    <section className="zev-hero" aria-labelledby="zev-hero-title">
      <div className="zev-hero-film" aria-hidden>
        <EngineFilm playing={playing} />
      </div>
      <div className="zev-hero-scrim" aria-hidden />
      <div className="zev-hero-grid">
        <div className="zev-hero-copy">
          <p className="zev-hero-eyebrow">
            <i aria-hidden /> Evidence-first AI optimization
          </p>
          <h1 id="zev-hero-title" aria-label="Make AI lighter.">
            <span>Make AI</span>{" "}
            <span>
              lighter<span className="zev-hero-period">.</span>
            </span>
          </h1>
          <p className="zev-hero-lede">
            Find expensive AI execution, test a lighter way, and keep only the
            changes that pass your quality gates.
          </p>
          <div className="zev-hero-slot">{composer}</div>
          <div className="zev-hero-ctas">
            <Link to="/signup" className="zev-hero-primary">
              Start optimizing
              <ArrowUpRight size={18} aria-hidden />
            </Link>
            <Link to="/product" className="zev-hero-secondary">
              Inside the product
              <ArrowUpRight size={14} aria-hidden />
            </Link>
          </div>
        </div>
        <div className="zev-hero-art">
          <DimensionalZ key={markSize} size={markSize} className="zev-hero-mark" />
        </div>
      </div>
      <div className="zev-hero-foot">
        <a href="#manifesto">
          <ArrowDown size={14} aria-hidden />
          <span>Scroll to get lighter</span>
        </a>
        <span className="zev-hero-chapters">Observe · Challenge · Verify · Release</span>
        <button
          type="button"
          className="zev-hero-motion"
          onClick={() => setPlaying((v) => !v)}
          aria-pressed={!playing}
        >
          {playing ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />}
          <span>{playing ? "Pause motion" : "Play motion"}</span>
        </button>
      </div>
    </section>
  );
}
