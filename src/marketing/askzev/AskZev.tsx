import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { ArrowUp, Minus, RotateCcw, Square, WifiOff, X } from 'lucide-react';
import { Zev } from '@/brand/Zev';
import { cn } from '@/lib/cn';
import { ANSWER_MODE_LABEL, SUPPORT_MESSAGE_MAX_CHARS } from '@/lib/contracts/support';
import { useAskZev } from './useAskZev';
import { useSectionSuggestion } from './useSectionSuggestion';

export const QUICK_CHIPS = ['What does ZEVQORA do?', 'How do I connect my server?', 'Why verify before optimizing?'] as const;

const NARROW = '(max-width: 420px)';
const narrowNow = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches;

/** Header height the stage slot must clear before the composer docks. */
const HEADER_OFFSET = 80;

/**
 * Ask Zev, the public homepage composer.
 *
 * Exactly one composer is mounted, rendered inside the Ask Zev stage so that it
 * follows the headline in reading and tab order. Once the slot scrolls under
 * the header the composer docks bottom-right (position: fixed) — the same DOM
 * node, so the draft, the thread and focus all carry over — and the slot keeps
 * its height so nothing below it moves. Scrolling back up returns it to the
 * slot. The slot is this component's parent element.
 */
export function AskZev() {
  const zev = useAskZev();
  const { messages, draft, setDraft, status, error, online, send, cancel, retry, dismissError } = zev;
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const thread = useRef<HTMLOListElement>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const [docked, setDocked] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [unread, setUnread] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const ids = { panel: `${uid}-panel`, input: `${uid}-input`, hint: `${uid}-hint`, title: `${uid}-title` };

  const collapsed = docked && !expanded;
  const dockedRef = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;
  const asked = messages.length > 0;
  const { suggestion, section, dismiss: dismissSuggestion } = useSectionSuggestion(collapsed && status === 'idle' && !asked);

  // ── Dock when the slot has scrolled up under the header; return when it is back.
  useEffect(() => {
    const slot = root.current?.parentElement;
    if (!slot || typeof IntersectionObserver === 'undefined') return;
    const apply = (past: boolean) => {
        if (past === dockedRef.current) return;
        dockedRef.current = past;
        // Decide before the re-render: a collapsed panel is hidden, and hiding it would drop focus.
        const focusedInside = Boolean(root.current?.contains(document.activeElement));
        // Hold the slot open while the composer is away, so the page does not jump.
        slot.style.minHeight = past ? `${slot.offsetHeight}px` : '';
        if (past) {
          setExpanded(focusedInside || statusRef.current === 'sending');
          if (focusedInside) setAnnouncement('Ask Zev moved to the bottom-right corner. Your message is still here.');
        } else {
          setUnread(false);
          if (focusedInside) setAnnouncement('Ask Zev is back in its section.');
        }
        setDocked(past);
    };
    const io = new IntersectionObserver(
      ([entry]) => apply(!entry.isIntersecting && entry.boundingClientRect.top < HEADER_OFFSET),
      { rootMargin: `-${HEADER_OFFSET}px 0px 0px 0px`, threshold: 0 },
    );
    io.observe(slot);
    // An instant jump (Home key, an anchor, "back to top") can go from above the
    // slot to below it without ever intersecting, so the observer never fires.
    // A throttled scroll check catches those jumps.
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const r = slot.getBoundingClientRect();
        if (r.height > 0) apply(r.bottom <= HEADER_OFFSET);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // An answer that lands while the panel is minimized marks the launcher (a real answer, never a teaser).
  const lastCount = useRef(0);
  useEffect(() => {
    const last = messages.at(-1);
    if (messages.length > lastCount.current && last?.role === 'assistant' && collapsed) setUnread(true);
    lastCount.current = messages.length;
  }, [messages, collapsed]);

  // Keep the newest message in view.
  useEffect(() => {
    const t = thread.current;
    if (t) t.scrollTop = t.scrollHeight;
  }, [messages.length, status, expanded, docked]);

  // Grow the textarea with its content, up to a cap.
  useLayoutEffect(() => {
    const t = input.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${Math.min(t.scrollHeight, 168)}px`;
  }, [draft, docked, expanded]);

  // Virtual keyboard: lift the docked panel above it (visualViewport shrinks, layout viewport does not).
  useEffect(() => {
    const vv = window.visualViewport;
    const el = root.current;
    if (!vv || !el) return;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
      el.style.setProperty('--zev-kb', `${Math.round(inset)}px`);
      el.style.setProperty('--zev-vvh', `${Math.round(vv.height)}px`);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  const page = docked ? section || 'page' : 'ask-zev';
  // The full placeholder wraps on very narrow phones; keep it on one line there.
  const [narrow] = useState(narrowNow);
  const submit = useCallback(() => {
    send(undefined, page);
  }, [send, page]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const expand = (focus = true) => {
    setExpanded(true);
    setUnread(false);
    if (focus) requestAnimationFrame(() => input.current?.focus());
  };
  const minimize = useCallback(() => {
    setExpanded(false);
    requestAnimationFrame(() => pill.current?.focus());
  }, []);

  useEffect(() => {
    if (!docked || !expanded) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && root.current?.contains(document.activeElement)) {
        e.preventDefault();
        minimize();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [docked, expanded, minimize]);

  const acceptSuggestion = (question: string) => {
    dismissSuggestion();
    setDraft(question);
    expand();
  };

  const remaining = SUPPORT_MESSAGE_MAX_CHARS - draft.length;
  const canSend = Boolean(draft.trim()) && status !== 'sending' && online && remaining >= 0;

  return (
    <div
      ref={root}
      className={cn('zev-ask', docked ? 'is-docked' : 'is-stage', collapsed && 'is-collapsed', asked && 'has-thread')}
      data-state={docked ? (expanded ? 'docked-open' : 'docked-closed') : 'stage'}
    >
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {collapsed && suggestion && (
        <aside className="zev-ask-suggestion" aria-label="Suggestion from Ask Zev">
          <span className="zev-ask-suggestion-tag">Suggestion</span>
          <p>{suggestion.text}</p>
          <div>
            <button type="button" onClick={() => acceptSuggestion(suggestion.question)}>
              Ask “{suggestion.question}”
            </button>
            <button type="button" className="zev-ask-icon" onClick={dismissSuggestion} aria-label="Dismiss suggestion">
              <X size={14} aria-hidden />
            </button>
          </div>
        </aside>
      )}

      {docked && (
        <button
          ref={pill}
          type="button"
          className="zev-ask-pill"
          hidden={expanded}
          aria-expanded={expanded}
          aria-controls={ids.panel}
          onClick={() => expand()}
        >
          <span className="zev-ask-pill-avatar" aria-hidden>
            <Zev view="pose-waving" height={34} alt="" />
          </span>
          <span>{asked ? 'Continue with Zev' : 'Ask Zev'}</span>
          {unread && (
            <span className="zev-ask-unread">
              <span className="sr-only">, new answer</span>
            </span>
          )}
        </button>
      )}

      <section
        id={ids.panel}
        className="zev-ask-panel"
        hidden={collapsed}
        aria-labelledby={ids.title}
      >
        <header className="zev-ask-head">
          <span className="zev-ask-head-avatar" aria-hidden>
            <Zev view="pose-waving" height={30} alt="" />
          </span>
          <div>
            <h2 id={ids.title}>Ask Zev</h2>
            <p>Public product questions · not a live person</p>
          </div>
          {docked && (
            <button type="button" className="zev-ask-icon" onClick={minimize} aria-label="Minimize Ask Zev">
              <Minus size={16} aria-hidden />
            </button>
          )}
        </header>

        {asked && (
          <ol ref={thread} className="zev-ask-thread" role="log" aria-label="Conversation with Zev" aria-live="polite" aria-relevant="additions">
            {messages.map((m) => (
              <li key={m.id} className={cn('zev-ask-msg', m.role === 'user' ? 'is-user' : 'is-zev')}>
                <span className="sr-only">{m.role === 'user' ? 'You:' : `Zev (${m.mode ? ANSWER_MODE_LABEL[m.mode] : 'answer'}):`}</span>
                {m.role === 'assistant' && m.mode && (
                  <span className={cn('zev-ask-mode', `is-${m.mode}`)} aria-hidden>
                    {ANSWER_MODE_LABEL[m.mode]}
                  </span>
                )}
                <p>{m.text}</p>
                {m.links && m.links.length > 0 && (
                  <span className="zev-ask-links">
                    {m.links.map((l) => (
                      <Link key={l.href} to={l.href}>
                        {l.label}
                      </Link>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}

        {status === 'sending' && (
          <div className="zev-ask-status" role="status">
            <span className="zev-ask-dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <span>Zev is answering…</span>
            <button type="button" onClick={cancel}>
              <Square size={11} aria-hidden /> Cancel
            </button>
          </div>
        )}

        {error && status === 'error' && (
          <div className="zev-ask-error" role="alert">
            <span>{error.message}</span>
            <span className="zev-ask-error-actions">
              {zev.canRetry && online && (
                <button type="button" onClick={retry}>
                  <RotateCcw size={12} aria-hidden /> Retry
                </button>
              )}
              <button type="button" className="zev-ask-icon" onClick={dismissError} aria-label="Dismiss message">
                <X size={13} aria-hidden />
              </button>
            </span>
          </div>
        )}

        {!online && (
          <p className="zev-ask-offline" role="status">
            <WifiOff size={13} aria-hidden /> Offline. Your draft stays here until you are connected.
          </p>
        )}

        <form
          className="zev-ask-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor={ids.input} className="sr-only">
            Ask Zev a question about ZEVQORA
          </label>
          <textarea
            ref={input}
            id={ids.input}
            rows={1}
            value={draft}
            maxLength={SUPPORT_MESSAGE_MAX_CHARS}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={narrow ? 'Ask Zev anything…' : 'Ask Zev anything about ZEVQORA…'}
            aria-describedby={ids.hint}
            enterKeyHint="send"
            autoComplete="off"
          />
          <button type="submit" className="zev-ask-send" disabled={!canSend} aria-label="Send message">
            <ArrowUp size={18} aria-hidden />
          </button>
        </form>
        <p id={ids.hint} className="zev-ask-hint">
          <span>Enter to send · Shift+Enter for a new line</span>
          <span>No signup. Public info only; ZEVQORA doesn't save your messages.</span>
        </p>

        {!asked && (
          <div className="zev-ask-chips" role="group" aria-label="Suggested questions">
            {QUICK_CHIPS.map((q) => (
              <button key={q} type="button" disabled={status === 'sending'} onClick={() => send(q, page)}>
                {q}
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
