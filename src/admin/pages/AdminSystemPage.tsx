import { useAsync } from '@/lib/useAsync';
import { dateTime } from '@/lib/format';
import { Card, CardHeader } from '@/components/ui/Card';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { adminV3 } from '../data-v3';
import { AdminHeader, StatusPill } from '../shared';

const EXPLAIN: Record<string, string> = {
  api: 'This API function answered.',
  database: 'A live query against the database succeeded.',
  cloud_replay: 'Platform model credential (OpenRouter) for replays that call a model.',
  stripe: 'Billing keys. Checkout stays disabled until set.',
  analytics_secret: 'ANALYTICS_SECRET (≥ 32 chars): stable daily visitor keys across server instances.',
  security_hash_secret: 'SECURITY_HASH_SECRET (≥ 32 chars): stable keyed hashes for security-event correlation.',
  cron: 'CRON_SECRET: protects the daily retention and credit job.',
  vercel_web_analytics: 'Optional traffic cross-check (VERCEL_WEB_ANALYTICS=1). First-party analytics remain the source of truth.',
  posthog: 'Not integrated: it would require a third-party script origin in the CSP and is not needed for the current funnels.',
};

/** Live configuration and health checks. Values are statuses only — never the secrets themselves. */
export default function AdminSystemPage() {
  const q = useAsync(() => adminV3.systemHealth(), []);
  return (
    <>
      <AdminHeader title="System health" description="Which server-side integrations are configured, checked live. Secret values are never returned to the browser." />
      {q.error && <ErrorState message={q.error} onRetry={() => void q.reload()} />}
      {q.loading && !q.data && <LoadingState label="Checking system health" />}
      {q.data && (
        <Card>
          <CardHeader title="Checks" description={`Checked ${dateTime(String(q.data.time))}${typeof q.data.database_ms === 'number' ? ` · database round trip ${q.data.database_ms} ms` : ''}`} action={<Button size="sm" variant="secondary" onClick={() => void q.reload()}>Re-check</Button>} />
          <dl className="px-5 pb-4">
            {Object.entries(q.data).filter(([k]) => k in EXPLAIN).map(([k, v]) => (
              <div key={k} className="grid gap-1 border-b border-line py-3 sm:grid-cols-[14rem_8rem_1fr] sm:items-center">
                <dt className="text-[13px] font-medium text-ink">{k.replace(/_/g, ' ')}</dt>
                <dd><StatusPill value={String(v)} /></dd>
                <dd className="text-[12.5px] text-muted">{EXPLAIN[k]}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
    </>
  );
}
