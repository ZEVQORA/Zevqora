import { useState } from 'react';
import { admin } from '../data';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Panel } from '@/components/ui/Panel';
import { Table, Th, Td } from '@/components/ui/Misc';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { dateTime, shortId } from '@/lib/format';

export default function AdminAuditPage() {
  const q = useAsync(() => admin.audit(200), []);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <PageHeader eyebrow="Internal" title="Audit log" description="Every sensitive admin action: who, what, target, when, and the before/after metadata. Secrets are never stored here." />
      {q.error && <ErrorState message={q.error} onRetry={() => q.reload()} />}
      {!q.data ? <Skeleton className="h-96 rounded-lg" /> : (
        <Panel className="p-2">
          <Table minWidth={760}>
            <thead><tr><Th>When</Th><Th>Admin</Th><Th>Action</Th><Th>Target</Th><Th>Metadata</Th></tr></thead>
            <tbody>
              {q.data.entries.map((e) => (
                <tr key={e.id}>
                  <Td mono>{dateTime(e.created_at)}</Td>
                  <Td mono>{e.admin_email || (e.admin_id ? shortId(e.admin_id) : 'system')}</Td>
                  <Td mono>{e.action}</Td>
                  <Td mono>{e.target_type} {e.target_id ? shortId(e.target_id, 12) : ''}</Td>
                  <Td>
                    <button type="button" onClick={() => setOpen(open === e.id ? null : e.id)} className="text-technical text-accent-text underline-offset-4 hover:underline">{open === e.id ? 'Hide' : 'Show'}</button>
                    {open === e.id && <pre className="mt-2 max-w-[420px] overflow-x-auto rounded-md bg-sunken p-2 font-mono text-[11px] text-ink">{JSON.stringify(e.metadata, null, 2)}</pre>}
                  </Td>
                </tr>
              ))}
              {!q.data.entries.length && <tr><Td colSpan={5} className="text-subtle">No admin actions recorded yet.</Td></tr>}
            </tbody>
          </Table>
        </Panel>
      )}
    </>
  );
}
