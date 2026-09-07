import { useCallback, useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'
import { StoreProvider, useStore } from './lib/store'
import { errorMessage } from './lib/api'
import { ToastProvider, useToast } from './components/ui'
import { TitleBar } from './components/shell/TitleBar'
import { Sidebar } from './components/shell/Sidebar'
import { Inspector } from './components/shell/Inspector'
import { WelcomeScreen } from './components/WelcomeScreen'
import { OverviewView } from './components/views/OverviewView'
import { WorkspaceView } from './components/views/WorkspaceView'
import { OpportunitiesView } from './components/views/OpportunitiesView'
import { ExperimentsView } from './components/views/ExperimentsView'
import { ChangesView } from './components/views/ChangesView'
import { RuntimeView } from './components/views/RuntimeView'
import { ZevView } from './components/views/ZevView'
import { SettingsView } from './components/views/SettingsView'
import { AddProductDialog } from './components/dialogs/AddProductDialog'
import { TestOpportunityDialog } from './components/dialogs/TestOpportunityDialog'
import { PrepareChangeDialog } from './components/dialogs/PrepareChangeDialog'
import { CommandPalette } from './components/dialogs/CommandPalette'
import type { Experiment, Finding } from './lib/types'
import { BrandLoader } from './brand/Logo'

function Shell() {
  const store = useStore()
  const toast = useToast()
  const { view, setView, auth, backendError, inspectorOpen, connectProduct, refreshProductData, setInspect, refreshAuth } = store
  const [addOpen, setAddOpen] = useState(false)
  const [testing, setTesting] = useState<Finding | null>(null)
  const [preparing, setPreparing] = useState<Experiment | null>(null)
  const [commandOpen, setCommandOpen] = useState(false)
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState('')

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

  const directLogin = useCallback(async (email: string, password: string) => {
    setAuthError('')
    setAuthLoading(true)
    try {
      if (!window.zevqoraDesktop) throw new Error('Desktop authentication bridge is unavailable.')
      await window.zevqoraDesktop.signInWithPassword(email, password)
      await refreshAuth()
    } catch (error) {
      setAuthError(errorMessage(error))
      throw error
    } finally {
      setAuthLoading(false)
    }
  }, [refreshAuth])

  if (auth === null) {
    return (
      <div className="flex h-screen items-center justify-center app-env">
        <BrandLoader label="Restoring your session" size={32} />
      </div>
    )
  }

  if (!auth.signedIn) {
    return (
      <WelcomeScreen
        auth={auth}
        loading={authLoading}
        error={authError}
        onDirectLogin={directLogin}
        onBrowserLogin={() => void window.zevqoraDesktop?.startBrowserAuth()}
        onCreateAccount={() => void window.zevqoraDesktop?.openSignup()}
      />
    )
  }

  let content: React.ReactNode
  if (view === 'workspace') content = <WorkspaceView onAddProduct={() => setAddOpen(true)} />
  else if (view === 'opportunities') content = <OpportunitiesView onTest={(finding) => setTesting(finding)} />
  else if (view === 'experiments') content = <ExperimentsView onPrepare={(experiment) => setPreparing(experiment)} onTest={() => setView('opportunities')} />
  else if (view === 'changes') content = <ChangesView onPrepare={(experiment) => setPreparing(experiment)} />
  else if (view === 'runtime') content = <RuntimeView />
  else if (view === 'zev') content = <ZevView />
  else if (view === 'settings') content = <SettingsView />
  else content = <OverviewView onAddProduct={() => setAddOpen(true)} />

  return (
    <div className="app-window app-env">
      <TitleBar onOpenCommand={() => setCommandOpen(true)} />
      <div className="app-body">
        <Sidebar onAddProduct={() => setAddOpen(true)} />
        <main className="main-surface">
          {backendError && (
            <div className="flex items-center gap-2 border-b border-warning/30 bg-warning-bg px-5 py-2 text-[12.5px] text-warning">
              <WifiOff size={13} /> Local engine offline. {backendError} Start the local engine on 127.0.0.1:8000.
            </div>
          )}
          {auth.degraded && auth.error && <div className="border-b border-warning/30 bg-warning-bg px-5 py-2 text-[12.5px] text-warning">{auth.error}</div>}
          {view === 'zev' ? <div className="relative flex min-h-0 flex-1 flex-col">{content}</div> : <div className="main-scroll">{content}</div>}
        </main>
        {inspectorOpen && <Inspector />}
      </div>

      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} onAddProduct={() => setAddOpen(true)} />
      <AddProductDialog open={addOpen} onClose={() => setAddOpen(false)} onConnect={async (path, name) => { const result = await connectProduct(path, name); toast({ tone: 'ok', title: `Connected ${result.product.name}`, description: `${result.files_scanned} files · ${result.ai_calls.length} AI call sites · ${result.findings.length} opportunities` }); setView('overview'); return result }} />
      <TestOpportunityDialog
        finding={testing}
        onClose={() => setTesting(null)}
        onComplete={async (evaluation) => {
          await refreshProductData()
          setInspect({ kind: 'evaluation', id: evaluation.id })
          setView('experiments')
          toast({ tone: evaluation.status === 'VERIFIED' ? 'ok' : 'info', title: evaluation.status === 'VERIFIED' ? 'Quality gate passed' : evaluation.status === 'REJECTED' ? 'Cheaper isn’t verified' : `Evaluation ${evaluation.status}`, description: evaluation.rejection_reason || undefined })
        }}
      />
      <PrepareChangeDialog
        experiment={preparing}
        onClose={() => setPreparing(null)}
        onComplete={async (implementation) => {
          await refreshProductData()
          setInspect({ kind: 'implementation', id: implementation.id })
          setView('changes')
          toast({ tone: 'ok', title: 'Change candidate prepared', description: `${implementation.branch_name} · ${implementation.status.replace(/_/g, ' ').toLowerCase()}` })
        }}
      />
    </div>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </ToastProvider>
  )
}
