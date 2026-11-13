import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ArrowUp, Boxes, ChevronDown, ChevronUp, FileCheck2, Lightbulb, Network, RotateCcw, ShieldCheck, Square, Wrench } from 'lucide-react';
import { ZevFace } from '@/brand/Zev';
import { useSession } from '@/lib/session';
import { ProductFrame } from '../Frame';
import { useProduct } from '../store';
import { engineErrorMessage } from '../engine';
import { useZevThread } from '../zevChat';
import type { AICall, ChatLine, Evaluation, Finding } from '../types';
import { ZevirPanel } from './ZevirPanel';
import './zev-ide.css';

type Tab = 'findings' | 'evaluations' | 'calls' | 'graph';
type Selection = { kind: 'finding'; item: Finding } | { kind: 'evaluation'; item: Evaluation } | { kind: 'call'; item: AICall } | null;

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const money = (v: number | null | undefined) => (v === null || v === undefined ? 'unknown' : `$${v.toFixed(v < 1 ? 4 : 2)}`);
const pct = (v: number | null | undefined) => (v === null || v === undefined ? 'unknown' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
const num = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? 'unknown' : v.toFixed(d));
const MIN_CHAT = 132;

function verdictClass(status: string) {
  const s = status.toUpperCase();
  if (s === 'VERIFIED') return 'is-verified';
  if (s === 'REJECTED') return 'is-rejected';
  return 'is-incomplete';
}

function describe(sel: Selection): string | null {
  if (!sel) return null;
  if (sel.kind === 'finding') return `finding ${sel.item.id} "${sel.item.title}" (${sel.item.category}, ${sel.item.file_path}:${sel.item.line})`;
  if (sel.kind === 'evaluation') return `evaluation ${sel.item.id} (status ${sel.item.status})`;
  return `AI call site ${sel.item.id} (${sel.item.provider}, ${sel.item.file_path}:${sel.item.line})`;
}

/**
 * Engineering Zev — an IDE-style workspace for the signed-in team.
 * Explorer (left) → work area (center) → inspector (right), with Zev in a
 * resizable panel at the bottom. Everything shown comes from the existing
 * authenticated engine routes; Zev answers through POST /api/engine/agent/chat,
 * which checks workspace membership and product access on the server and runs
 * read-only tools only. The browser never holds a provider key.
 */
export default function ZevView() {
  const { engine, products, selected, selectProduct, findings, evaluations, aiCalls, economics, health, model, refreshProductData, setZevState } = useProduct();
  const { activeWorkspace } = useSession();
  const { lines, setLines } = useZevThread(activeWorkspace?.id || null);
  const [tab, setTab] = useState<Tab>('findings');
  const [sel, setSel] = useState<Selection>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [chatOpen, setChatOpen] = useState(true);
  const [chatHeight, setChatHeight] = useState(300);
  const failed = useRef<{ text: string; context: string | null } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const graphEnabled = Boolean(activeWorkspace?.features?.zevir_graph_ui || activeWorkspace?.features?.zevir_shadow);
  const configured = health ? Boolean(health.openrouter_configured) : null;

  useEffect(() => setSel(null), [selected?.id]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [lines.length, busy]);

  const actions = useMemo(() => {
    const list: { label: string; prompt: string }[] = [];
    if (!selected) return [{ label: 'What can Engineering Zev do?', prompt: 'What can you do in this workspace, and what can you not access?' }];
    list.push({ label: 'Explain this workload', prompt: 'Explain how this workload executes and where the cost comes from. Cite the evidence you used and say what is missing.' });
    if (sel?.kind === 'evaluation' && sel.item.status.toUpperCase() === 'REJECTED') list.push({ label: 'Why was this rejected?', prompt: 'Why was this candidate rejected? Name the failed gate, the observed value and the threshold.' });
    else if (sel?.kind === 'finding') list.push({ label: 'Explain this finding', prompt: 'Explain this finding: the root cause, the evidence behind it and what would falsify it.' });
    if (evaluations.length >= 2) list.push({ label: 'Compare these candidates', prompt: 'Compare the evaluated candidates for this workload on cost, latency and quality, using only recorded evaluations.' });
    list.push({ label: 'What evidence is missing?', prompt: 'What evidence is missing before a candidate here could be verified?' });
    return list;
  }, [selected, sel, evaluations.length]);

  const send = async (text: string, contextOverride?: string | null) => {
    const value = text.trim();
    if (!value || busy) return;
    const context = contextOverride === undefined ? describe(sel) : contextOverride;
    const userLine: ChatLine = { id: uid(), role: 'user', content: value };
    const history = [...lines, userLine];
    setLines(() => history);
    setInput('');
    setError('');
    setBusy(true);
    setZevState('thinking');
    const ac = new AbortController();
    controller.current = ac;
    try {
      const wire = history.map((l, i) => ({ role: l.role, content: i === history.length - 1 && context ? `${l.content}\n\n(Selected in the workspace: ${context})` : l.content }));
      const res = await engine.chat(selected?.id || null, wire.slice(-16), model || undefined, ac.signal);
      if (controller.current !== ac) return;
      failed.current = null;
      setLines((cur) => [
        ...cur,
        {
          id: uid(),
          role: 'assistant',
          content: res.openrouter_configured === false ? `Engineering Zev is not configured for this environment. ${res.message}` : res.message,
          toolEvents: res.tool_events,
          model: res.openrouter_configured === false ? undefined : res.model,
        },
      ]);
      if (res.tool_events.length) await refreshProductData();
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        setError('Stopped. No answer was shown; retry to ask again.');
      } else {
        setError(engineErrorMessage(err));
      }
      failed.current = { text: value, context };
      // The question stays in the thread; retry resends it without duplicating it.
      setLines((cur) => cur.filter((l) => l.id !== userLine.id));
    } finally {
      if (controller.current === ac) controller.current = null;
      setBusy(false);
      setZevState('idle');
    }
  };

  const cancel = () => controller.current?.abort();
  const retry = () => {
    const f = failed.current;
    if (f) void send(f.text, f.context);
  };

  // Resizable chat: drag the handle, or use the arrow keys on it.
  const startDrag = (e: React.PointerEvent) => {
    const startY = e.clientY;
    const startH = chatHeight;
    const max = Math.round(window.innerHeight * 0.7);
    const move = (ev: PointerEvent) => setChatHeight(Math.max(MIN_CHAT, Math.min(max, startH + (startY - ev.clientY))));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const onHandleKey = (e: ReactKeyboardEvent) => {
    const max = Math.round(window.innerHeight * 0.7);
    if (e.key === 'ArrowUp') setChatHeight((h) => Math.min(max, h + 24));
    else if (e.key === 'ArrowDown') setChatHeight((h) => Math.max(MIN_CHAT, h - 24));
    else return;
    e.preventDefault();
  };

  const counts = { findings: findings.length, evaluations: evaluations.length, calls: aiCalls.length };
  const rejected = evaluations.filter((e) => e.status.toUpperCase() === 'REJECTED').length;

  return (
    <ProductFrame padded={false} inspector={false}>
      <div className={`zide${chatOpen ? '' : ' is-chat-closed'}`} style={{ ['--zide-chat' as string]: `${chatOpen ? chatHeight : 52}px` }}>
        {/* ── Explorer ── */}
        <nav className="zide-explorer" aria-label="Workspace explorer">
          <div className="zide-section-title">Workloads</div>
          {products.length === 0 && <p className="zide-empty">No workloads yet. Add one from Workloads or Connections.</p>}
          <ul>
            {products.map((p) => (
              <li key={p.id}>
                <button type="button" className={p.id === selected?.id ? 'is-active' : ''} aria-current={p.id === selected?.id ? 'true' : undefined} onClick={() => selectProduct(p.id)}>
                  <Boxes size={14} aria-hidden />
                  <span>{p.name}</span>
                </button>
              </li>
            ))}
          </ul>
          {selected && (
            <>
              <div className="zide-section-title">In this workload</div>
              <ul>
                {([
                  ['findings', 'Findings', Lightbulb, counts.findings],
                  ['evaluations', 'Runs & verdicts', FileCheck2, counts.evaluations],
                  ['calls', 'AI call sites', Wrench, counts.calls],
                  ['graph', 'Execution graph (ZevIR)', Network, null],
                ] as const).map(([key, label, Icon, count]) => (
                  <li key={key}>
                    <button type="button" className={tab === key ? 'is-active' : ''} aria-current={tab === key ? 'true' : undefined} onClick={() => setTab(key)}>
                      <Icon size={14} aria-hidden />
                      <span>{label}</span>
                      {count !== null && <small>{count}</small>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </nav>

        {/* ── Work area ── */}
        <main className="zide-main" aria-label="Work area">
          <label className="zide-mobile-picker">
            <span className="sr-only">Workload</span>
            <select value={selected?.id || ''} onChange={(e) => selectProduct(e.target.value || null)}>
              <option value="">Choose a workload…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {!selected ? (
            <div className="zide-blank">
              <ZevFace expression="friendly-idle" size={56} />
              <h1>Engineering Zev</h1>
              <p>Pick a workload to see its findings, runs and execution graph. Ask Zev below about what you are looking at.</p>
            </div>
          ) : (
            <>
              <header className="zide-main-head">
                <div>
                  <h1>{selected.name}</h1>
                  <p>
                    {economics?.trace_count ? `${economics.trace_count} traces · observed cost ${money(economics.observed_cost_usd)}` : 'No runtime traces yet'} · {counts.findings} findings · {counts.evaluations} runs
                    {rejected ? ` · ${rejected} rejected` : ''}
                  </p>
                </div>
                <div className="zide-tabs" role="tablist" aria-label="Work area view">
                  {(['findings', 'evaluations', 'calls', 'graph'] as const).map((t) => (
                    <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'is-active' : ''} onClick={() => setTab(t)}>
                      {t === 'findings' ? 'Findings' : t === 'evaluations' ? 'Runs' : t === 'calls' ? 'Call sites' : 'Graph'}
                    </button>
                  ))}
                </div>
              </header>
              <div className="zide-main-body">
                {tab === 'findings' &&
                  (findings.length ? (
                    <table className="zide-table">
                      <thead><tr><th>Finding</th><th>Category</th><th>Risk</th><th>Evidence</th></tr></thead>
                      <tbody>
                        {findings.map((f) => (
                          <tr key={f.id} className={sel?.kind === 'finding' && sel.item.id === f.id ? 'is-selected' : ''} onClick={() => setSel({ kind: 'finding', item: f })}>
                            <td><button type="button" onClick={() => setSel({ kind: 'finding', item: f })}>{f.title}</button></td>
                            <td>{f.category}</td>
                            <td>{f.risk}</td>
                            <td>{f.evidence_status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="zide-empty">No findings recorded for this workload yet. Run an analysis from Workloads.</p>)}
                {tab === 'evaluations' &&
                  (evaluations.length ? (
                    <table className="zide-table">
                      <thead><tr><th>Run</th><th>Verdict</th><th>Cost change</th><th>Quality Δ</th><th>Samples</th></tr></thead>
                      <tbody>
                        {evaluations.map((e) => (
                          <tr key={e.id} className={sel?.kind === 'evaluation' && sel.item.id === e.id ? 'is-selected' : ''} onClick={() => setSel({ kind: 'evaluation', item: e })}>
                            <td><button type="button" onClick={() => setSel({ kind: 'evaluation', item: e })} className="mono">{e.id.slice(0, 8)}</button></td>
                            <td><span className={`zide-verdict ${verdictClass(e.status)}`}>{e.status.toUpperCase()}</span></td>
                            <td>{pct(e.raw_cost_delta_percent)}</td>
                            <td>{num(e.quality_delta, 3)}</td>
                            <td>{e.sample_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="zide-empty">No optimization runs yet. Verdicts appear here once a candidate is replayed against frozen gates.</p>)}
                {tab === 'calls' &&
                  (aiCalls.length ? (
                    <table className="zide-table">
                      <thead><tr><th>Location</th><th>Provider</th><th>Symbol</th></tr></thead>
                      <tbody>
                        {aiCalls.map((c) => (
                          <tr key={c.id} className={sel?.kind === 'call' && sel.item.id === c.id ? 'is-selected' : ''} onClick={() => setSel({ kind: 'call', item: c })}>
                            <td><button type="button" onClick={() => setSel({ kind: 'call', item: c })} className="mono">{c.file_path}:{c.line}</button></td>
                            <td>{c.provider}</td>
                            <td className="mono">{c.symbol || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <p className="zide-empty">No AI call sites detected. Scan a repository to map where models are called.</p>)}
                {tab === 'graph' && (graphEnabled ? <ZevirPanel /> : <p className="zide-empty">The execution graph (ZevIR) is not enabled for this workspace. It is in controlled preview behind a feature flag.</p>)}
              </div>
            </>
          )}
        </main>

        {/* ── Inspector ── */}
        <aside className="zide-inspector" aria-label="Inspector">
          <div className="zide-section-title">Inspector</div>
          {!sel && <p className="zide-empty">Select a finding, run or call site to inspect it.</p>}
          {sel?.kind === 'finding' && (
            <dl className="zide-dl">
              <dt>Finding</dt><dd>{sel.item.title}</dd>
              <dt>Root cause</dt><dd>{sel.item.root_cause || 'not recorded'}</dd>
              <dt>Location</dt><dd className="mono">{sel.item.file_path}:{sel.item.line}</dd>
              <dt>Confidence</dt><dd>{num(sel.item.confidence)}</dd>
              <dt>Evidence</dt><dd>{sel.item.evidence_status}</dd>
              <dt>Provenance</dt><dd>{sel.item.origin} · id <span className="mono">{sel.item.id.slice(0, 8)}</span></dd>
            </dl>
          )}
          {sel?.kind === 'evaluation' && (
            <dl className="zide-dl">
              <dt>Verdict</dt><dd><span className={`zide-verdict ${verdictClass(sel.item.status)}`}>{sel.item.status.toUpperCase()}</span></dd>
              {sel.item.rejection_reason && (<><dt>Reason</dt><dd>{sel.item.rejection_reason}</dd></>)}
              <dt>Cost</dt><dd>{money(sel.item.baseline_cost_usd)} → {money(sel.item.candidate_cost_usd)} ({pct(sel.item.raw_cost_delta_percent)})</dd>
              <dt>Quality</dt><dd>{num(sel.item.baseline_quality, 3)} → {num(sel.item.candidate_quality, 3)}</dd>
              <dt>Samples</dt><dd>{sel.item.sample_count} ({sel.item.protected_sample_count} protected)</dd>
              <dt>Gates</dt>
              <dd>
                <ul className="zide-gates">
                  {sel.item.gates.map((g) => (
                    <li key={g.name} className={g.outcome.toLowerCase() === 'pass' ? 'is-pass' : g.outcome.toLowerCase() === 'fail' ? 'is-fail' : ''}>
                      <b>{g.name}</b> {g.outcome}{g.required ? ' · required' : ''}
                    </li>
                  ))}
                  {!sel.item.gates.length && <li>No gate results recorded.</li>}
                </ul>
              </dd>
              <dt>Provenance</dt><dd>{sel.item.verification_source} · evidence {sel.item.evidence_version} · gates <span className="mono">{sel.item.gate_config_hash.slice(0, 10)}</span></dd>
            </dl>
          )}
          {sel?.kind === 'call' && (
            <dl className="zide-dl">
              <dt>Location</dt><dd className="mono">{sel.item.file_path}:{sel.item.line}</dd>
              <dt>Provider</dt><dd>{sel.item.provider}</dd>
              <dt>Excerpt</dt><dd><pre className="zide-pre">{sel.item.excerpt}</pre></dd>
            </dl>
          )}
          <p className="zide-note"><ShieldCheck size={12} aria-hidden /> Zev explains and proposes. Gates decide verdicts; people decide what ships.</p>
        </aside>

        {/* ── Engineering Zev (bottom panel) ── */}
        <section className="zide-chat" aria-label="Engineering Zev">
          {chatOpen && (
            <div
              className="zide-chat-handle"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize Engineering Zev panel"
              aria-valuemin={MIN_CHAT}
              aria-valuenow={chatHeight}
              tabIndex={0}
              onPointerDown={startDrag}
              onKeyDown={onHandleKey}
            />
          )}
          <header className="zide-chat-head">
            <ZevFace expression={busy ? 'focused' : 'friendly-idle'} size={24} />
            <b>Engineering Zev</b>
            <span className="zide-chat-scope">{selected ? `Scope: ${selected.name}` : `Scope: ${activeWorkspace?.name || 'workspace'}`} · read-only tools</span>
            <span className={`zide-chat-provider ${configured === false ? 'is-off' : configured ? 'is-on' : ''}`}>
              {configured === false ? 'Not configured for this environment' : configured ? 'Platform compute' : 'Checking provider…'}
            </span>
            <button type="button" className="zide-icon" onClick={() => setChatOpen((v) => !v)} aria-expanded={chatOpen} aria-label={chatOpen ? 'Collapse Engineering Zev' : 'Expand Engineering Zev'}>
              {chatOpen ? <ChevronDown size={16} aria-hidden /> : <ChevronUp size={16} aria-hidden />}
            </button>
          </header>
          {chatOpen && (
            <>
              <div ref={logRef} className="zide-chat-log" role="log" aria-live="polite" aria-label="Conversation with Engineering Zev">
                {!lines.length && <p className="zide-empty">Ask about the workload, a finding or a run. Zev reads this workspace through scoped tools and says what it could not see.</p>}
                {lines.map((l) => (
                  <div key={l.id} className={`zide-msg ${l.role === 'user' ? 'is-user' : 'is-zev'}`}>
                    <span className="sr-only">{l.role === 'user' ? 'You:' : 'Zev:'}</span>
                    <p>{l.content}</p>
                    {!!l.toolEvents?.length && (
                      <ul className="zide-tools" aria-label="Tools Zev ran">
                        {l.toolEvents.map((t, i) => (
                          <li key={`${t.name}-${i}`} className={t.status === 'done' ? 'is-done' : 'is-failed'}>
                            <b>{t.name}</b> {t.status} — {t.summary}
                          </li>
                        ))}
                      </ul>
                    )}
                    {l.model && <small>{l.model}</small>}
                  </div>
                ))}
                {busy && (
                  <div className="zide-status" role="status">
                    <span className="pthinking"><i /><i /><i /></span> Zev is reading the evidence…
                    <button type="button" onClick={cancel}><Square size={11} aria-hidden /> Cancel</button>
                  </div>
                )}
              </div>
              {error && (
                <div className="zide-error" role="alert">
                  <span>{error}</span>
                  {failed.current && <button type="button" onClick={retry}><RotateCcw size={12} aria-hidden /> Retry</button>}
                </div>
              )}
              <div className="zide-chat-actions" role="group" aria-label="Suggested questions">
                {actions.map((a) => (
                  <button key={a.label} type="button" disabled={busy} onClick={() => void send(a.prompt)}>{a.label}</button>
                ))}
              </div>
              <form
                className="zide-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(input);
                }}
              >
                <label htmlFor="zide-input" className="sr-only">Ask Engineering Zev</label>
                <textarea
                  id="zide-input"
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void send(input);
                    }
                  }}
                  placeholder={sel ? 'Ask about the selected item…' : selected ? `Ask about ${selected.name}…` : 'Ask Engineering Zev…'}
                />
                <button type="submit" disabled={!input.trim() || busy} aria-label="Send to Engineering Zev"><ArrowUp size={15} aria-hidden /></button>
              </form>
            </>
          )}
        </section>
      </div>
    </ProductFrame>
  );
}
