import { useEffect, useState } from 'react'
import { AlertCircle, Check, FileJson, FolderSearch, GitBranch, Play, ScanSearch, ShieldCheck, Upload } from 'lucide-react'
import { api, API_BASE } from '../lib/api'
import type { Economics, Experiment, Finding, Health, Implementation, Product, ScanResult, ViewKey } from '../lib/types'

function Money({ value }: { value: number | null | undefined }) {
  return <>{value == null ? '—' : `$${value.toFixed(value < 1 ? 4 : 2)}`}</>
}

function Page({ eyebrow, title, subtitle, children }: { eyebrow: string; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-7 py-7">
      <div className="mx-auto max-w-[1180px]">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-softblue">{eyebrow}</div>
        <h1 className="mt-2 font-editorial text-[34px] leading-tight">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/50">{subtitle}</p>
        <div className="mt-7">{children}</div>
      </div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[22px] border border-dashed border-stone bg-white p-8 text-center text-sm leading-6 text-ink/45">{children}</div>
}

export function ProductsView({ products, selected, onSelect, onAdd }: { products: Product[]; selected: Product | null; onSelect: (id: string) => void; onAdd: () => void }) {
  return (
    <Page eyebrow="My Products" title="One place for the economics of every AI product." subtitle="Desktop is the primary local product surface. Connect one real workload first; do not configure an observability stack just to get started.">
      <div className="mb-4 flex justify-end"><button onClick={onAdd} className="rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white">+ Add product</button></div>
      {!products.length ? <Empty>No products connected yet.</Empty> : (
        <div className="grid grid-cols-2 gap-4">
          {products.map((product) => (
            <button key={product.id} onClick={() => onSelect(product.id)} className={`rounded-[22px] border p-5 text-left transition ${selected?.id === product.id ? 'border-softblue bg-softblue/[0.04]' : 'border-stone bg-white hover:border-softblue/40'}`}>
              <div className="flex items-center justify-between"><div className="text-base font-semibold">{product.name}</div><span className="rounded-lg bg-cloud px-2 py-1 text-[10px] font-semibold text-ink/45">{product.monitoring_enabled ? 'MONITORING' : 'PAUSED'}</span></div>
              <div className="mt-3 truncate text-xs text-ink/42">{product.root_path}</div>
              <div className="mt-5 text-[11px] text-ink/38">Last scan: {product.last_scan_at ? new Date(product.last_scan_at).toLocaleString() : 'Not scanned'}</div>
            </button>
          ))}
        </div>
      )}
    </Page>
  )
}

export function SpendView({ product, economics, onImport }: { product: Product | null; economics: Economics | null; onImport: () => Promise<void> }) {
  if (!product) return <Page eyebrow="Live Spend" title="Connect a product first." subtitle="Runtime economics need a product context."><Empty>Add a local product to continue.</Empty></Page>
  return (
    <Page eyebrow="Live Spend" title="Measured AI economics, not a model-price dashboard." subtitle="Values below come only from imported execution evidence. ZEVQORA does not fabricate monthly spend when it does not have a defensible observation window.">
      <div className="grid grid-cols-4 gap-3">
        {[
          ['Observed cost', economics?.observed_cost_usd == null ? '—' : `$${economics.observed_cost_usd.toFixed(4)}`],
          ['Execution traces', String(economics?.trace_count ?? 0)],
          ['Cost / trace', economics?.avg_cost_per_trace_usd == null ? '—' : `$${economics.avg_cost_per_trace_usd.toFixed(5)}`],
          ['Verified replay saving', `$${(economics?.verified_savings_usd ?? 0).toFixed(4)}`],
        ].map(([label, value]) => <div key={label} className="rounded-[22px] border border-stone bg-white p-4"><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/35">{label}</div><div className="mt-3 text-2xl font-semibold tracking-tight">{value}</div></div>)}
      </div>
      <div className="mt-4 rounded-[22px] border border-stone bg-white p-5">
        <div className="flex items-start justify-between gap-4"><div><div className="text-sm font-semibold">Execution evidence</div><p className="mt-1 text-xs leading-5 text-ink/45">Import JSONL from your product/runtime. Candidate replay fields can be included when you are testing a cheaper execution strategy.</p></div><button onClick={() => void onImport()} className="flex shrink-0 items-center gap-2 rounded-xl bg-softblue px-3.5 py-2.5 text-xs font-semibold text-white"><Upload size={14} /> Import traces</button></div>
        <div className="mt-4 border-t border-stone pt-4 text-xs text-ink/45">{economics?.note || 'No evidence loaded.'}</div>
      </div>
    </Page>
  )
}

export function WasteView({ product, findings, onTest }: { product: Product | null; findings: Finding[]; onTest: (finding: Finding) => void }) {
  return (
    <Page eyebrow="Waste" title="Root-cause signals that still have to earn trust." subtitle="Static source analysis can tell us where to investigate. It cannot turn a guess into Verified Savings.">
      {!product ? <Empty>Connect a product first.</Empty> : !findings.length ? <Empty>No findings yet. Run a scan from Zev or the workspace controls.</Empty> : (
        <div className="grid gap-3">
          {findings.map((finding) => (
            <div key={finding.id} className="rounded-[22px] border border-stone bg-white p-5">
              <div className="flex items-start justify-between gap-5">
                <div className="min-w-0"><div className="flex items-center gap-2"><span className="rounded-lg bg-stone/45 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink/48">{finding.category.replaceAll('_', ' ')}</span><span className="rounded-lg bg-softblue/[0.06] px-2 py-1 text-[10px] font-semibold text-softblue">{finding.origin.replaceAll('_', ' ')}</span><span className="text-[10px] text-ink/35">confidence {Math.round(finding.confidence * 100)}%</span></div><h3 className="mt-3 text-base font-semibold">{finding.title}</h3><p className="mt-1.5 max-w-3xl text-sm leading-6 text-ink/52">{finding.root_cause}</p><div className="mt-3 font-mono text-[11px] text-ink/40">{finding.file_path}:{finding.line}{finding.symbol ? ` · ${finding.symbol}` : ''}</div></div>
                <div className="shrink-0 text-right"><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/35">Evidence</div><div className="mt-1 text-xs font-semibold text-ink/60">{finding.evidence_status.replaceAll('_', ' ')}</div><button onClick={() => onTest(finding)} className="mt-4 flex items-center gap-2 rounded-xl border border-softblue/35 bg-softblue/[0.06] px-3 py-2 text-xs font-semibold text-softblue"><Play size={13} /> Let Zev test it</button></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Page>
  )
}

export function ExperimentsView({ experiments }: { experiments: Experiment[] }) {
  return (
    <Page eyebrow="Experiments" title="Cheaper is not enough." subtitle="Every candidate must pass sample, quality, protected-slice, cost, latency and fallback gates before the word Verified appears.">
      {!experiments.length ? <Empty>No experiments yet. Choose a Waste finding and run verification.</Empty> : (
        <div className="grid gap-4">
          {experiments.map((exp) => (
            <div key={exp.id} className="rounded-[22px] border border-stone bg-white p-5">
              <div className="flex items-start justify-between"><div><div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/35">Experiment · {exp.evidence_version}</div><div className="mt-2 text-xl font-semibold">{exp.status}</div></div><span className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold ${exp.status === 'VERIFIED' ? 'bg-softblue/10 text-softblue' : 'bg-stone/55 text-ink/50'}`}>{exp.sample_size} replay rows</span></div>
              <div className="mt-5 grid grid-cols-4 gap-3 text-sm"><div><div className="text-[10px] text-ink/35">BASELINE COST</div><div className="mt-1 font-semibold"><Money value={exp.baseline_cost_usd} /></div></div><div><div className="text-[10px] text-ink/35">CANDIDATE COST</div><div className="mt-1 font-semibold"><Money value={exp.candidate_cost_usd} /></div></div><div><div className="text-[10px] text-ink/35">CANDIDATE QUALITY</div><div className="mt-1 font-semibold">{exp.candidate_quality == null ? '—' : `${(exp.candidate_quality * 100).toFixed(1)}%`}</div></div><div><div className="text-[10px] text-ink/35">VERIFIED SAMPLE SAVING</div><div className="mt-1 font-semibold"><Money value={exp.verified_savings_usd} /></div></div></div>
              <div className="mt-5 grid grid-cols-2 gap-2">{exp.gates.map((gate) => <div key={gate.name} className="flex gap-2 rounded-xl bg-cloud px-3 py-2.5 text-[11px]"><div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${gate.passed ? 'bg-softblue/15 text-softblue' : 'bg-stone text-ink/45'}`}>{gate.passed ? <Check size={10} /> : <AlertCircle size={10} />}</div><div><div className="font-semibold capitalize">{gate.name.replaceAll('_', ' ')}</div><div className="mt-0.5 leading-4 text-ink/42">{gate.detail}</div></div></div>)}</div>
            </div>
          ))}
        </div>
      )}
    </Page>
  )
}

export function SavingsView({ experiments }: { experiments: Experiment[] }) {
  const verified = experiments.filter((item) => item.status === 'VERIFIED')
  const total = verified.reduce((sum, item) => sum + (item.verified_savings_usd || 0), 0)
  return (
    <Page eyebrow="Verified Savings" title="Savings that passed the evidence gate." subtitle="This page intentionally excludes potential findings and rejected candidates. Realized production savings are a separate measurement stage.">
      <div className="rounded-[28px] border border-softblue/25 bg-softblue/[0.045] p-6"><div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-softblue">Verified replay savings · current evidence set</div><div className="mt-3 text-4xl font-semibold tracking-[-0.035em]">${total.toFixed(4)}</div><div className="mt-2 text-xs text-ink/45">{verified.length} verified experiment{verified.length === 1 ? '' : 's'} · not presented as realized monthly savings</div></div>
      <div className="mt-4">{!verified.length ? <Empty>No verified savings yet. That is a valid result until evidence proves otherwise.</Empty> : verified.map((exp) => <div key={exp.id} className="mb-3 rounded-[22px] border border-stone bg-white p-5"><div className="flex justify-between"><div><div className="text-sm font-semibold">{exp.evidence_version}</div><div className="mt-1 text-xs text-ink/42">{exp.sample_size} replay tasks · quality {(exp.candidate_quality! * 100).toFixed(1)}%</div></div><div className="text-xl font-semibold text-softblue"><Money value={exp.verified_savings_usd} /></div></div></div>)}</div>
    </Page>
  )
}

export function ImplementationsView({
  experiments,
  implementations,
  onPrepare,
}: {
  experiments: Experiment[]
  implementations: Implementation[]
  onPrepare: (experiment: Experiment) => void
}) {
  const verified = experiments.filter((item) => item.status === 'VERIFIED')
  return (
    <Page eyebrow="Implementations" title="Proof first. Change second." subtitle="Only a VERIFIED experiment can prepare a code candidate. ZEVQORA writes the candidate into an isolated Git worktree and never merges or deploys it automatically.">
      {!verified.length ? <Empty>No implementation should be prepared until an experiment is verified.</Empty> : (
        <div className="grid gap-3">
          {verified.map((exp) => (
            <div key={exp.id} className="rounded-[22px] border border-stone bg-white p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={16} className="text-softblue" /> Eligible for reviewed implementation</div>
                  <div className="mt-2 text-xs text-ink/42">{exp.evidence_version} · Human review required · Auto merge off · Auto deploy off</div>
                </div>
                <button onClick={() => onPrepare(exp)} className="flex items-center gap-2 rounded-xl bg-ink px-3.5 py-2.5 text-xs font-semibold text-white"><GitBranch size={14} /> Prepare isolated change</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-7 border-t border-stone pt-6">
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/35">Prepared review candidates</div>
        {!implementations.length ? <Empty>No isolated implementation candidates prepared yet.</Empty> : (
          <div className="grid gap-4">
            {implementations.map((item) => (
              <div key={item.id} className="rounded-[22px] border border-stone bg-white p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{item.summary}</div>
                    <div className="mt-2 font-mono text-[10px] text-ink/40">{item.branch_name} · {item.target_file}</div>
                    <div className="mt-1 truncate font-mono text-[10px] text-ink/30" title={item.worktree_path}>{item.worktree_path}</div>
                  </div>
                  <span className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold ${item.status === 'READY_FOR_REVIEW' ? 'bg-softblue/10 text-softblue' : 'bg-stone/55 text-ink/50'}`}>{item.status.replaceAll('_', ' ')}</span>
                </div>
                <details className="mt-4 rounded-xl border border-stone bg-cloud">
                  <summary className="cursor-pointer px-3 py-2.5 text-xs font-semibold text-ink/55">Review generated diff</summary>
                  <pre className="max-h-[420px] overflow-auto border-t border-stone p-3 text-[10px] leading-5 text-ink/70">{item.diff_text}</pre>
                </details>
                {item.test_output && (
                  <details className="mt-2 rounded-xl border border-stone bg-white">
                    <summary className="cursor-pointer px-3 py-2.5 text-xs font-semibold text-ink/55">Compile / test output · exit {item.test_exit_code ?? '—'}</summary>
                    <pre className="max-h-[260px] overflow-auto border-t border-stone p-3 text-[10px] leading-5 text-ink/65">{item.test_output}</pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Page>
  )
}

export function SettingsView({ health, model, onModel }: { health: Health | null; model: string; onModel: (value: string) => void }) {
  const [key, setKey] = useState('')
  const [provider, setProvider] = useState<{ openrouterConfigured: boolean; secureStorageAvailable: boolean; source: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const refreshProvider = async () => {
    try {
      const next = await window.zevqoraDesktop?.getProviderConfig()
      if (next) setProvider(next)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  useEffect(() => { void refreshProvider() }, [])

  const saveKey = async () => {
    if (!window.zevqoraDesktop) return setMessage('Secure provider settings are available in the installed desktop app.')
    setBusy(true); setMessage('')
    try {
      const next = await window.zevqoraDesktop.saveOpenRouterKey(key)
      setProvider(next); setKey('')
      setMessage('OpenRouter key encrypted locally. The packaged agent backend is restarting with the new key.')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }

  const clearKey = async () => {
    if (!window.zevqoraDesktop) return
    setBusy(true); setMessage('')
    try {
      const next = await window.zevqoraDesktop.clearOpenRouterKey()
      setProvider(next); setKey('')
      setMessage('Stored OpenRouter key removed from this device.')
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }

  const configured = provider?.openrouterConfigured ?? health?.openrouter_configured ?? false
  return (
    <Page eyebrow="Settings" title="Local-first controls." subtitle="Zev can use OpenRouter without placing a provider secret in the renderer, repository, or installer. The key is encrypted with the operating system's secure storage on this device.">
      <div className="grid max-w-3xl gap-4">
        <div className="rounded-[22px] border border-stone bg-white p-5">
          <div className="flex items-start justify-between gap-4"><div><div className="text-sm font-semibold">Zev · OpenRouter</div><div className="mt-1 text-xs text-ink/42">{configured ? 'Ready for conversational reasoning + controlled tools' : 'Add a key to enable full Zev reasoning'}</div></div><span className={`rounded-lg px-2.5 py-1.5 text-[10px] font-semibold ${configured ? 'bg-softblue/10 text-softblue' : 'bg-stone/55 text-ink/45'}`}>{configured ? 'CONNECTED' : 'NOT CONNECTED'}</span></div>
          <div className="mt-4 grid gap-3">
            <label className="grid gap-1.5 text-xs text-ink/55">OpenRouter API key<input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-or-v1-…" autoComplete="off" className="rounded-xl border border-stone px-3 py-2.5 text-sm text-ink outline-none focus:border-softblue" /></label>
            <div className="flex gap-2"><button disabled={busy || !key.trim()} onClick={() => void saveKey()} className="rounded-xl bg-softblue px-3.5 py-2.5 text-xs font-semibold text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save securely'}</button><button disabled={busy || !configured} onClick={() => void clearKey()} className="rounded-xl border border-stone bg-white px-3.5 py-2.5 text-xs font-semibold text-ink/60 disabled:opacity-40">Remove key</button></div>
            <div className="text-[11px] leading-5 text-ink/42">Storage: {provider?.source === 'encrypted-local' ? 'OS-encrypted local secret' : provider?.source === 'environment' ? 'Backend environment' : 'No key stored'}{provider && !provider.secureStorageAvailable ? ' · OS secure storage unavailable' : ''}</div>
            {message && <div className="rounded-xl bg-cloud px-3 py-2.5 text-[11px] leading-5 text-ink/52">{message}</div>}
            <label className="grid gap-1.5 border-t border-stone pt-4 text-xs text-ink/55">OpenRouter model ID<input value={model} onChange={(e) => onModel(e.target.value)} placeholder="openrouter/auto" className="rounded-xl border border-stone px-3 py-2.5 text-sm text-ink outline-none focus:border-softblue" /></label>
            <div className="text-[11px] text-ink/38">Default: <span className="font-mono">openrouter/auto</span>. You can use any valid OpenRouter model slug.</div>
          </div>
        </div>
        <div className="rounded-[22px] border border-stone bg-white p-5"><div className="text-sm font-semibold">Account & billing</div><p className="mt-2 text-xs leading-5 text-ink/48">Your ZEVQORA account and subscription state are shared across web and desktop. Desktop email/password sign-in stores only the resulting session tokens locally; provider BYOK remains device-local and separate from billing credentials.</p></div>
        <div className="rounded-[22px] border border-stone bg-white p-5"><div className="text-sm font-semibold">Local API</div><div className="mt-2 font-mono text-xs text-ink/45">{API_BASE}</div><div className="mt-2 text-xs text-ink/42">Backend: {health?.status === 'ok' ? `${health.version} · online` : 'offline'}</div></div>
        <div className="rounded-[22px] border border-stone bg-cloud p-5"><div className="text-sm font-semibold">Privacy</div><p className="mt-2 text-xs leading-5 text-ink/48">Workspace source scanning excludes secret-like files by default. Runtime traces are imported only through explicit user action. Human review remains mandatory before implementation is merged or deployed.</p></div>
      </div>
    </Page>
  )
}
export function ExperimentDialog({ finding, product, onClose, onComplete }: { finding: Finding | null; product: Product | null; onClose: () => void; onComplete: (experiment: Experiment) => Promise<void> }) {
  const [quality, setQuality] = useState('0.98')
  const [samples, setSamples] = useState('5')
  const [fallback, setFallback] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!finding || !product) return null
  const run = async () => {
    setBusy(true); setError('')
    try {
      const result = await api.runExperiment(product.id, { finding_id: finding.id, quality_gate: Number(quality), min_samples: Number(samples), fallback_exists: fallback })
      await onComplete(result)
      onClose()
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) } finally { setBusy(false) }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 p-6 backdrop-blur-[2px]"><div className="w-full max-w-[560px] rounded-[26px] border border-stone bg-white p-6 shadow-soft"><div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-softblue">Controlled experiment</div><h2 className="mt-2 text-xl font-semibold">Let Zev test this finding</h2><p className="mt-2 text-sm leading-6 text-ink/50">{finding.title}</p><div className="mt-5 grid grid-cols-2 gap-3"><label className="grid gap-1.5 text-xs text-ink/55">Quality gate<input value={quality} onChange={(e) => setQuality(e.target.value)} type="number" min="0" max="1" step="0.01" className="rounded-xl border border-stone px-3 py-2.5 text-sm outline-none focus:border-softblue" /></label><label className="grid gap-1.5 text-xs text-ink/55">Minimum replay samples<input value={samples} onChange={(e) => setSamples(e.target.value)} type="number" min="1" className="rounded-xl border border-stone px-3 py-2.5 text-sm outline-none focus:border-softblue" /></label></div><label className="mt-4 flex items-start gap-3 rounded-xl border border-stone bg-cloud p-3 text-xs leading-5 text-ink/55"><input type="checkbox" checked={fallback} onChange={(e) => setFallback(e.target.checked)} className="mt-1" /><span><strong className="text-ink/75">Baseline fallback exists.</strong><br />Confirm only if the candidate can safely fall back to the current execution path.</span></label><div className="mt-4 rounded-xl border border-stone p-3 text-[11px] leading-5 text-ink/45"><FileJson size={14} className="mb-1 text-softblue" /> Verification uses imported replay rows containing baseline output/cost, expected output, and candidate output/cost. Missing evidence returns NEEDS_EVIDENCE rather than a made-up saving.</div>{error && <div className="mt-3 text-xs text-red-600">{error}</div>}<div className="mt-6 flex justify-end gap-2"><button onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm text-ink/50">Cancel</button><button onClick={() => void run()} disabled={busy} className="flex items-center gap-2 rounded-xl bg-softblue px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Play size={14} /> {busy ? 'Evaluating…' : 'Run verification'}</button></div></div></div>
}


export function ImplementationDialog({
  experiment,
  product,
  model,
  onClose,
  onComplete,
}: {
  experiment: Experiment | null
  product: Product | null
  model: string
  onClose: () => void
  onComplete: (implementation: Implementation) => Promise<void>
}) {
  const [instructions, setInstructions] = useState('')
  const [runTests, setRunTests] = useState(false)
  const [testCommand, setTestCommand] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!experiment || !product) return null

  const prepare = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await api.prepareImplementation(product.id, {
        experiment_id: experiment.id,
        instructions: instructions.trim() || undefined,
        model: model.trim() || undefined,
        run_tests: runTests,
        test_command: runTests ? testCommand.trim() || undefined : undefined,
      })
      await onComplete(result)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 p-6 backdrop-blur-[2px]">
      <div className="w-full max-w-[620px] rounded-[26px] border border-stone bg-white p-6 shadow-soft">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-softblue">Explicit source-change approval</div>
        <h2 className="mt-2 text-xl font-semibold">Prepare an isolated implementation candidate</h2>
        <p className="mt-2 text-sm leading-6 text-ink/50">ZEVQORA will create a new Git worktree + branch, ask the configured OpenRouter model for a minimal one-file replacement, and show the diff. It will not merge or deploy.</p>

        <label className="mt-5 grid gap-1.5 text-xs text-ink/55">
          Optional implementation guidance
          <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} className="resize-none rounded-xl border border-stone px-3 py-2.5 text-sm outline-none focus:border-softblue" placeholder="e.g. preserve the current public API and keep the baseline model as fallback" />
        </label>

        <label className="mt-4 flex items-start gap-3 rounded-xl border border-stone bg-cloud p-3 text-xs leading-5 text-ink/55">
          <input type="checkbox" checked={runTests} onChange={(e) => setRunTests(e.target.checked)} className="mt-1" />
          <span><strong className="text-ink/75">Run my project test command in the isolated worktree.</strong><br />The command is executed only because you explicitly provide and approve it.</span>
        </label>
        {runTests && (
          <label className="mt-3 grid gap-1.5 text-xs text-ink/55">Test command<input value={testCommand} onChange={(e) => setTestCommand(e.target.value)} className="rounded-xl border border-stone px-3 py-2.5 font-mono text-xs outline-none focus:border-softblue" placeholder="pytest -q" /></label>
        )}

        <div className="mt-4 rounded-xl border border-stone p-3 text-[11px] leading-5 text-ink/45">Python target files always receive a syntax compile check. Full project tests are never guessed or silently executed.</div>
        {error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
        <div className="mt-6 flex justify-end gap-2"><button onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm text-ink/50">Cancel</button><button onClick={() => void prepare()} disabled={busy || (runTests && !testCommand.trim())} className="flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-45"><GitBranch size={14} /> {busy ? 'Preparing worktree…' : 'Prepare candidate'}</button></div>
      </div>
    </div>
  )
}

export function WorkspaceControl({
  product,
  scan,
  onScan,
  onToggle,
  inspectorOpen,
}: {
  product: Product | null
  scan: ScanResult | null
  onScan: () => Promise<void>
  onToggle: () => Promise<void>
  inspectorOpen: boolean
}) {
  if (!product) return null
  return (
    <div
      className="workspace-control fixed bottom-4 z-30 flex items-center gap-1.5 rounded-[20px] border border-white/75 bg-white/82 p-1.5 shadow-[0_18px_48px_rgba(15,17,21,.10)] backdrop-blur-2xl transition-[right] duration-300"
      style={{ right: inspectorOpen ? 332 : 18 }}
    >
      <div className="max-w-[200px] px-2.5 text-[10px] font-medium text-ink/40">
        <FolderSearch size={12} className="mr-1 inline text-softblue" /> {scan?.files_scanned ?? '—'} files · read-only
      </div>
      <button onClick={() => void onScan()} className="flex items-center gap-1.5 rounded-[14px] bg-cloud/90 px-3 py-2 text-[11px] font-semibold text-ink/60 transition hover:bg-stone/60">
        <ScanSearch size={13} /> Scan
      </button>
      <button onClick={() => void onToggle()} className={`rounded-[14px] px-3 py-2 text-[11px] font-semibold transition ${product.monitoring_enabled ? 'bg-softblue/10 text-softblue hover:bg-softblue/15' : 'bg-cloud text-ink/45 hover:bg-stone/60'}`}>
        {product.monitoring_enabled ? 'Monitor on' : 'Monitor off'}
      </button>
    </div>
  )
}

export function viewTitle(view: ViewKey) { return view }
