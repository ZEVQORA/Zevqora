import type { Account } from '@/lib/types';

/** Zev credit for the current period, straight from the account record. */
export function creditSummary(account: Account | null | undefined) {
  const included = Number(account?.credit?.includedUsd ?? 0);
  const used = Number(account?.credit?.usedUsd ?? 0);
  const remaining = Math.max(0, included - used);
  const ratio = included > 0 ? Math.min(1, used / included) : 0;
  return { included, used, remaining, ratio };
}
