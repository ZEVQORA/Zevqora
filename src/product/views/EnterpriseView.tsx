import { Link } from 'react-router';
import { ArrowUpRight, LockKeyhole, ShieldCheck, Users } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useSiteContent } from '@/lib/site';
import type { EnterpriseFeature } from '@/lib/contracts/enterprise';

const CAPABILITIES: Array<{ key: EnterpriseFeature; title: string; body: string; status: string }> = [
  { key: 'sso', title: 'SSO / SAML / OIDC', body: 'Verified domain, identity provider metadata and sign-in controls.', status: 'REQUEST SETUP · NOT CONNECTED' },
  { key: 'scim', title: 'SCIM provisioning', body: 'Directory sync and controlled user lifecycle.', status: 'PLANNED · NOT CONNECTED' },
  { key: 'data_residency', title: 'Data residency', body: 'Region and storage policy must be agreed and verified.', status: 'REQUEST REVIEW' },
  { key: 'retention_controls', title: 'Retention & redaction', body: 'Review supported workspace settings and evidence retention boundaries.', status: 'VERIFY WITH SECURITY' },
  { key: 'audit_export', title: 'Workspace audit export', body: 'Tenant-scoped activity export requires a tested backend capability.', status: 'PROPOSED · NOT CONNECTED' },
  { key: 'approval_workflow', title: 'Human change approval', body: 'Frozen evaluation evidence and an explicitly authorized reviewer.', status: 'EXISTING EVALUATION · CHECK FLAGS' },
  { key: 'billing_procurement', title: 'Enterprise procurement', body: 'Quotes, agreements, billing contacts and invoices are reviewed by the team.', status: 'CONTACT SALES' },
  { key: 'private_deployment', title: 'Private deployment', body: 'Infrastructure design and security review are required.', status: 'REQUEST REVIEW' },
];
/** Frontend-ready enterprise request surface; never mutates workspace settings. */
export default function EnterpriseView() {
  const { activeWorkspace, status } = useSession();
  const { contact } = useSiteContent();
  const role = activeWorkspace?.role;
  const canRequest = role === 'owner' || role === 'admin';
  const subject = encodeURIComponent('ZEVQORA Enterprise evaluation request');
  const body = encodeURIComponent('I would like to discuss ZEVQORA enterprise setup, capabilities, security review and procurement. Please contact me.');
  return (
    <main className="mx-auto w-full max-w-[1180px] px-4 py-8 sm:px-8 lg:py-12">
      <div className="relative overflow-hidden rounded-[24px] bg-[#0F1115] px-6 py-10 text-[#F7F8FA] sm:px-10 lg:grid lg:grid-cols-[1.4fr_0.6fr] lg:items-center">
        <div><p className="font-mono text-[12px] uppercase tracking-widest text-[#8ab6ff]">Enterprise · Permission aware</p><h1 className="mt-4 max-w-[18ch] text-[clamp(2.3rem,5vw,4.6rem)] font-semibold leading-[1.09] tracking-tight">Enterprise controls, without the guesswork.</h1><p className="mt-5 max-w-[55ch] text-[16px] leading-relaxed text-white/70">See what is already supported, what needs setup and what requires a separate security or procurement decision. Nothing here turns on SSO, compliance or production deployment.</p></div>
        <div aria-hidden className="mt-8 flex items-center justify-center lg:mt-0"><ShieldCheck size={112} strokeWidth={1} className="text-[#468BFF]" /></div>
      </div>
      <div className="mt-6 flex flex-wrap gap-3 rounded-xl border border-line bg-surface p-4 text-[13px] text-muted"><span className="font-semibold text-ink">Workspace:</span>{activeWorkspace?.name ?? 'None selected'}<span className="mx-1 text-subtle">·</span><span className="font-semibold text-ink">Verified role:</span>{role ?? 'Unavailable'}<span className="mx-1 text-subtle">·</span><span className="font-semibold text-ink">Capability source:</span>Existing release + proposed API map</div>
      <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <article className="rounded-[18px] border border-line bg-surface p-6"><Users size={23} className="text-accent-text" aria-hidden /><h2 className="mt-4 text-[18px] font-semibold text-ink">Team and access</h2><p className="mt-2 text-[14px] leading-relaxed text-muted">Existing workspace members and roles remain server-enforced. CEO/CTO display mode is not permission.</p><Link to="/app/team" className="mt-4 inline-flex min-h-11 items-center gap-2 text-[13px] font-medium text-accent-text underline underline-offset-4">Manage members <ArrowUpRight size={14} /></Link></article>
        <article className="rounded-[18px] border border-line bg-surface p-6"><LockKeyhole size={23} className="text-accent-text" aria-hidden /><h2 className="mt-4 text-[18px] font-semibold text-ink">Data boundary</h2><p className="mt-2 text-[14px] leading-relaxed text-muted">Metadata-first ZevIR ingestion, existing RLS and server-side authorization need independent staging verification.</p><Link to="/security" className="mt-4 inline-flex min-h-11 items-center gap-2 text-[13px] font-medium text-accent-text underline underline-offset-4">Security model <ArrowUpRight size={14} /></Link></article>
        <article className="rounded-[18px] border border-line bg-surface p-6"><ShieldCheck size={23} className="text-accent-text" aria-hidden /><h2 className="mt-4 text-[18px] font-semibold text-ink">Evaluation controls</h2><p className="mt-2 text-[14px] leading-relaxed text-muted">Freeze gates, run bounded evaluations and review outcomes only when enabled by real workspace capability.</p><Link to="/app/optimize" className="mt-4 inline-flex min-h-11 items-center gap-2 text-[13px] font-medium text-accent-text underline underline-offset-4">Optimization workbench <ArrowUpRight size={14} /></Link></article>
      </div>
      <section className="mt-10"><p className="font-mono text-[12px] uppercase tracking-widest text-accent-text">Setup and procurement roadmap</p><h2 className="mt-2 text-[25px] font-semibold text-ink">Explicit capability, explicit next action.</h2><div className="mt-5 grid gap-3 sm:grid-cols-2">{CAPABILITIES.map((c) => <article key={c.key} className="rounded-[16px] border border-line bg-surface p-5"><div className="flex flex-wrap justify-between gap-2"><h3 className="text-[16px] font-semibold text-ink">{c.title}</h3><span className="rounded-md bg-sunken px-2 py-1 font-mono text-[10px] text-muted">{c.status}</span></div><p className="mt-2 text-[14px] leading-relaxed text-muted">{c.body}</p></article>)}</div></section>
      <section className="mt-10 rounded-[20px] border border-line bg-sunken p-6 sm:p-8"><h2 className="text-[25px] font-semibold text-ink">Discuss your requirements.</h2><p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-muted">This opens a pre-filled email, not a submitted ticket or approved enterprise entitlement. Do not include production secrets or customer traces.</p>{status === 'signed_in' && !canRequest ? <p className="mt-5 rounded-lg border border-line bg-surface p-4 text-[14px]">An authorized workspace owner or admin can initiate this request. Ask your administrator for access.</p> : <a href={`mailto:${contact.email}?subject=${subject}&body=${body}`} className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-xl bg-[#468BFF] px-5 text-[14px] font-semibold text-white hover:bg-[#2869da]">Email the enterprise team <ArrowUpRight size={16} aria-hidden /></a>}</section>
    </main>
  );
}
