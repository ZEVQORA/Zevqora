import type { IntegrationCatalogEntry, IntegrationGateway } from '../contracts/connections';
import { IntegrationNotConnected } from '../contracts/connections';
/**
 * This is a factual setup CATALOG, not a list of customer connections.
 * Every availability is conservative; live capability/health must come from an
 * authorized backend before a status may become AVAILABLE or CONNECTED.
 * No OAuth, token or vendor API call is made from this client.
 */
export const SETUP_CATALOG: readonly IntegrationCatalogEntry[] = [
  { id: 'zevqora-telemetry', name: 'ZEVQORA scoped telemetry', category: 'Tracing/observability', method: 'sdk', availability: 'setup_required', detail: 'Scoped connection tokens and POST /api/telemetry/ingest are in the release code; setup and server health must be verified in your workspace.', capturedFields: ['request metadata', 'cost when known', 'timings when known'], excludedFields: ['secrets', 'unsolicited raw content'], setupRoute: '/app/docs' },
  { id: 'otel-genai', name: 'OpenTelemetry GenAI', category: 'Tracing/observability', method: 'otlp', availability: 'setup_required', detail: 'Use the bounded ZevIR ingest adapter; this is NOT native vendor OAuth.', capturedFields: ['allowlisted spans', 'operations', 'token counts when present'], excludedFields: ['raw prompt/output content', 'private headers'], setupRoute: '/app/docs' },
  { id: 'openinference', name: 'OpenInference', category: 'Agent framework', method: 'upload', availability: 'setup_required', detail: 'OpenInference mapping exists; export and authorization still require setup.', capturedFields: ['allowlisted spans', 'tool/retrieval metadata'], excludedFields: ['raw documents', 'tool arguments', 'secrets'], setupRoute: '/app/docs' },
  { id: 'trace-file', name: 'Sanitized trace import', category: 'Custom/Enterprise', method: 'upload', availability: 'setup_required', detail: 'Existing JSON/JSONL import; redact samples before uploading.', capturedFields: ['user-selected trace data'], excludedFields: ['only data the user removes before upload'], setupRoute: '/app/connections' },
  { id: 'repo-scan', name: 'Repository / desktop scan', category: 'Code/repository', method: 'sdk', availability: 'setup_required', detail: 'Existing local browser/desktop scanning; not a hosted GitHub OAuth connection.', capturedFields: ['call sites', 'scan findings'], excludedFields: ['source file contents unless separately authorized'], setupRoute: '/app/connections' },
  { id: 'openai-direct', name: 'OpenAI account connector', category: 'AI provider', method: 'oauth', availability: 'not_implemented', detail: 'Direct account OAuth is not present. Instrument applications or request an adapter.', capturedFields: [], excludedFields: ['all account data'] },
  { id: 'anthropic-direct', name: 'Anthropic account connector', category: 'AI provider', method: 'oauth', availability: 'not_implemented', detail: 'Direct provider OAuth is not present. Instrument applications or request an adapter.', capturedFields: [], excludedFields: ['all account data'] },
  { id: 'langsmith-direct', name: 'LangSmith native integration', category: 'Tracing/observability', method: 'oauth', availability: 'not_implemented', detail: 'Native connector unverified. Export OTel evidence when compatible.', capturedFields: [], excludedFields: ['all vendor data'] },
  { id: 'langfuse-direct', name: 'Langfuse native integration', category: 'Tracing/observability', method: 'oauth', availability: 'not_implemented', detail: 'Native connector unverified. Export OTel evidence when compatible.', capturedFields: [], excludedFields: ['all vendor data'] },
  { id: 'github-oauth', name: 'GitHub hosted integration', category: 'Code/repository', method: 'oauth', availability: 'not_implemented', detail: 'Local repository scanning is not equivalent to hosted GitHub installation authorization.', capturedFields: [], excludedFields: ['private repositories'] },
];

/** Safe by default: capability-less mode rejects both connection listings and mutations. */
export const disconnectedGateway: IntegrationGateway = {
  async listCatalog() { return [...SETUP_CATALOG]; },
  async listWorkspaceConnections() { throw new IntegrationNotConnected(); },
  async testConnection() { throw new IntegrationNotConnected(); },
};
