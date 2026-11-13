import { useCallback, useState } from 'react';
import { useSession } from '@/lib/session';
import { app } from '@/app/data';
import type { ExplainMode } from './engine';

/**
 * How Zev explains things: a per-user presentation preference stored in the
 * profile's onboarding object (PATCH /api/me). It is never a permission: the
 * server decides access from workspace membership and roles, and both styles
 * read exactly the same data.
 *
 * "later" means the user chose to decide later; it behaves like the beginner
 * (non-technical) default until they pick.
 */
export type ExplainChoice = ExplainMode | 'later';

export const EXPLAIN_OPTIONS: Array<{ value: ExplainChoice; label: string; description: string }> = [
  { value: 'technical', label: 'Technical', description: 'API details, traces, models and implementation steps.' },
  { value: 'nontechnical', label: 'Non-technical', description: 'Cost, speed, risk and the verified outcome in plain language.' },
  { value: 'later', label: "I'll choose later", description: 'Start with plain language. Change it any time.' },
];

export function readExplainChoice(onboarding: Record<string, unknown> | null | undefined): ExplainChoice | null {
  const v = onboarding?.explain_mode;
  return v === 'technical' || v === 'nontechnical' || v === 'later' ? v : null;
}

/** The style actually sent to Zev. Unset and "later" use the beginner default. */
export function effectiveExplainMode(choice: ExplainChoice | null): ExplainMode {
  return choice === 'technical' ? 'technical' : 'nontechnical';
}

export function useExplainMode() {
  const { me, refreshMe } = useSession();
  const choice = readExplainChoice(me?.profile.onboarding);
  const [pending, setPending] = useState<ExplainChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = useCallback(
    async (next: ExplainChoice) => {
      setPending(next);
      setError(null);
      try {
        await app.updateMe({ onboarding: { explain_mode: next } });
        await refreshMe();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save your preference.');
      } finally {
        setPending(null);
      }
    },
    [refreshMe],
  );
  const shown = pending ?? choice;
  return { choice: shown, mode: effectiveExplainMode(shown), set, saving: pending !== null, error };
}
