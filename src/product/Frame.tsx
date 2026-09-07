import { useState, type ReactNode } from 'react';
import { Check, ChevronsUpDown, FolderGit2, Plus } from 'lucide-react';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/cn';
import { EvidenceInspector } from './Inspector';
import { useProduct } from './store';
import { useProductDialogs } from './dialogs/context';
import { creditSummary } from './credits';
import { money } from './format';

function RepositorySwitcher() {
  const { products, selected, selectProduct, productsLoading } = useProduct();
  const dialogs = useProductDialogs();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open} className="text-caption inline-flex h-8 max-w-[320px] items-center gap-2 rounded-md border border-line/70 bg-surface/70 px-2.5 text-ink transition-control hover:bg-surface">
        <FolderGit2 size={13} className="shrink-0 text-subtle" aria-hidden />
        <span className="truncate">{selected ? selected.name : productsLoading ? 'Loading repositories…' : 'No repository connected'}</span>
        <ChevronsUpDown size={12} className="shrink-0 text-subtle" aria-hidden />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div role="listbox" className="glass-pop absolute left-0 top-full z-40 mt-1.5 w-72 rounded-lg p-1.5">
            {products.map((p) => (
              <button key={p.id} type="button" role="option" aria-selected={selected?.id === p.id} onClick={() => { selectProduct(p.id); setOpen(false); }} className={cn('text-caption flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-ink transition-control hover:bg-ink/5', selected?.id === p.id && 'bg-ink/5')}>
                <span className="min-w-0">
                  <span className="block truncate">{p.name}</span>
                  <span className="text-technical block truncate font-mono text-subtle">{p.root_path}</span>
                </span>
                {selected?.id === p.id && <Check size={14} className="shrink-0 text-accent-text" />}
              </button>
            ))}
            {!products.length && <p className="text-technical px-2.5 py-2 text-subtle">No repositories connected yet.</p>}
            <div className="my-1 border-t border-line" />
            <button type="button" onClick={() => { setOpen(false); dialogs.openConnect(); }} className="text-caption flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-muted transition-control hover:bg-ink/5 hover:text-ink">
              <Plus size={14} aria-hidden /> Connect a repository
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function EngineStatus() {
  const { health, runtime, engineError } = useProduct();
  const { me } = useSession();
  const credit = creditSummary(me?.account);
  const ok = health?.status === 'ok';
  const label = ok ? (runtime === 'desktop' ? `Local engine ${health?.version}` : 'Platform engine') : runtime === 'desktop' ? 'Local engine offline' : engineError || 'Engine unavailable';
  const provider = health?.provider_mode === 'platform' ? 'Platform compute' : health?.provider_mode === 'local_key' ? 'Local OpenRouter key' : 'No model provider';
  return (
    <div className="flex items-center gap-3">
      <span className="text-technical hidden items-center gap-2 text-muted md:inline-flex" title={provider}>
        <span className={cn('pconn-dot', ok ? 'is-live' : 'is-off')} /> {label}
      </span>
      {credit.included > 0 && (
        <span className="text-technical hidden items-center gap-2 text-muted lg:inline-flex" title={`Zev credit · ${money(credit.remaining)} of ${money(credit.included)} remaining this period`}>
          <span className="pcredit-track w-16"><span className={cn('pcredit-fill block', credit.ratio > 0.85 && 'is-low', credit.remaining <= 0 && 'is-empty')} style={{ width: `${Math.round((1 - credit.ratio) * 100)}%` }} /></span>
          {money(credit.remaining)} credit
        </span>
      )}
    </div>
  );
}

/** Product page frame: repository toolbar, scrolling content, and the Evidence Inspector. */
export function ProductFrame({ children, inspector = true, padded = true }: { children: ReactNode; inspector?: boolean; padded?: boolean }) {
  return (
    <div className="product-frame">
      <div className="product-main">
        <div className="flex h-11 items-center justify-between gap-3 border-b border-line/60 bg-surface/50 px-4 lg:px-6">
          <RepositorySwitcher />
          <EngineStatus />
        </div>
        {padded ? <div className="product-page">{children}</div> : children}
      </div>
      {inspector && <EvidenceInspector />}
    </div>
  );
}
