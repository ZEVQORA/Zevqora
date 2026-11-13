import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Check, Copy, FileUp, FlaskConical, FolderGit2, GitBranch, Radio, Route as RouteIcon, Triangle } from 'lucide-react';
import { useSession } from '@/lib/session';
import { ApiClientError } from '@/lib/api';
import { app, type RuntimeSummary } from '@/app/data';
import type { Connection, Project } from '@/lib/types';
import { relativeTime } from '../format';
import './connect.css';

/**
 * "Connect your AI app": every method says what it can establish, what it
 * cannot, and its real state. A status is shown only when the server reports
 * it (a token it issued, events it received). Nothing here is marked CONNECTED
 * or VERIFIED from the client.
 */

export type ConnStatus = 'not_connected' | 'authorized' | 'data_flowing' | 'insufficient' | 'coming_soon' | 'not_available' | 'preview' | 'not_enabled' | 'sample';

const STATUS: Record<ConnStatus, { label: string; tone: 'neutral' | 'info' | 'ok' | 'warn' | 'off' }> = {
  not_connected: { label: 'Not connected', tone: 'neutral' },
  authorized: { label: 'Authorized · no data yet', tone: 'info' },
  data_flowing: { label: 'Data flowing', tone: 'ok' },
  insufficient: { label: 'Insufficient evidence', tone: 'warn' },
  coming_soon: { label: 'Coming soon', tone: 'off' },
  not_available: { label: 'Not available', tone: 'off' },
  preview: { label: 'Preview · enabled', tone: 'info' },
  not_enabled: { label: 'Preview · not enabled here', tone: 'off' },
  sample: { label: 'Sample data', tone: 'warn' },
};

export function StatusPill({ status }: { status: ConnStatus }) {
  const s = STATUS[status];
  return <span className={`zconn-pill is-${s.tone}`}>{s.label}</span>;
}

const LITELLM_PROJECT = 'LiteLLM gateway';

/** LiteLLM custom callback that sends usage metadata only (no prompts, outputs or headers). */
export function litellmSnippet(origin: string) {
  return `# zevqora_logger.py: sends usage metadata only. No prompts, outputs or headers.
import os, httpx
from litellm.integrations.custom_logger import CustomLogger

ZEVQORA_URL = "${origin}/api/telemetry/ingest"
ZEVQORA_TOKEN = os.environ["ZEVQORA_CONNECTION_TOKEN"]

class ZevqoraLogger(CustomLogger):
    async def _send(self, kwargs, start_time, end_time, status):
        p = kwargs.get("standard_logging_object") or {}
        event = {
            "occurred_at": end_time.isoformat(),
            "provider": p.get("custom_llm_provider"),
            "model": p.get("model"),
            "status": status,
            "input_tokens": p.get("prompt_tokens"),
            "output_tokens": p.get("completion_tokens"),
            "cost_usd": p.get("response_cost"),
            "latency_ms": (end_time - start_time).total_seconds() * 1000,
            "trace_id": p.get("id"),
        }
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(ZEVQORA_URL, json={"events": [event]},
                              headers={"authorization": f"Bearer {ZEVQORA_TOKEN}"})

    async def async_log_success_event(self, kwargs, response_obj, start_time, end_time):
        await self._send(kwargs, start_time, end_time, "ok")

    async def async_log_failure_event(self, kwargs, response_obj, start_time, end_time):
        await self._send(kwargs, start_time, end_time, "error")

zevqora_logger = ZevqoraLogger()

# config.yaml
# litellm_settings:
#   callbacks: zevqora_logger.zevqora_logger`;
}

type LiteState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; project: Project | null; connection: Connection | null; runtime: RuntimeSummary | null };

function useLiteLLM(workspaceId: string | null) {
  const [state, setState] = useState<LiteState>({ phase: 'loading' });
  const load = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const { projects } = await app.projects(workspaceId);
      const project = projects.find((p) => p.name === LITELLM_PROJECT && p.source_kind === 'runtime') || null;
      if (!project) return setState({ phase: 'ready', project: null, connection: null, runtime: null });
      const runtime = await app.runtime(project.id);
      const connection = runtime.connections.find((c) => c.kind === 'server_telemetry' && c.status === 'active') || null;
      setState({ phase: 'ready', project, connection, runtime });
    } catch (e) {
      setState({ phase: 'error', message: e instanceof Error ? e.message : 'Could not read connection state.' });
    }
  }, [workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  return { state, reload: load };
}

export function liteStatus(connection: Connection | null, runtime: RuntimeSummary | null): ConnStatus {
  if (!connection) return 'not_connected';
  if (connection.last_seen_at || (runtime?.totals.requests ?? 0) > 0) return 'data_flowing';
  return 'authorized';
}

function LiteLLMCard() {
  const { activeWorkspace } = useSession();
  const workspaceId = activeWorkspace?.id ?? null;
  const canEdit = activeWorkspace ? activeWorkspace.role !== 'viewer' : false;
  const { state, reload } = useLiteLLM(workspaceId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<'token' | 'code' | null>(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const connect = async () => {
    if (!workspaceId || state.phase !== 'ready') return;
    setBusy(true);
    setError(null);
    try {
      const project = state.project || (await app.createProject(workspaceId, { name: LITELLM_PROJECT, source_kind: 'runtime', description: 'Usage metadata from a LiteLLM gateway callback.' })).project;
      const res = await app.createConnection(project.id, { kind: 'server_telemetry', name: LITELLM_PROJECT, capture_samples: false });
      setToken(res.token);
      await reload();
    } catch (e) {
      setError(e instanceof ApiClientError && e.code === 'FEATURE_DISABLED' ? 'Runtime telemetry is paused on this deployment, so no token was issued.' : e instanceof Error ? e.message : 'Could not create the connection.');
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (c: Connection) => {
    setBusy(true);
    setError(null);
    try {
      await app.revokeConnection(c.id);
      setToken(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke the token.');
    } finally {
      setBusy(false);
    }
  };
  const copy = (what: 'token' | 'code', text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1500);
    });
  };

  const ready = state.phase === 'ready' ? state : null;
  const status = ready ? liteStatus(ready.connection, ready.runtime) : 'not_connected';

  return (
    <article className="zconn-card is-primary" aria-labelledby="zconn-litellm">
      <header className="zconn-card-head">
        <span className="zconn-icon"><RouteIcon size={18} aria-hidden /></span>
        <div className="min-w-0">
          <h3 id="zconn-litellm">LiteLLM gateway</h3>
          <p>Recommended if your app already calls models through LiteLLM.</p>
        </div>
        {state.phase === 'loading' ? <span className="zconn-pill is-neutral">Checking…</span> : <StatusPill status={status} />}
      </header>
      <dl className="zconn-matrix">
        <div><dt>Can show</dt><dd>Per-request model, provider, tokens, cost, latency and errors.</dd></div>
        <div><dt>Cannot show</dt><dd>Answer quality. Verifying a cheaper plan still needs recorded examples (trace import).</dd></div>
        <div><dt>Sent</dt><dd>Usage metadata only. Prompts, outputs and headers are not sent.</dd></div>
      </dl>
      {ready?.connection && (
        <p className="zconn-meta">
          Token {ready.connection.token_prefix}…{ready.connection.token_last4} · issued {relativeTime(ready.connection.created_at)}
          {ready.connection.last_seen_at ? ` · last event ${relativeTime(ready.connection.last_seen_at)}` : ' · no events received yet'}
          {ready.runtime && ready.runtime.totals.requests > 0 ? ` · ${ready.runtime.totals.requests.toLocaleString()} requests in 30 days` : ''}
        </p>
      )}
      {status === 'data_flowing' && (
        <p className="zconn-note"><StatusPill status="insufficient" /> Usage is arriving. Cost and latency can be measured; quality cannot be verified from metadata alone.</p>
      )}
      {state.phase === 'error' && <p className="zconn-error" role="alert">{state.message}</p>}
      {error && <p className="zconn-error" role="alert">{error}</p>}

      {token && (
        <div className="zconn-token" role="region" aria-label="New connection token">
          <p><b>Copy this token now.</b> It is shown once and never stored in readable form. Set it as <code>ZEVQORA_CONNECTION_TOKEN</code> on your LiteLLM server.</p>
          <div className="zconn-token-row">
            <code>{token}</code>
            <button type="button" onClick={() => copy('token', token)}>{copied === 'token' ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied === 'token' ? 'Copied' : 'Copy'}</button>
          </div>
        </div>
      )}
      {(token || ready?.connection) && (
        <details className="zconn-code" open={Boolean(token)}>
          <summary>LiteLLM callback (Python)</summary>
          <p>Add this file next to your LiteLLM config, reference it in <code>config.yaml</code> and restart the proxy. Check the field names against your LiteLLM version. The endpoint accepts 120 requests a minute per token; batch events (up to 500 per request) for busier gateways.</p>
          <div className="zconn-code-wrap">
            <pre><code>{litellmSnippet(origin)}</code></pre>
            <button type="button" onClick={() => copy('code', litellmSnippet(origin))}>{copied === 'code' ? 'Copied' : 'Copy code'}</button>
          </div>
        </details>
      )}

      <div className="zconn-actions">
        {!ready?.connection && (
          <button type="button" className="zconn-primary" onClick={() => void connect()} disabled={!canEdit || busy || state.phase !== 'ready'}>
            {busy ? 'Creating…' : 'Create a LiteLLM token'}
          </button>
        )}
        {ready?.connection && canEdit && (
          <button type="button" className="zconn-secondary" onClick={() => void revoke(ready.connection!)} disabled={busy}>Revoke token</button>
        )}
        {ready?.connection && <button type="button" className="zconn-secondary" onClick={() => void reload()} disabled={busy}>Check for data</button>}
        {!canEdit && <span className="zconn-hint">Viewers cannot create tokens. Ask a workspace member.</span>}
      </div>
    </article>
  );
}

function StaticCard({ id, icon, title, lead, can, cannot, status, children }: { id: string; icon: ReactNode; title: string; lead: string; can: string; cannot: string; status: ConnStatus; children?: ReactNode }) {
  return (
    <article className="zconn-card" aria-labelledby={`zconn-${id}`}>
      <header className="zconn-card-head">
        <span className="zconn-icon">{icon}</span>
        <div className="min-w-0">
          <h3 id={`zconn-${id}`}>{title}</h3>
          <p>{lead}</p>
        </div>
        <StatusPill status={status} />
      </header>
      <dl className="zconn-matrix">
        <div><dt>Can show</dt><dd>{can}</dd></div>
        <div><dt>Cannot show</dt><dd>{cannot}</dd></div>
      </dl>
      {children && <div className="zconn-actions">{children}</div>}
    </article>
  );
}

export default function ConnectChooser({ onImportTraces, onScanFolder }: { onImportTraces?: () => void; onScanFolder?: () => void }) {
  const { activeWorkspace } = useSession();
  const otelEnabled = Boolean(activeWorkspace?.features?.zevir_shadow);
  return (
    <section className="zconn" aria-labelledby="zconn-title">
      <div className="zconn-intro">
        <h2 id="zconn-title">Connect your AI app</h2>
        <p>Pick one source. Each option says what it can and cannot show. A status changes only after the server has issued a token or received data.</p>
        <ul className="zconn-legend" aria-label="What each status means">
          <li><StatusPill status="authorized" /> a token exists, nothing received yet</li>
          <li><StatusPill status="data_flowing" /> the server has received events</li>
          <li><StatusPill status="insufficient" /> enough to measure, not to verify quality</li>
        </ul>
      </div>

      <div className="zconn-grid">
        <LiteLLMCard />

        <StaticCard id="otel" icon={<Radio size={18} aria-hidden />} title="OpenTelemetry / OpenInference" lead="Send GenAI or OpenInference spans you already export." can="An execution graph: model and tool steps, token counts and timings when present." cannot="Raw prompt or output content (dropped by design), or quality on its own." status={otelEnabled ? 'preview' : 'not_enabled'}>
          {otelEnabled ? <Link to="/app/docs" className="zconn-secondary">Span format and endpoint</Link> : <span className="zconn-hint">This preview is enabled per workspace. Ask the ZEVQORA team to turn it on.</span>}
        </StaticCard>

        <StaticCard id="vercel" icon={<Triangle size={18} aria-hidden />} title="Vercel" lead="Project and deployment metadata from your Vercel account." can="Projects, deployments and their status, once the integration exists." cannot="AI cost, prompts or quality. A Vercel connection alone is not AI evidence." status="coming_soon">
          <span className="zconn-hint">Not available yet: the read-only Vercel integration has not been registered. Use LiteLLM or OpenTelemetry meanwhile.</span>
        </StaticCard>

        <StaticCard id="github" icon={<GitBranch size={18} aria-hidden />} title="GitHub" lead="Repository access through a GitHub App." can="Where your code calls models, once the app exists." cannot="Anything today: the hosted GitHub App is not built." status="not_available" />

        <StaticCard id="sample" icon={<FlaskConical size={18} aria-hidden />} title="Try a sample" lead="See how a decision looks before connecting anything." can="A labelled sample from an internal benchmark, explained step by step." cannot="Anything about your own app. It uses no credentials and spends nothing." status="sample">
          <Link to="/app?demo=1" className="zconn-secondary">Open the sample</Link>
        </StaticCard>
      </div>

      <div id="advanced" className="zconn-advanced" aria-labelledby="zconn-adv-title">
        <h3 id="zconn-adv-title">Advanced</h3>
        <p>For engineers who want to bring evidence by hand.</p>
        <div className="zconn-adv-row">
          <div>
            <b><FileUp size={15} aria-hidden /> Import traces (JSON / JSONL)</b>
            <span>Recorded requests and outputs; this is what replays and verification run on. Stored as exported, so redact first.</span>
          </div>
          {onImportTraces ? <button type="button" className="zconn-secondary" onClick={onImportTraces}>Import traces</button> : <Link to="/app/onboarding?advanced=1" className="zconn-secondary">Guided import</Link>}
        </div>
        <div className="zconn-adv-row">
          <div>
            <b><FolderGit2 size={15} aria-hidden /> Scan a local folder</b>
            <span>Finds model calls in your code on this machine. Only call locations and findings leave it; source files are not uploaded.</span>
          </div>
          {onScanFolder ? <button type="button" className="zconn-secondary" onClick={onScanFolder}>Scan a folder</button> : null}
        </div>
      </div>
    </section>
  );
}
