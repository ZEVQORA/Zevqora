import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Check, ArrowRight, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ZevqoraLogo } from '@/brand/ZevqoraLogo';
import { Zev } from '@/brand/Zev';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Checkbox } from '@/components/ui/Field';
import { InlineNotice } from '@/components/ui/States';
import { CopyButton, Code } from '@/components/ui/Misc';
import { useSession } from '@/lib/session';
import { app } from '../data';
import { errorMessage } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';

const STEPS = ['Welcome', 'Workspace', 'Project', 'Connect', 'Detect', 'Analyze', 'Review', 'Test', 'Verify'];

export default function OnboardingPage() {
  const { me, refreshMe, setActiveWorkspaceId, setActiveProjectId } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const [step, setStep] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [sourceKind, setSourceKind] = useState('runtime');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [captureSamples, setCaptureSamples] = useState(true);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Welcome — ZEVQORA';
  }, []);
  useEffect(() => {
    if (me?.workspaces.length && !workspaceId) {
      setWorkspaceId(me.workspaces[0].id);
      setWorkspaceName(me.workspaces[0].name);
    }
  }, [me, workspaceId]);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://zevqora.vercel.app';
  const snippet = useMemo(
    () => `curl -X POST ${origin}/api/telemetry/ingest \\
  -H "Authorization: Bearer ${token || 'zqt_…'}" \\
  -H "Content-Type: application/json" \\
  -d '{"events":[{"trace_id":"req_1","provider":"openai","model":"gpt-4o","operation":"classify.intent","status":"ok","input_tokens":812,"output_tokens":14,"latency_ms":1980}]}'`,
    [origin, token],
  );

  async function createWorkspace() {
    setPending(true);
    setError(null);
    try {
      const { workspace } = await app.createWorkspace(workspaceName.trim());
      setWorkspaceId(workspace.id);
      setActiveWorkspaceId(workspace.id);
      await refreshMe();
      setStep(2);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  async function createProject() {
    if (!workspaceId) return;
    setPending(true);
    setError(null);
    try {
      const { project } = await app.createProject(workspaceId, { name: projectName.trim(), source_kind: sourceKind });
      setProjectId(project.id);
      setActiveProjectId(project.id);
      setStep(3);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  async function createConnection() {
    if (!projectId) return;
    setPending(true);
    setError(null);
    try {
      const res = await app.createConnection(projectId, { kind: 'server_telemetry', name: `${projectName.trim() || 'Runtime'} telemetry`, capture_samples: captureSamples });
      setToken(res.token);
      setStep(4);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  const finish = async () => {
    await app.updateMe({ onboarding: { completed_at: new Date().toISOString(), plan_interest: params.get('plan') || null } }).catch(() => undefined);
    await refreshMe();
    toast({ tone: 'success', title: 'Welcome to ZEVQORA', description: 'Your workspace is ready.' });
    navigate('/app', { replace: true });
  };

  const canContinue = step === 1 ? workspaceName.trim().length >= 2 : step === 2 ? projectName.trim().length >= 2 : true;

  return (
    <main id="main" className="app-env min-h-dvh">
      <header className="container-page flex items-center justify-between py-6">
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

      <div className="container-page grid gap-12 py-8 lg:grid-cols-[1fr_auto] lg:py-16">
        <div className="max-w-[36rem]">
          {step === 0 && (
            <>
              <p className="text-eyebrow uppercase text-muted">Welcome to ZEVQORA</p>
              <h1 className="text-h1 mt-4 text-ink">Find the waste. Test the fix. Verify the savings.</h1>
              <p className="text-body mt-4 max-w-[46ch] text-muted">In the next few minutes you will create a workspace, add a project, connect a runtime, and run your first analysis. Nothing changes in your system; ZEVQORA only reads what you send it.</p>
            </>
          )}
          {step === 1 && (
            <>
              <h1 className="text-h1 text-ink">Create your workspace.</h1>
              <p className="text-body mt-4 max-w-[42ch] text-muted">A workspace holds your team, projects, evidence and usage. You can invite teammates later.</p>
              <div className="mt-8">
                <Field id="ws" label="Workspace name" hint="Usually your company or team.">
                  <Input id="ws" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} placeholder="Acme AI" autoFocus maxLength={80} />
                </Field>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <h1 className="text-h1 text-ink">Add your first project.</h1>
              <p className="text-body mt-4 max-w-[42ch] text-muted">A project is one AI product or service. Its telemetry, opportunities and experiments stay together.</p>
              <div className="mt-8 grid gap-4">
                <Field id="pn" label="Project name">
                  <Input id="pn" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="support-assistant" autoFocus maxLength={80} />
                </Field>
                <Field id="sk" label="Primary source">
                  <Select id="sk" value={sourceKind} onChange={(e) => setSourceKind(e.target.value)}>
                    <option value="runtime">Runtime API (server sends telemetry)</option>
                    <option value="server">Server telemetry agent</option>
                    <option value="repository">Repository (desktop engine)</option>
                    <option value="github">GitHub (coming soon)</option>
                  </Select>
                </Field>
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <h1 className="text-h1 text-ink">Connect a source.</h1>
              <p className="text-body mt-4 max-w-[44ch] text-muted">Create a scoped telemetry token for this project. It is shown once. It can only write telemetry, and you can revoke it at any time.</p>
              <div className="mt-8 rounded-lg border border-line bg-surface p-5">
                <p className="text-caption font-medium text-ink">What this connection reads</p>
                <ul className="text-technical mt-2 space-y-1 text-muted">
                  <li>· provider, model, operation, status</li>
                  <li>· token counts, latency, provider-reported cost</li>
                  <li>· a hash of the prompt for repeat detection</li>
                </ul>
                <p className="text-caption mt-4 font-medium text-ink">Never</p>
                <ul className="text-technical mt-2 space-y-1 text-muted">
                  <li>· source code, environment variables, credentials</li>
                  <li>· images, files or tool payloads</li>
                </ul>
                <div className="mt-5 border-t border-line pt-4">
                  <Checkbox id="cap" checked={captureSamples} onChange={(e) => setCaptureSamples(e.target.checked)} label="Capture sanitized request and response samples" description="Required to replay candidates on real requests. Secrets are redacted; non-text content is dropped." />
                </div>
              </div>
            </>
          )}
          {step === 4 && (
            <>
              <h1 className="text-h1 text-ink">Detect AI usage.</h1>
              <p className="text-body mt-4 max-w-[44ch] text-muted">Send your first events. Copy the token now; it will not be shown again.</p>
              {token && (
                <div className="mt-6 rounded-lg border border-accent/30 bg-accent-subtle p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-eyebrow uppercase text-accent-text">Connection token · shown once</p>
                    <CopyButton value={token} label="Copy token" size="xs" />
                  </div>
                  <code className="mt-2 block break-all font-mono text-technical text-ink">{token}</code>
                </div>
              )}
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-caption font-medium text-ink">Send an event</p>
                  <CopyButton value={snippet} label="Copy" size="xs" />
                </div>
                <Code block>{snippet}</Code>
                <p className="text-technical mt-2 text-subtle">
                  Full payload reference in <Link to="/app/docs" className="underline underline-offset-4">Docs</Link>. You can continue now and send events later.
                </p>
              </div>
            </>
          )}
          {step >= 5 && step <= 8 && (
            <>
              <h1 className="text-h1 text-ink">{['Run your first analysis.', 'Review an opportunity.', 'Let Zev test it.', 'See the verified result.'][step - 5]}</h1>
              <p className="text-body mt-4 max-w-[46ch] text-muted">
                {[
                  'Once telemetry arrives, Opportunities → Run analysis maps spend and diagnoses waste deterministically. No model calls, no credit consumed.',
                  'Each opportunity shows the issue, root cause, current model, candidate strategy, estimated savings, confidence, risk and how complete the evidence is.',
                  'Testing replays your captured samples on the candidate. Provider cost is charged to Zev credit exactly once per run.',
                  'A result is Verified only when every gate passes. If the quality floor is missed, ZEVQORA rejects the candidate and shows you why.',
                ][step - 5]}
              </p>
              <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                {[
                  ['Measure', 'Baseline from your telemetry'],
                  ['Replay', 'Same samples, candidate model'],
                  ['Verify', 'Named gates, all must pass'],
                  ['Review', 'Report with evidence attached'],
                ].map(([k, v], i) => (
                  <li key={k} className={cn('rounded-md border px-4 py-3', i <= step - 5 ? 'border-accent/30 bg-accent-subtle' : 'border-line bg-surface')}>
                    <p className="text-caption font-medium text-ink">{k}</p>
                    <p className="text-technical text-muted">{v}</p>
                  </li>
                ))}
              </ul>
            </>
          )}

          {error && <InlineNotice tone="danger" className="mt-6">{error}</InlineNotice>}

          <div className="mt-10 flex items-center gap-3">
            {step > 0 && step !== 4 && (
              <Button variant="secondary" onClick={() => setStep((s) => s - 1)} disabled={pending}>
                <ArrowLeft size={14} /> Back
              </Button>
            )}
            {step === 0 && <Button onClick={() => setStep(me?.workspaces.length ? 2 : 1)}>Get started <ArrowRight size={14} /></Button>}
            {step === 1 && <Button onClick={createWorkspace} loading={pending} disabled={!canContinue}>Create workspace</Button>}
            {step === 2 && <Button onClick={createProject} loading={pending} disabled={!canContinue}>Create project</Button>}
            {step === 3 && (
              <>
                <Button onClick={createConnection} loading={pending}>Create telemetry token</Button>
                <Button variant="ghost" onClick={() => setStep(5)}>Skip for now</Button>
              </>
            )}
            {step === 4 && <Button onClick={() => setStep(5)}>I saved the token <ArrowRight size={14} /></Button>}
            {step >= 5 && step < 8 && <Button onClick={() => setStep((s) => s + 1)}>Continue <ArrowRight size={14} /></Button>}
            {step === 8 && <Button onClick={finish}>Open my workspace <ArrowRight size={14} /></Button>}
          </div>
        </div>
        <div className="hidden items-end lg:flex">
          <Zev view={step >= 8 ? 'pose-waving' : step >= 5 ? 'pose-thinking' : 'three-quarter-front'} height={230} />
        </div>
      </div>
    </main>
  );
}
