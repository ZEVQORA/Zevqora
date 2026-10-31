import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";

export function EngineEnd() {
  return (
    <section className="engine-end">
      <div className="engine-section-meta">
        <span>YOUR NEXT LIGHTER STEP</span>
        <span>THE FUTURE CARRIES LESS.</span>
      </div>
      <h2>
        Go build
        <br />
        <em>something</em>
        <br />
        <span>lighter.</span>
      </h2>
      <div className="engine-end-bottom">
        <p>
          Start with one workload.
          <br />
          See what your AI could stop carrying.
        </p>
        <Link to="/signup" className="engine-end-action">
          LET’S GET LIGHTER
          <ArrowUpRight size={36} />
        </Link>
        <Link to="/demo" className="engine-inline-link">
          Or take a look inside
          <ArrowUpRight size={15} />
        </Link>
      </div>
    </section>
  );
}
