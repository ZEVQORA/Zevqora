import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useProduct } from '../store';
import { engineErrorMessage } from '../engine';
import { Button, Card, CardHeader, Empty, Field, KeyValue, Modal, StatusChip, useProductToast } from '../ui';
import { dateTime, money, ms, num, relativeTime } from '../format';
import type { EvaluationRequirements } from '../types';

const GAP_TEXT: Record<string, string> = {
  no_traces: 'No traces yet',
  cost_unknown: 'Cost unknown on some traces',
  latency_unknown: 'Latency unknown on some traces',
  no_expected_output: 'Some traces cannot be graded',
  input_only: 'Some traces carry no recorded prompt',
  no_protected_cases: 'No protected cases',
  stale: 'Baseline is stale',
};

function tallyLine(t: Record<string, number>) {
  const entries = Object.entries(t).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '—';
  return entries.slice(0, 4).map(([k, v]) => `${k} · ${v}`).join(', ') + (entries.length > 4 ? ` (+${entries.length - 4} more)` : '');
}

/** The baseline, with where every number came from and what is missing. */
export function BaselineCard() {
  const { economics } = useProduct();
  const b = economics?.baseline;
  if (!economics?.trace_count) {
    return (
      <Card>
        <CardHeader title="Baseline" description="What the current system costs and does, measured from recorded traces." />
        <div className="pcard-body"><Empty title="No baseline yet" description="Import execution traces for this project. The baseline is built only from recorded evidence, never from price lists." /></div>
      </Card>
    );
  }
  const partial = b && !b.cost.complete;
  return (
    <Card>
      <CardHeader
        title="Baseline"
        description="Measured from imported execution traces. Every figure says what it covers."
        action={b?.stale ? <StatusChip status="waiting" label="STALE" /> : <StatusChip status="ok" label={`${economics.trace_count} TRACES`} />}
      />
      <div className="pcard-body grid gap-5 lg:grid-cols-2">
        <KeyValue
          items={[
            ['Provider / model', b ? tallyLine(b.models) : Object.keys(economics.providers).join(', ') || '—'],
            ['Workflows', b ? tallyLine(b.workflows) : '—'],
            ['Calls (traces)', num(economics.trace_count)],
            ['Tokens in / out', b?.tokens.known ? `${num(b.tokens.input ?? 0)} / ${num(b.tokens.output ?? 0)}${b.tokens.known < b.trace_count ? ` (on ${b.tokens.known} of ${b.trace_count})` : ''}` : 'unknown'],
            ['Window', economics.first_evidence_at ? `${dateTime(economics.first_evidence_at)} → ${dateTime(economics.latest_evidence_at)}` : '—'],
          ]}
        />
        <KeyValue
          items={[
            ['Cost', economics.observed_cost_usd == null ? 'unknown' : `${partial ? '≥ ' : ''}${money(economics.observed_cost_usd, { digits: 6 })}${b ? ` · priced ${b.cost.known} of ${b.trace_count}` : ''}`],
            ['Cost source', b ? tallyLine(b.cost.sources) : 'unknown'],
            ['Latency', economics.avg_latency_ms == null ? 'unknown' : `${ms(economics.avg_latency_ms)} average${b ? ` · on ${b.latency.known} of ${b.trace_count}` : ''}`],
            ['Latency source', 'recorded in the imported traces'],
            ['Evaluation coverage', b ? `${b.evaluation_coverage.with_expected_output} gradable · ${b.evaluation_coverage.with_recorded_prompt} with prompt · ${b.evaluation_coverage.protected} protected` : '—'],
          ]}
        />
        {b && (
          <div className="lg:col-span-2">
            <div className="pmetric-label">Evidence gaps</div>
            {!b.gaps.length ? (
              <p className="mt-1 text-[13px] text-verified">None. Every trace is priced, timed, gradable and carries its prompt.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {b.gaps.map((g) => {
                  const [key, ...rest] = g.split(':');
                  return (
                    <li key={g} className="text-[13px]">
                      <b className="font-semibold text-warning">{GAP_TEXT[key] || key}</b>
                      <span className="text-muted">{rest.length ? `: ${rest.join(':').trim()}` : ''}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
        {!b && <p className="text-[12.5px] text-subtle lg:col-span-2">This engine does not report baseline provenance yet; treat cost and latency as covering only the traces that recorded them.</p>}
      </div>
    </Card>
  );
}

/** The team's frozen quality bar for this project. Only admins change it. */
export function RequirementsCard() {
  const { selected, engine, refreshProducts, runtime } = useProduct();
  const { activeWorkspace } = useSession();
  const toast = useProductToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EvaluationRequirements>({});
  const [saving, setSaving] = useState(false);
  if (!selected) return null;
  const req = selected.evaluation_requirements || {};
  const set = Object.keys(req).some((k) => k !== 'frozen_at' && k !== 'frozen_by');
  const isAdmin = activeWorkspace?.role === 'owner' || activeWorkspace?.role === 'admin';

  const save = async () => {
    setSaving(true);
    try {
      await engine.setRequirements(selected.id, draft);
      await refreshProducts();
      toast({ tone: 'ok', title: 'Requirements frozen', description: 'They apply to experiments evaluated from now on.' });
      setEditing(false);
    } catch (error) {
      toast({ tone: 'err', title: 'Could not save requirements', description: engineErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Evaluation requirements"
        description="The floor every experiment on this project is held to. An experiment can be stricter, never looser."
        action={isAdmin && runtime === 'browser' ? <Button size="xs" variant="secondary" onClick={() => { setDraft({ quality_floor: req.quality_floor ?? 0.95, min_samples: req.min_samples ?? 10, require_protected_cases: Boolean(req.require_protected_cases), require_latency: req.require_latency ?? true }); setEditing(true); }}><Pencil size={12} /> {set ? 'Change' : 'Set'}</Button> : undefined}
      />
      <div className="pcard-body">
        {!set ? (
          <p className="text-[13px] text-muted">No project floor set. Experiments use the engine defaults (quality 0.95, 5 cases) or whatever each experiment asks for.{!isAdmin ? ' A workspace admin can set a floor.' : ''}</p>
        ) : (
          <KeyValue
            items={[
              ['Quality floor', String(req.quality_floor ?? '—')],
              ['Minimum cases', String(req.min_samples ?? '—')],
              ['Protected cases', req.require_protected_cases ? 'required' : 'not required'],
              ['Latency evidence', req.require_latency ? 'required' : 'not required'],
              ['Frozen', req.frozen_at ? relativeTime(req.frozen_at) : '—'],
            ]}
          />
        )}
      </div>
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        size="sm"
        title="Change evaluation requirements"
        description="Past verdicts keep the requirements they were evaluated under."
        footer={<><Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button><Button onClick={() => void save()} loading={saving}>Freeze requirements</Button></>}
      >
        <div className="grid gap-3">
          <Field label="Quality floor (0.5 – 1)"><input className="pinput mono" type="number" min="0.5" max="1" step="0.01" value={draft.quality_floor ?? ''} onChange={(e) => setDraft((d) => ({ ...d, quality_floor: Number(e.target.value) }))} /></Field>
          <Field label="Minimum evaluated cases"><input className="pinput mono" type="number" min="3" step="1" value={draft.min_samples ?? ''} onChange={(e) => setDraft((d) => ({ ...d, min_samples: Math.floor(Number(e.target.value)) }))} /></Field>
          <label className="flex items-center gap-2 text-[13px] text-ink"><input type="checkbox" checked={Boolean(draft.require_protected_cases)} onChange={(e) => setDraft((d) => ({ ...d, require_protected_cases: e.target.checked }))} /> Require protected cases</label>
          <label className="flex items-center gap-2 text-[13px] text-ink"><input type="checkbox" checked={Boolean(draft.require_latency)} onChange={(e) => setDraft((d) => ({ ...d, require_latency: e.target.checked }))} /> Require latency evidence</label>
        </div>
      </Modal>
    </Card>
  );
}
