import { useState } from 'react'
import { GitBranch } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useStore } from '../../lib/store'
import { Button, Field, Modal, Note } from '../ui'
import type { Experiment, Implementation } from '../../lib/types'

export function PrepareChangeDialog({ experiment, onClose, onComplete }: { experiment: Experiment | null; onClose: () => void; onComplete: (implementation: Implementation) => Promise<void> | void }) {
  const { selected, model, health, setZevState } = useStore()
  const [instructions, setInstructions] = useState('')
  const [runTests, setRunTests] = useState(false)
  const [testCommand, setTestCommand] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!experiment || !selected) return null

  const prepare = async () => {
    setBusy(true)
    setError('')
    setZevState('experimenting')
    try {
      const result = await api.prepareImplementation(selected.id, {
        experiment_id: experiment.id,
        instructions: instructions.trim() || undefined,
        model: model.trim() || undefined,
        run_tests: runTests,
        test_command: runTests ? testCommand.trim() || undefined : undefined,
      })
      setZevState('done')
      window.setTimeout(() => setZevState('idle'), 1200)
      await onComplete(result)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setZevState('idle')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={Boolean(experiment)} onClose={busy ? () => undefined : onClose} eyebrow="Explicit source-change approval" title="Prepare an isolated change" description="ZEVQORA creates a new Git worktree and branch, asks the model for a minimal one-file replacement that reflects the verified experiment, and shows you the diff. It will not merge or deploy." footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="inverse" onClick={() => void prepare()} loading={busy} disabled={runTests && !testCommand.trim()}><GitBranch size={14} /> {busy ? 'Preparing worktree…' : 'Prepare candidate'}</Button></>}>
      <div className="grid gap-4">
        {!health?.openrouter_configured && <Note tone="warn">A model provider is required to write the candidate. Sign in for platform compute or add a local key in Settings.</Note>}
        <Field label="Implementation guidance (optional)"><textarea className="textarea" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. preserve the public API and keep the baseline model as fallback" /></Field>
        <label className="checkbox"><input type="checkbox" checked={runTests} onChange={(e) => setRunTests(e.target.checked)} /><span><b>Run my project test command in the isolated worktree.</b><br />Executed only because you provide and approve it. Shell operators are refused.</span></label>
        {runTests && <Field label="Test command"><input className="input mono" value={testCommand} onChange={(e) => setTestCommand(e.target.value)} placeholder="pytest -q" /></Field>}
        <Note tone="info">Python targets always receive a compile check. Files containing secret-like values are never sent or rewritten.</Note>
        {error && <Note tone="error">{error}</Note>}
      </div>
    </Modal>
  )
}
