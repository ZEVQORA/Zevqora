import { useState } from 'react'
import { ArrowRight, FolderOpen, ShieldCheck } from 'lucide-react'
import { Zev } from '../../brand/Zev'
import { errorMessage } from '../../lib/api'
import { Button, Field, Modal, Note } from '../ui'
import type { ScanResult } from '../../lib/types'

export function AddProductDialog({ open, onClose, onConnect }: { open: boolean; onClose: () => void; onConnect: (path: string, name?: string) => Promise<ScanResult> }) {
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const choose = async () => {
    const chosen = await window.zevqoraDesktop?.selectFolder()
    if (chosen) setPath(chosen)
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
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} size="lg" eyebrow="Connect repository" title="Give Zev a repository to understand." description="Choose the folder you actually develop in. ZEVQORA inspects supported source files read-only and detects the AI stack without changing code." footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => void submit()} loading={busy} disabled={!path.trim()}>{busy ? 'Detecting AI stack…' : 'Connect and scan'} {!busy && <ArrowRight size={14} />}</Button></>}>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_150px]">
        <div className="grid gap-4">
          <Field label="Local project folder">
            <div className="flex gap-2">
              <input className="input mono min-w-0 flex-1" value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\projects\my-ai-product" />
              <Button variant="secondary" onClick={() => void choose()}><FolderOpen size={15} /> Browse</Button>
            </div>
          </Field>
          <Field label={<span>Product name <span className="font-normal text-subtle">optional</span></span>}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Support assistant" />
          </Field>
          <div className="rounded-xl border border-line bg-cloud p-3">
            <div className="flex items-start gap-3">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-verified" />
              <div className="text-[12.5px] text-muted"><b className="text-ink">Local trust boundary.</b> Secret-like paths, .git, dependencies and build output are skipped. Source is not uploaded during this step.</div>
            </div>
          </div>
          {error && <Note tone="error">{error}</Note>}
        </div>
        <div className="hidden items-end justify-center md:flex">
          <Zev view="pose-sitting" height={150} />
        </div>
      </div>
    </Modal>
  )
}
