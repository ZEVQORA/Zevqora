import { FormEvent, useMemo, useRef, useState } from 'react'
import { ArrowUp, Braces, RefreshCw, ShieldCheck } from 'lucide-react'
import { Zev, ZevFace } from '../../brand/Zev'
import { api, errorMessage } from '../../lib/api'
import { useStore, type ZevState } from '../../lib/store'
import type { ChatLine } from '../../lib/types'

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function stateForPrompt(value: string): ZevState {
  const text = value.toLowerCase()
  if (/verify|experiment|test|quality|evidence/.test(text)) return 'verifying'
  if (/scan|analy|inspect|find|waste|spend/.test(text)) return 'scanning'
  if (/implement|patch|change|fix|candidate/.test(text)) return 'experimenting'
  return 'thinking'
}

export function ZevView() {
  const { selected, health, model, setModel, refreshProductData, zevState, setZevState } = useStore()
  const [lines, setLines] = useState<ChatLine[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const suggestions = useMemo(
    () => (selected ? ['Analyze this product', 'Show the highest-impact waste', 'What evidence is missing?', 'Explain the latest verdict'] : ['What can Zev optimize?', 'Why is verification required?']),
    [selected],
  )

  const providerLabel = health?.provider_mode === 'platform' ? 'Platform compute' : health?.provider_mode === 'local_key' ? 'OpenRouter (local key)' : 'Local tools only'

  const submit = async (text: string) => {
    const value = text.trim()
    if (!value || busy) return
    const next = [...lines, { id: uid(), role: 'user' as const, content: value }]
    setLines(next)
    setInput('')
    setBusy(true)
    setError('')
    setZevState(stateForPrompt(value))
    queueMicrotask(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }))
    try {
      const response = await api.chat(selected?.id || null, next.map((l) => ({ role: l.role, content: l.content })).slice(-16), model || undefined)
      setLines((current) => [...current, { id: uid(), role: 'assistant', content: response.message, toolEvents: response.tool_events, model: response.model }])
      if (response.tool_events.length) await refreshProductData()
      setZevState('done')
      window.setTimeout(() => setZevState('idle'), 1200)
    } catch (err) {
      setError(errorMessage(err))
      setZevState('idle')
    } finally {
      setBusy(false)
      window.setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 30)
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void submit(input)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-[58px] shrink-0 items-center justify-between border-b border-line/80 px-6">
        <div className="flex items-center gap-3">
          <ZevFace expression={zevState === 'idle' ? 'friendly-idle' : zevState === 'done' ? 'delighted' : 'focused'} size={34} />
          <div>
            <div className="text-[13.5px] font-semibold text-ink">Zev</div>
            <div className="text-[11.5px] text-subtle">{selected ? `AI cost engineer for ${selected.name}` : 'AI cost optimization engineer'} · {zevState === 'idle' ? 'ready' : zevState}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex h-[32px] items-center gap-2 rounded-lg border border-line bg-cloud px-2.5">
            <Braces size={12} className="text-subtle" />
            <input value={model} onChange={(e) => setModel(e.target.value)} className="mono w-[170px] bg-transparent text-[11.5px] text-ink outline-none" aria-label="Model id" placeholder="openrouter/auto" />
          </label>
          <span className={`chip ${health?.openrouter_configured ? 'chip-verified' : 'chip-neutral'}`}>{providerLabel}</span>
        </div>
      </header>

      <div ref={scrollRef} className="chat-scroll px-6 pb-40 pt-6">
        <div className="mx-auto max-w-[860px]">
          {!lines.length && (
            <section className="mb-8 flex items-center gap-6">
              <Zev view="pose-thinking" height={120} />
              <div>
                <div className="eyebrow">Measure. Replay. Verify. Then optimize.</div>
                <h1 className="h1 mt-2 max-w-[600px] !text-[26px]">Ask where the AI cost comes from. Then prove the safer path.</h1>
                <p className="lede">Chat is the interface. Runtime evidence, replay, quality gates and your approval remain the authority. Zev can run read-only tools and start verifications; it cannot mark anything verified.</p>
              </div>
            </section>
          )}
          <div className="grid gap-4">
            {lines.map((line) => (
              <div key={line.id} className={`msg ${line.role === 'user' ? 'is-user' : 'is-zev'}`}>
                {line.role === 'assistant' && <ZevFace expression="calm-confidence" size={30} className="mt-1" />}
                <div className="min-w-0 max-w-[76%]">
                  <div className="msg-bubble">{line.content}</div>
                  {!!line.toolEvents?.length && (
                    <div className="mt-2 grid gap-1">
                      {line.toolEvents.map((event, index) => (
                        <div key={`${event.name}-${index}`} className="tool-event">
                          <RefreshCw size={11} className={event.status === 'done' ? 'text-blue' : 'text-rejected'} />
                          <b>{event.name}</b>
                          <span className="truncate">{event.summary}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {line.model && <div className="mt-1 text-[10.5px] text-subtle">{line.model}</div>}
                </div>
              </div>
            ))}
            {busy && (
              <div className="msg is-zev">
                <ZevFace expression="focused" size={30} className="mt-1" />
                <div className="flex items-center gap-2 py-2 text-[12px] text-subtle"><span className="thinking-dots"><i /><i /><i /></span> Zev is working through the evidence</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-white via-white/90 to-transparent px-6 pb-5 pt-10">
        <div className="pointer-events-auto mx-auto max-w-[860px]">
          {error && <div className="note note-error mb-2">{error}</div>}
          <div className="mb-2 flex flex-wrap gap-1.5">
            {suggestions.map((item) => (
              <button key={item} onClick={() => void submit(item)} className="suggestion">{item}</button>
            ))}
          </div>
          <form onSubmit={onSubmit} className="composer">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void submit(input)
                }
              }}
              rows={1}
              placeholder={selected ? 'Ask Zev to analyze cost, waste, evidence, or a candidate…' : 'Connect a repository or ask Zev how verification works…'}
            />
            <div className="flex items-center gap-2 pb-0.5">
              <span className="hidden items-center gap-1 text-[11px] text-subtle md:flex"><ShieldCheck size={11} /> Human review stays on</span>
              <button className="send" disabled={!input.trim() || busy} aria-label="Send"><ArrowUp size={15} /></button>
            </div>
          </form>
          <div className="mt-1.5 text-center text-[10.5px] text-subtle">Zev may propose actions. Verification gates decide what is verified. You decide what ships.</div>
        </div>
      </div>
    </div>
  )
}
