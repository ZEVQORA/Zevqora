import { useState } from 'react'
import { ArrowRight, FolderOpen, ShieldCheck, Sparkles, X } from 'lucide-react'
import { BrandAsset, brandAssets } from './BrandAsset'

export function AddProductDialog({
  open,
  onClose,
  onConnect,
}: {
  open: boolean
  onClose: () => void
  onConnect: (path: string, name?: string) => Promise<void>
}) {
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  const choose = async () => {
    if (!window.zevqoraDesktop) return
    const selected = await window.zevqoraDesktop.selectFolder()
    if (selected) setPath(selected)
  }

  const submit = async () => {
    if (!path.trim()) return
    setBusy(true)
    setError('')
    try {
      await onConnect(path.trim(), name.trim() || undefined)
      setPath('')
      setName('')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="premium-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="premium-modal w-full max-w-[720px] overflow-hidden rounded-[30px] border border-white/75 bg-white/92 shadow-[0_36px_110px_rgba(15,17,21,.18)] backdrop-blur-2xl">
        <div className="grid grid-cols-[184px_minmax(0,1fr)]">
          <aside className="relative overflow-hidden border-r border-stone/80 bg-[linear-gradient(180deg,#F9FBFF_0%,#F3F5FB_100%)] p-6">
            <div className="absolute -left-14 top-10 h-36 w-36 rounded-full bg-softblue/10 blur-3xl" />
            <div className="relative flex h-full min-h-[430px] flex-col">
              <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-[14px] border border-white bg-white shadow-[0_10px_28px_rgba(15,17,21,.06)]">
                <BrandAsset src={brandAssets.mark} alt="ZEVQORA mark" compact className="h-6 w-6 object-contain" />
              </div>
              <div className="mt-8 text-[10px] font-semibold uppercase tracking-[0.18em] text-softblue">Connect product</div>
              <h2 className="mt-3 font-editorial text-[27px] leading-[1.08] tracking-[-0.025em] text-ink">Give Zev a workspace to understand.</h2>
              <p className="mt-4 text-[12px] leading-5 text-ink/48">Start local. ZEVQORA maps AI call sites first, then asks for runtime evidence before it calls anything verified.</p>
              <div className="mt-auto pt-8">
                <div className="relative mx-auto h-28 w-28">
                  <div className="absolute inset-2 rounded-full bg-softblue/[0.08] blur-2xl" />
                  <BrandAsset src={brandAssets.mascot} alt="Zev mascot" compact className="relative h-full w-full object-contain zev-dialog-mascot" />
                </div>
                <div className="mt-3 flex items-center justify-center gap-1.5 text-[10px] font-medium text-ink/40"><Sparkles size={11} className="text-softblue" /> Read-only first scan</div>
              </div>
            </div>
          </aside>

          <section className="p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink/34">Step 01 · Local workspace</div>
                <h3 className="mt-2 text-[20px] font-semibold tracking-[-0.02em]">Add one real AI product.</h3>
                <p className="mt-2 max-w-lg text-[12px] leading-5 text-ink/46">Choose the folder you actually develop in. ZEVQORA will inspect supported source files and detect the AI stack without changing code.</p>
              </div>
              <button onClick={onClose} className="rounded-[12px] p-2 text-ink/38 transition hover:bg-cloud hover:text-ink/65" aria-label="Close"><X size={17} /></button>
            </div>

            <div className="mt-7 grid gap-5">
              <label className="grid gap-2 text-[11px] font-semibold text-ink/56">
                Product name <span className="font-normal text-ink/30">optional</span>
                <input value={name} onChange={(e) => setName(e.target.value)} className="premium-input h-11 rounded-[14px] border border-stone bg-white px-3.5 text-sm text-ink outline-none transition focus:border-softblue/65 focus:ring-4 focus:ring-softblue/[0.08]" placeholder="e.g. Support Agent" />
              </label>
              <label className="grid gap-2 text-[11px] font-semibold text-ink/56">
                Local project folder
                <div className="flex gap-2">
                  <input value={path} onChange={(e) => setPath(e.target.value)} className="premium-input h-11 min-w-0 flex-1 rounded-[14px] border border-stone bg-white px-3.5 text-sm text-ink outline-none transition focus:border-softblue/65 focus:ring-4 focus:ring-softblue/[0.08]" placeholder="C:\\projects\\my-ai-product" />
                  {window.zevqoraDesktop && (
                    <button onClick={choose} className="flex h-11 items-center gap-2 rounded-[14px] border border-stone bg-cloud/70 px-3.5 text-xs font-semibold text-ink/60 transition hover:bg-stone/55">
                      <FolderOpen size={15} /> Browse
                    </button>
                  )}
                </div>
              </label>
            </div>

            <div className="mt-6 rounded-[18px] border border-stone/90 bg-cloud/70 p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] bg-white text-softblue shadow-[0_6px_18px_rgba(15,17,21,.04)]"><ShieldCheck size={14} /></div>
                <div><div className="text-[11px] font-semibold text-ink/65">Local trust boundary</div><p className="mt-1 text-[11px] leading-5 text-ink/43">Secret-bearing paths, `.git`, dependencies and build output are skipped. Source changes never happen during this connection step.</p></div>
              </div>
            </div>

            {error && <div className="mt-4 rounded-[16px] border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}

            <div className="mt-7 flex items-center justify-between border-t border-stone/80 pt-5">
              <div className="text-[10px] leading-4 text-ink/34">Next: detect SDKs → map AI call sites → review what Zev can observe.</div>
              <div className="flex items-center gap-2">
                <button onClick={onClose} className="rounded-[13px] px-4 py-2.5 text-xs font-semibold text-ink/45 transition hover:bg-cloud">Cancel</button>
                <button disabled={!path.trim() || busy} onClick={submit} className="flex items-center gap-2 rounded-[14px] bg-ink px-4 py-2.5 text-xs font-semibold text-white shadow-[0_9px_24px_rgba(15,17,21,.16)] transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0">
                  {busy ? 'Detecting AI stack…' : 'Connect product'} {!busy && <ArrowRight size={14} />}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
