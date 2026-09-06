import { useState } from 'react';
import { admin, type ModelPricingRow } from '../data';
import { useAsync } from '@/lib/useAsync';
import { PageHeader, Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Table, Th, Td } from '@/components/ui/Misc';
import { ErrorState, Skeleton, InlineNotice } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api';
import { dateOnly } from '@/lib/format';

function Row({ row, onSaved }: { row: ModelPricingRow; onSaved: () => void }) {
  const [form, setForm] = useState(row);
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const dirty = JSON.stringify(form) !== JSON.stringify(row);
  const save = async () => {
    setPending(true);
    try {
      await admin.savePricing(row.model, { input_per_million: Number(form.input_per_million), output_per_million: Number(form.output_per_million), cached_input_per_million: form.cached_input_per_million === null ? null : Number(form.cached_input_per_million), tier: form.tier, active: form.active, source: form.source });
      toast({ tone: 'success', title: `${row.model} saved` });
      onSaved();
    } catch (e) {
      toast({ tone: 'error', title: 'Could not save', description: errorMessage(e) });
    } finally {
      setPending(false);
    }
  };
  return (
    <tr>
      <Td mono>{row.model}<div className="text-subtle">{row.provider} · {dateOnly(row.retrieved_at)}</div></Td>
      <Td><Input type="number" step="0.0001" value={form.input_per_million} onChange={(e) => setForm({ ...form, input_per_million: Number(e.target.value) })} className="h-8 w-24 text-technical" aria-label="Input price" /></Td>
      <Td><Input type="number" step="0.0001" value={form.output_per_million} onChange={(e) => setForm({ ...form, output_per_million: Number(e.target.value) })} className="h-8 w-24 text-technical" aria-label="Output price" /></Td>
      <Td><Input type="number" step="0.0001" value={form.cached_input_per_million ?? ''} onChange={(e) => setForm({ ...form, cached_input_per_million: e.target.value === '' ? null : Number(e.target.value) })} className="h-8 w-24 text-technical" aria-label="Cached input price" /></Td>
      <Td><Select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })} className="h-8 w-28 py-0 text-technical" aria-label="Tier"><option value="frontier">frontier</option><option value="standard">standard</option><option value="small">small</option><option value="embedding">embedding</option></Select></Td>
      <Td><Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="h-8 w-40 text-technical" aria-label="Source" /></Td>
      <Td><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} aria-label="Active" /></Td>
      <Td align="right"><Button size="xs" onClick={save} disabled={!dirty} loading={pending}>Save</Button></Td>
    </tr>
  );
}

export default function AdminModelPricingPage() {
  const q = useAsync(() => admin.pricing(), []);
  const toast = useToast();
  const [newModel, setNewModel] = useState('');
  const [newIn, setNewIn] = useState('');
  const [newOut, setNewOut] = useState('');
  const add = async () => {
    try {
      await admin.savePricing(newModel.trim().toLowerCase(), { input_per_million: Number(newIn), output_per_million: Number(newOut), tier: 'standard', source: 'admin entry' });
      setNewModel('');
      setNewIn('');
      setNewOut('');
      await q.reload(true);
      toast({ tone: 'success', title: 'Model added' });
    } catch (e) {
      toast({ tone: 'error', title: 'Could not add', description: errorMessage(e) });
    }
  };
  return (
    <>
      <PageHeader eyebrow="Internal" title="Model pricing snapshot" description="USD per million tokens. Used only when a runtime does not report cost; every estimate is labelled pricing_snapshot_estimate." />
      <InlineNotice tone="info" className="mb-4">Edits take effect within five minutes (server cache) and are audit-logged. Provider-reported costs are never overwritten.</InlineNotice>
      {q.error && <ErrorState message={q.error} onRetry={() => q.reload()} />}
      {!q.data ? <Skeleton className="h-96 rounded-lg" /> : (
        <Panel className="p-2">
          <Table minWidth={980}>
            <thead><tr><Th>Model</Th><Th>Input / M</Th><Th>Output / M</Th><Th>Cached / M</Th><Th>Tier</Th><Th>Source</Th><Th>Active</Th><Th /></tr></thead>
            <tbody>
              {q.data.pricing.map((r) => <Row key={r.model} row={r} onSaved={() => q.reload(true)} />)}
              <tr>
                <Td><Input value={newModel} onChange={(e) => setNewModel(e.target.value)} placeholder="provider/model" className="h-8 text-technical" aria-label="New model" /></Td>
                <Td><Input type="number" value={newIn} onChange={(e) => setNewIn(e.target.value)} className="h-8 w-24 text-technical" aria-label="New input price" /></Td>
                <Td><Input type="number" value={newOut} onChange={(e) => setNewOut(e.target.value)} className="h-8 w-24 text-technical" aria-label="New output price" /></Td>
                <Td colSpan={4} className="text-subtle">standard · admin entry</Td>
                <Td align="right"><Button size="xs" variant="secondary" onClick={add} disabled={!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/.test(newModel.trim().toLowerCase()) || !newIn || !newOut}>Add</Button></Td>
              </tr>
            </tbody>
          </Table>
        </Panel>
      )}
    </>
  );
}
