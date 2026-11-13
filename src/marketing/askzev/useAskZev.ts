import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import type { PublicAnswerMode, PublicSupportLink, PublicSupportMessageResponse, PublicSupportTurn } from '@/lib/contracts/support';
import { SUPPORT_MESSAGE_MAX_CHARS } from '@/lib/contracts/support';

export interface ZevMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  mode?: PublicAnswerMode;
  links?: PublicSupportLink[];
}

export type ZevStatus = 'idle' | 'sending' | 'error';

export interface ZevError {
  kind: 'offline' | 'rate_limited' | 'invalid' | 'server';
  message: string;
}

const HISTORY_TURNS = 6;
let seq = 0;
const nextId = () => `zev-${Date.now().toString(36)}-${(seq += 1)}`;

function toError(error: unknown): ZevError {
  if (error instanceof ApiClientError) {
    if (error.status === 0) return { kind: 'offline', message: 'You appear to be offline. Your message is kept; retry when you are back online.' };
    if (error.status === 429) return { kind: 'rate_limited', message: error.message || 'You are sending messages quickly. Wait a moment and try again.' };
    if (error.status === 400 || error.status === 413) return { kind: 'invalid', message: error.message };
  }
  return { kind: 'server', message: 'Zev could not answer just now. Your message is kept; try again.' };
}

/**
 * Conversation state for the public homepage composer. Lives in memory only:
 * nothing is persisted on the device or the server. One instance drives the
 * single mounted composer whether it sits in the hero or in the corner.
 */
export function useAskZev() {
  const [messages, setMessages] = useState<ZevMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<ZevStatus>('idle');
  const [error, setError] = useState<ZevError | null>(null);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  /** The last message that failed, so Retry resends exactly it. */
  const failed = useRef<{ text: string; page: string | null } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      controller.current?.abort();
    };
  }, []);

  const request = useCallback(async (text: string, page: string | null, priorTurns: ZevMessage[]) => {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    setStatus('sending');
    setError(null);
    const history: PublicSupportTurn[] = priorTurns.slice(-HISTORY_TURNS).map((m) => ({ role: m.role, content: m.text }));
    try {
      const res = await api<PublicSupportMessageResponse>('/api/support/message', {
        method: 'POST',
        auth: false,
        signal: ac.signal,
        body: { message: text, history, ...(page ? { page } : {}) },
      });
      if (controller.current !== ac) return;
      failed.current = null;
      setMessages((list) => [...list, { id: nextId(), role: 'assistant', text: res.answer, mode: res.mode, links: res.links }]);
      setStatus('idle');
    } catch (e) {
      if (controller.current !== ac) return;
      if ((e as Error)?.name === 'AbortError') {
        setStatus('idle');
        return;
      }
      failed.current = { text, page };
      setError(toError(e));
      setStatus('error');
    } finally {
      if (controller.current === ac) controller.current = null;
    }
  }, []);

  /** Sends the draft (or the given text). Returns false when nothing was sent. */
  const send = useCallback(
    (text?: string, page: string | null = null) => {
      const body = (text ?? draft).trim();
      if (!body || body.length > SUPPORT_MESSAGE_MAX_CHARS) return false;
      if (status === 'sending') return false;
      if (!online) {
        setError({ kind: 'offline', message: 'You are offline. Your message is kept here; send it when you are back online.' });
        setStatus('error');
        return false;
      }
      const prior = messagesRef.current;
      setMessages((list) => [...list, { id: nextId(), role: 'user', text: body }]);
      if (text === undefined) setDraft('');
      void request(body, page, prior);
      return true;
    },
    [draft, online, request, status],
  );

  /** Stops the request in flight; the question stays in the thread and can be retried. */
  const cancel = useCallback(() => {
    const ac = controller.current;
    if (!ac) return;
    controller.current = null;
    ac.abort();
    const last = messagesRef.current.at(-1);
    if (last?.role === 'user') failed.current = { text: last.text, page: null };
    setError({ kind: 'server', message: 'Stopped. Retry to ask again.' });
    setStatus('error');
  }, []);

  const retry = useCallback(() => {
    const f = failed.current;
    if (!f || !online) return;
    // The question is already in the thread; resend it with the turns before it.
    const prior = messagesRef.current.slice(0, -1);
    void request(f.text, f.page, prior);
  }, [online, request]);

  const dismissError = useCallback(() => {
    setError(null);
    setStatus('idle');
  }, []);

  return { messages, draft, setDraft, status, error, online, send, cancel, retry, dismissError, canRetry: Boolean(failed.current) };
}

export type AskZevState = ReturnType<typeof useAskZev>;
