import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from './supabase';
import { api, ApiClientError } from './api';
import type { Me, Workspace } from './types';

type Status = 'loading' | 'signed_out' | 'signed_in' | 'unconfigured';

interface SessionState {
  status: Status;
  session: Session | null;
  me: Me | null;
  meError: string | null;
  refreshMe: () => Promise<Me | null>;
  signOut: () => Promise<void>;
  activeWorkspace: Workspace | null;
  setActiveWorkspaceId: (id: string) => void;
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;
}

const Ctx = createContext<SessionState | null>(null);
const WS_KEY = 'zevqora.activeWorkspace';
const PROJECT_KEY = 'zevqora.activeProject';

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  const [activeWorkspaceId, setWs] = useState<string | null>(() => read(WS_KEY));
  const [activeProjectId, setProject] = useState<string | null>(() => read(PROJECT_KEY));
  const loading = useRef<Promise<Me | null> | null>(null);

  const refreshMe = useCallback(async () => {
    if (loading.current) return loading.current;
    loading.current = api<Me>('/api/me')
      .then((data) => {
        setMe(data);
        setMeError(null);
        return data;
      })
      .catch(async (error) => {
        if (error instanceof ApiClientError && (error.status === 401 || error.code === 'ACCOUNT_SUSPENDED')) {
          if (error.code === 'ACCOUNT_SUSPENDED') setMeError(error.message);
          const sb = await getSupabase();
          if (error.status === 401) await sb?.auth.signOut();
          setMe(null);
          return null;
        }
        setMeError(error instanceof Error ? error.message : 'Could not load your account.');
        return null;
      })
      .finally(() => {
        loading.current = null;
      });
    return loading.current;
  }, []);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let active = true;
    getSupabase().then((sb) => {
      if (!active) return;
      if (!sb) {
        setStatus('unconfigured');
        return;
      }
      sb.auth.getSession().then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        setStatus(data.session ? 'signed_in' : 'signed_out');
        if (data.session) void refreshMe();
      });
      const { data: sub } = sb.auth.onAuthStateChange((event, next) => {
        if (!active) return;
        setSession(next);
        if (event === 'SIGNED_OUT') {
          setMe(null);
          setStatus('signed_out');
          return;
        }
        if (next) {
          setStatus('signed_in');
          if (event === 'SIGNED_IN' || event === 'USER_UPDATED') void refreshMe();
        }
      });
      unsub = () => sub.subscription.unsubscribe();
    });
    return () => {
      active = false;
      unsub?.();
    };
  }, [refreshMe]);

  const signOut = useCallback(async () => {
    const sb = await getSupabase();
    await sb?.auth.signOut();
    setMe(null);
    setStatus('signed_out');
  }, []);

  const activeWorkspace = useMemo(() => {
    if (!me) return null;
    return me.workspaces.find((w) => w.id === activeWorkspaceId) || me.workspaces[0] || null;
  }, [me, activeWorkspaceId]);

  useEffect(() => {
    if (activeWorkspace && activeWorkspace.id !== activeWorkspaceId) {
      setWs(activeWorkspace.id);
      write(WS_KEY, activeWorkspace.id);
    }
  }, [activeWorkspace, activeWorkspaceId]);

  const setActiveWorkspaceId = useCallback((id: string) => {
    setWs(id);
    write(WS_KEY, id);
    setProject(null);
    write(PROJECT_KEY, null);
  }, []);

  const setActiveProjectId = useCallback((id: string | null) => {
    setProject(id);
    write(PROJECT_KEY, id);
  }, []);

  const value = useMemo<SessionState>(
    () => ({ status, session, me, meError, refreshMe, signOut, activeWorkspace, setActiveWorkspaceId, activeProjectId, setActiveProjectId }),
    [status, session, me, meError, refreshMe, signOut, activeWorkspace, setActiveWorkspaceId, activeProjectId, setActiveProjectId],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
