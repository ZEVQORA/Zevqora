import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Check, ArrowRight, ArrowLeft, FolderGit2, FileUp, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ZevqoraLogo } from '@/brand/ZevqoraLogo';
import { Button } from '@/components/ui/Button';
import { Field, Input, Checkbox } from '@/components/ui/Field';
import { InlineNotice } from '@/components/ui/States';
import { useSession } from '@/lib/session';
import { app } from '../data';
import { errorMessage } from '@/lib/api';
import { cloudEngine, localEngine, engineErrorMessage } from '@/product/engine';
import { desktopBridge, isDesktop } from '@/product/bridge';
import { pickRepository, pickTraceFile } from '@/product/browserScan';
import { rememberSelectedProduct } from '@/product/store';
import { candidateFor, firstSupported } from '@/product/evidence';
import type { EvaluationRequirements, Finding, Product } from '@/product/types';

const STEPS = ['Workspace', 'Evidence', 'Boundary', 'Requirements', 'First analysis'];
type Source = 'repository' | 'workload';

interface FirstResult {
  product: Product;
  findings: Finding[];
  traceCount: number;
  callSites: number;
  elapsedMs: number;
}

function elapsed(msTotal: number) {
  const s = Math.max(1, Math.round(msTotal / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function OnboardingPage() {
  const { me, refreshMe, setActiveWorkspaceId, activeWorkspace } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const desktop = isDesktop();
  const startedAt = useRef(Date.now());

  const [step, setStep] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existing = useMemo(() => me?.workspaces || [], [me]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');

  const [source, setSource] = useState<Source>('repository');
  const [projectName, setProjectName] = useState('');
  const [authorized, setAuthorized] = useState(false);

  const [qualityFloor, setQualityFloor] = useState('0.95');
  const [minSamples, setMinSamples] = useState('10');
  const [requireProtected, setRequireProtected] = useState(false);
  const [requireLatency, setRequireLatency] = useState(true);

  const [result, setResult] = useState<FirstResult | null>(null);

  useEffect(() => {
    document.title = 'Get started — ZEVQORA';
  }, []);
  useEffect(() => {
    if (workspaceId || creatingWorkspace || !me) return;
    if (existing.length) setWorkspaceId(activeWorkspace?.id || existing[0].id);
    else setCreatingWorkspace(true);
  }, [me, existing, activeWorkspace, workspaceId, creatingWorkspace]);

  const requirements = useMemo<EvaluationRequirements>(() => ({
    quality_floor: Math.min(1, Math.max(0.5, Number(qualityFloor) || 0.95)),
    min_samples: Math.max(3, Math.floor(Number(minSamples) || 10)),
    require_protected_cases: requireProtected,
    require_latency: requireLatency,
  }), [qualityFloor, minSamples, requireProtected, requireLatency]);

  async function confirmWorkspace() {
    setPending(true);
    setError(null);
    try {
      if (creatingWorkspace) {
        const { workspace } = await app.createWorkspace(workspaceName.trim());
        setWorkspaceId(workspace.id);
        setActiveWorkspaceId(workspace.id);
        await refreshMe();
      } else if (workspaceId) {
        setActiveWorkspaceId(workspaceId);
      }
      void app.updateMe({ onboarding: { started_at: new Date(startedAt.current).toISOString() } }).catch(() => undefined);
      setStep(1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  /** Connect the chosen evidence source and run the first analysis. */
  async function connectAndAnalyze() {
    if (!workspaceId) return;
    setPending(true);
    setError(null);
    const engine = desktop ? localEngine() : cloudEngine(workspaceId);
    try {
      let product: Product;
      let traceCount = 0;
      let callSites = 0;
      if (source === 'repository') {
        if (desktop) {
          const path = await desktopBridge()?.selectFolder();
          if (!path) return;
          const scan = await engine.connect({ rootPath: path, name: projectName.trim() || undefined });
          product = scan.product;
          callSites = scan.ai_calls.length;
        } else {
          const repo = await pickRepository();
          if (!repo) return;
          const scan = await engine.connect({ rootPath: repo.rootPath, name: projectName.trim() || repo.name, upload: repo.upload, requirements });
          product = scan.product;
          callSites = scan.ai_calls.length;
        }
      } else {
        const file = await pickTraceFile();
        if (!file) return;
        product = await engine.createWorkload({ name: projectName.trim() || file.name.replace(/\.(jsonl?|txt)$/i, ''), requirements });
        const imported = await engine.importTraces(product.id, file.content);
        if (!imported.imported) throw new Error(imported.errors[0] ? `No traces imported: ${imported.errors[0]}` : 'No traces imported. Check the file format in Docs.');
      }
      // Persist the boundary the user just confirmed as the start of this project's evaluation record.
      if (!desktop) await engine.setTrial(product.id, { workload: product.name, status: 'active', data_boundary_note: source === 'workload' ? 'Imported traces, stored as exported. Redaction is the importer’s responsibility.' : 'Repository scanned locally; call locations and findings uploaded.' }, { confirmBoundary: true }).catch(() => undefined);
      const [findings, economics] = await Promise.all([engine.findings(product.id), engine.economics(product.id)]);
      traceCount = economics.trace_count;
      const elapsedMs = Date.now() - startedAt.current;
      rememberSelectedProduct(workspaceId, product.id);
      void app.updateMe({ onboarding: { started_at: new Date(startedAt.current).toISOString(), first_evidence_at: new Date().toISOString(), evidence_source: source, time_to_first_evidence_ms: elapsedMs } }).catch(() => undefined);
      setResult({ product, findings, traceCount, callSites, elapsedMs });
    } catch (e) {
      setError(engineErrorMessage(e));
    } finally {
      setPending(false);
    }
  }

  const finish = async () => {
    await app.updateMe({ onboarding: { completed_at: new Date().toISOString(), plan_interest: params.get('plan') || null, intent: params.get('intent') || null } }).catch(() => undefined);
    await refreshMe();
    navigate(result ? '/app' : '/app/connections', { replace: true });
  };

  const top = result ? firstSupported(result.findings, result.traceCount) : null;
  const canContinue =
    step === 0 ? (creatingWorkspace ? workspaceName.trim().length >= 2 : Boolean(workspaceId)) :
    step === 2 ? authorized :
    true;

  return (
    <main id="main" className="app-env min-h-dvh">
      <header className="container-page flex items-center justify-between gap-4 py-6">
        <Link to="/" aria-label="ZEVQORA home" className="rounded-sm">
          <ZevqoraLogo size={24} />
        </Link>
        <ol className="no-scrollbar flex items-center gap-2 overflow-x-auto" aria-label="Onboarding progress">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span className={cn('inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2 font-mono text-[10px] uppercase tracking-wide', i === step ? 'bg-ink text-cloud' : i < step ? 'bg-verified-bg text-verified' : 'bg-sunken text-subtle')} aria-current={i === step ? 'step' : undefined}>
                {i < step ? <Check size={10} strokeWidth={3} /> : String(i + 1).padStart(2, '0')} <span className="hidden sm:inline">{s}</span>
              </span>
              {i < STEPS.length - 1 && <span aria-hidden className="h-px w-3 bg-line" />}
            </li>
          ))}
        </ol>
      </header>

      <div className="container-page max-w-[42rem] py-8 lg:py-14">
        {step === 0 && (
          <>
            <p className="text-eyebrow uppercase text-muted">Step 1 · Workspace</p>
            <h1 className="text-h1 mt-4 text-ink">Where should this evaluation live?</h1>
            <p className="text-body mt-4 text-muted">A workspace holds your team, projects and evidence. The goal of the next few minutes is your first piece of evidence, not an account.</p>
            <div className="mt-8 grid gap-2">
              {existing.map((w) => (
                <button key={w.id} type="button" onClick={() => { setCreatingWorkspace(false); setWorkspaceId(w.id); }} className={cn('flex items-center justify-between rounded-md border px-4 py-3 text-left transition-control', !creatingWorkspace && workspaceId === w.id ? 'border-accent bg-accent-subtle' : 'border-line bg-surface hover:border-line-control')}>
                  <span className="text-caption font-medium text-ink">{w.name}</span>
                  <span className="text-technical font-mono uppercase text-subtle">{w.role}</span>
                </button>
              ))}
              {existing.length > 0 && !creatingWorkspace && (
                <button type="button" onClick={() => setCreatingWorkspace(true)} className="text-caption mt-1 w-fit text-muted underline underline-offset-4 hover:text-ink">Create a new workspace instead</button>
              )}
              {creatingWorkspace && (
                <Field id="ws" label="Workspace name" hint="Usually your company or team.">
                  <Input id="ws" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} placeholder="Acme AI" autoFocus maxLength={80} />
                </Field>
              )}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <p className="text-eyebrow uppercase text-muted">Step 2 · Evidence source</p>
            <h1 className="text-h1 mt-4 text-ink">What can ZEVQORA look at?</h1>
            <p className="text-body mt-4 text-muted">One authorized source is enough. You can add the other later.</p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {([
                ['repository', FolderGit2, 'A repository', 'Finds where your code calls models. Scanned on this machine; source is not uploaded.'],
                ['workload', FileUp, 'A workload’s traces', 'A JSON / JSONL export of recorded requests and outputs. This is what baselines and replays run on.'],
              ] as const).map(([key, Icon, title, body]) => (
                <button key={key} type="button" disabled={key === 'workload' && desktop} onClick={() => setSource(key)} className={cn('rounded-lg border p-4 text-left transition-control disabled:opacity-50', source === key ? 'border-accent bg-accent-subtle' : 'border-line bg-surface hover:border-line-control')}>
                  <Icon size={18} className="text-accent-text" aria-hidden />
                  <p className="text-caption mt-3 font-semibold text-ink">{title}</p>
                  <p className="text-technical mt-1 text-muted">{body}</p>
                  {key === 'workload' && desktop && <p className="text-technical mt-2 text-subtle">Available in the web app.</p>}
                </button>
              ))}
            </div>
            <div className="mt-6">
              <Field id="pn" label="Project name" hint={source === 'workload' ? 'Optional: defaults to the file name.' : 'Optional: defaults to the folder name.'}>
                <Input id="pn" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="support-assistant" maxLength={80} />
              </Field>
            </div>
            {source === 'workload' && (
              <p className="text-technical mt-4 text-subtle">
                Each line needs <code>request_id</code>, <code>model</code>, <code>input_text</code> or <code>messages</code>, and <code>output_text</code>. Add <code>expected_output</code> to grade, <code>cost_usd</code> and <code>latency_ms</code> to measure, <code>&quot;protected&quot;: true</code> for cases that must never regress. <Link to="/app/docs" className="underline underline-offset-4">Full format</Link>.
              </p>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <p className="text-eyebrow uppercase text-muted">Step 3 · Data boundary</p>
            <h1 className="text-h1 mt-4 text-ink">Confirm what leaves your machine.</h1>
            <div className="mt-8 rounded-lg border border-line bg-surface p-5">
              {source === 'repository' ? (
                <ul className="text-caption space-y-2 text-muted">
                  <li>· The folder is read {desktop ? 'by the desktop engine' : 'in this browser'}, read-only. Nothing in it is changed.</li>
                  <li>· Only AI call locations and findings are sent. Source files are not uploaded.</li>
                  <li>· Paths that look sensitive (secrets, keys, environment files, dependencies) are skipped.</li>
                  <li>· Later, preparing a change sends the one file being changed, and only when you ask.</li>
                </ul>
              ) : (
                <ul className="text-caption space-y-2 text-muted">
                  <li>· The traces you import are stored as they are, prompts and outputs included, so a replay can ask a candidate the same question.</li>
                  <li>· Redact anything that must not leave before you export. Representative or redacted cases are enough.</li>
                  <li>· Replays send the recorded prompt of each selected case to the candidate model through the ZEVQORA platform key.</li>
                  <li>· Only members of this workspace can read them, through the API.</li>
                </ul>
              )}
              <div className="mt-5 border-t border-line pt-4">
                <Checkbox id="auth" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} label="I am authorized to share this evidence, and I have removed what must not leave." />
              </div>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <p className="text-eyebrow uppercase text-muted">Step 4 · Evaluation requirements</p>
            <h1 className="text-h1 mt-4 text-ink">What must a cheaper change still do?</h1>
            <p className="text-body mt-4 text-muted">These become the floor for every experiment on this project. A single experiment can be stricter, never looser. Admins can change them later; past verdicts keep theirs.</p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <Field id="qf" label="Quality floor (0.5 – 1)" hint="Share of graded cases the candidate must get right.">
                <Input id="qf" type="number" min={0.5} max={1} step={0.01} value={qualityFloor} onChange={(e) => setQualityFloor(e.target.value)} />
              </Field>
              <Field id="ms" label="Minimum evaluated cases" hint="Fewer cases returns INCOMPLETE, not a verdict.">
                <Input id="ms" type="number" min={3} step={1} value={minSamples} onChange={(e) => setMinSamples(e.target.value)} />
              </Field>
            </div>
            <div className="mt-5 grid gap-3">
              <Checkbox id="rp" checked={requireProtected} onChange={(e) => setRequireProtected(e.target.checked)} label="Require protected cases" description="Every experiment must include cases marked protected, and all of them must pass." />
              <Checkbox id="rl" checked={requireLatency} onChange={(e) => setRequireLatency(e.target.checked)} label="Require latency evidence" description="Without latency on the cases, the verdict is INCOMPLETE rather than silently ignoring latency." />
            </div>
            {desktop && <InlineNotice tone="info" className="mt-5">On the desktop engine these are applied per experiment; the platform engine stores and enforces them.</InlineNotice>}
          </>
        )}

        {step === 4 && (
          <>
            <p className="text-eyebrow uppercase text-muted">Step 5 · First analysis</p>
            <h1 className="text-h1 mt-4 text-ink">{result ? `First evidence in ${elapsed(result.elapsedMs)}.` : source === 'repository' ? 'Pick the repository.' : 'Pick the trace file.'}</h1>
            {!result && (
              <p className="text-body mt-4 text-muted">{source === 'repository' ? 'Choose the folder you develop in. ZEVQORA scans it and lists where your product calls models.' : 'Choose a JSON or JSONL export. ZEVQORA imports it, builds the baseline and looks for supported opportunities.'}</p>
            )}
            {result && (
              <div className="mt-6 grid gap-4">
                <div className="rounded-lg border border-line bg-surface p-5">
                  <p className="text-caption font-semibold text-ink">{result.product.name}</p>
                  <p className="text-technical mt-1 text-muted">{result.callSites ? `${result.callSites} AI call sites · ` : ''}{result.traceCount} execution traces · {result.findings.length} signals</p>
                </div>
                {top ? (
                  <div className="rounded-lg border border-accent/30 bg-accent-subtle p-5">
                    <p className="text-eyebrow uppercase text-accent-text">First supported opportunity</p>
                    <p className="text-caption mt-2 font-semibold text-ink">{top.title}</p>
                    <p className="text-technical mt-1 text-muted">{top.root_cause}</p>
                    <p className="text-technical mt-3 text-ink">{candidateFor(top, result.traceCount).family} · {candidateFor(top, result.traceCount).executable ? 'ready to test on your traces' : candidateFor(top, result.traceCount).blocker}</p>
                    <p className="text-technical mt-1 text-subtle">This is a signal, not a saving. It becomes one only if a replay passes your requirements.</p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-line bg-surface p-5">
                    <p className="text-caption inline-flex items-center gap-2 font-semibold text-ink"><AlertTriangle size={14} className="text-warning" aria-hidden /> No supported opportunity found.</p>
                    <p className="text-technical mt-2 text-muted">
                      {result.findings.length
                        ? `The ${result.findings.length} signal${result.findings.length === 1 ? '' : 's'} found are not ones ZEVQORA can test yet (supported today: model substitution and exact reuse).`
                        : 'Nothing in this evidence points at a pattern ZEVQORA can test today.'}{' '}
                      {source === 'repository' ? 'Import execution traces for the busiest call site next: replays and baselines run on traces.' : 'Try a larger or more repetitive sample, or a workflow on an expensive model.'}
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {error && <InlineNotice tone="danger" className="mt-6">{error}</InlineNotice>}

        <div className="mt-10 flex flex-wrap items-center gap-3">
          {step > 0 && !result && (
            <Button variant="secondary" onClick={() => setStep((s) => s - 1)} disabled={pending}><ArrowLeft size={14} /> Back</Button>
          )}
          {step === 0 && <Button onClick={() => void confirmWorkspace()} loading={pending} disabled={!canContinue}>{creatingWorkspace ? 'Create workspace' : 'Continue'} <ArrowRight size={14} /></Button>}
          {(step === 1 || step === 2 || step === 3) && <Button onClick={() => setStep((s) => s + 1)} disabled={!canContinue}>Continue <ArrowRight size={14} /></Button>}
          {step === 4 && !result && <Button onClick={() => void connectAndAnalyze()} loading={pending}>{source === 'repository' ? <><FolderGit2 size={14} /> Choose folder</> : <><FileUp size={14} /> Choose trace file</>}</Button>}
          {step === 4 && result && <Button onClick={() => void finish()}>{top && candidateFor(top, result.traceCount).executable ? 'Open and test it' : 'Open the project'} <ArrowRight size={14} /></Button>}
          {step === 4 && !result && <Button variant="ghost" onClick={() => void finish()}>Skip for now</Button>}
        </div>
      </div>
    </main>
  );
}
