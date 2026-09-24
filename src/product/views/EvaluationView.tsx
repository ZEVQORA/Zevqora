import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Download, Save, ShieldCheck } from 'lucide-react';
import { useSession } from '@/lib/session';
import { ProductFrame } from '../Frame';
import { useProduct } from '../store';
import { useProductDialogs } from '../dialogs/context';
import { engineErrorMessage } from '../engine';
import { Button, Card, CardHeader, Empty, Field, StatusChip, saveTextFile, useProductToast } from '../ui';
import { dateTime, money, score, STRATEGY_LABEL, titleCase } from '../format';
import { canonicalEvaluations, countsAsMeasuredSaving, DECISION_LABEL, ledgerSummary, trialReportMarkdown } from '../evidence';
import type { Evaluation, EvaluationTrial } from '../types';

const lines = (v: string) => v.split('\n').map((s) => s.trim()).filter(Boolean);

/** A bounded design-partner evaluation of one authorized workload, and its report. */
export default function EvaluationView() {
  const { selected, engine, evaluations, plans, economics, canEdit, refreshProducts, runtime } = useProduct();
  const { activeWorkspace } = useSession();
  const dialogs = useProductDialogs();
  const navigate = useNavigate();
  const toast = useProductToast();
  const [draft, setDraft] = useState<EvaluationTrial>({});
  const [criteria, setCriteria] = useState('');
  const [limitations, setLimitations] = useState('');
  const [saving, setSaving] = useState(false);

  const trial = selected?.evaluation_trial || null;
  useEffect(() => {
    setDraft(trial || {});
    setCriteria((trial?.success_criteria || []).join('\n'));
    setLimitations((trial?.limitations || []).join('\n'));
  }, [trial]);

  if (!selected) {
    return (
      <ProductFrame>
        <Empty title="No project selected" description="An evaluation covers one authorized workload. Connect it first." action={<Button onClick={dialogs.openConnect}>Connect evidence</Button>} />
      </ProductFrame>
    );
  }
  if (runtime === 'desktop') {
    return (
      <ProductFrame>
        <Empty title="Evaluation records live on the platform" description="Open this project in the web app to record scope, success criteria and the decision." />
      </ProductFrame>
    );
  }

  const strategyFor = (e: Evaluation) => {
    const p = plans.find((x) => x.id === e.candidate_plan_id);
    return STRATEGY_LABEL[p?.strategy || ''] || titleCase(p?.strategy || 'candidate');
  };
  const rows = canonicalEvaluations(evaluations);
  const summary = ledgerSummary(evaluations);
  const req = selected.evaluation_requirements || {};
  const b = economics?.baseline;

  const save = async (confirmBoundary = false) => {
    setSaving(true);
    try {
      const { data_boundary_confirmed: _c, updated_at: _u, updated_by: _b, ...editable } = draft;
      await engine.setTrial(selected.id, { ...editable, success_criteria: lines(criteria), limitations: lines(limitations) }, { confirmBoundary });
      await refreshProducts();
      toast({ tone: 'ok', title: confirmBoundary ? 'Data boundary confirmed' : 'Evaluation saved' });
    } catch (error) {
      toast({ tone: 'err', title: 'Could not save', description: engineErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  };

  const exportReport = async () => {
    const md = trialReportMarkdown({ workspaceName: activeWorkspace?.name || 'Workspace', product: selected, trial, requirements: req, baseline: b, observedCostUsd: economics?.observed_cost_usd, evaluations, strategyFor });
    const path = await saveTextFile(`zevqora-evaluation-${selected.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md`, md, 'text/markdown');
    if (path) toast({ tone: 'ok', title: 'Evaluation report saved', description: path });
  };

  const input = 'pinput w-full';
  const set = <K extends keyof EvaluationTrial>(k: K, v: EvaluationTrial[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <ProductFrame>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="peyebrow">Evaluation</div>
          <h1 className="ph1">{trial?.customer ? `${trial.customer}: ` : ''}{selected.name}</h1>
          <p className="plede">One authorized workload, bounded. Scope and decisions are written by people; baseline, requirements and verdicts come straight from the evidence.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => void exportReport()}><Download size={14} /> Evaluation report (.md)</Button>
          {canEdit && <Button size="sm" onClick={() => void save()} loading={saving}><Save size={14} /> Save</Button>}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Scope and data boundary" action={<StatusChip status={trial?.status === 'closed' ? 'disconnected' : 'active'} label={(trial?.status || 'not started').toUpperCase()} />} />
          <div className="pcard-body grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Customer or team"><input className={input} value={draft.customer || ''} disabled={!canEdit} onChange={(e) => set('customer', e.target.value)} placeholder="Design partner" /></Field>
              <Field label="Fixtures">
                <select className={input} value={draft.fixtures || ''} disabled={!canEdit} onChange={(e) => set('fixtures', (e.target.value || undefined) as EvaluationTrial['fixtures'])}>
                  <option value="">Not recorded</option>
                  <option value="representative">Representative sample</option>
                  <option value="redacted">Redacted</option>
                  <option value="synthetic">Synthetic</option>
                  <option value="production_sample">Production sample</option>
                </select>
              </Field>
            </div>
            <Field label="Authorized workload"><input className={input} value={draft.workload || ''} disabled={!canEdit} onChange={(e) => set('workload', e.target.value)} placeholder={selected.name} /></Field>
            <Field label="Data boundary"><textarea className={`${input} min-h-[64px]`} value={draft.data_boundary_note || ''} disabled={!canEdit} onChange={(e) => set('data_boundary_note', e.target.value)} placeholder="What may be shared, what was redacted, retention agreed." /></Field>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-[12.5px]">
              {trial?.data_boundary_confirmed ? (
                <span className="inline-flex items-center gap-1.5 text-verified"><ShieldCheck size={14} /> Confirmed {dateTime(trial.data_boundary_confirmed.at)}</span>
              ) : (
                <span className="text-warning">Data boundary not confirmed. Do not import evidence until it is.</span>
              )}
              {canEdit && !trial?.data_boundary_confirmed && <Button size="xs" onClick={() => void save(true)} loading={saving}>Confirm boundary</Button>}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Baseline and requirements" description="Read from the evidence; change them in Projects." action={<Button size="xs" variant="secondary" onClick={() => navigate('/app/project')}>Open</Button>} />
          <div className="pcard-body grid gap-2 text-[13px]">
            <p className="text-ink">{economics?.trace_count ? `${economics.trace_count} traces · cost ${economics.observed_cost_usd == null ? 'unknown' : `${b && !b.cost.complete ? '≥ ' : ''}${money(economics.observed_cost_usd, { digits: 6 })}`}${b ? ` · priced ${b.cost.known} of ${b.trace_count}` : ''}` : 'No baseline yet: import traces.'}</p>
            {b && b.gaps.length > 0 && <p className="text-warning">{b.gaps.length} evidence gap{b.gaps.length === 1 ? '' : 's'} in the baseline.</p>}
            <p className="text-muted">Quality floor {req.quality_floor ?? '0.95 (default)'} · minimum cases {req.min_samples ?? '5 (default)'} · protected {req.require_protected_cases ? 'required' : 'not required'} · latency {req.require_latency ? 'required' : 'not required'}</p>
            <Field label="Measurable success criteria (one per line)">
              <textarea className={`${input} min-h-[88px]`} value={criteria} disabled={!canEdit} onChange={(e) => setCriteria(e.target.value)} placeholder={'At least 20% lower cost on the evaluated cases\nQuality at or above 0.95, no protected case failing'} />
            </Field>
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Experiments and verdicts" description={`Measured on evaluated cases: ${summary.measured.savedUsd === null ? 'none yet' : `${money(summary.measured.savedUsd, { digits: 6 })} across ${summary.measured.evaluatedCases} cases`}. Projected production impact: not modelled.`} action={<Button size="xs" variant="secondary" onClick={() => navigate('/app/evidence')}>Evidence</Button>} />
          {!rows.length ? (
            <div className="pcard-body"><Empty title="No experiments yet" description="Test a supported opportunity. Every verdict appears here, whatever it is." action={<Button size="sm" onClick={() => navigate('/app/opportunities')}>Go to opportunities</Button>} /></div>
          ) : (
            <div className="pcard-body overflow-x-auto p-0">
              <table className="ptable">
                <thead><tr><th>Evaluated</th><th>Candidate</th><th className="right">Cases</th><th>Quality</th><th>Verdict</th><th className="right">Measured saving</th></tr></thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id}>
                      <td>{dateTime(e.completed_at || e.created_at)}</td>
                      <td>{strategyFor(e)}</td>
                      <td className="right tnum">{e.sample_count}</td>
                      <td className="tnum">{score(e.baseline_quality)} → {score(e.candidate_quality)}</td>
                      <td><StatusChip status={e.status} /></td>
                      <td className={`right tnum ${countsAsMeasuredSaving(e) ? 'text-verified' : 'text-subtle'}`}>{countsAsMeasuredSaving(e) ? money(-(e.raw_cost_delta_usd as number), { digits: 6 }) : 'not savings'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Recommendation and next decision" description="Written by a person after reading the evidence. ZEVQORA never decides on its own." />
          <div className="pcard-body grid gap-3 lg:grid-cols-2">
            <Field label="Implementation recommendation"><textarea className={`${input} min-h-[110px]`} value={draft.recommendation || ''} disabled={!canEdit} onChange={(e) => set('recommendation', e.target.value)} placeholder="Which change, if any, should ship and why." /></Field>
            <Field label="Limitations (one per line)"><textarea className={`${input} min-h-[110px]`} value={limitations} disabled={!canEdit} onChange={(e) => setLimitations(e.target.value)} placeholder={'Evaluated on 40 cases from one week\nNo production projection was modelled'} /></Field>
            <div className="grid gap-3 sm:grid-cols-3 lg:col-span-2">
              <Field label="Next decision">
                <select className={input} value={draft.next_decision || 'undecided'} disabled={!canEdit} onChange={(e) => set('next_decision', e.target.value as EvaluationTrial['next_decision'])}>
                  {Object.entries(DECISION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Owner"><input className={input} value={draft.next_decision_owner || ''} disabled={!canEdit} onChange={(e) => set('next_decision_owner', e.target.value)} /></Field>
              <Field label="Due"><input className={input} type="date" value={draft.next_decision_due || ''} disabled={!canEdit} onChange={(e) => set('next_decision_due', e.target.value)} /></Field>
            </div>
          </div>
        </Card>
      </div>
    </ProductFrame>
  );
}
