import { Link } from 'react-router';
import { ArrowUpRight, Check, LockKeyhole, Minus, ShieldCheck, Users } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useSiteContent } from '@/lib/site';
import { ENTERPRISE_REQUEST_API_AVAILABLE, type EnterpriseFeature } from '@/lib/contracts/enterprise';
import { SERVER_ACTIONS, roleAllows } from '@/lib/contracts/roles';

/** No enterprise capability endpoint exists in this release: every status is PROPOSED or REQUEST-only. */
const CAPABILITIES: Array<{ key: EnterpriseFeature; title: string; body: string; status: string }> = [
  { key: 'sso', title: 'SSO / SAML / OIDC', body: 'Verified domain, identity provider metadata and sign-in controls.', status: 'REQUEST SETUP · NOT CONNECTED' },
  { key: 'scim', title: 'SCIM provisioning', body: 'Directory sync and controlled user lifecycle.', status: 'PROPOSED · NOT CONNECTED' },
  { key: 'data_residency', title: 'Data residency', body: 'Region and storage policy must be agreed and verified.', status: 'REQUEST REVIEW' },
  { key: 'retention_controls', title: 'Retention & redaction', body: 'Review supported workspace settings and evidence retention boundaries.', status: 'VERIFY WITH SECURITY' },
  { key: 'audit_export', title: 'Workspace audit export', body: 'Tenant-scoped activity export requires a tested backend capability.', status: 'PROPOSED · NOT CONNECTED' },
  { key: 'billing_procurement', title: 'Enterprise procurement', body: 'Quotes, agreements, billing contacts and invoices are reviewed by the team.', status: 'CONTACT SALES' },
  { key: 'private_deployment', title: 'Private deployment', body: 'Infrastructure design and security review are required.', status: 'REQUEST REVIEW' },
];

/**
 * Enterprise surface for the signed-in workspace. Shows the verified role from
 * /api/me and what the server lets that role do; it never mutates settings
 * and never claims SSO, SCIM, regions, certifications or private deployment.
 */
export default function EnterpriseView() {
  const { activeWorkspace, status } = useSession();
  const { contact } = useSiteContent();
  const role = activeWorkspace?.role ?? null;
  const features = activeWorkspace?.features;
  const canRequest = role === 'owner' || role === 'admin';
  const optimizationOn = Boolean(features?.verified_optimization_vnext);
  const subject = encodeURIComponent('ZEVQORA Enterprise evaluation request');
  const body = encodeURIComponent('I would like to discuss ZEVQORA enterprise setup, capabilities, security review and procurement. Please contact me.');
  return (
    <div className="mx-auto w-full max-w-[1180px]">
      <div className="relative overflow-hidden rounded-[24px] bg-[#0F1115] px-6 py-9 text-[#F7F8FA] sm:px-10 lg:grid lg:grid-cols-[1.4fr_0.6fr] lg:items-center">
        <div>
          <p className="font-mono text-[12px] uppercase tracking-widest text-[#8ab6ff]">Enterprise · Permission aware</p>
          <h1 className="mt-4 max-w-[20ch] text-[clamp(2rem,4.2vw,3.5rem)] font-semibold leading-[1.1] tracking-tight">Enterprise controls, without the guesswork.</h1>
          <p className="mt-5 max-w-[58ch] text-[15px] leading-relaxed text-white/70 sm:text-[16px]">See what is already supported, what needs setup and what requires a separate security or procurement decision. Nothing here turns on SSO, compliance or production deployment.</p>
        </div>
        <div aria-hidden className="mt-8 hidden items-center justify-center sm:flex lg:mt-0"><ShieldCheck size={104} strokeWidth={1} className="text-[#468BFF]" /></div>
      </div>

      <dl className="mt-6 grid gap-x-6 gap-y-2 rounded-xl border border-line bg-surface p-4 text-[13px] text-muted sm:grid-cols-3">
        <div><dt className="font-semibold text-ink">Workspace</dt><dd>{activeWorkspace?.name ?? 'None selected'}</dd></div>
        <div><dt className="font-semibold text-ink">Your role (server-verified)</dt><dd className="font-mono uppercase">{role ?? 'Unavailable'}</dd></div>
        <div><dt className="font-semibold text-ink">Capability source</dt><dd>Workspace role and flags from /api/me; no enterprise capability API yet</dd></div>
      </dl>

      <section className="mt-8" aria-labelledby="zq-role-caps">
        <h2 id="zq-role-caps" className="text-[20px] font-semibold text-ink">What your role can do here</h2>
        <p className="mt-1 max-w-[70ch] text-[14px] leading-relaxed text-muted">The API enforces these minimum roles on every request. CEO / CTO / Developer view only changes emphasis — it never grants an action.</p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[520px] text-left text-[13px]">
            <thead className="border-b border-line bg-sunken text-[12px] text-muted">
              <tr><th scope="col" className="px-4 py-2.5 font-medium">Action</th><th scope="col" className="px-4 py-2.5 font-medium">Minimum role</th><th scope="col" className="px-4 py-2.5 font-medium">You</th></tr>
            </thead>
            <tbody>
              {SERVER_ACTIONS.map((a) => {
                const ok = roleAllows(role, a.minRole);
                return (
                  <tr key={a.key} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 text-ink">{a.label}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px] uppercase text-muted">{a.minRole}</td>
                    <td className="px-4 py-2.5">
                      {ok
                        ? <span className="inline-flex items-center gap-1.5 text-verified"><Check size={14} aria-hidden /> Allowed</span>
                        : <span className="inline-flex items-center gap-1.5 text-muted"><Minus size={14} aria-hidden /> Not with your role</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <article className="rounded-[18px] border border-line bg-surface p-6"><Users size={23} className="text-accent-text" aria-hidden /><h2 className="mt-4 text-[18px] font-semibold text-ink">Team and access</h2><p className="mt-2 text-[14px] leading-relaxed text-muted">Workspace members and roles are server-enforced. Presentation view is not permission.</p><Link to="/app/team" className="mt-4 inline-flex min-h-11 items-center gap-2 text-[13px] font-medium text-accent-text underline underline-offset-4">Workspace members <ArrowUpRight size={14} aria-hidden /></Link></article>
        <article className="rounded-[18px] border border-line bg-surface p-6"><LockKeyhole size={23} className="text-accent-text" aria-hidden /><h2 className="mt-4 text-[18px] font-semibold text-ink">Data boundary</h2><p className="mt-2 text-[14px] leading-relaxed text-muted">ZevIR graphs keep hashes, sizes and timings, not content. Row-level security and server-side authorization still need independent staging verification.</p><Link to="/security" className="mt-4 inline-flex min-h-11 items-center gap-2 text-[13px] font-medium text-accent-text underline underline-offset-4">Security model <ArrowUpRight size={14} aria-hidden /></Link></article>
        <article className="rounded-[18px] border border-line bg-surface p-6">
          <ShieldCheck size={23} className="text-accent-text" aria-hidden />
          <h2 className="mt-4 text-[18px] font-semibold text-ink">Human change approval</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-muted">Frozen evaluation gates, bounded replay and a recorded human decision. Verified is not deployed.</p>
          <p className="mt-3 font-mono text-[11px] uppercase tracking-wider text-muted">{optimizationOn ? 'Enabled for this workspace (flag on)' : 'Not enabled for this workspace (flag off)'}</p>
          {optimizationOn && <Link to="/app/optimize" className="mt-3 inline-flex min-h-11 items-center gap-2 text-[13px] font-medium text-accent-text underline underline-offset-4">Optimization workbench <ArrowUpRight size={14} aria-hidden /></Link>}
        </article>
      </div>

      <section className="mt-10" aria-labelledby="zq-ent-roadmap">
        <p className="font-mono text-[12px] uppercase tracking-widest text-accent-text">Setup and procurement</p>
        <h2 id="zq-ent-roadmap" className="mt-2 text-[22px] font-semibold text-ink">Explicit capability, explicit next action.</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <article key={c.key} className="rounded-[16px] border border-line bg-surface p-5">
              <div className="flex flex-wrap justify-between gap-2"><h3 className="text-[16px] font-semibold text-ink">{c.title}</h3><span className="rounded-md bg-sunken px-2 py-1 font-mono text-[10px] text-muted">{c.status}</span></div>
              <p className="mt-2 text-[14px] leading-relaxed text-muted">{c.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-10 rounded-[20px] border border-line bg-sunken p-6 sm:p-8" aria-labelledby="zq-ent-contact">
        <h2 id="zq-ent-contact" className="text-[22px] font-semibold text-ink">Discuss your requirements.</h2>
        <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-muted">
          {ENTERPRISE_REQUEST_API_AVAILABLE ? 'Requests are recorded for the team.' : 'This opens a pre-filled email — it is not a submitted ticket or an approved entitlement.'} Do not include production secrets or customer traces.
        </p>
        {status === 'signed_in' && !canRequest
          ? <p className="mt-5 rounded-lg border border-line bg-surface p-4 text-[14px]">A workspace owner or admin can start this request. Ask your administrator.</p>
          : <a href={`mailto:${contact.email}?subject=${subject}&body=${body}`} className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-xl bg-cta px-5 text-[14px] font-semibold text-cta-fg hover:bg-cta-hover">Email the enterprise team <ArrowUpRight size={16} aria-hidden /></a>}
      </section>
    </div>
  );
}
