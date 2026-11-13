import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowRight, ArrowUp, BookOpen, FlaskConical, LayoutDashboard, Plug, RotateCcw, Square, Wrench, X } from 'lucide-react';
import { ZevFace } from '@/brand/Zev';
import { useSession } from '@/lib/session';
import { DEFAULT_CONTENT } from '@/lib/site';
import { useProduct } from '../store';
import { engineErrorMessage } from '../engine';
import { useZevThread } from '../zevChat';
import { EXPLAIN_OPTIONS, useExplainMode, type ExplainChoice } from '../explainMode';
import { experienceApi } from '../experience';
import { welcomeName } from './Welcome';
import type { ChatLine } from '../types';
import './zevhome.css';

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

type Guide = 'how' | 'expensive' | 'demo' | null;

/**
 * Written guides shown when AI assistance is unavailable, or when the user
 * asks for the sample. They are product documentation, labelled as such, and
 * never presented as a model answer.
 */
const GUIDES: Record<'how' | 'expensive', { title: string; plain: string[]; technical: string[] }> = {
  how: {
    title: 'How ZEVQORA works',
    plain: [
      'ZEVQORA looks at how your AI app is used today: what it costs, how fast it answers and how often it works.',
      'It tries cheaper or faster ways to do the same work, on your own recorded examples.',
      'A change is only marked VERIFIED when the answers stay as good as before. If quality drops, it is REJECTED. If there is not enough evidence, it says INCOMPLETE.',
      'Nothing is changed in your product automatically. You review and decide.',
    ],
    technical: [
      'Evidence in: sanitized traces (JSON/JSONL), OpenTelemetry GenAI or OpenInference spans, runtime telemetry events, or a local repository scan for call sites.',
      'ZEVQORA builds a baseline per workload under a frozen evaluation contract (quality floor, latency and cost thresholds).',
      'Candidate plans (model routing, prompt and context changes, caching) are replayed against recorded cases and graded against the contract.',
      'Verdicts: VERIFIED (all gates pass), REJECTED (a gate failed, with the observed value and threshold), INCOMPLETE (missing evidence). Nothing is deployed without human review.',
    ],
  },
  expensive: {
    title: 'Why AI apps get expensive',
    plain: [
      'Common causes: using a large model for simple questions, sending long instructions or history with every request, retries, and agents that take many steps.',
      'ZEVQORA can only say which of these apply to you after it sees your usage. Connect your AI app or import a sample to measure it.',
    ],
    technical: [
      'Typical drivers: model choice per call site, input tokens (system prompt, history, retrieved context), retries and fallbacks, agent step count and tool loops, and missed caching.',
      'To attribute spend you need per-request model, token counts and cost. Connect a LiteLLM gateway or send OTel GenAI spans, then ZEVQORA can rank workloads by cost and test cheaper plans.',
    ],
  },
};

export default function ZevHome() {
  const { me, activeWorkspace } = useSession();
  const { engine, health, products, selected, model, refreshProductData, setZevState } = useProduct();
  const { lines, setLines } = useZevThread(activeWorkspace?.id || null);
  const explain = useExplainMode();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [params] = useSearchParams();
  const [guide, setGuide] = useState<Guide>(() => (params.get('demo') === '1' ? 'demo' : params.get('guide') === 'how' ? 'how' : null));
  const [pending, setPending] = useState<number | null>(null);
  const failed = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const provider = health?.engineering_zev_provider ?? (health ? (health.openrouter_configured ? 'openrouter' : 'none') : null);
  const unavailable = provider === 'none';
  const providerLabel = provider === 'anthropic' ? 'Claude' : provider === 'openrouter' ? 'Platform compute' : provider === 'none' ? 'Unavailable' : 'Checking…';
  const name = welcomeName(me?.profile);
  const returning = products.length > 0;
  const technical = explain.mode === 'technical';

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [lines.length, busy, guide]);

  // Pending decisions come from the real Command Center; failure leaves it unknown.
  useEffect(() => {
    if (!activeWorkspace || !returning) return;
    let live = true;
    experienceApi.commandCenter(activeWorkspace.id, 30).then(
      (cc) => live && setPending(cc.decision_queue.length),
      () => live && setPending(null),
    );
    return () => {
      live = false;
    };
  }, [activeWorkspace, returning]);

  const send = async (text: string) => {
    const value = text.trim();
    if (!value || busy || unavailable) return;
    setGuide(null);
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
      const wire = history.map((l) => ({ role: l.role, content: l.content }));
      const res = await engine.chat(selected?.id || null, wire.slice(-16), model || undefined, ac.signal, explain.mode);
      if (controller.current !== ac) return;
      failed.current = null;
      const off = res.provider_configured === false || (res.provider_configured === undefined && res.openrouter_configured === false);
      setLines((cur) => [
        ...cur,
        {
          id: uid(),
          role: 'assistant',
          content: off ? 'AI assistance is currently unavailable in this environment. The guides below still work.' : res.message,
          toolEvents: res.tool_events,
          model: res.provider === 'none' ? undefined : `${res.provider === 'anthropic' ? 'Claude' : 'Platform compute'} · ${res.model}`,
        },
      ]);
      if (res.tool_events.length) await refreshProductData();
    } catch (err) {
      setError((err as Error)?.name === 'AbortError' ? 'Stopped. Nothing was answered; retry to ask again.' : engineErrorMessage(err));
      failed.current = value;
      setLines((cur) => cur.filter((l) => l.id !== userLine.id));
    } finally {
      if (controller.current === ac) controller.current = null;
      setBusy(false);
      setZevState('idle');
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };
  const onKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  };

  const ask = (which: 'how' | 'expensive') => {
    if (unavailable) {
      setGuide(which);
      return;
    }
    void send(
      which === 'how'
        ? 'Explain how ZEVQORA works, and what I need to get started. Keep it short.'
        : 'Why is my AI expensive? Say what you can see in this workspace, what you cannot, and what I should connect to find out.',
    );
  };

  const started = lines.length > 0 || guide !== null || busy;
  const proof = DEFAULT_CONTENT.proof;

  return (
    <div className={`zhome${started ? ' is-started' : ''}`}>
      <section className="zhome-hero" aria-labelledby="zhome-title">
        <ZevFace expression={returning ? 'calm-confidence' : 'warm-smile'} size={started ? 48 : 72} className="zhome-face" />
        {returning ? (
          <>
            <h1 id="zhome-title">{name ? `Welcome back, ${name}.` : 'Welcome back.'}</h1>
            <p className="zhome-sub">
              {activeWorkspace?.name} · {activeWorkspace?.role}
              {selected ? ` · last workload: ${selected.name}` : ''}
              {pending !== null ? ` · ${pending ? `${pending} ${pending === 1 ? 'decision needs' : 'decisions need'} you` : 'nothing pending'}` : ''}
            </p>
            <Link to="/app/zev" className="zhome-continue">Continue with Zev <ArrowRight size={15} aria-hidden /></Link>
          </>
        ) : (
          <>
            <h1 id="zhome-title">Hi, I&rsquo;m Zev. What would you like to improve?</h1>
            <p className="zhome-sub">I find AI waste, test cheaper changes and keep quality. Ask me anything, no setup needed.</p>
          </>
        )}
      </section>

      <section className="zhome-chat" aria-label="Conversation with Zev">
        <header className="zhome-chat-head">
          <span className={`zhome-provider ${unavailable ? 'is-off' : provider ? 'is-on' : ''}`}>{providerLabel}</span>
          <span className="zhome-scope">{selected ? selected.name : activeWorkspace?.name} · read-only</span>
          {explain.choice && <ExplainSwitch value={explain.mode} onChange={(v) => void explain.set(v)} disabled={explain.saving} />}
        </header>

        {unavailable && (
          <div className="zhome-unavailable" role="status">
            <b>AI assistance is currently unavailable.</b> No model is configured for this environment, so Zev cannot answer typed questions. The guided options below still work.
          </div>
        )}

        {started && (
          <div ref={logRef} className="zhome-log" role="log" aria-live="polite" aria-label="Messages">
            {lines.map((l) => (
              <div key={l.id} className={`zhome-msg ${l.role === 'user' ? 'is-user' : 'is-zev'}`}>
                <span className="sr-only">{l.role === 'user' ? 'You:' : 'Zev:'}</span>
                <p>{l.content}</p>
                {!!l.toolEvents?.length && <small>Read {l.toolEvents.length} workspace {l.toolEvents.length === 1 ? 'source' : 'sources'}: {l.toolEvents.map((t) => t.name).join(', ')}</small>}
                {l.model && <small>{l.model}</small>}
              </div>
            ))}
            {guide === 'demo' && (
              <article className="zhome-guide zhome-demo" aria-labelledby="zhome-demo-title">
                <div className="zhome-guide-head">
                  <span className="zhome-tag">SAMPLE · not your data</span>
                  <button type="button" onClick={() => setGuide(null)} aria-label="Close sample"><X size={15} aria-hidden /></button>
                </div>
                <h2 id="zhome-demo-title">A cheaper plan that ZEVQORA rejected</h2>
                <p>From {proof.kind.toLowerCase()} ({proof.cases} cases). Not customer evidence.</p>
                <dl className="zhome-demo-facts">
                  <div><dt>Cost</dt><dd>{proof.rejected.cost_reduction} cheaper</dd></div>
                  <div><dt>Quality</dt><dd>{proof.rejected.quality} (needs {proof.rejected.quality_floor})</dd></div>
                  <div><dt>Verdict</dt><dd className="is-rejected">REJECTED</dd></div>
                </dl>
                <p>{technical ? `The candidate passed the cost gate but its graded quality ${proof.rejected.quality} fell below the frozen floor ${proof.rejected.quality_floor}, so the quality gate failed and the plan was not selected.` : 'It would have saved money, but the answers got worse than the agreed minimum. So ZEVQORA said no. Saving money never counts if quality drops.'}</p>
                <ul className="zhome-verdicts">
                  <li><b className="is-verified">VERIFIED</b> every check passed on your recorded examples.</li>
                  <li><b className="is-rejected">REJECTED</b> a check failed; the reason is shown.</li>
                  <li><b className="is-incomplete">INCOMPLETE</b> not enough evidence yet to decide.</li>
                </ul>
                <div className="zhome-guide-actions">
                  <Link to="/app/connections">Connect my AI app <ArrowRight size={14} aria-hidden /></Link>
                </div>
              </article>
            )}
            {(guide === 'how' || guide === 'expensive') && (
              <article className="zhome-guide" aria-labelledby="zhome-guide-title">
                <div className="zhome-guide-head">
                  <span className="zhome-tag">Guide · written by the ZEVQORA team</span>
                  <button type="button" onClick={() => setGuide(null)} aria-label="Close guide"><X size={15} aria-hidden /></button>
                </div>
                <h2 id="zhome-guide-title">{GUIDES[guide].title}</h2>
                <ul>
                  {(technical ? GUIDES[guide].technical : GUIDES[guide].plain).map((t) => <li key={t}>{t}</li>)}
                </ul>
                <div className="zhome-guide-actions">
                  <Link to="/app/connections">Connect my AI app <ArrowRight size={14} aria-hidden /></Link>
                  <button type="button" onClick={() => setGuide('demo')}>See a sample result</button>
                </div>
              </article>
            )}
            {busy && (
              <div className="zhome-status" role="status">
                <span className="pthinking"><i /><i /><i /></span> Zev is reading this workspace…
                <button type="button" onClick={() => controller.current?.abort()}><Square size={11} aria-hidden /> Stop</button>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="zhome-error" role="alert">
            <span>{error}</span>
            {failed.current && <button type="button" onClick={() => failed.current && void send(failed.current)}><RotateCcw size={12} aria-hidden /> Retry</button>}
          </div>
        )}

        <form className="zhome-composer" onSubmit={onSubmit}>
          <label htmlFor="zhome-input" className="sr-only">Ask Zev</label>
          <textarea
            id="zhome-input"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            rows={started ? 1 : 2}
            maxLength={4000}
            disabled={unavailable}
            placeholder={unavailable ? 'Typed questions need AI assistance, which is unavailable here.' : 'Ask Zev about your AI app…'}
          />
          <button type="submit" disabled={!input.trim() || busy || unavailable} aria-label="Send to Zev">
            <ArrowUp size={18} aria-hidden />
          </button>
        </form>

        <div className="zhome-actions" role="group" aria-label="Start with">
          <button type="button" onClick={() => ask('how')} disabled={busy}><BookOpen size={15} aria-hidden /> Explain how ZEVQORA works</button>
          <button type="button" onClick={() => navigate('/app/connections')}><Plug size={15} aria-hidden /> Connect my AI app</button>
          <button type="button" onClick={() => setGuide('demo')}><FlaskConical size={15} aria-hidden /> Try a safe demo</button>
          <button type="button" onClick={() => ask('expensive')} disabled={busy}><Wrench size={15} aria-hidden /> Why is my AI expensive?</button>
        </div>
      </section>

      {!explain.choice && (
        <section className="zhome-pref" aria-labelledby="zhome-pref-title">
          <p id="zhome-pref-title">How would you like Zev to explain things?</p>
          <div className="zhome-pref-options" role="group" aria-labelledby="zhome-pref-title">
            {EXPLAIN_OPTIONS.map((o) => (
              <button key={o.value} type="button" onClick={() => void explain.set(o.value)} disabled={explain.saving}>
                <b>{o.label}</b>
                <span>{o.description}</span>
              </button>
            ))}
          </div>
          <small>This only changes how answers are written. It does not change what you can see or do.</small>
          {explain.error && <small className="zhome-err" role="alert">{explain.error}</small>}
        </section>
      )}

      <footer className="zhome-foot">
        <Link to="/app/command"><LayoutDashboard size={13} aria-hidden /> Overview</Link>
        <Link to="/app/onboarding?advanced=1">Advanced setup</Link>
        <Link to="/app/connections#advanced">Scan a local folder or import JSONL</Link>
      </footer>
    </div>
  );
}

/** Plain / Technical switch for the Zev chat header. Presentation only. */
export function ExplainSwitch({ value, onChange, disabled }: { value: 'technical' | 'nontechnical'; onChange: (v: ExplainChoice) => void; disabled?: boolean }) {
  return (
    <div className="zexplain" role="radiogroup" aria-label="How Zev explains things">
      {(['nontechnical', 'technical'] as const).map((v) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} disabled={disabled} onClick={() => value !== v && onChange(v)}>
          {v === 'technical' ? 'Technical' : 'Plain'}
        </button>
      ))}
    </div>
  );
}
