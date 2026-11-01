import {
  Activity,
  ArrowDownRight,
  ChevronDown,
  FlaskConical,
  FolderGit2,
  GitPullRequest,
  LayoutDashboard,
  Lightbulb,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { ZevqoraLogo } from "@/brand/ZevqoraLogo";
import { ZevFace } from "@/brand/Zev";

export function SpendChart({
  compact = false,
  variant = 0,
}: {
  compact?: boolean;
  variant?: number;
}) {
  const baseline = variant
    ? "M0 67 C40 62 52 76 90 57 S145 43 180 50 S224 17 260 26 S304 40 340 23 S390 31 420 14 S463 20 500 7"
    : "M0 76 C40 72 52 82 90 61 S145 52 180 55 S224 27 260 35 S304 43 340 25 S390 37 420 19 S463 23 500 10";
  const candidate =
    "M0 87 C40 83 52 91 90 77 S145 75 180 77 S224 54 260 62 S304 70 340 56 S390 61 420 51 S463 56 500 44";
  return (
    <svg
      className="spend-chart"
      viewBox="-30 -10 560 145"
      role="img"
      aria-label="Illustrative baseline and candidate inference cost over seven days"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient
          id={`chart-fill-${compact ? "small" : "large"}-${variant}`}
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop offset="0%" stopColor="#468bff" stopOpacity=".13" />
          <stop offset="100%" stopColor="#468bff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 35, 70, 105].map((y, i) => (
        <g key={y}>
          <line
            x1="0"
            y1={y}
            x2="500"
            y2={y}
            stroke="#e9edf4"
            strokeWidth=".6"
            strokeDasharray="3 3"
          />
          <text
            x="-10"
            y={y + 3}
            textAnchor="end"
            fontSize="7"
            fill="#9ba7b8"
            fontFamily="monospace"
          >
            {["$60", "$40", "$20", "$0"][i]}
          </text>
        </g>
      ))}
      <path
        d={`${baseline} L500 105 L0 105Z`}
        fill={`url(#chart-fill-${compact ? "small" : "large"}-${variant})`}
      />
      <path d={baseline} fill="none" stroke="#468bff" strokeWidth="1.7" />
      <path
        d={candidate}
        fill="none"
        stroke="#aebdce"
        strokeWidth="1.3"
        strokeDasharray="4 4"
      />
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => (
        <text
          key={d}
          x={i * 83}
          y="126"
          textAnchor={i === 0 ? "start" : "middle"}
          fontSize="7"
          fill="#9ba7b8"
          fontFamily="monospace"
        >
          {d}
        </text>
      ))}
    </svg>
  );
}

export function ProductPreview({ view = "Overview" }: { view?: string }) {
  const isOpportunities = view === "Opportunities",
    isExperiments = view === "Experiments";
  return (
    <div className="preview-window">
      <aside className="preview-side" aria-hidden="true">
        <ZevqoraLogo size={17} />
        <div className="preview-side-nav">
          {[
            [LayoutDashboard, "Overview"],
            [FolderGit2, "Project"],
            [Lightbulb, "Opportunities"],
            [FlaskConical, "Experiments"],
            [GitPullRequest, "Changes"],
          ].map(([Icon, label]) => {
            const I = Icon as typeof LayoutDashboard;
            return (
              <span
                className={view === label ? "selected" : ""}
                key={String(label)}
              >
                <I size={12} />
                {String(label)}
              </span>
            );
          })}
          <small>WORKSPACE</small>
          <span>
            <Activity size={12} />
            Runtime
          </span>
          <span>
            <ShieldCheck size={12} />
            Evidence
          </span>
          <span>
            <Settings size={12} />
            Settings
          </span>
        </div>
      </aside>
      <div className="preview-content">
        <div className="preview-top">
          <span>
            Workspace / <b>Support intelligence</b>
          </span>
          <span>PRODUCT PREVIEW · SAMPLE DATA</span>
        </div>
        <div className="preview-heading">
          <div>
            <h3>{view}</h3>
            <p>
              {isOpportunities
                ? "A clear next step for every cost driver."
                : isExperiments
                  ? "Every candidate earns its result."
                  : "A lighter system starts with a clearer picture."}
            </p>
          </div>
          <span className="preview-period">
            Last 7 days <ChevronDown size={10} className="ml-2 inline" />
          </span>
        </div>
        <div className="preview-metrics">
          <div>
            <small>Measured AI spend</small>
            <strong>$2,481.60</strong>
            <em>From captured execution</em>
          </div>
          <div>
            <small>Potential savings</small>
            <strong>$428.20</strong>
            <em>
              <ArrowDownRight size={10} className="inline text-[#468bff]" />{" "}
              Estimate · not verified
            </em>
          </div>
          <div>
            <small>Quality floor</small>
            <strong>0.95</strong>
            <em>Configured before replay</em>
          </div>
        </div>
        {isOpportunities || isExperiments ? (
          <div className="preview-table-wrap">
            <table className="preview-table">
              <thead>
                <tr>
                  <th>{isExperiments ? "CANDIDATE" : "OPPORTUNITY"}</th>
                  <th>{isExperiments ? "QUALITY" : "STRATEGY"}</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {(isExperiments
                  ? [
                      ["Candidate A", "0.87 / 0.95", "Rejected"],
                      ["Candidate D", "0.97 / 0.95", "Verified*"],
                      ["Context trim", "Not evaluated", "Candidate"],
                    ]
                  : [
                      [
                        "Intent classification",
                        "Model routing",
                        "Ready to test",
                      ],
                      ["Repeated FAQ requests", "Exact cache", "Needs samples"],
                      [
                        "Long retrieval context",
                        "Context reduction",
                        "Ready to test",
                      ],
                    ]
                ).map(([a, b, c], i) => (
                  <tr key={a}>
                    <td>{a}</td>
                    <td>{b}</td>
                    <td>
                      <span
                        className={`z-status ${isExperiments ? (i === 0 ? "rejected" : i === 1 ? "verified" : "") : "blue"}`}
                      >
                        {c}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {isExperiments && (
              <p className="preview-disclaimer">
                *Internal benchmark point estimate. 95% CI crosses zero.
              </p>
            )}
          </div>
        ) : (
          <div className="preview-chart">
            <div className="chart-label">
              Inference cost{" "}
              <span>
                <i className="chart-dot" />
                Baseline&nbsp;&nbsp; ┄ Candidate
              </span>
            </div>
            <SpendChart compact />
          </div>
        )}
        <div className="preview-note">
          <ZevFace size={29} expression="calm-confidence" />
          <span>
            <b>Zev keeps the evidence in view.</b>{" "}
            {isExperiments
              ? "A lower cost only counts when quality holds."
              : "Potential is an estimate. Replay makes it testable."}
          </span>
        </div>
      </div>
    </div>
  );
}
