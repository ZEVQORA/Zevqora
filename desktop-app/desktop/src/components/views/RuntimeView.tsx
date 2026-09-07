import { useEffect, useMemo, useState } from 'react'
import { Copy, ExternalLink, KeyRound, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useStore } from '../../lib/store'
import { platform, platformErrorMessage } from '../../lib/platform'
import { Bars, Button, Card, CardHeader, Empty, Field, Metric, Modal, Note, StatusChip, useAsync, useToast } from '../ui'
import { compactNum, dateTime, money, ms, num, relativeTime } from '../../lib/format'
import type { RuntimeSummary } from '../../lib/types'

type Window = '1h' | '24h' | '7d' | '30d'

function connectionState(summary: RuntimeSummary | null, error: string | null) {
  if (error) return { status: 'error', label: 'ERROR' }
  if (!summary) return { status: 'waiting', label: 'WAITING' }
  const active = summary.connections.filter((c) => c.status === 'active')
  if (!active.length) return { status: 'disconnected', label: 'DISCONNECTED' }
  const last = summary.totals.last_seen ? Date.now() - new Date(summary.totals.last_seen).getTime() : Infinity
  if (last < 15 * 60_000) return { status: 'live', label: 'CONNECTED' }
  return { status: 'waiting', label: 'WAITING' }
}

export function RuntimeView() {
  const store = useStore()
  const { auth, activeWorkspace, cloudProjects, cloudProjectsError, reloadCloudProjects, productLinks, selected, setContext, activeProjectId } = store
  const toast = useToast()
  const [window_, setWindow] = useState<Window>('24h')
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [capture, setCapture] = useState(false)
  const [issued, setIssued] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [projectOpen, setProjectOpen] = useState(false)
  const [projectName, setProjectName] = useState('')

  const linked = selected ? productLinks[selected.id] : null
  const projectId = useMemo(() => (linked && cloudProjects.some((p) => p.id === linked) ? linked : activeProjectId || cloudProjects[0]?.id || null), [linked, cloudProjects, activeProjectId])
  const project = cloudProjects.find((p) => p.id === projectId) || null

  const q = useAsync(() => platform.runtime(projectId!, window_), [projectId, window_], { enabled: Boolean(projectId && auth?.signedIn) })
  useEffect(() => {
    if (!projectId) return
    const id = window.setInterval(() => q.reload(), 30_000)
    return () => window.clearInterval(id)
  }, [projectId, q])

  const state = connectionState(q.data, q.error)

  if (!auth?.signedIn) return <div className="page page-narrow"><Empty title="Sign in to see live runtime" /></div>
  if (!activeWorkspace) return <div className="page page-narrow"><Empty title="No workspace yet" description="Create a workspace in your ZEVQORA account, then come back here." action={<Button size="sm" onClick={() => void window.zevqoraDesktop?.openWeb?.('/app')}>Open ZEVQORA web <ExternalLink size={12} /></Button>} /></div>

  const createProject = async () => {
    if (!projectName.trim()) return
    setBusy(true)
    try {
      const { project: created } = await platform.createProject(activeWorkspace.id, { name: projectName.trim(), source_kind: 'runtime' })
      await reloadCloudProjects()
      await setContext(activeWorkspace.id, created.id)
      if (selected) store.linkProduct(selected.id, created.id)
      toast({ tone: 'ok', title: `Project ${created.name} created` })
      setProjectOpen(false)
      setProjectName('')
    } catch (error) {
      toast({ tone: 'err', title: 'Could not create project', description: platformErrorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const createConnection = async () => {
    if (!project || !newName.trim()) return
    setBusy(true)
    try {
      const { token } = await platform.createConnection(project.id, { kind: 'server_telemetry', name: newName.trim(), capture_samples: capture })
      setIssued(token)
      q.reload()
    } catch (error) {
      toast({ tone: 'err', title: 'Could not create connection', description: platformErrorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (id: string, name: string) => {
    try {
      await platform.revokeConnection(id)
      toast({ tone: 'ok', title: `Revoked ${name}`, description: 'Its token stops working immediately.' })
      q.reload()
    } catch (error) {
      toast({ tone: 'err', title: 'Could not revoke', description: platformErrorMessage(error) })
    }
  }

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    toast({ tone: 'ok', title: 'Copied' })
  }

  const d = q.data
  const platformUrl = auth.platformUrl || 'https://zevqora.vercel.app'

  return (
    <div className="page page-narrow">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Live runtime · {activeWorkspace.name}</div>
          <h1 className="h1">What your product is spending right now.</h1>
          <p className="lede">Telemetry your servers send to ZEVQORA with a scoped, revocable token over HTTPS. No agent, no SSH, no shell access. Sanitized samples only when you opt in.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="select !w-auto" value={projectId || ''} onChange={(e) => { const id = e.target.value || null; void setContext(activeWorkspace.id, id); if (selected && id) store.linkProduct(selected.id, id) }} aria-label="Project">
            {!cloudProjects.length && <option value="">No project yet</option>}
            {cloudProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Button size="sm" variant="secondary" onClick={() => setProjectOpen(true)}><Plus size={14} /> New project</Button>
          <Button size="sm" variant="secondary" onClick={() => q.reload()} loading={q.loading && Boolean(d)}><RefreshCw size={14} /></Button>
        </div>
      </div>

      {cloudProjectsError && <Note tone="error" className="mb-4">{cloudProjectsError}</Note>}

      {!project ? (
        <Empty title="Create a project to receive telemetry" description="A project holds a workload's telemetry, opportunities and evidence in your workspace." action={<Button size="sm" onClick={() => setProjectOpen(true)}><Plus size={14} /> New project</Button>} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <StatusChip status={state.status} label={state.label} />
            <span className="text-[12.5px] text-muted">{d?.totals.last_seen ? `Last seen ${relativeTime(d.totals.last_seen)}` : 'No events received yet'} · {d ? `${num(d.totals.requests_per_min_5m, 1)} req/min (5m)` : ''}</span>
            <div className="ml-auto flex gap-1">
              {(['1h', '24h', '7d', '30d'] as Window[]).map((w) => (
                <button key={w} onClick={() => setWindow(w)} className={`suggestion ${window_ === w ? '!border-blue !text-ink' : ''}`}>{w}</button>
              ))}
            </div>
          </div>
          {q.error && <Note tone="error" className="mb-4">{q.error}</Note>}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card className="p-5"><Metric label="Requests" value={compactNum(d?.totals.requests)} hint={d ? `${d.totals.errors} errors · ${d.totals.errors_5m} in last 5m` : ''} /></Card>
            <Card className="p-5"><Metric label="Cost" value={money(d?.totals.cost_usd, { digits: 4 })} hint={d ? `${compactNum(d.totals.input_tokens)} in · ${compactNum(d.totals.output_tokens)} out tokens` : ''} /></Card>
            <Card className="p-5"><Metric label="Latency p50 / p95" value={d ? `${ms(d.totals.latency_p50_ms)} / ${ms(d.totals.latency_p95_ms)}` : '—'} hint="wall time of provider calls" /></Card>
            <Card className="p-5"><Metric label="Open opportunities" value={String(d?.open_opportunities ?? '—')} hint={d ? `${d.totals.samples} sanitized samples stored` : ''} tone="accent" /></Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader title="Models" description="Where the spend goes in this window." />
              <div className="card-body overflow-x-auto p-0">
                {!d?.models.length ? <div className="p-5"><Empty title="No telemetry in this window" description="Send events from your runtime with the connection token." /></div> : (
                  <table className="table">
                    <thead><tr><th>Model</th><th className="right">Requests</th><th className="right">Errors</th><th className="right">Cost</th><th className="right">p50</th><th className="right">p95</th></tr></thead>
                    <tbody>
                      {d.models.map((m) => (
                        <tr key={`${m.provider}/${m.model}`}>
                          <td className="mono">{m.provider}/{m.model}</td>
                          <td className="right tnum">{num(m.requests)}</td>
                          <td className="right tnum">{num(m.errors)}</td>
                          <td className="right tnum">{money(m.cost_usd, { digits: 4 })}</td>
                          <td className="right tnum">{ms(m.latency_p50_ms)}</td>
                          <td className="right tnum">{ms(m.latency_p95_ms)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              {d && d.daily.length > 1 && <div className="px-5 pb-5"><div className="metric-label mb-2">Daily cost</div><Bars values={d.daily.map((x) => x.cost_usd)} /></div>}
            </Card>

            <div className="grid content-start gap-4">
              <Card>
                <CardHeader title="Connections" description="Scoped tokens. Hashed at rest. Revoke any time." action={<Button size="xs" onClick={() => { setIssued(null); setNewName(''); setCreateOpen(true) }}><KeyRound size={12} /> New token</Button>} />
                <div className="card-body grid gap-2 pt-3">
                  {!d?.connections.length && <p className="text-[12.5px] text-muted">No connections yet.</p>}
                  {d?.connections.map((c) => (
                    <div key={c.id} className="list-row">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-semibold text-ink">{c.name}</span>
                        <StatusChip status={c.status} />
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[11.5px] text-subtle">
                        <span className="mono">{c.token_prefix ? `zqt_${c.token_prefix}_…${c.token_last4 || ''}` : c.kind} · seen {c.last_seen_at ? relativeTime(c.last_seen_at) : 'never'}</span>
                        {c.status === 'active' && <button className="text-rejected hover:underline" onClick={() => void revoke(c.id, c.name)} title="Revoke"><Trash2 size={13} /></button>}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
              <Card>
                <CardHeader title="Recent events" description="Latest 50 provider calls." />
                <div className="card-body max-h-[360px] overflow-auto p-0">
                  {!d?.recent.length ? <p className="p-5 text-[12.5px] text-muted">Nothing received yet.</p> : (
                    <table className="table">
                      <thead><tr><th>When</th><th>Model</th><th>Status</th><th className="right">Cost</th><th className="right">Latency</th></tr></thead>
                      <tbody>
                        {d.recent.map((e) => (
                          <tr key={e.id}>
                            <td className="whitespace-nowrap text-[11.5px] text-subtle">{dateTime(e.occurred_at)}</td>
                            <td className="mono">{e.model}<div className="text-subtle">{e.operation || ''}</div></td>
                            <td><StatusChip status={e.status === 'ok' ? 'ok' : 'error'} label={e.status.toUpperCase()} /></td>
                            <td className="right tnum">{money(e.cost_usd, { digits: 5 })}</td>
                            <td className="right tnum">{ms(e.latency_ms)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </Card>
            </div>
          </div>
        </>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={issued ? 'Connection token issued' : 'New telemetry connection'} eyebrow={project?.name} description={issued ? 'Copy it now. ZEVQORA stores only a hash and cannot show it again.' : 'A scoped token your servers use to POST telemetry events. It can only write telemetry for this project.'} footer={issued ? <Button onClick={() => setCreateOpen(false)}>Done</Button> : <><Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button><Button onClick={() => void createConnection()} loading={busy} disabled={!newName.trim()}>Create token</Button></>}>
        {issued ? (
          <div className="grid gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-line bg-cloud p-3">
              <code className="mono min-w-0 flex-1 break-all text-[12px]">{issued}</code>
              <Button size="xs" variant="secondary" onClick={() => void copy(issued)}><Copy size={12} /> Copy</Button>
            </div>
            <pre className="mono overflow-auto rounded-lg bg-ink p-3 text-[11.5px] leading-relaxed text-cloud/85">{`POST ${platformUrl}/api/telemetry/ingest
Authorization: Bearer <token>
Content-Type: application/json

{ "events": [ { "trace_id": "…", "provider": "openai", "model": "gpt-4o",
    "operation": "classify.intent", "input_tokens": 812, "output_tokens": 41,
    "latency_ms": 640, "cost_usd": 0.0031, "status": "ok" } ] }`}</pre>
            <Note tone="info">Only scalar metadata and, if capture is on, sanitized message text are stored. Secrets are redacted before storage.</Note>
          </div>
        ) : (
          <div className="grid gap-3">
            <Field label="Connection name"><input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. production-api" /></Field>
            <label className="checkbox"><input type="checkbox" checked={capture} onChange={(e) => setCapture(e.target.checked)} /><span><b>Capture sanitized samples.</b><br />Store prompt/output text (secrets redacted) so replays can use real tasks. Off by default.</span></label>
          </div>
        )}
      </Modal>

      <Modal open={projectOpen} onClose={() => setProjectOpen(false)} size="sm" title="New project" description={`In workspace ${activeWorkspace.name}. Plan limits apply.`} footer={<><Button variant="ghost" onClick={() => setProjectOpen(false)}>Cancel</Button><Button onClick={() => void createProject()} loading={busy} disabled={!projectName.trim()}>Create</Button></>}>
        <Field label="Project name"><input className="input" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder={selected?.name || 'support-assistant'} /></Field>
      </Modal>
    </div>
  )
}
