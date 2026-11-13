import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Link } from "react-router";
import "./premium-narrative.css";

export function ClarityAudience() {
  return (
    <section className="zq-clarity-audience" aria-labelledby="zq-audience-heading">
      <div className="zq-premium-wrap">
        <div className="zq-premium-meta">
          <span>06 / WHO IT'S FOR</span>
          <span>BUILT AROUND REAL CUSTOMER WORKLOADS</span>
        </div>
        <div className="zq-audience-heading-row">
          <div>
            <p className="zq-premium-kicker">FOR PEOPLE WHO OWN THE OUTCOME</p>
            <h2 id="zq-audience-heading">
              You ship the AI.
              <span> You live with the consequences.</span>
            </h2>
          </div>
          <p>
            Start with one recurring workflow and the requirements your users
            already expect it to meet. Keep the scope explicit.
          </p>
        </div>
        <div className="zq-audience-rails">
          <article>
            <span>01 / AI PRODUCT TEAMS</span>
            <h3>Move beyond model-by-model savings.</h3>
            <p>Understand retries, chained calls and agent tools that can make a cheap request expensive in practice.</p>
            <Link to="/evaluation">Explore a scoped evaluation <ArrowRight size={17} aria-hidden="true" /></Link>
          </article>
          <article>
            <span>02 / RAG AND AGENT ENGINEERS</span>
            <h3>Protect the answer while changing the path.</h3>
            <p>Compare retrieval, context and execution choices against representative tasks rather than a single happy-path prompt.</p>
            <Link to="/proof">See how decisions are evaluated <ArrowRight size={17} aria-hidden="true" /></Link>
          </article>
        </div>
      </div>
    </section>
  );
}

export function ClarityClose() {
  return (
    <section className="zq-clarity-close" aria-labelledby="zq-close-heading">
      <div className="zq-premium-wrap zq-close-layout">
        <div>
          <p className="zq-premium-kicker">A LIGHTER WAY, WITH PROOF</p>
          <h2 id="zq-close-heading">One workload is enough to start learning.</h2>
          <p>Define the scope. Agree on the quality gates. Review the evidence before deciding what should change.</p>
        </div>
        <div className="zq-close-actions">
          <Link to="/evaluation" className="zq-close-primary">Explore an evaluation <ArrowUpRight size={19} aria-hidden="true" /></Link>
          <Link to="/product" className="zq-close-secondary">View current capabilities <ArrowRight size={18} aria-hidden="true" /></Link>
          <small>No customer savings, production deployment or integration is implied without verified evidence.</small>
        </div>
      </div>
    </section>
  );
}
