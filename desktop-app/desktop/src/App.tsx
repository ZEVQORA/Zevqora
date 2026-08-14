import { useCallback, useEffect, useMemo, useState } from 'react'
import { WifiOff } from 'lucide-react'
import { AddProductDialog } from './components/AddProductDialog'
import { CommandPalette } from './components/CommandPalette'
import { EvidenceRail } from './components/EvidenceRail'
import { LivingWorkspace } from './components/LivingWorkspace'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { WelcomeScreen } from './components/WelcomeScreen'
import type { ZevState } from './components/ZevPresence'
import {
  ExperimentDialog,
  ImplementationDialog,
  ExperimentsView,
  ImplementationsView,
  ProductsView,
  SavingsView,
  SettingsView,
  SpendView,
  WasteView,
  WorkspaceControl,
} from './components/Views'
import { api } from './lib/api'
import type { Economics, Experiment, Finding, Health, Implementation, Product, ScanResult, ViewKey } from './lib/types'
import type { DesktopAuthState } from './lib/auth'

export default function App() {
  const [view, setView] = useState<ViewKey>('zev')
  const [health, setHealth] = useState<Health | null>(null)
  const [backendError, setBackendError] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [aiCallCount, setAiCallCount] = useState(0)
  const [detectedStack, setDetectedStack] = useState<string[]>([])
  const [findings, setFindings] = useState<Finding[]>([])
  const [economics, setEconomics] = useState<Economics | null>(null)
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [implementations, setImplementations] = useState<Implementation[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [testing, setTesting] = useState<Finding | null>(null)
  const [preparing, setPreparing] = useState<Experiment | null>(null)
  const [model, setModel] = useState(localStorage.getItem('zevqora.agentModel') || 'openrouter/auto')
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [agentState, setAgentState] = useState<ZevState>('idle')
  const [commandOpen, setCommandOpen] = useState(false)
  const [auth, setAuth] = useState<DesktopAuthState | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')

  const selected = useMemo(() => products.find((item) => item.id === selectedId) || null, [products, selectedId])

  useEffect(() => {
    document.documentElement.removeAttribute('data-theme')
    localStorage.removeItem('zevqora.theme')
    const bridge = window.zevqoraDesktop
    if (!bridge) {
      setAuth({ signedIn: false, error: 'Desktop authentication is available inside the installed ZEVQORA app.' })
      setAuthLoading(false)
      return
    }

    let active = true
    const refreshAuth = () => {
      void bridge.getAuthState()
        .then((state) => { if (active) setAuth(state) })
        .catch((error) => { if (active) setAuthError(error instanceof Error ? error.message : String(error)) })
        .finally(() => { if (active) setAuthLoading(false) })
    }
    refreshAuth()
    const authInterval = window.setInterval(refreshAuth, 60_000)
    window.addEventListener('focus', refreshAuth)

    const unsubscribe = bridge.onAuthChanged((state) => {
      if (!active) return
      setAuth(state)
      setAuthError(state.error || '')
      setAuthLoading(false)
    })

    return () => {
      active = false
      window.clearInterval(authInterval)
      window.removeEventListener('focus', refreshAuth)
      unsubscribe?.()
    }
  }, [])

  const refreshHealth = useCallback(async () => {
    try {
      const next = await api.health()
      setHealth(next)
      setBackendError('')
    } catch (err) {
      setHealth(null)
      setBackendError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const refreshProducts = useCallback(async () => {
    const rows = await api.products()
    setProducts(rows)
    setSelectedId((current) => current && rows.some((item) => item.id === current) ? current : rows[0]?.id || null)
  }, [])

  const refreshProductData = useCallback(async () => {
    if (!selectedId) {
      setFindings([])
      setEconomics(null)
      setExperiments([])
      setImplementations([])
      setAiCallCount(0)
      setDetectedStack([])
      return
    }
    const [nextCalls, nextFindings, nextEconomics, nextExperiments, nextImplementations] = await Promise.all([
      api.aiCalls(selectedId), api.findings(selectedId), api.economics(selectedId), api.experiments(selectedId), api.implementations(selectedId),
    ])
    setAiCallCount(nextCalls.length)
    setDetectedStack(Array.from(new Set(nextCalls.map((item) => item.provider))).sort())
    setFindings(nextFindings)
    setEconomics(nextEconomics)
    setExperiments(nextExperiments)
    setImplementations(nextImplementations)
    await refreshProducts()
  }, [selectedId, refreshProducts])

  useEffect(() => {
    void (async () => {
      await refreshHealth()
      try { await refreshProducts() } catch { /* local offline state is shown in UI */ }
    })()
    const id = window.setInterval(() => void refreshHealth(), 10000)
    return () => window.clearInterval(id)
  }, [refreshHealth, refreshProducts])

  useEffect(() => {
    setScan(null)
    void refreshProductData().catch(() => undefined)
  }, [refreshProductData])

  useEffect(() => {
    if (health?.status === 'ok' && !products.length) void refreshProducts().catch(() => undefined)
  }, [health?.status, products.length, refreshProducts])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen((current) => !current)
      }
      if (event.key === 'Escape') setCommandOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const connect = async (path: string, name?: string) => {
    setAgentState('scanning')
    try {
      const result = await api.connectLocal(path, name)
      setScan(result)
      setAiCallCount(result.ai_calls.length)
      setDetectedStack(result.detected_stack)
      await refreshProducts()
      setSelectedId(result.product.id)
      setView('zev')
      setAgentState('done')
      window.setTimeout(() => setAgentState('idle'), 1200)
    } catch (err) {
      setAgentState('idle')
      throw err
    }
  }

  const runScan = async () => {
    if (!selected) return
    setAgentState('scanning')
    try {
      const result = await api.scan(selected.id)
      setScan(result)
      setAiCallCount(result.ai_calls.length)
      setDetectedStack(result.detected_stack)
      await refreshProductData()
      setAgentState('done')
      window.setTimeout(() => setAgentState('idle'), 1200)
    } catch (err) {
      setAgentState('idle')
      throw err
    }
  }

  const toggleMonitoring = async () => {
    if (!selected) return
    await api.monitoring(selected.id, !selected.monitoring_enabled)
    await refreshProducts()
  }

  const importTraceFile = async () => {
    if (!selected) return
    if (!window.zevqoraDesktop) {
      alert('Trace file picker is available in the Electron desktop shell.')
      return
    }
    const file = await window.zevqoraDesktop.selectTraceFile()
    if (!file) return
    setAgentState('verifying')
    try {
      const result = await api.importTraces(selected.id, file.content)
      if (result.rejected) alert(`Imported ${result.imported}. Rejected ${result.rejected}. First error: ${result.errors[0] || 'unknown'}`)
      await refreshProductData()
      setAgentState('done')
      window.setTimeout(() => setAgentState('idle'), 1200)
    } catch (err) {
      setAgentState('idle')
      throw err
    }
  }

  const updateModel = (value: string) => {
    setModel(value)
    localStorage.setItem('zevqora.agentModel', value)
  }

  const directLogin = async (email: string, password: string) => {
    setAuthError('')
    setAuthLoading(true)
    try {
      if (!window.zevqoraDesktop) throw new Error('Desktop authentication bridge is unavailable.')
      const state = await window.zevqoraDesktop.signInWithPassword(email, password)
      setAuth(state)
      setAuthError(state.error || '')
    } catch (error) {
      setAuth({ signedIn: false })
      setAuthError(error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      setAuthLoading(false)
    }
  }

  const createAccount = () => {
    void window.zevqoraDesktop?.openSignup()
  }

  const signOut = async () => {
    if (!window.zevqoraDesktop) return
    const state = await window.zevqoraDesktop.signOut()
    setAuth(state)
  }

  if (!auth?.signedIn) {
    return (
      <WelcomeScreen
        auth={auth}
        loading={authLoading}
        error={authError}
        onDirectLogin={directLogin}
        onCreateAccount={createAccount}
      />
    )
  }

  let content: React.ReactNode
  if (view === 'products') content = <ProductsView products={products} selected={selected} onSelect={setSelectedId} onAdd={() => setAddOpen(true)} />
  else if (view === 'spend') content = <SpendView product={selected} economics={economics} onImport={importTraceFile} />
  else if (view === 'waste') content = <WasteView product={selected} findings={findings} onTest={(finding) => { setTesting(finding); setAgentState('verifying') }} />
  else if (view === 'experiments') content = <ExperimentsView experiments={experiments} />
  else if (view === 'savings') content = <SavingsView experiments={experiments} />
  else if (view === 'implementations') content = <ImplementationsView experiments={experiments} implementations={implementations} onPrepare={(experiment) => { setPreparing(experiment); setAgentState('experimenting') }} />
  else if (view === 'settings') content = <SettingsView health={health} model={model} onModel={updateModel} />
  else content = (
    <LivingWorkspace
      product={selected}
      health={health}
      economics={economics}
      findings={findings}
      experiments={experiments}
      aiCallCount={aiCallCount}
      agentState={agentState}
      onAgentState={setAgentState}
      onDataChanged={refreshProductData}
      onScan={runScan}
    />
  )

  return (
    <div className="app-window">
      <TitleBar
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen((current) => !current)}
        onOpenCommand={() => setCommandOpen(true)}
        productName={selected?.name}
        auth={auth}
        onOpenAccount={() => void window.zevqoraDesktop?.openAccount()}
        onSignOut={() => void signOut()}
      />
      <div className="app-body">
        <Sidebar view={view} onView={setView} products={products} selectedId={selectedId} onSelectProduct={setSelectedId} onAddProduct={() => setAddOpen(true)} />
        <main className="main-surface">
          {backendError && <div className="offline-toast"><WifiOff size={13} /> Backend offline. Start the local engine on 127.0.0.1:8000.</div>}
          {content}
          {view !== 'zev' && <WorkspaceControl product={selected} scan={scan} onScan={runScan} onToggle={toggleMonitoring} inspectorOpen={inspectorOpen} />}
        </main>
        {inspectorOpen && (
          <EvidenceRail
            health={health}
            product={selected}
            scan={scan}
            aiCallCount={aiCallCount}
            detectedStack={detectedStack}
            findings={findings}
            economics={economics}
            experiments={experiments}
          />
        )}
      </div>

      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} onView={setView} onAddProduct={() => setAddOpen(true)} />
      <AddProductDialog open={addOpen} onClose={() => setAddOpen(false)} onConnect={connect} />
      <ExperimentDialog finding={testing} product={selected} onClose={() => { setTesting(null); setAgentState('idle') }} onComplete={async () => { await refreshProductData(); setAgentState('done'); window.setTimeout(() => setAgentState('idle'), 1200); setView('experiments') }} />
      <ImplementationDialog experiment={preparing} product={selected} model={model} onClose={() => { setPreparing(null); setAgentState('idle') }} onComplete={async () => { await refreshProductData(); setAgentState('done'); window.setTimeout(() => setAgentState('idle'), 1200); setView('implementations') }} />
    </div>
  )
}
