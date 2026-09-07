import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, errorMessage } from './api'
import { platform } from './platform'
import type { DesktopAuthState } from './auth'
import type {
  AICall,
  CloudProject,
  CloudWorkspace,
  Economics,
  Evaluation,
  Experiment,
  Finding,
  Health,
  Implementation,
  OptimizationExecution,
  OptimizationPlan,
  PlatformStatus,
  Product,
  ScanResult,
  ViewKey,
} from './types'
import { useToast } from '../components/ui'

export type InspectTarget =
  | { kind: 'finding'; id: string }
  | { kind: 'evaluation'; id: string }
  | { kind: 'experiment'; id: string }
  | { kind: 'implementation'; id: string }
  | { kind: 'execution'; id: string }
  | { kind: 'plan'; id: string }
  | { kind: 'product' }
  | null

export type ZevState = 'idle' | 'thinking' | 'scanning' | 'experimenting' | 'verifying' | 'done'

export const PRODUCT_LINK_KEY = 'zevqora.productLinks'

export function readProductLinks(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(PRODUCT_LINK_KEY) || '{}') || {}
  } catch {
    return {}
  }
}

export function writeProductLink(productId: string, cloudProjectId: string | null) {
  const links = readProductLinks()
  if (cloudProjectId) links[productId] = cloudProjectId
  else delete links[productId]
  localStorage.setItem(PRODUCT_LINK_KEY, JSON.stringify(links))
  return links
}

interface Store {
  view: ViewKey
  setView: (view: ViewKey) => void
  inspect: InspectTarget
  setInspect: (target: InspectTarget) => void
  inspectorOpen: boolean
  setInspectorOpen: (open: boolean | ((current: boolean) => boolean)) => void

  auth: DesktopAuthState | null
  refreshAuth: () => Promise<void>
  signOut: () => Promise<void>
  workspaces: CloudWorkspace[]
  activeWorkspace: CloudWorkspace | null
  activeProjectId: string | null
  cloudProjects: CloudProject[]
  cloudProjectsError: string | null
  setContext: (workspaceId: string | null, projectId: string | null) => Promise<void>
  reloadCloudProjects: () => Promise<void>
  productLinks: Record<string, string>
  linkProduct: (productId: string, cloudProjectId: string | null) => void

  health: Health | null
  backendError: string
  platformStatus: PlatformStatus | null
  refreshHealth: () => Promise<void>

  products: Product[]
  selected: Product | null
  selectProduct: (id: string | null) => void
  scan: ScanResult | null
  aiCalls: AICall[]
  findings: Finding[]
  economics: Economics | null
  experiments: Experiment[]
  implementations: Implementation[]
  plans: OptimizationPlan[]
  executions: OptimizationExecution[]
  evaluations: Evaluation[]
  dataLoading: boolean
  refreshProducts: () => Promise<void>
  refreshProductData: () => Promise<void>
  connectProduct: (path: string, name?: string) => Promise<ScanResult>
  runScan: () => Promise<ScanResult | null>
  toggleMonitoring: () => Promise<void>
  importTraceFile: () => Promise<void>
  archiveProduct: (id: string) => Promise<void>

  zevState: ZevState
  setZevState: (state: ZevState) => void
  model: string
  setModel: (model: string) => void
}

const StoreContext = createContext<Store | null>(null)

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const toast = useToast()
  const [view, setViewState] = useState<ViewKey>(() => (localStorage.getItem('zevqora.view') as ViewKey) || 'overview')
  const [inspect, setInspect] = useState<InspectTarget>(null)
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(() => localStorage.getItem('zevqora.inspector') !== '0')

  const [auth, setAuth] = useState<DesktopAuthState | null>(null)
  const [context, setContextState] = useState<{ workspaceId: string | null; projectId: string | null }>({ workspaceId: null, projectId: null })
  const [cloudProjects, setCloudProjects] = useState<CloudProject[]>([])
  const [cloudProjectsError, setCloudProjectsError] = useState<string | null>(null)
  const [productLinks, setProductLinks] = useState<Record<string, string>>(() => readProductLinks())

  const [health, setHealth] = useState<Health | null>(null)
  const [backendError, setBackendError] = useState('')
  const [platformStatus, setPlatformStatus] = useState<PlatformStatus | null>(null)

  const [products, setProducts] = useState<Product[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(() => localStorage.getItem('zevqora.selectedProduct'))
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [aiCalls, setAiCalls] = useState<AICall[]>([])
  const [findings, setFindings] = useState<Finding[]>([])
  const [economics, setEconomics] = useState<Economics | null>(null)
  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [implementations, setImplementations] = useState<Implementation[]>([])
  const [plans, setPlans] = useState<OptimizationPlan[]>([])
  const [executions, setExecutions] = useState<OptimizationExecution[]>([])
  const [evaluations, setEvaluations] = useState<Evaluation[]>([])
  const [dataLoading, setDataLoading] = useState(false)

  const [zevState, setZevState] = useState<ZevState>('idle')
  const [model, setModelState] = useState(localStorage.getItem('zevqora.agentModel') || 'openrouter/auto')

  const selected = useMemo(() => products.find((p) => p.id === selectedId) || null, [products, selectedId])
  const workspaces = auth?.workspaces || []
  const activeWorkspace = useMemo(() => workspaces.find((w) => w.id === context.workspaceId) || workspaces[0] || null, [workspaces, context.workspaceId])
  const activeProjectId = useMemo(() => (cloudProjects.some((p) => p.id === context.projectId) ? context.projectId : null), [cloudProjects, context.projectId])

  const setView = useCallback((next: ViewKey) => {
    setViewState(next)
    localStorage.setItem('zevqora.view', next)
  }, [])

  useEffect(() => {
    localStorage.setItem('zevqora.inspector', inspectorOpen ? '1' : '0')
  }, [inspectorOpen])

  // ---- Account ---------------------------------------------------------------
  const refreshAuth = useCallback(async () => {
    const bridge = window.zevqoraDesktop
    if (!bridge) {
      setAuth({ signedIn: false, error: 'Desktop authentication is available inside the installed ZEVQORA app.' })
      return
    }
    try {
      const state = await bridge.getAuthState()
      setAuth(state)
      if (state.context) setContextState(state.context)
    } catch (error) {
      setAuth((current) => ({ ...(current || { signedIn: false }), error: errorMessage(error) }))
    }
  }, [])

  useEffect(() => {
    const bridge = window.zevqoraDesktop
    void refreshAuth()
    if (!bridge) return
    const interval = window.setInterval(() => void refreshAuth(), 90_000)
    const onFocus = () => void refreshAuth()
    window.addEventListener('focus', onFocus)
    const unsubscribe = bridge.onAuthChanged((state) => {
      setAuth(state)
      if (state.context) setContextState(state.context)
    })
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      unsubscribe?.()
    }
  }, [refreshAuth])

  const signOut = useCallback(async () => {
    if (!window.zevqoraDesktop) return
    const state = await window.zevqoraDesktop.signOut()
    setAuth(state)
    setCloudProjects([])
  }, [])

  const reloadCloudProjects = useCallback(async () => {
    if (!activeWorkspace || !auth?.signedIn) {
      setCloudProjects([])
      return
    }
    try {
      const { projects } = await platform.projects(activeWorkspace.id)
      setCloudProjects(projects)
      setCloudProjectsError(null)
    } catch (error) {
      setCloudProjectsError(errorMessage(error))
    }
  }, [activeWorkspace, auth?.signedIn])

  useEffect(() => {
    void reloadCloudProjects()
  }, [reloadCloudProjects])

  // Keep the persisted context aligned with the workspace that is actually active.
  useEffect(() => {
    if (!auth?.signedIn || !activeWorkspace) return
    if (context.workspaceId !== activeWorkspace.id) {
      void window.zevqoraDesktop?.setContext?.(activeWorkspace.id, null).then((next) => setContextState(next))
    }
  }, [auth?.signedIn, activeWorkspace, context.workspaceId])

  const setContext = useCallback(async (workspaceId: string | null, projectId: string | null) => {
    const next = (await window.zevqoraDesktop?.setContext?.(workspaceId, projectId)) || { workspaceId, projectId }
    setContextState(next)
  }, [])

  const linkProduct = useCallback((productId: string, cloudProjectId: string | null) => {
    setProductLinks(writeProductLink(productId, cloudProjectId))
  }, [])

  // ---- Local engine -----------------------------------------------------------
  const refreshHealth = useCallback(async () => {
    try {
      const next = await api.health()
      setHealth(next)
      setBackendError('')
      try {
        setPlatformStatus(await api.platformStatus())
      } catch {
        setPlatformStatus(null)
      }
    } catch (error) {
      setHealth(null)
      setPlatformStatus(null)
      setBackendError(errorMessage(error))
    }
  }, [])

  useEffect(() => {
    void refreshHealth()
    const id = window.setInterval(() => void refreshHealth(), 10_000)
    const unsubscribe = window.zevqoraDesktop?.onPlatformSynced?.(() => void refreshHealth())
    return () => {
      window.clearInterval(id)
      unsubscribe?.()
    }
  }, [refreshHealth])

  const refreshProducts = useCallback(async () => {
    const rows = await api.products()
    setProducts(rows)
    setSelectedId((current) => (current && rows.some((item) => item.id === current) ? current : rows[0]?.id || null))
  }, [])

  const productLoadedOnce = useRef(false)
  useEffect(() => {
    if (health?.status === 'ok' && !productLoadedOnce.current) {
      productLoadedOnce.current = true
      void refreshProducts().catch(() => {
        productLoadedOnce.current = false
      })
    }
  }, [health?.status, refreshProducts])

  const selectProduct = useCallback((id: string | null) => {
    setSelectedId(id)
    if (id) localStorage.setItem('zevqora.selectedProduct', id)
    else localStorage.removeItem('zevqora.selectedProduct')
    setInspect(null)
  }, [])

  const refreshProductData = useCallback(async () => {
    if (!selectedId) {
      setAiCalls([])
      setFindings([])
      setEconomics(null)
      setExperiments([])
      setImplementations([])
      setPlans([])
      setExecutions([])
      setEvaluations([])
      return
    }
    setDataLoading(true)
    try {
      const [calls, nextFindings, nextEconomics, nextExperiments, nextImplementations, nextPlans, nextExecutions, nextEvaluations] = await Promise.all([
        api.aiCalls(selectedId),
        api.findings(selectedId),
        api.economics(selectedId),
        api.experiments(selectedId),
        api.implementations(selectedId),
        api.plans(selectedId),
        api.executions(selectedId),
        api.evaluations(selectedId),
      ])
      setAiCalls(calls)
      setFindings(nextFindings)
      setEconomics(nextEconomics)
      setExperiments(nextExperiments)
      setImplementations(nextImplementations)
      setPlans(nextPlans)
      setExecutions(nextExecutions)
      setEvaluations(nextEvaluations)
    } finally {
      setDataLoading(false)
    }
  }, [selectedId])

  useEffect(() => {
    setScan(null)
    void refreshProductData().catch(() => undefined)
  }, [refreshProductData])

  const connectProduct = useCallback(
    async (path: string, name?: string) => {
      setZevState('scanning')
      try {
        const result = await api.connectLocal(path, name)
        setScan(result)
        await refreshProducts()
        setSelectedId(result.product.id)
        localStorage.setItem('zevqora.selectedProduct', result.product.id)
        setZevState('done')
        window.setTimeout(() => setZevState('idle'), 1200)
        return result
      } catch (error) {
        setZevState('idle')
        throw error
      }
    },
    [refreshProducts],
  )

  const runScan = useCallback(async () => {
    if (!selected) return null
    setZevState('scanning')
    try {
      const result = await api.scan(selected.id)
      setScan(result)
      await refreshProducts()
      await refreshProductData()
      setZevState('done')
      window.setTimeout(() => setZevState('idle'), 1200)
      toast({ tone: 'ok', title: `Scanned ${result.files_scanned} files`, description: `${result.ai_calls.length} AI call sites · ${result.findings.length} opportunities · ${result.skipped_sensitive_paths} sensitive paths skipped` })
      return result
    } catch (error) {
      setZevState('idle')
      toast({ tone: 'err', title: 'Scan failed', description: errorMessage(error) })
      throw error
    }
  }, [selected, refreshProducts, refreshProductData, toast])

  const toggleMonitoring = useCallback(async () => {
    if (!selected) return
    await api.monitoring(selected.id, !selected.monitoring_enabled)
    await refreshProducts()
  }, [selected, refreshProducts])

  const importTraceFile = useCallback(async () => {
    if (!selected) return
    if (!window.zevqoraDesktop) {
      toast({ tone: 'err', title: 'Trace file picker is available in the desktop shell.' })
      return
    }
    const file = await window.zevqoraDesktop.selectTraceFile()
    if (!file) return
    setZevState('verifying')
    try {
      const result = await api.importTraces(selected.id, file.content)
      await refreshProductData()
      setZevState('done')
      window.setTimeout(() => setZevState('idle'), 1200)
      if (result.rejected) toast({ tone: 'err', title: `Imported ${result.imported}, rejected ${result.rejected}`, description: result.errors[0] || 'Some rows were invalid.' })
      else toast({ tone: 'ok', title: `Imported ${result.imported} execution traces` })
    } catch (error) {
      setZevState('idle')
      toast({ tone: 'err', title: 'Import failed', description: errorMessage(error) })
    }
  }, [selected, refreshProductData, toast])

  const archiveProduct = useCallback(
    async (id: string) => {
      await api.archiveProduct(id)
      linkProduct(id, null)
      await refreshProducts()
    },
    [refreshProducts, linkProduct],
  )

  const setModel = useCallback((value: string) => {
    setModelState(value)
    localStorage.setItem('zevqora.agentModel', value)
  }, [])

  const value = useMemo<Store>(
    () => ({
      view,
      setView,
      inspect,
      setInspect,
      inspectorOpen,
      setInspectorOpen,
      auth,
      refreshAuth,
      signOut,
      workspaces,
      activeWorkspace,
      activeProjectId,
      cloudProjects,
      cloudProjectsError,
      setContext,
      reloadCloudProjects,
      productLinks,
      linkProduct,
      health,
      backendError,
      platformStatus,
      refreshHealth,
      products,
      selected,
      selectProduct,
      scan,
      aiCalls,
      findings,
      economics,
      experiments,
      implementations,
      plans,
      executions,
      evaluations,
      dataLoading,
      refreshProducts,
      refreshProductData,
      connectProduct,
      runScan,
      toggleMonitoring,
      importTraceFile,
      archiveProduct,
      zevState,
      setZevState,
      model,
      setModel,
    }),
    [
      view, setView, inspect, inspectorOpen, auth, refreshAuth, signOut, workspaces, activeWorkspace, activeProjectId, cloudProjects, cloudProjectsError, setContext, reloadCloudProjects, productLinks, linkProduct,
      health, backendError, platformStatus, refreshHealth, products, selected, selectProduct, scan, aiCalls, findings, economics, experiments, implementations, plans, executions, evaluations, dataLoading,
      refreshProducts, refreshProductData, connectProduct, runScan, toggleMonitoring, importTraceFile, archiveProduct, zevState, model, setModel,
    ],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
