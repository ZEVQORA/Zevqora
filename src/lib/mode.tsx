import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * Presentation mode: what the Command Center emphasises for the reader.
 *
 * CEO / CTO / Developer are NOT permission roles. They change wording, order
 * and density only; every API still authorizes with the workspace role.
 */
export type PresentationMode = 'ceo' | 'cto' | 'developer';

export const MODES: Array<{ value: PresentationMode; label: string; description: string }> = [
  { value: 'ceo', label: 'CEO', description: 'Money, value and decisions' },
  { value: 'cto', label: 'CTO', description: 'Performance, risk and strategy' },
  { value: 'developer', label: 'Developer', description: 'Execution paths, evidence and proof' },
];

const KEY = 'zevqora.presentationMode';
const Ctx = createContext<{ mode: PresentationMode; setMode: (m: PresentationMode) => void } | null>(null);

function read(): PresentationMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'ceo' || v === 'cto' || v === 'developer' ? v : 'cto';
  } catch {
    return 'cto';
  }
}

export function PresentationModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<PresentationMode>(read);
  const setMode = useCallback((m: PresentationMode) => setModeState(m), []);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* storage unavailable: the mode lasts for this page view */
    }
  }, [mode]);
  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePresentationMode() {
  return useContext(Ctx) || { mode: 'cto' as PresentationMode, setMode: () => undefined };
}
