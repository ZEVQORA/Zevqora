import { useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { Link } from "react-router";
import { DimensionalZ } from "@/brand/DimensionalZ";

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
  return compact ? 112 : 430;
}

/**
 * First viewport: the headline, the Ask Zev slot right under it, the two
 * CTAs, and the dimensional Z mark. The composer is passed in and mounted
 * once in the slot; it docks on scroll without being remounted. Text and CTAs
 * are plain markup with no entrance animation, so nothing waits on motion or
 * on the mark.
 */
export function Hero({ composer }: { composer: ReactNode }) {
  const markSize = useMarkSize();
  return (
    <section className="zev-hero" aria-labelledby="zev-hero-title">
      <div className="zev-hero-field" aria-hidden />
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
        <span>Observe · Challenge · Verify · Release</span>
      </div>
    </section>
  );
}
