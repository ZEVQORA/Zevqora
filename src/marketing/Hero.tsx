import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUpRight, Pause, Play } from "lucide-react";
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
  return compact ? 112 : 440;
}

/**
 * Scroll-linked exit: as the hero leaves, the copy settles upward and the Z
 * drifts deeper. Driven by ordinary scroll position (no scroll hijack), written
 * to one CSS variable, and skipped entirely under reduced motion.
 */
function useHeroExit(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const h = el.offsetHeight || 1;
      const p = Math.min(1, Math.max(0, window.scrollY / (h * 0.85)));
      el.style.setProperty("--hero-exit", p.toFixed(3));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);
}

/**
 * Scene 1 — the cinematic introduction. Main's flowing blue EngineFilm fills
 * the screen; the dimensional Z stands in front of it; one headline, one
 * sentence, one action, and an arrow down to Zev. No chat here: Ask Zev has
 * its own scene directly below. Text is plain markup with no entrance delay,
 * so nothing waits on the film or the mark. The film can be paused (WCAG
 * 2.2.2) and already stops offscreen, in hidden tabs and under reduced motion.
 */
export function Hero() {
  const markSize = useMarkSize();
  const [playing, setPlaying] = useState(true);
  const ref = useRef<HTMLElement>(null);
  useHeroExit(ref);
  return (
    <section ref={ref} className="zev-hero" aria-labelledby="zev-hero-title">
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
            Find expensive AI work. Test a lighter alternative. Keep quality in control.
          </p>
          <div className="zev-hero-ctas">
            <a href="#workbench" className="zev-hero-primary">
              Explore ZEVQORA
              <ArrowUpRight size={18} aria-hidden />
            </a>
            <a href="#ask-zev" className="zev-hero-next">
              <span className="zev-hero-next-icon" aria-hidden>
                <ArrowDown size={16} />
              </span>
              Meet Zev
            </a>
          </div>
        </div>
        <div className="zev-hero-art">
          <DimensionalZ key={markSize} size={markSize} className="zev-hero-mark" />
        </div>
      </div>
      <div className="zev-hero-foot">
        <span className="zev-hero-chapters">Observe · Challenge · Verify · Review</span>
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
