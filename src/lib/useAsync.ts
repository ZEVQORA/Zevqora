import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from './api';

interface State<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** Fetch-on-mount hook with retry and dependency refresh. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], { enabled = true }: { enabled?: boolean } = {}) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: enabled });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const tick = useRef(0);

  const run = useCallback(async (silent = false) => {
    if (!enabled) return;
    const id = ++tick.current;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fnRef.current();
      if (id === tick.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (id === tick.current) setState((s) => ({ data: s.data, error: errorMessage(error), loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => {
    void run();
  }, [run]);

  return { ...state, reload: run, setData: (updater: (prev: T | null) => T | null) => setState((s) => ({ ...s, data: updater(s.data) })) };
}
