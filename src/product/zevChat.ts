import { useCallback, useSyncExternalStore } from 'react';
import type { ChatLine } from './types';

/**
 * Engineering Zev conversations, kept per workspace for the life of the tab.
 * A workspace can hold several conversations (the sidebar's "Recent" list and
 * "New chat"); exactly one is active. They survive switching panels and routes
 * inside the app, never cross workspaces, and are never written to storage
 * (traces and answers can contain workspace data), so a reload starts fresh.
 */
export type Conversation = { id: string; title: string; lines: ChatLine[]; updatedAt: number };
type Store = { list: Conversation[]; activeId: string | null };

const stores = new Map<string, Store>();
const listeners = new Set<() => void>();
const EMPTY_STORE: Store = { list: [], activeId: null };
const NO_LINES: ChatLine[] = [];

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function emit() {
  for (const l of listeners) l();
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function read(key: string) {
  return stores.get(key) || EMPTY_STORE;
}
function write(key: string, next: Store) {
  stores.set(key, next);
  emit();
}

/** A conversation's title: its first question, trimmed to one line. */
export function conversationTitle(lines: ChatLine[]) {
  const first = lines.find((l) => l.role === 'user')?.content.replace(/\s+/g, ' ').trim() || 'New chat';
  return first.length > 48 ? `${first.slice(0, 47).trimEnd()}…` : first;
}

/** The active conversation's messages, and a setter that creates the conversation on first use. */
export function useZevThread(workspaceId: string | null) {
  const key = workspaceId || 'none';
  const store = useSyncExternalStore(subscribe, () => read(key));
  const active = store.list.find((c) => c.id === store.activeId);
  const setLines = useCallback(
    (update: (lines: ChatLine[]) => ChatLine[]) => {
      const cur = read(key);
      const current = cur.list.find((c) => c.id === cur.activeId);
      const lines = update(current?.lines || NO_LINES);
      if (current) {
        const next: Conversation = { ...current, lines, title: conversationTitle(lines), updatedAt: Date.now() };
        write(key, { ...cur, list: cur.list.map((c) => (c.id === current.id ? next : c)) });
      } else {
        if (!lines.length) return;
        const created: Conversation = { id: uid(), title: conversationTitle(lines), lines, updatedAt: Date.now() };
        write(key, { list: [created, ...cur.list], activeId: created.id });
      }
    },
    [key],
  );
  return { lines: active?.lines || NO_LINES, setLines };
}

/** The workspace's conversations (newest first, empty ones hidden) and the actions on them. */
export function useZevConversations(workspaceId: string | null) {
  const key = workspaceId || 'none';
  const store = useSyncExternalStore(subscribe, () => read(key));
  const newChat = useCallback(() => {
    const cur = read(key);
    if (cur.activeId === null) return;
    write(key, { list: cur.list.filter((c) => c.lines.length > 0), activeId: null });
  }, [key]);
  const open = useCallback(
    (id: string) => {
      const cur = read(key);
      if (cur.list.some((c) => c.id === id)) write(key, { ...cur, activeId: id });
    },
    [key],
  );
  const remove = useCallback(
    (id: string) => {
      const cur = read(key);
      write(key, { list: cur.list.filter((c) => c.id !== id), activeId: cur.activeId === id ? null : cur.activeId });
    },
    [key],
  );
  const list = store.list.filter((c) => c.lines.length > 0).sort((a, b) => b.updatedAt - a.updatedAt);
  return { list, activeId: store.activeId, newChat, open, remove };
}

/** Test hook. */
export function resetZevThreads() {
  stores.clear();
  emit();
}
