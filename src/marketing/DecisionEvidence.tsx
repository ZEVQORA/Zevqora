import { useState } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, Check, Fingerprint, ShieldCheck, X } from "lucide-react";
import { useSiteContent } from "@/lib/site";
import { ZevqoraMark } from "@/brand/ZevqoraMark";

function QualityDial({ quality, floor }: { quality: number; floor: number }) {
  const angle = ((135 + Math.min(1, Math.max(0, floor)) * 270) * Math.PI) / 180;
  const x = 110 + Math.cos(angle) * 82,
    y = 110 + Math.sin(angle) * 82;
  return (
    <svg
      viewBox="0 0 220 215"
      className="decision-dial"
      role="img"
      aria-label={`Quality ${quality.toFixed(2)}, required floor ${floor.toFixed(2)}`}
    >
      <circle
        cx="110"
        cy="110"
        r="82"
        fill="none"
        stroke="#e7edf6"
        strokeWidth="15"
        pathLength="100"
        strokeDasharray="75 25"
        transform="rotate(135 110 110)"
        strokeLinecap="round"
      />
      <circle
        cx="110"
        cy="110"
        r="82"
        fill="none"
        stroke="currentColor"
        strokeWidth="15"
        pathLength="100"
        strokeDasharray={`${Math.min(1, Math.max(0, quality)) * 75} 100`}
        transform="rotate(135 110 110)"
        strokeLinecap="round"
        className="decision-dial-fill"
      />
      {Array.from({ length: 21 }, (_, i) => {
        const a = ((135 + (i / 20) * 270) * Math.PI) / 180;
        return (
          <line
            key={i}
            x1={110 + Math.cos(a) * 96}
            y1={110 + Math.sin(a) * 96}
            x2={110 + Math.cos(a) * 100}
            y2={110 + Math.sin(a) * 100}
            stroke="#a9b8cc"
            strokeWidth="1"
          />
        );
      })}
      <circle
        cx={x}
        cy={y}
        r="5"
        fill="#142a4d"
        stroke="white"
        strokeWidth="2"
      />
      <text x="110" y="108" textAnchor="middle" className="dial-value">
        {quality.toFixed(2)}
      </text>
      <text x="110" y="132" textAnchor="middle" className="dial-label">
        QUALITY SCORE
      </text>
      <text x="110" y="183" textAnchor="middle" className="dial-floor">
        {floor.toFixed(2)} REQUIRED FLOOR
      </text>
    </svg>
  );
}

export function DecisionEvidence() {
  const { proof } = useSiteContent();
  const [kind, setKind] = useState<"rejected" | "verified">("rejected");
  const reduced = useReducedMotion();
  const chosen = proof[kind];
  const reduction = Number.parseFloat(chosen.cost_reduction);
  const candidateCost = Math.max(0, 100 - reduction);
  return (
    <section className={`decision-evidence is-${kind}`} id="proof">
      <div className="engine-section-meta">
        <span>THE EVIDENCE</span>
        <span>03 / A BETTER STANDARD</span>
      </div>
      <div className="decision-layout">
        <div className="decision-intro">
          <span className="decision-eyebrow">
            <ShieldCheck size={15} /> QUALITY GETS THE FINAL SAY
          </span>
          <h2>
            The biggest
            <br />
            saving?
            <br />
            <span>We rejected it.</span>
          </h2>
          <p>
            A lighter bill only matters if your product still works. Here’s the
            decision behind the number.
          </p>
          <Link to="/proof" className="decision-evidence-link">
            Read the full evidence
            <ArrowUpRight size={18} />
          </Link>
        </div>
        <div className="decision-workbench">
          <div
            className="decision-switch"
            role="group"
            aria-label="Benchmark result"
          >
            <button
              type="button"
              aria-pressed={kind === "rejected"}
              onClick={() => setKind("rejected")}
            >
              <span className="decision-switch-icon">
                <X size={15} />
              </span>
              <span>
                <b>Rejected candidate</b>
                <small>Cheaper didn’t make it better.</small>
              </span>
            </button>
            <button
              type="button"
              aria-pressed={kind === "verified"}
              onClick={() => setKind("verified")}
            >
              <span className="decision-switch-icon">
                <Check size={15} />
              </span>
              <span>
                <b>Candidate D</b>
                <small>The evidence earned a pass.</small>
              </span>
            </button>
          </div>
          <div className="decision-card-shell">
            <span className="decision-back-sheet" aria-hidden />
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={kind}
                className="decision-card"
                initial={reduced ? false : { opacity: 0, y: 14, rotate: 0.6 }}
                animate={{ opacity: 1, y: 0, rotate: 0 }}
                exit={{ opacity: 0, y: reduced ? 0 : -8 }}
                transition={{ duration: 0.28 }}
              >
                <header>
                  <span>
                    <Fingerprint size={15} /> INTERNAL REPLAY / {proof.cases}{" "}
                    CASES
                  </span>
                  <ZevqoraMark height={23} />
                </header>
                <div className="decision-card-body">
                  <div className="decision-cost">
                    <span>LOWER MEASURED INFERENCE COST</span>
                    <strong>
                      {chosen.cost_reduction.replace("%", "")}
                      <small>%</small>
                    </strong>
                    <div className="decision-cost-bars">
                      <div>
                        <span>Baseline</span>
                        <i>
                          <b style={{ width: "100%" }} />
                        </i>
                        <small>100%</small>
                      </div>
                      <div>
                        <span>Candidate</span>
                        <i>
                          <b style={{ width: `${candidateCost}%` }} />
                        </i>
                        <small>{candidateCost.toFixed(2)}%</small>
                      </div>
                    </div>
                  </div>
                  <QualityDial
                    quality={Number(chosen.quality)}
                    floor={Number(chosen.quality_floor)}
                  />
                </div>
                <div className="decision-verdict">
                  <span className="decision-verdict-icon">
                    {kind === "rejected" ? (
                      <X size={21} />
                    ) : (
                      <Check size={21} />
                    )}
                  </span>
                  <div>
                    <strong>
                      {kind === "rejected"
                        ? "Cheaper. Still rejected."
                        : "Quality passed. Evidence attached."}
                    </strong>
                    <p>
                      {kind === "rejected"
                        ? `Quality ${chosen.quality} missed the ${chosen.quality_floor} floor. This candidate never became a recommendation.`
                        : "The confidence interval crosses zero. The reduction is a point estimate, not a conclusive saving."}
                    </p>
                  </div>
                </div>
                <footer>
                  <span>
                    {kind === "rejected"
                      ? "REJECTED / QUALITY FLOOR"
                      : "PASSED GATES / POINT ESTIMATE"}
                  </span>
                  <span>MEASURE → REPLAY → VERIFY</span>
                </footer>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
      <div className="decision-qualifier">
        <ShieldCheck size={15} />
        <p>{proof.qualifier}</p>
        <span>
          {proof.cases} CASES
          <br />
          INTERNAL BENCHMARK
        </span>
      </div>
    </section>
  );
}
