import { useEffect } from "react";
import { Intro } from "./Editorial";
import { useSiteContent } from "@/lib/site";

const PRIVACY = [
  ['What we collect', 'Account data (email, name, username, login provider), workspace and project metadata, AI call telemetry sent by connections you create (provider, model, token counts, latency, status, cost, prompt hashes), optional sanitized samples you choose to capture, execution traces you import (including the prompts and outputs they contain), candidate outputs from replays you run, usage and credit records, and standard server logs.'],
  ['What we do not collect', 'We do not upload your repository: scans run on your device and send only AI call locations and findings. If you ask ZEVQORA to prepare a change, the one file being changed is sent to generate the patch, and the patch is stored with the change. We do not accept environment variables or credentials, and we strip images, files and tool payloads from runtime samples before storage. Known secret shapes are redacted.'],
  ['Website analytics', 'When enabled, our website records first-party page views and button clicks without cookies or third-party scripts: the page path (no query string), the referring site&rsquo;s domain, campaign tags, an approximate country and region from our hosting provider, device and browser family, a random id kept in your browser&rsquo;s session storage for the current tab, and a visitor key that is a keyed hash of your IP address and browser that changes every day. We do not store your IP address in analytics. If your browser sends Do Not Track or Global Privacy Control, nothing is recorded. Website events are deleted after 400 days so year-over-year trends can be compared.'],
  ['Product usage and security records', 'Inside the product we record which steps you complete (for example workspace created, baseline built, plan selected) as ids and counts, never prompts or outputs. To protect accounts we log failed sign-ins, denied requests and server errors with a truncated IP prefix and a keyed hash of the address; only ZEVQORA administrators can read these records, every read is logged, and they are deleted after 90 days.'],
  ['Evaluation requests', 'If you request an evaluation we store your name, work email, company, role, the workflow you describe and how you found us, to reply to you. A person reads every request. We keep requests until you ask us to delete them.'],
  ['How we use it', 'To map AI spend, diagnose waste, replay candidates on your samples, verify results, account for usage and provide support. We do not sell data and we do not train models on customer data.'],
  ['Providers', 'Replay experiments send your captured samples to the model provider selected for the candidate through OpenRouter, using ZEVQORA&rsquo;s own credential, solely to produce the candidate output for comparison.'],
  ['Retention', 'Runtime telemetry is deleted at the end of your plan&rsquo;s retention window or the shorter window you configure per workspace. Imported traces and the evaluations computed from them are kept as evidence until you ask us to delete them. Account data is retained while the account exists. Contact us to delete an account.'],
  ['Security', 'Row-level security, server-enforced roles, hashed connection tokens, strict transport security and a content security policy. See the Security page for the full overview.'],
  ['Your rights', 'You can export reports, revoke connections, remove members and request deletion at any time. Email us for access or deletion requests.'],
];

const TERMS = [
  ['The service', 'ZEVQORA provides analysis, replay and verification tooling for AI workloads. Results are evidence about your own samples; they are not guarantees of production savings.'],
  ['Your responsibilities', 'You are responsible for the data you send through connections, for keeping tokens confidential, for the accounts you invite into your workspace and for reviewing any change before you ship it. ZEVQORA never merges or deploys on your behalf.'],
  ['Plans and credit', 'Plan limits are enforced on the server. Zev credit resets each billing period, is consumed only by provider cost during replay and is not refundable. Prices are shown on the pricing page and may change with notice.'],
  ['Acceptable use', 'No abuse of the platform credential, no attempts to access other workspaces, no reverse engineering of the verification gates to force a pass. We may suspend accounts that violate these terms.'],
  ['Availability', 'The service is in private beta and provided as is. We aim for high availability but do not promise it. Historical evidence is immutable; product features may change.'],
  ['Liability', 'To the extent permitted by law, ZEVQORA&rsquo;s liability is limited to the fees you paid in the three months before a claim.'],
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
        <p className="plan-reference">Last updated 2026-10-12</p>
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
