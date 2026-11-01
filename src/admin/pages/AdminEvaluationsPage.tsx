import { useState } from 'react';
import { Mail } from 'lucide-react';
import { useAsync } from '@/lib/useAsync';
import { errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Field';
import { SegmentedControl } from '@/components/ui/Segmented';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { adminV3, type EvaluationRequest } from '../data-v3';
import { AdminHeader } from '../shared';

const STATUSES: EvaluationRequest['status'][] = ['new', 'contacted', 'qualified', 'closed'];
const SPEND: Record<string, string> = { unknown: 'not stated', under_1k: '< $1k/mo', '1k_10k': '$1k–10k/mo', '10k_50k': '$10k–50k/mo', '50k_250k': '$50k–250k/mo', over_250k: '> $250k/mo' };

/** The evaluation request inbox. Reading it and changing a status are both audited server-side. */
export default function AdminEvaluationsPage() {
  const [filter, setFilter] = useState<'all' | EvaluationRequest['status']>('new');
  const q = useAsync(() => adminV3.evaluationRequests(filter === 'all' ? undefined : filter), [filter]);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const setStatus = async (r: EvaluationRequest, status: EvaluationRequest['status']) => {
    setBusy(r.id);
    try {
      await adminV3.setEvaluationStatus(r.id, status);
      toast({ tone: 'success', title: `Marked ${status}`, description: r.company });
      await q.reload(true);
    } catch (e) {
      toast({ tone: 'error', title: 'Could not update', description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <AdminHeader title="Evaluation requests" description="Requests from the public evaluation form. Contact details are personal data: each read of this inbox is written to the audit log." />
      <SegmentedControl label="Status filter" value={filter} onChange={setFilter} options={[{ value: 'new', label: 'New' }, { value: 'contacted', label: 'Contacted' }, { value: 'qualified', label: 'Qualified' }, { value: 'closed', label: 'Closed' }, { value: 'all', label: 'All' }]} className="mb-4" />
      {q.error && <ErrorState message={q.error} onRetry={() => void q.reload()} />}
      {q.loading && !q.data && <LoadingState label="Loading requests" />}
      {q.data && !q.data.requests.length && <EmptyState zev={null} title="No requests here" description={filter === 'new' ? 'Nobody is waiting for a reply.' : 'No requests with this status.'} compact />}
      <ul className="flex flex-col gap-3">
        {q.data?.requests.map((r) => (
          <li key={r.id}>
            <Card as="article" className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold text-ink">{r.company}</h2>
                  <p className="text-[12.5px] text-muted">{r.name}{r.role_title ? ` · ${r.role_title}` : ''} · <a className="inline-flex items-center gap-1 text-accent-text" href={`mailto:${r.email}`}><Mail size={12} aria-hidden /> {r.email}</a></p>
                </div>
                <label className="flex items-center gap-2 text-[12px] text-muted">
                  Status
                  <Select aria-label={`Status for ${r.company}`} value={r.status} disabled={busy === r.id} onChange={(e) => void setStatus(r, e.target.value as EvaluationRequest['status'])} className="h-8 w-36 py-0 text-[12.5px]">
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </label>
              </div>
              <p className="mt-3 whitespace-pre-wrap break-words text-[13.5px] text-ink">{r.workload}</p>
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-subtle">
                <span>Received {dateTime(r.created_at)}</span>
                <span>AI spend {SPEND[r.ai_spend_band] || r.ai_spend_band}</span>
                {r.source?.referrer && <span>Referrer {r.source.referrer}</span>}
                {r.source?.utm_source && <span>UTM {r.source.utm_source}{r.source.utm_campaign ? ` / ${r.source.utm_campaign}` : ''}</span>}
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
