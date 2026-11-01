import { ArrowUpRight, FileCheck2 } from "lucide-react";
import { useSiteContent } from "@/lib/site";
import { EndCta, Intro, Kicker, PageTitle, Rise } from "./Editorial";
import { ProofCards } from "./ExperienceSections";

export default function ProofPage() {
  const { proof } = useSiteContent();
  return (
    <>
      <PageTitle title="Proof" />
      <Intro
        kicker="THE EVIDENCE, WITH ITS LIMITS"
        title={
          <>
            Show the work.
            <br />
            <span>Keep the context.</span>
          </>
        }
        body="A claim is only as useful as the evidence behind it. Here is what our internal benchmark found, what it rejected, and what it does not prove."
      />
      <section className="z-section proof-section">
        <div className="z-wrap">
          <div className="z-section-head">
            <div>
              <Kicker>INTERNAL DOGFOODING BENCHMARK</Kicker>
              <h2 className="z-heading">
                The bigger saving
                <br />
                didn’t make the cut.
              </h2>
            </div>
            <p>
              {proof.cases} internal cases. A frozen quality floor. Both
              outcomes stay visible.
            </p>
          </div>
          <ProofCards />
          <p className="proof-qualifier">{proof.qualifier}</p>
        </div>
      </section>
      <section className="z-section">
        <div className="z-wrap loop-layout">
          <Rise>
            <Kicker>READ THE NUMBERS CORRECTLY</Kicker>
            <h2 className="z-heading" style={{ marginTop: 24 }}>
              A passed gate
              <br />
              isn’t a guarantee.
            </h2>
            <p className="z-body" style={{ marginTop: 25 }}>
              Candidate D passed the benchmark’s gates. Its measured cost
              reduction is a point estimate. The confidence interval includes
              zero, so this is not conclusive proof of a saving.
            </p>
            <a
              href="https://github.com/ZEVQORA/Zevqora/tree/main/docs/evidence/candidate-d"
              target="_blank"
              rel="noreferrer"
              className="z-text-link"
              style={{ marginTop: 15 }}
            >
              Inspect the evidence pack
              <ArrowUpRight size={15} />
            </a>
          </Rise>
          <div className="proof-card verified">
            <div className="proof-status">
              <span className="z-status blue">
                <FileCheck2 size={12} /> BENCHMARK RECORD
              </span>
              <span>CANDIDATE D</span>
            </div>
            <dl className="proof-record">
              {[
                ["Cases", String(proof.cases)],
                ["Quality score", proof.verified.quality],
                ["Frozen quality floor", proof.verified.quality_floor],
                [
                  "Cost reduction · point estimate",
                  proof.verified.cost_reduction,
                ],
                ["95% confidence interval", proof.verified.ci95],
                ["Customer production evidence", "No"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>
      <section className="z-section">
        <div className="z-wrap">
          <Kicker>WHAT COMES NEXT</Kicker>
          <h2 className="z-heading" style={{ marginTop: 24 }}>
            Real workloads.
            <br />
            Honest attribution.
          </h2>
          <p className="z-lede" style={{ marginTop: 24 }}>
            The DUREM evaluation is an affiliated design-partner pilot: the
            founder built the partner system. That affiliation is disclosed with
            the evaluation. Its protocol and context belong with its results.
          </p>
          <a
            href="https://github.com/ZEVQORA/Zevqora/tree/main/docs/evidence/durem-affiliated-eval-v1"
            className="z-text-link"
            target="_blank"
            rel="noreferrer"
            style={{ marginTop: 20 }}
          >
            Read the evaluation protocol
            <ArrowUpRight size={15} />
          </a>
        </div>
      </section>
      <EndCta />
    </>
  );
}
