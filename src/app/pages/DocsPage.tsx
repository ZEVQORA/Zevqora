import { PageHeader, Panel, PanelHeader } from '@/components/ui/Panel';
import { Code, Table, Th, Td } from '@/components/ui/Misc';

const FIELDS: Array<[string, string, string]> = [
  ['trace_id', 'string', 'Your request id. Used for de-duplication together with span_id.'],
  ['span_id', 'string', 'Optional. Unique id of this model call within the trace.'],
  ['occurred_at', 'ISO 8601 or epoch', 'When the call happened. Defaults to receipt time.'],
  ['provider', 'string', 'openai, anthropic, google, openrouter, mistral, …'],
  ['model', 'string', 'Model name as your SDK reports it. Date suffixes are normalized.'],
  ['operation', 'string', 'Your unit of work, e.g. classify.intent. Drives the spend map.'],
  ['status', 'ok | error | timeout | cancelled', 'Defaults to ok.'],
  ['input_tokens / output_tokens', 'integer', 'Also accepted: prompt_tokens, completion_tokens, or a usage object.'],
  ['cached_input_tokens', 'integer', 'Optional.'],
  ['latency_ms', 'number', 'Wall time of the provider call.'],
  ['cost_usd', 'number', 'If omitted, ZEVQORA estimates from public list prices and labels it as an estimate.'],
  ['attempt', 'integer', 'Retry counter, 1-based. Enables retry-waste diagnosis.'],
  ['error_class', 'string', 'Short error category for failed calls.'],
  ['prompt_hash', 'sha256 hex', 'Optional. Computed from messages when omitted.'],
  ['sample', 'object', '{ messages: [{role, content}], output } — only stored if the connection has capture enabled; sanitized before storage.'],
  ['metadata', 'object', 'Scalar key/values only, 2 KB cap. Keys that look like secrets are dropped.'],
];

export default function DocsPage() {
  const origin = window.location.origin;
  return (
    <>
      <PageHeader eyebrow="Docs" title="Runtime telemetry" description="One HTTPS endpoint. Batch up to 500 events per request. Authenticate with the connection token from Connections." />
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel>
          <PanelHeader title="Endpoint" />
          <div className="flex flex-col gap-3 p-5">
            <Code block>{`POST ${origin}/api/telemetry/ingest
Authorization: Bearer zqt_<prefix>_<secret>
Content-Type: application/json

{ "events": [ { ...event }, { ...event } ] }`}</Code>
            <p className="text-technical text-muted">Responses: <code>202-style JSON</code> with accepted, duplicates, rejected and up to five per-event errors. Rate limit: 120 requests per minute per connection.</p>
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Node.js wrapper (OpenAI SDK)" description="Wrap the call; send metadata after it returns." />
          <div className="p-5">
            <Code block>{`import OpenAI from "openai";
const openai = new OpenAI();
const ZQ = { url: "${origin}/api/telemetry/ingest", token: process.env.ZEVQORA_TOKEN };

export async function chat(operation, params) {
  const t0 = Date.now();
  let res, status = "ok", error_class = null;
  try { res = await openai.chat.completions.create(params); }
  catch (e) { status = "error"; error_class = e?.constructor?.name; throw e; }
  finally {
    void fetch(ZQ.url, { method: "POST",
      headers: { authorization: "Bearer " + ZQ.token, "content-type": "application/json" },
      body: JSON.stringify({ events: [{
        trace_id: res?.id, occurred_at: new Date(t0).toISOString(),
        provider: "openai", model: params.model, operation, status, error_class,
        input_tokens: res?.usage?.prompt_tokens, output_tokens: res?.usage?.completion_tokens,
        latency_ms: Date.now() - t0,
        // Optional, only stored when capture is enabled on the connection:
        sample: { messages: params.messages, output: res?.choices?.[0]?.message?.content }
      }] }) }).catch(() => {});
  }
  return res;
}`}</Code>
          </div>
        </Panel>
      </div>
      <Panel className="mt-4 p-2">
        <PanelHeader title="Event fields" className="px-3" />
        <Table minWidth={720}>
          <thead><tr><Th>Field</Th><Th>Type</Th><Th>Notes</Th></tr></thead>
          <tbody>
            {FIELDS.map(([f, t, n]) => (
              <tr key={f}><Td mono>{f}</Td><Td mono>{t}</Td><Td className="text-muted">{n}</Td></tr>
            ))}
          </tbody>
        </Table>
      </Panel>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Python" />
          <div className="p-5">
            <Code block>{`import time, requests
ZQ_URL = "${origin}/api/telemetry/ingest"
ZQ_TOKEN = os.environ["ZEVQORA_TOKEN"]

def report(event):
    try:
        requests.post(ZQ_URL, json={"events": [event]},
            headers={"Authorization": f"Bearer {ZQ_TOKEN}"}, timeout=3)
    except Exception:
        pass  # telemetry must never break the request path

t0 = time.time()
resp = client.chat.completions.create(model="gpt-4o", messages=msgs)
report({"trace_id": resp.id, "provider": "openai", "model": "gpt-4o",
        "operation": "summarize.thread", "status": "ok",
        "input_tokens": resp.usage.prompt_tokens,
        "output_tokens": resp.usage.completion_tokens,
        "latency_ms": (time.time() - t0) * 1000})`}</Code>
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Semantics" />
          <ul className="text-caption space-y-3 p-5 text-muted">
            <li><span className="text-ink">De-duplication.</span> Events with the same span_id (or trace_id) for a project are stored once. Retries are safe.</li>
            <li><span className="text-ink">Cost source.</span> Provider-reported cost is kept as reported. Estimated cost is labelled <code>pricing_snapshot_estimate</code> and never mixed silently.</li>
            <li><span className="text-ink">Samples.</span> Only text roles survive. Images, files and tool payloads are dropped, known secret shapes are redacted, and size is capped. Toggle capture per connection at any time.</li>
            <li><span className="text-ink">Retention.</span> Events are purged after the plan window or your workspace setting, whichever is shorter.</li>
            <li><span className="text-ink">Revocation.</span> A revoked token is rejected immediately with 401.</li>
          </ul>
        </Panel>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Execution traces (JSONL)" description="What a replay needs in order to be a fair comparison." />
          <div className="flex flex-col gap-3 p-5">
            <Code block>{`{"request_id": "req-1",
 "model": "gpt-4o", "provider": "openai",
 "system_prompt": "Classify the ticket as billing, technical or account. Answer with one word.",
 "input_text": "My card was charged twice.",
 "output_text": "billing", "expected_output": "billing",
 "input_tokens": 48, "output_tokens": 1,
 "cost_usd": 0.0024, "latency_ms": 900}`}</Code>
            <p className="text-technical text-muted">One JSON object per line. <code>request_id</code> de-duplicates, so re-importing a longer file is safe.</p>
            <ul className="text-caption space-y-3 text-muted">
              <li><span className="text-ink">Export the prompt.</span> <code>system_prompt</code>, or the full <code>messages</code> array, records the request that produced <code>output_text</code>. A replay sends it back verbatim so the candidate answers the same question. Without it the candidate is asked a bare input with no instructions and will be graded down for the wrong reason.</li>
              <li><span className="text-ink">Give it something to grade.</span> <code>expected_output</code> is what the deterministic graders compare against. Without it there is nothing to verify and the run returns INCOMPLETE.</li>
              <li><span className="text-ink">Mark what must not regress.</span> <code>"protected": true</code> keeps a sample out of reuse and lets the protected-slice gate assert something.</li>
              <li><span className="text-ink">Costs stay honest.</span> <code>cost_usd</code> is treated as <code>imported_external</code>. Provider-reported cost from a replay is never mixed with it silently.</li>
            </ul>
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="One product, two runtimes" description="The same loop, the same screens, on the web and in the desktop app." />
          <ul className="text-caption space-y-3 p-5 text-muted">
            <li><span className="text-ink">Same loop everywhere.</span> Connect a repository → detect AI usage → import execution traces → let Zev test a candidate → quality gate → evidence → reviewed change. The screens are shared source, so the two runtimes cannot drift apart.</li>
            <li><span className="text-ink">In the browser.</span> You pick a folder and the scan runs on your machine. Only call sites, findings and counts are uploaded; source text is not. Replays run on ZEVQORA platform compute and are charged to your workspace credit.</li>
            <li><span className="text-ink">In the desktop app.</span> The same product, plus a local engine that reads the real folder and prepares changes in an isolated Git worktree it can push for you. Pushing from the browser is refused; you get the patch instead.</li>
            <li><span className="text-ink">Same account.</span> Workspace, plan and Zev credit follow you between the two.</li>
            <li><span className="text-ink">Never.</span> No auto-merge, no auto-deploy, no SSH. Admin stays web-only.</li>
          </ul>
        </Panel>
        <Panel>
          <PanelHeader title="Platform compute" description="How the desktop engine reaches a model provider without a key on your device." />
          <div className="flex flex-col gap-3 p-5">
            <Code block>{`POST ${origin}/api/platform/chat/completions
Authorization: Bearer <your ZEVQORA session>
X-Zevqora-Workspace: <workspace id>   (optional; bills the workspace owner)
X-Zevqora-Project:   <project id>     (optional; attributes usage)

OpenAI/OpenRouter-compatible body. stream is refused; usage is always accounted.`}</Code>
            <p className="text-technical text-muted">Order of checks: session → membership → plan and Zev credit → rate limit (per plan) → provider. The provider-reported cost is charged to the billing owner's credit, idempotently by provider request id, and appears under Usage as <code>platform_completion</code>. Public list prices for budgeting: <code>GET /api/platform/pricing</code>.</p>
          </div>
        </Panel>
      </div>
    </>
  );
}
