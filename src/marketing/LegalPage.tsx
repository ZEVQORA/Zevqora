import { useEffect } from "react";
import { Intro } from "./Editorial";
import { useSiteContent } from "@/lib/site";

const PRIVACY = [
  [
    "What we collect",
    "Account data (email, name, username, login provider), workspace and project metadata, AI call telemetry sent by connections you create (provider, model, token counts, latency, status, cost, prompt hashes), optional sanitized samples you choose to capture, usage and credit records, and standard server logs.",
  ],
  [
    "What we do not collect",
    "We do not read your source code from the platform, we do not accept environment variables or credentials, and we strip images, files and tool payloads from any sample before storage. Known secret shapes are redacted.",
  ],
  [
    "How we use it",
    "To map AI spend, diagnose waste, replay candidates on your samples, verify results, account for usage and provide support. We do not sell data and we do not train models on customer data.",
  ],
  [
    "Providers",
    "Replay experiments send your captured samples to the model provider selected for the candidate through OpenRouter, using ZEVQORA&rsquo;s own credential, solely to produce the candidate output for comparison.",
  ],
  [
    "Retention",
    "Telemetry is deleted at the end of your plan&rsquo;s retention window or the shorter window you configure per workspace. Account data is retained while the account exists. Contact us to delete an account.",
  ],
  [
    "Security",
    "Row-level security, server-enforced roles, hashed connection tokens, strict transport security and a content security policy. See the Security page for the full overview.",
  ],
  [
    "Your rights",
    "You can export reports, revoke connections, remove members and request deletion at any time. Email us for access or deletion requests.",
  ],
];

const TERMS = [
  [
    "The service",
    "ZEVQORA provides analysis, replay and verification tooling for AI workloads. Results are evidence about your own samples; they are not guarantees of production savings.",
  ],
  [
    "Your responsibilities",
    "You are responsible for the data you send through connections, for keeping tokens confidential, for the accounts you invite into your workspace and for reviewing any change before you ship it. ZEVQORA never merges or deploys on your behalf.",
  ],
  [
    "Plans and credit",
    "Plan limits are enforced on the server. Zev credit resets each billing period, is consumed only by provider cost during replay and is not refundable. Prices are shown on the pricing page and may change with notice.",
  ],
  [
    "Acceptable use",
    "No abuse of the platform credential, no attempts to access other workspaces, no reverse engineering of the verification gates to force a pass. We may suspend accounts that violate these terms.",
  ],
  [
    "Availability",
    "The service is in private beta and provided as is. We aim for high availability but do not promise it. Historical evidence is immutable; product features may change.",
  ],
  [
    "Liability",
    "To the extent permitted by law, ZEVQORA&rsquo;s liability is limited to the fees you paid in the three months before a claim.",
  ],
];

export default function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const { contact } = useSiteContent();
  const items = kind === "privacy" ? PRIVACY : TERMS;
  useEffect(() => {
    document.title = `${kind === "privacy" ? "Privacy" : "Terms"} — ZEVQORA`;
  }, [kind]);
  const title =
    kind === "privacy" ? "Your data. Your trust." : "A clear agreement.";
  return (
    <>
      <Intro
        kicker={kind === "privacy" ? "PRIVACY POLICY" : "TERMS OF SERVICE"}
        title={title}
        body={
          kind === "privacy"
            ? "What we collect, why we collect it, and the choices you keep."
            : "The terms you accept when using ZEVQORA."
        }
      >
        <p className="plan-reference">Last updated 2026-09-06</p>
      </Intro>
      <div className="z-wrap legal-layout">
        <nav className="legal-nav" aria-label="On this page">
          {items.map(([t], i) => (
            <a href={`#legal-${i}`} key={t}>
              {String(i + 1).padStart(2, "0")} / {t}
            </a>
          ))}
        </nav>
        <article className="legal-article">
          {items.map(([t, b], i) => (
            <div id={`legal-${i}`} key={t}>
              <h2>{t}</h2>
              <p dangerouslySetInnerHTML={{ __html: b }} />
            </div>
          ))}
          <p style={{ marginTop: 25 }}>
            Questions:{" "}
            <a className="z-text-link" href={`mailto:${contact.email}`}>
              {contact.email}
            </a>
          </p>
        </article>
      </div>
    </>
  );
}
