import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ExternalLink, Search } from 'lucide-react';
import { useSiteContent } from '@/lib/site';
import { SETUP_CATALOG } from '@/lib/clients/integrations';
import type { IntegrationCategory } from '@/lib/contracts/connections';

const categories: Array<'All' | IntegrationCategory> = ['All', 'AI provider', 'Tracing/observability', 'LLM gateway', 'Agent framework', 'RAG/retrieval', 'Code/repository', 'Custom/Enterprise'];
/** Static source-capability catalogue, NOT connection status and NOT a synthetic account. */
export default function IntegrationCatalog() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'All' | IntegrationCategory>('All');
  const { contact } = useSiteContent();
  const entries = useMemo(() => SETUP_CATALOG.filter((e) =>
    (category === 'All' || category === e.category) &&
    `${e.name} ${e.detail} ${e.category}`.toLowerCase().includes(query.trim().toLowerCase())), [query, category]);

  return (
    <section aria-label="Integration setup catalogue" className="mb-7 rounded-[20px] border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-accent-text">Evidence onboarding · Source capability catalogue</p>
          <h2 className="mt-2 text-[21px] font-semibold text-ink">Connect only what is supported.</h2>
          <p className="mt-2 max-w-[65ch] text-[14px] leading-relaxed text-muted">A provider card is not an active integration. Setup is workspace-scoped; success is confirmed only by the server and an authorized test ingest.</p>
        </div>
        <span className="shrink-0 rounded-lg border border-line bg-sunken px-3 py-2 font-mono text-[11px] text-muted">CATALOG · NOT CONNECTION HEALTH</span>
      </div>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <label className="flex min-h-11 flex-1 items-center gap-2 rounded-lg border border-line bg-canvas px-3"><Search size={16} aria-hidden className="text-muted" /><span className="sr-only">Search integrations</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a source, framework or method" className="min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none" /></label>
        <label className="sr-only" htmlFor="zq-integration-category">Integration category</label>
        <select id="zq-integration-category" value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className="min-h-11 rounded-lg border border-line bg-canvas px-3 text-[14px] text-ink">{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {entries.map((it) => <article key={it.id} className="flex flex-col rounded-[15px] border border-line bg-canvas p-4">
          <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="text-[15px] font-semibold text-ink">{it.name}</h3><span className="rounded-full bg-sunken px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted">{it.availability === 'not_implemented' ? 'NOT AVAILABLE' : 'SETUP REQUIRED'}</span></div>
          <p className="mt-1 text-[12px] text-subtle">{it.category} · {it.method.toUpperCase()}</p>
          <p className="mt-3 flex-1 text-[13px] leading-relaxed text-muted">{it.detail}</p>
          <p className="mt-3 text-[12px] text-muted"><strong className="text-ink">Evidence:</strong> {it.capturedFields.length ? it.capturedFields.join(', ') : 'None connected'}</p>
          <p className="mt-1 text-[12px] text-muted"><strong className="text-ink">Excluded:</strong> {it.excludedFields.join(', ')}</p>
          <div className="mt-4">
            {it.setupRoute ? <Link to={it.setupRoute} className="inline-flex min-h-11 items-center gap-2 text-[13px] font-semibold text-accent-text underline underline-offset-4">Read setup instructions <ExternalLink size={13} aria-hidden /></Link> : <a href={`mailto:${contact.email}?subject=${encodeURIComponent(`ZEVQORA adapter request: ${it.name}`)}`} className="inline-flex min-h-11 items-center text-[13px] font-semibold text-accent-text underline underline-offset-4">Request adapter</a>}
          </div>
        </article>)}
        {!entries.length && <p className="text-[14px] text-muted">No source matches that filter. Try another category, or request an adapter.</p>}
      </div>
    </section>
  );
}
