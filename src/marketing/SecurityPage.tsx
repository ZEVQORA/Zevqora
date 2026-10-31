import {
  ArrowUpRight,
  Database,
  EyeOff,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { Code } from "@/components/ui/Misc";
import { useSiteContent } from "@/lib/site";
import { EndCta, Kicker, PageTitle, Rise } from "./Editorial";
import { SecurityBoundary } from "./ExperienceSections";

const CONTROLS = [
  {
    Icon: Fingerprint,
    title: "Identity & workspace access",
    body: "Supabase Auth with Google, GitHub or email/password. Workspace membership is checked with row-level security on reads and server-enforced roles on writes. Sensitive admin changes are audited.",
  },
  {
    Icon: KeyRound,
    title: "Scoped, revocable tokens",
    body: "Telemetry tokens use 256-bit random secrets. Only their SHA-256 hashes are stored, and each token is shown once. Connections are scoped to one project and can be revoked or rotated.",
  },
  {
    Icon: EyeOff,
    title: "Less data, by design",
    body: "Metadata is the default. Samples are opt-in, size-limited and passed through secret redaction. Repository scans happen on your machine and skip secret-like paths.",
  },
  {
    Icon: LockKeyhole,
    title: "Credentials stay server-side",
    body: "Platform replays use a server-held provider credential. The API checks session, role, plan, credit and rate limits before calling the provider. Provider errors are sanitized.",
  },
  {
    Icon: Database,
    title: "Retention you can see",
    body: "Telemetry is purged at the plan retention window or your shorter workspace setting. Experiments retain provenance, hashes and short output previews rather than full candidate transcripts.",
  },
  {
    Icon: ShieldCheck,
    title: "Evidence you can inspect",
    body: "Experiments keep the gate and grader versions, samples, models and provenance hash. Historical benchmark packs are immutable and checked in CI. Shipping a change still requires a person.",
  },
];
export default function SecurityPage() {
  const { contact } = useSiteContent();
  return (
    <>
      <PageTitle title="Security" />
      <section
        className="z-wrap security-layout"
        style={{ paddingBlock: "80px 70px" }}
      >
        <div>
          <Kicker>TRUSTED BY DESIGN</Kicker>
          <h1 className="z-display" style={{ marginTop: 26 }}>
            Built to respect
            <br />
            <span>your boundaries.</span>
          </h1>
          <p className="z-lede" style={{ marginTop: 28 }}>
            What we read. What stays local. Who gets to change what. Security
            should be understandable before you connect a thing.
          </p>
          <a className="z-text-link" href="#controls" style={{ marginTop: 22 }}>
            Read the controls
            <ArrowUpRight size={15} />
          </a>
        </div>
        <Rise>
          <SecurityBoundary />
        </Rise>
      </section>
      <section className="z-section" id="controls">
        <div className="z-wrap security-details">
          {CONTROLS.map(({ Icon, title, body }) => (
            <Rise key={title} className="security-detail">
              <Icon size={29} />
              <h3>{title}</h3>
              <p>{body}</p>
            </Rise>
          ))}
        </div>
      </section>
      <section className="z-section proof-section">
        <div className="z-wrap loop-layout">
          <div>
            <Kicker>THE PAYLOAD, IN PLAIN SIGHT</Kicker>
            <h2 className="z-heading" style={{ marginTop: 24 }}>
              Exactly what
              <br />
              leaves your runtime.
            </h2>
            <p className="z-body" style={{ marginTop: 23 }}>
              A batch of call metadata over HTTPS, authenticated with a
              connection token. A sample block is only sent when you choose to
              include one.
            </p>
            <p className="z-body" style={{ marginTop: 15 }}>
              No SSH access. No remote shell. No platform scan of your source
              code.
            </p>
          </div>
          <div className="security-code">
            <Code
              block
            >{`POST /api/telemetry/ingest\nAuthorization: Bearer zqt_••••••••_••••\n\n{ "events": [{\n  "trace_id": "req_8f2c44",\n  "provider": "openai",\n  "model": "gpt-4o",\n  "operation": "classify.intent",\n  "status": "ok",\n  "input_tokens": 812,\n  "output_tokens": 14,\n  "latency_ms": 1980,\n  "cost_usd": 0.0188\n}] }`}</Code>
          </div>
        </div>
      </section>
      <section className="z-section">
        <div className="z-wrap">
          <Kicker>RESPONSIBLE DISCLOSURE</Kicker>
          <h2 className="z-heading" style={{ marginTop: 24 }}>
            A direct line
            <br />
            to the people building it.
          </h2>
          <p className="z-lede" style={{ marginTop: 25 }}>
            Found a vulnerability? Send the details to the team. We acknowledge
            reports within two business days and welcome good-faith research.
          </p>
          <a
            className="z-text-link"
            href={`mailto:${contact.email}`}
            style={{ marginTop: 20 }}
          >
            {contact.email}
            <ArrowUpRight size={15} />
          </a>
        </div>
      </section>
      <EndCta />
    </>
  );
}
