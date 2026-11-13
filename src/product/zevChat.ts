import { useCallback, useSyncExternalStore } from 'react';
import type { ChatLine } from './types';

/**
 * Engineering Zev conversation state, kept per workspace for the life of the
 * tab. It survives switching panels and routes inside the app, never crosses
 * workspaces, and is never written to storage (traces and answers can contain
 * workspace data).
 */
type Thread = { lines: ChatLine[] };
const threads = new Map<string, Thread>();
const listeners = new Set<() => void>();
const EMPTY: Thread = { lines: [] };

function emit() {
  for (const l of listeners) l();
}

export function useZevThread(workspaceId: string | null) {
  const key = workspaceId || 'none';
  const thread = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => threads.get(key) || EMPTY,
  );
  const setLines = useCallback(
    (update: (lines: ChatLine[]) => ChatLine[]) => {
      const current = threads.get(key) || EMPTY;
      threads.set(key, { lines: update(current.lines) });
      emit();
    },
    [key],
  );
  return { lines: thread.lines, setLines };
}

/** Test hook. */
export function resetZevThreads() {
  threads.clear();
  emit();
}
