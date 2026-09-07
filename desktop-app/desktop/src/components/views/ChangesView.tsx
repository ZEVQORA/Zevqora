import { useEffect, useMemo, useState } from 'react'
import { Check, ExternalLink, FolderOpen, GitBranch, GitPullRequest, UploadCloud, X } from 'lucide-react'
import { useStore } from '../../lib/store'
import { api, errorMessage } from '../../lib/api'
import { Button, Card, CardHeader, DiffView, Empty, Field, KeyValue, Modal, Note, StatusChip, useToast } from '../ui'
import { costDeltaLabel, dateTime, relativeTime, shortId } from '../../lib/format'
import type { Experiment, GitContext, Implementation } from '../../lib/types'

export function ChangesView({ onPrepare }: { onPrepare: (experiment: Experiment) => void }) {
  const store = useStore()
  const { selected, implementations, experiments, evaluations, inspect, setInspect, refreshProductData } = store
  const toast = useToast()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [git, setGit] = useState<GitContext | null>(null)
  const [gitError, setGitError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'approve' | 'reject' | 'push' | null>(null)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [note, setNote] = useState('')
  const [prUrl, setPrUrl] = useState('')

  const current = useMemo<Implementation | null>(() => {
    const id = inspect?.kind === 'implementation' ? inspect.id : selectedId
    return implementations.find((i) => i.id === id) || implementations[0] || null
  }, [implementations, inspect, selectedId])

  useEffect(() => {
    if (!selected || !current) {
      setGit(null)
      return
    }
    let active = true
    setGitError(null)
    api
      .implementationGit(selected.id, current.id)
      .then((ctx) => active && setGit(ctx))
      .catch((error) => active && setGitError(errorMessage(error)))
    return () => {
      active = false
    }
  }, [selected, current?.id, current?.pushed_at, current?.status])

  const eligible = experiments.filter((e) => e.status === 'VERIFIED' && e.execution_proven && e.evaluation_run_id)

  if (!selected) return <div className="page page-narrow"><Empty title="Connect a repository first" /></div>

  const act = async (kind: 'approve' | 'reject' | 'push') => {
    if (!current) return
    setBusy(kind)
    try {
      if (kind === 'push') {
        const result = await api.pushImplementation(selected.id, current.id)
        toast({ tone: 'ok', title: 'Branch pushed to origin', description: result.compare_url ? 'Open the pull request from the button below.' : 'No pull-request link could be derived for this remote.' })
      } else {
        await api.decideImplementation(selected.id, current.id, kind, kind === 'reject' ? note : undefined)
        toast({ tone: 'ok', title: kind === 'approve' ? 'Marked approved for PR review' : 'Candidate rejected' })
        setRejectOpen(false)
        setNote('')
      }
      await refreshProductData()
    } catch (error) {
      toast({ tone: 'err', title: kind === 'push' ? 'Push failed' : 'Could not record decision', description: errorMessage(error) })
    } finally {
      setBusy(null)
    }
  }

  const openPr = async () => {
    if (!git?.compare_url) return
    await window.zevqoraDesktop?.openExternal?.(git.compare_url)
  }

  const savePr = async () => {
    if (!current || !prUrl.trim()) return
    try {
      await api.recordPrLink(selected.id, current.id, prUrl.trim())
      toast({ tone: 'ok', title: 'Pull request linked' })
      setPrUrl('')
      await refreshProductData()
    } catch (error) {
      toast({ tone: 'err', title: 'Could not link PR', description: errorMessage(error) })
    }
  }

  const evaluationFor = (impl: Implementation) => {
    const exp = experiments.find((e) => e.id === impl.experiment_id)
    return exp ? evaluations.find((ev) => ev.id === exp.evaluation_run_id) || null : null
  }

  return (
    <div className="page page-narrow">
      <div className="mb-6">
        <div className="eyebrow">Patch &amp; review</div>
        <h1 className="h1">Proof first. Change second. Humans merge.</h1>
        <p className="lede">Only an execution-proven VERIFIED experiment can prepare a change. ZEVQORA writes it into an isolated Git worktree on a new branch, shows the diff and your tests, and hands the pull request to you. It never merges or deploys.</p>
      </div>

      <Card className="mb-4">
        <CardHeader title="Eligible experiments" description={eligible.length ? 'Verified, execution-proven, linked to a source finding.' : 'No experiment is eligible yet. Verify a candidate first.'} />
        {eligible.length > 0 && (
          <div className="card-body grid gap-2">
            {eligible.map((e) => (
              <div key={e.id} className="list-row">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-[13px] font-semibold text-ink">Experiment {shortId(e.id)}</span>
                    <span className="ml-2 text-[12px] text-subtle">{e.sample_size} samples · quality {e.candidate_quality?.toFixed(2)} · {relativeTime(e.created_at)}</span>
                  </div>
                  <Button size="xs" onClick={() => onPrepare(e)}><GitBranch size={12} /> Prepare isolated change</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {!implementations.length ? (
        <Empty title="No change candidates prepared" description="Prepared changes appear here with their diff, branch, worktree and test output." />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
          <div className="grid content-start gap-2">
            {implementations.map((i) => (
              <button key={i.id} className={`list-row is-clickable ${current?.id === i.id ? 'is-selected' : ''}`} onClick={() => { setSelectedId(i.id); setInspect({ kind: 'implementation', id: i.id }) }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-semibold text-ink">{i.summary || i.target_file}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="mono truncate text-[11px] text-subtle">{i.branch_name}</span>
                  <StatusChip status={i.status} />
                </div>
              </button>
            ))}
          </div>

          {current && (
            <div className="grid content-start gap-4">
              <Card>
                <CardHeader
                  title={current.summary || 'Change candidate'}
                  description={<span className="mono">{current.target_file}</span>}
                  action={<StatusChip status={current.status} />}
                />
                <div className="card-body grid gap-4 md:grid-cols-2">
                  <KeyValue
                    items={[
                      ['Branch', current.branch_name],
                      ['Worktree', current.worktree_path],
                      ['Model', current.model],
                      ['Prepared', dateTime(current.created_at)],
                    ]}
                  />
                  <KeyValue
                    items={[
                      ['Remote', git?.remote_url || (gitError ? 'unavailable' : '—')],
                      ['Base branch', git?.default_branch || '—'],
                      ['Pushed', dateTime(current.pushed_at)],
                      ['Reviewed', current.reviewed_at ? `${dateTime(current.reviewed_at)}${current.review_note ? ' · ' + current.review_note : ''}` : '—'],
                    ]}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-4">
                  <Button size="sm" variant="secondary" onClick={() => void window.zevqoraDesktop?.openPath?.(current.worktree_path)} disabled={git ? !git.worktree_exists : false}><FolderOpen size={14} /> Open worktree</Button>
                  <Button size="sm" variant="secondary" onClick={() => void act('push')} loading={busy === 'push'} disabled={current.status === 'REJECTED' || (git ? !git.worktree_exists || !git.remote_url : false)} title={git && !git.remote_url ? 'The repository has no origin remote' : 'git push -u origin <branch> from the isolated worktree'}><UploadCloud size={14} /> {current.pushed_at ? 'Push again' : 'Push branch'}</Button>
                  <Button size="sm" onClick={() => void openPr()} disabled={!git?.compare_url || !current.pushed_at} title={!current.pushed_at ? 'Push the branch first' : git?.compare_url || ''}><GitPullRequest size={14} /> Create pull request <ExternalLink size={12} /></Button>
                  <span className="mx-1 h-5 w-px bg-line" aria-hidden />
                  <Button size="sm" variant="accent" onClick={() => void act('approve')} loading={busy === 'approve'} disabled={current.status === 'REJECTED' || current.status === 'TESTS_FAILED' || current.status === 'APPROVED_FOR_REVIEW'}><Check size={14} /> Approve for review</Button>
                  <Button size="sm" variant="danger" onClick={() => setRejectOpen(true)} disabled={current.status === 'REJECTED'}><X size={14} /> Reject</Button>
                </div>
                {current.pr_url ? (
                  <div className="px-5 pb-4 text-[12.5px] text-muted">Pull request: <button className="text-blue-700 underline underline-offset-4" onClick={() => void window.zevqoraDesktop?.openExternal?.(current.pr_url || '')}>{current.pr_url}</button></div>
                ) : (
                  <div className="flex flex-wrap items-end gap-2 px-5 pb-4">
                    <Field label="Link the pull request once opened" className="min-w-[320px] flex-1"><input className="input mono" value={prUrl} onChange={(e) => setPrUrl(e.target.value)} placeholder="https://github.com/org/repo/pull/123" /></Field>
                    <Button size="sm" variant="secondary" onClick={() => void savePr()} disabled={!prUrl.trim()}>Save link</Button>
                  </div>
                )}
              </Card>

              {(() => {
                const ev = evaluationFor(current)
                return ev ? (
                  <Note tone={ev.status === 'VERIFIED' ? 'ok' : 'warn'}>
                    Backed by evaluation {shortId(ev.id)} · {ev.status} · {ev.sample_count} samples · quality {ev.candidate_quality?.toFixed(2)} · {costDeltaLabel(ev)}.{' '}
                    <button className="underline underline-offset-4" onClick={() => setInspect({ kind: 'evaluation', id: ev.id })}>Inspect evidence</button>
                  </Note>
                ) : null
              })()}

              <DiffView diff={current.diff_text} file={current.target_file} />

              <Card>
                <CardHeader title="Tests" description={current.test_command ? `${current.test_command} · exit ${current.test_exit_code ?? '—'}` : 'No project test command was run. Python targets receive a compile check.'} action={current.test_exit_code !== null && <StatusChip status={current.test_exit_code === 0 ? 'passed' : 'failed'} />} />
                {current.test_output && (
                  <div className="card-body pt-0">
                    <pre className="mono max-h-[260px] overflow-auto rounded-lg bg-ink p-3 text-[11.5px] leading-relaxed text-cloud/85">{current.test_output}</pre>
                  </div>
                )}
              </Card>
            </div>
          )}
        </div>
      )}

      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} size="sm" title="Reject this candidate?" description="The branch and worktree stay on disk for your reference. Nothing is merged either way." footer={<><Button variant="ghost" onClick={() => setRejectOpen(false)}>Cancel</Button><Button variant="danger" onClick={() => void act('reject')} loading={busy === 'reject'}>Reject candidate</Button></>}>
        <Field label="Reason (optional)"><textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. touches the public interface; needs a different fallback" /></Field>
      </Modal>
    </div>
  )
}
