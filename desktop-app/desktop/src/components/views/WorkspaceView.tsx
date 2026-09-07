import { useState } from 'react'
import { Archive, FolderOpen, Link2, ScanSearch, ShieldCheck, Upload } from 'lucide-react'
import { useStore } from '../../lib/store'
import { Button, Card, CardHeader, Empty, Field, KeyValue, Modal, Note, StatusChip, useToast } from '../ui'
import { dateTime, money, ms, relativeTime, titleCase } from '../../lib/format'
import { errorMessage } from '../../lib/api'

export function WorkspaceView({ onAddProduct }: { onAddProduct: () => void }) {
  const store = useStore()
  const { selected, scan, aiCalls, findings, economics, runScan, toggleMonitoring, importTraceFile, archiveProduct, cloudProjects, productLinks, linkProduct, activeWorkspace, zevState } = store
  const toast = useToast()
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [archiving, setArchiving] = useState(false)

  if (!selected) {
    return (
      <div className="page page-narrow">
        <Empty title="No repository connected" description="Connect the folder you actually develop in. ZEVQORA inspects supported source files read-only and never changes code during this step." action={<Button onClick={onAddProduct}><FolderOpen size={15} /> Connect repository</Button>} />
      </div>
    )
  }

  const providers = aiCalls.reduce<Record<string, number>>((acc, c) => {
    acc[c.provider] = (acc[c.provider] || 0) + 1
    return acc
  }, {})
  const linkedProjectId = productLinks[selected.id] || ''

  const archive = async () => {
    setArchiving(true)
    try {
      await archiveProduct(selected.id)
      toast({ tone: 'ok', title: 'Repository disconnected', description: 'Evidence attached to it is kept; the product no longer appears in the sidebar.' })
      setConfirmArchive(false)
    } catch (error) {
      toast({ tone: 'err', title: 'Could not disconnect', description: errorMessage(error) })
    } finally {
      setArchiving(false)
    }
  }

  return (
    <div className="page page-narrow">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="eyebrow">Project</div>
          <h1 className="h1">{selected.name}</h1>
          <p className="lede mono text-[12.5px]">{selected.root_path}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => void window.zevqoraDesktop?.openPath?.(selected.root_path)}><FolderOpen size={14} /> Open folder</Button>
          <Button variant="secondary" size="sm" onClick={() => void importTraceFile()}><Upload size={14} /> Import traces</Button>
          <Button size="sm" onClick={() => void runScan()} loading={zevState === 'scanning'}><ScanSearch size={14} /> Scan now</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5">
          <div className="metric-label">Analysis status</div>
          <div className="mt-2"><StatusChip status={selected.last_scan_at ? 'ok' : 'waiting'} label={selected.last_scan_at ? 'SCANNED' : 'NOT SCANNED'} /></div>
          <div className="mt-2 text-[12px] text-subtle">Last scan {selected.last_scan_at ? relativeTime(selected.last_scan_at) : 'never'}{scan ? ` · ${scan.files_scanned} files · ${scan.skipped_sensitive_paths} sensitive paths skipped` : ''}</div>
        </Card>
        <Card className="p-5">
          <div className="metric-label">AI usage locations</div>
          <div className="metric-value">{aiCalls.length}</div>
          <div className="metric-hint">{Object.keys(providers).length ? Object.entries(providers).map(([p, n]) => `${p} ${n}`).join(' · ') : 'No providers detected yet'}</div>
        </Card>
        <Card className="p-5">
          <div className="metric-label">Execution evidence</div>
          <div className="metric-value">{economics?.trace_count ?? 0}</div>
          <div className="metric-hint">{economics?.latest_evidence_at ? `latest ${relativeTime(economics.latest_evidence_at)} · avg ${ms(economics.avg_latency_ms)}` : 'Import JSONL traces from your runtime'}</div>
        </Card>
        <Card className="p-5">
          <div className="metric-label">Continuous monitoring</div>
          <div className="mt-2 flex items-center gap-2">
            <StatusChip status={selected.monitoring_enabled ? 'live' : 'disconnected'} label={selected.monitoring_enabled ? 'ON' : 'OFF'} />
            <Button size="xs" variant="secondary" onClick={() => void toggleMonitoring()}>{selected.monitoring_enabled ? 'Pause' : 'Enable'}</Button>
          </div>
          <div className="mt-2 text-[12px] text-subtle">Re-scans the folder periodically. Read-only.</div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="AI usage locations" description="Every detected model call site in the scanned source. Read-only." />
          <div className="card-body overflow-x-auto p-0">
            {!aiCalls.length ? (
              <div className="p-5"><Empty title="Nothing detected yet" description="Run a scan. ZEVQORA looks for OpenAI, Anthropic, Gemini, OpenRouter, Vercel AI SDK, LiteLLM and LangChain call patterns in .py/.js/.ts sources." /></div>
            ) : (
              <table className="table">
                <thead><tr><th>Location</th><th>Provider</th><th>Symbol</th><th>Excerpt</th></tr></thead>
                <tbody>
                  {aiCalls.map((c) => (
                    <tr key={c.id}>
                      <td className="mono">{c.file_path}:{c.line}</td>
                      <td><span className="chip chip-accent">{c.provider}</span></td>
                      <td className="mono">{c.symbol || '—'}</td>
                      <td className="mono max-w-[360px] truncate text-subtle" title={c.excerpt}>{c.excerpt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        <div className="grid gap-4 content-start">
          <Card>
            <CardHeader title="What ZEVQORA accesses" description="The local trust boundary for this repository." />
            <div className="card-body grid gap-2 text-[12.5px] text-muted">
              <div className="flex items-start gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-verified" /><span><b className="text-ink">Reads</b> .py, .js, .jsx, .ts, .tsx, .mjs, .cjs sources up to 1 MB each.</span></div>
              <div className="flex items-start gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-verified" /><span><b className="text-ink">Skips</b> .git, node_modules, venvs, build output, and anything named like .env, secret, credential, token, key, private, backup, dump.</span></div>
              <div className="flex items-start gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-verified" /><span><b className="text-ink">Never</b> sends source to the cloud during scan. Replays send only the sampled task text you imported, through your account.</span></div>
              <div className="flex items-start gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-verified" /><span><b className="text-ink">Writes</b> only into an isolated Git worktree when you explicitly prepare a change. No merge. No deploy. No SSH.</span></div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Cloud project link" description="Attach this repository to a project in your ZEVQORA workspace to see its live runtime here." />
            <div className="card-body grid gap-3">
              <Field label="Workspace project" hint={activeWorkspace ? `Workspace: ${activeWorkspace.name}` : 'Sign in and pick a workspace first.'}>
                <select className="select" value={linkedProjectId} onChange={(e) => { linkProduct(selected.id, e.target.value || null); toast({ tone: 'ok', title: e.target.value ? 'Repository linked to project' : 'Link removed' }) }}>
                  <option value="">Not linked</option>
                  {cloudProjects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} · {p.source_kind}</option>
                  ))}
                </select>
              </Field>
              <div className="flex items-center gap-2 text-[12px] text-subtle"><Link2 size={13} /> Linking is a local preference; evidence stays where it was produced.</div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Economics" description="Only from imported execution evidence." />
            <div className="card-body">
              <KeyValue
                items={[
                  ['Observed cost', money(economics?.observed_cost_usd, { digits: 4 })],
                  ['Per trace', money(economics?.avg_cost_per_trace_usd, { digits: 5 })],
                  ['Avg latency', ms(economics?.avg_latency_ms)],
                  ['Window', economics?.first_evidence_at ? `${dateTime(economics.first_evidence_at)} → ${dateTime(economics.latest_evidence_at)}` : '—'],
                  ['Verified savings', money(economics?.verified_savings_usd, { digits: 4 })],
                  ['Opportunities', `${findings.length} (${findings.filter((f) => f.evidence_status === 'verified').length} verified)`],
                ]}
              />
              {economics?.note && <Note tone="info" className="mt-3">{economics.note}</Note>}
            </div>
          </Card>

          <Card>
            <CardHeader title="Disconnect" description="Detach this repository from the desktop. Evidence is kept." />
            <div className="card-body">
              <Button variant="danger" size="sm" onClick={() => setConfirmArchive(true)}><Archive size={14} /> Disconnect repository</Button>
            </div>
          </Card>
        </div>
      </div>

      <Modal open={confirmArchive} onClose={() => setConfirmArchive(false)} size="sm" title="Disconnect this repository?" description={`${selected.name} will leave the sidebar. Evaluations and evidence it produced remain stored locally and unchanged.`} footer={<><Button variant="ghost" onClick={() => setConfirmArchive(false)}>Cancel</Button><Button variant="danger" onClick={() => void archive()} loading={archiving}>Disconnect</Button></>}>
        <div className="text-caption text-muted">Nothing is deleted from the folder itself. {titleCase('read-only')} access stops.</div>
      </Modal>
    </div>
  )
}
