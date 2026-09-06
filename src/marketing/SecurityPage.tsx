import { useEffect } from 'react';
import { Check, X } from 'lucide-react';
import { Section, Reveal } from './Sections';
import { useSiteContent } from '@/lib/site';
import { Code } from '@/components/ui/Misc';

export default function SecurityPage() {
  const { contact } = useSiteContent();
  useEffect(() => {
    document.title = 'Security — ZEVQORA';
  }, []);
  const reads = ['Provider and model per call', 'Input, output and cached token counts', 'Latency and status (ok, error, timeout)', 'Provider-reported cost, or a labelled estimate', 'A hash of the prompt for repeat detection', 'Opt-in, sanitized request and response samples'];
  const never = ['Your source code (the desktop engine scans it locally)', 'Environment variables or credentials', 'Images, files or tool payloads inside prompts', 'Anything from a revoked connection'];
  return (
    <>
      <Section rule={false} className="studio pt-14 lg:pt-20">
        <div className="container-page">
          <Reveal>
            <p className="text-eyebrow uppercase text-muted">Security</p>
            <h1 className="text-display mt-5 max-w-[14ch] text-ink">Least privilege, by construction.</h1>
            <p className="text-body-lg mt-6 max-w-[56ch] text-muted">ZEVQORA is designed to be handed a real production workload. Everything below is how the system is built today, not a roadmap.</p>
          </Reveal>
        </div>
      </Section>
      <Section surface="sunken">
        <div className="container-page grid gap-8 lg:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface p-7">
            <h2 className="text-h3 text-ink">What a telemetry connection reads</h2>
            <ul className="mt-5 space-y-2.5">
              {reads.map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-caption text-muted">
                  <Check size={14} className="mt-0.5 shrink-0 text-verified" aria-hidden /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-line bg-surface p-7">
            <h2 className="text-h3 text-ink">What it never touches</h2>
            <ul className="mt-5 space-y-2.5">
              {never.map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-caption text-muted">
                  <X size={14} className="mt-0.5 shrink-0 text-rejected" aria-hidden /> {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>
      <Section>
        <div className="container-page grid gap-12 lg:grid-cols-2 lg:gap-16">
          {[
            ['Identity and access', ['Supabase Auth with Google, GitHub and email/password. Sessions use the PKCE flow.', 'Workspaces isolate all data. Row-level security policies enforce membership on every read; every write goes through the server API, which re-checks the caller&rsquo;s role.', 'Roles: owner, admin, member, viewer. Only the owner can grant or revoke admin.', 'The internal admin panel is gated by a server-enforced admin role and every sensitive action is written to an audit log.']],
            ['Connection tokens', ['Tokens are 256-bit random secrets. Only a SHA-256 hash is stored; the token is shown exactly once at creation.', 'Every token is scoped to one project and one purpose (telemetry write). A workspace id is never accepted as authorization on its own.', 'Tokens can be rotated and revoked at any time. Revocation is immediate and deletes the stored hash.']],
            ['Platform provider credential', ['Replays run on ZEVQORA&rsquo;s own OpenRouter credential, held only in server environment variables.', 'The browser never receives a provider key. Requests flow browser → authenticated ZEVQORA API → authorization → plan and credit checks → rate limits → provider → normalized response → usage accounting.', 'Provider errors are sanitized before they reach a client.']],
            ['Data minimization and retention', ['Samples are opt-in per connection, capped in size, stripped of non-text content, and passed through secret redaction before storage.', 'Telemetry is purged automatically at the end of the plan retention window (7 to 365 days) or the shorter workspace setting.', 'Experiments store output hashes and short previews, never full candidate transcripts.']],
            ['Evidence integrity', ['Every experiment records its gate version, grader version, sample ids, models and a provenance hash of its cases.', 'Historical benchmark evidence in the repository is immutable and verified in CI.', 'A candidate can only become Verified Savings by passing every named gate on a replay.']],
            ['Transport and headers', ['HTTPS everywhere with HSTS preload. Strict Content Security Policy, no third-party scripts, self-hosted fonts.', 'The API accepts JSON only, with body size limits and per-route rate limits.']],
          ].map(([title, points]) => (
            <Reveal key={title as string}>
              <h2 className="text-h3 text-ink">{title as string}</h2>
              <ul className="mt-4 space-y-3">
                {(points as string[]).map((p) => (
                  <li key={p} className="text-caption text-muted" dangerouslySetInnerHTML={{ __html: p }} />
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
      </Section>
      <Section surface="sunken">
        <div className="container-page grid gap-10 lg:grid-cols-[1fr_1fr]">
          <div>
            <p className="text-eyebrow uppercase text-muted">Telemetry payload</p>
            <h2 className="text-h2 mt-4 text-ink">Exactly what leaves your server.</h2>
            <p className="text-caption mt-3 max-w-[50ch] text-muted">One HTTPS POST per batch, authenticated with the connection token. The sample block is only sent if you choose to include it.</p>
          </div>
          <Code block>{`POST /api/telemetry/ingest
Authorization: Bearer zqt_••••••••_••••

{ "events": [{
  "trace_id": "req_8f2c44",
  "occurred_at": "2026-09-06T09:41:12Z",
  "provider": "openai",
  "model": "gpt-4o",
  "operation": "classify.intent",
  "status": "ok",
  "input_tokens": 812, "output_tokens": 14,
  "latency_ms": 1980,
  "cost_usd": 0.0188
}] }`}</Code>
        </div>
      </Section>
      <Section>
        <div className="container-page">
          <h2 className="text-h3 text-ink">Responsible disclosure</h2>
          <p className="text-caption mt-3 max-w-[56ch] text-muted">
            Found a vulnerability? Email <a className="text-ink underline underline-offset-4" href={`mailto:${contact.email}`}>{contact.email}</a>. We acknowledge reports within two business days and never take action against good-faith research.
          </p>
        </div>
      </Section>
    </>
  );
}
