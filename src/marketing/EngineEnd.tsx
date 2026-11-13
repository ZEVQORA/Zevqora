import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";
import { useSession } from "@/lib/session";

export function EngineEnd() {
  const { status } = useSession();
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
        <Link to={status === "signed_in" ? "/app" : "/signup"} className="engine-end-action">
          {status === "signed_in" ? "OPEN WORKSPACE" : "START OPTIMIZING"}
          <ArrowUpRight size={36} />
        </Link>
        <Link to="/product" className="engine-inline-link">
          Or take a look inside
          <ArrowUpRight size={15} />
        </Link>
      </div>
    </section>
  );
}
