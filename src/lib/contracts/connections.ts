import type { CapabilityAvailability } from './claims';
export type ConnectionLifecycle = 'not_configured' | 'authorizing' | 'connected_unverified' |
  'healthy' | 'partial' | 'expired' | 'suspended' | 'error' | 'revoked';
export type ConnectionMethod = 'oauth' | 'server_api_key' | 'otlp' | 'sdk' | 'upload';
export type IntegrationCategory = 'AI provider' | 'Tracing/observability' | 'LLM gateway' |
  'Agent framework' | 'RAG/retrieval' | 'Code/repository' | 'Custom/Enterprise';
export interface ConnectionCard {
  id: string;
  workspaceId: string;
  providerId: string;
  name: string;
  category: IntegrationCategory;
  connectionMethod: ConnectionMethod;
  lifecycle: ConnectionLifecycle;
  backendAvailability: CapabilityAvailability;
  scopes: string[];
  capturedFields: string[];
  excludedFields: string[];
  lastVerifiedAt: string | null;
  lastIngestAt: string | null;
  sampledTraces: number | null;
  coverage: { cost: number | null; tokens: number | null; latency: number | null; outcome: number | null };
  errorCode?: string | null;
  credentialHint?: string | null; // fingerprint/last 4 only — NEVER the secret
}
export interface IntegrationCatalogEntry {
  id: string;
  name: string;
  category: IntegrationCategory;
  method: ConnectionMethod;
  availability: CapabilityAvailability;
  detail: string;
  capturedFields: readonly string[];
  excludedFields: readonly string[];
  setupRoute?: string;
}
export interface IntegrationGateway {
  listCatalog(): Promise<IntegrationCatalogEntry[]>;
  listWorkspaceConnections(workspaceId: string): Promise<ConnectionCard[]>;
  testConnection(workspaceId: string, connectionId: string): Promise<ConnectionCard>;
}
export class IntegrationNotConnected extends Error {
  readonly code = 'INTEGRATION_NOT_CONNECTED';
  constructor() { super('Provider control plane is not connected to a verified server capability.'); }
}
