import { FormEvent, useMemo, useRef, useState } from 'react'
import { ArrowUp, Braces, Check, LoaderCircle, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'
import { api } from '../lib/api'
import type { ChatLine, Health, Product } from '../lib/types'
import { BrandAsset, brandAssets } from './BrandAsset'
import { ZevPresence, type ZevState } from './ZevPresence'

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

function AgentStatePill({ state }: { state: ZevState }) {
  const labels: Record<ZevState, string> = {
    idle: 'Ready',
    thinking: 'Thinking',
    scanning: 'Analyzing',
    experimenting: 'Preparing',
    verifying: 'Verifying',
    done: 'Updated',
  }
  return (
    <div className={`agent-state-pill agent-state-${state}`}>
      {state === 'idle' || state === 'done' ? <Check size={11} /> : <LoaderCircle size={11} className="animate-spin" />}
      {labels[state]}
    </div>
  )
}

export function ZevChat({
  product,
  health,
  model,
  onModel,
  onDataChanged,
  agentState,
  onAgentState,
}: {
  product: Product | null
  health: Health | null
  model: string
  onModel: (value: string) => void
  onDataChanged: () => Promise<void>
  agentState: ZevState
  onAgentState: (state: ZevState) => void
}) {
  const [lines, setLines] = useState<ChatLine[]>([
    {
      id: uid(),
      role: 'assistant',
      content: 'Connect an AI product and I will map where the spend comes from, explain what looks wasteful, and tell you what evidence is still missing before a change can be trusted.',
    },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const suggestions = useMemo(
    () => product
      ? ['Analyze this product', 'Show the highest-impact waste', 'What evidence is missing?', 'Explain verified savings']
      : ['What can Zev optimize?', 'Why is verification required?'],
    [product],
  )

  const submit = async (text: string) => {
    const value = text.trim()
    if (!value || busy) return
    const userLine: ChatLine = { id: uid(), role: 'user', content: value }
    const next = [...lines, userLine]
    setLines(next)
    setInput('')
    setBusy(true)
    setError('')
    onAgentState(stateForPrompt(value))
    queueMicrotask(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }))
    try {
      const response = await api.chat(
        product?.id || null,
        next.map((line) => ({ role: line.role, content: line.content })),
        model || undefined,
      )
      setLines((current) => [
        ...current,
        { id: uid(), role: 'assistant', content: response.message, toolEvents: response.tool_events },
      ])
      if (response.tool_events.length) await onDataChanged()
      onAgentState('done')
      window.setTimeout(() => onAgentState('idle'), 1300)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      onAgentState('idle')
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
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <header className="chat-toolbar flex h-[62px] shrink-0 items-center justify-between px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-[11px] bg-softblue/[0.09] text-softblue">
            <Sparkles size={15} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold tracking-[-0.012em] text-ink/84">Zev</span>
              <AgentStatePill state={agentState} />
            </div>
            <div className="mt-0.5 truncate text-[10px] text-ink/34">{product ? `AI cost engineer for ${product.name}` : 'AI cost optimization engineer'}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="model-control">
            <Braces size={12.5} className="text-ink/33" />
            <input
              value={model}
              onChange={(event) => onModel(event.target.value)}
              className="w-[148px] bg-transparent text-[10px] font-medium text-ink/65 outline-none"
              aria-label="OpenRouter model id"
              placeholder="openrouter/auto"
            />
          </div>
          <span className={`provider-status ${health?.openrouter_configured ? 'is-ready' : ''}`}>
            {health?.openrouter_configured ? 'OpenRouter' : 'Local tools'}
          </span>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 pb-36 pt-7">
        <div className="mx-auto max-w-[870px]">
          {lines.length <= 1 && (
            <section className="zev-welcome mb-8">
              <div className="zev-welcome-mascot">
                <div className="zev-orbit zev-orbit-a" />
                <div className="zev-orbit zev-orbit-b" />
                <BrandAsset src={brandAssets.mascot} alt="Zev mascot" className="relative z-10 h-[108px] w-[108px] object-contain" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="eyebrow-premium">CALM INTERFACES. CLEAR IMPACT.</div>
                <h1 className="mt-2 max-w-[650px] font-editorial text-[34px] leading-[1.05] tracking-[-0.035em] text-ink/92">
                  Ask where the AI cost comes from. Then prove the safer path.
                </h1>
                <p className="mt-3 max-w-[620px] text-[12px] leading-5 text-ink/43">
                  Chat is the interface. Runtime evidence, replay, quality gates, and human approval remain the authority.
                </p>
              </div>
            </section>
          )}

          <div className="space-y-5">
            {lines.map((line) => (
              <div key={line.id} className={`message-row ${line.role === 'user' ? 'message-user' : 'message-assistant'}`}>
                {line.role === 'assistant' && (
                  <BrandAsset src={brandAssets.avatar} alt="Zev avatar" compact className="message-avatar" />
                )}
                <div className={line.role === 'user' ? 'user-bubble' : 'assistant-content'}>
                  {line.role === 'assistant' && <div className="mb-1.5 text-[10px] font-semibold text-ink/34">Zev</div>}
                  <div className={`whitespace-pre-wrap text-[13px] leading-[1.72] ${line.role === 'assistant' ? 'text-ink/73' : 'text-white/95'}`}>{line.content}</div>
                  {!!line.toolEvents?.length && (
                    <div className="mt-3 grid gap-1.5">
                      {line.toolEvents.map((event, index) => (
                        <div key={`${event.name}-${index}`} className="tool-event">
                          <RefreshCw size={11.5} className={event.status === 'done' ? 'text-softblue' : 'text-ink/35'} />
                          <span className="font-semibold text-ink/62">{event.name}</span>
                          <span className="truncate text-ink/35">{event.summary}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="message-row message-assistant">
                <BrandAsset src={brandAssets.avatar} alt="Zev avatar" compact className="message-avatar" />
                <div className="flex items-center gap-2 py-2 text-[11px] text-ink/38">
                  <span className="thinking-dots"><i /><i /><i /></span>
                  Zev is working through the evidence
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="composer-dock absolute inset-x-0 bottom-0 z-20 px-6 pb-5 pt-10">
        <div className="mx-auto max-w-[870px]">
          {error && <div className="mb-2 rounded-[14px] border border-red-200/70 bg-red-50/85 px-3 py-2 text-[10px] text-red-700 shadow-sm">{error}</div>}
          <div className="mb-2 flex flex-wrap gap-1.5 px-1">
            {suggestions.map((item) => (
              <button key={item} onClick={() => void submit(item)} className="suggestion-pill">{item}</button>
            ))}
          </div>
          <form onSubmit={onSubmit} className="composer-shell">
            <div className="flex min-w-0 flex-1 items-end">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void submit(input)
                  }
                }}
                rows={2}
                className="min-h-[48px] max-h-[130px] flex-1 resize-none bg-transparent px-2 py-2 text-[13px] leading-5 text-ink/82 outline-none placeholder:text-ink/27"
                placeholder={product ? 'Ask Zev to analyze cost, waste, evidence, or a candidate...' : 'Connect a product or ask Zev how verification works...'}
              />
            </div>
            <div className="flex items-center gap-2 pb-1 pr-1">
              <div className="hidden items-center gap-1.5 text-[9px] text-ink/28 md:flex"><ShieldCheck size={11} /> Human review stays on</div>
              <button disabled={!input.trim() || busy} className="send-button" aria-label="Send message"><ArrowUp size={15} /></button>
            </div>
          </form>
          <div className="mt-1.5 text-center text-[9px] text-ink/24">Zev may propose actions. Verification gates decide what is verified. You decide what ships.</div>
        </div>
      </div>

      <ZevPresence state={agentState} />
    </div>
  )
}
