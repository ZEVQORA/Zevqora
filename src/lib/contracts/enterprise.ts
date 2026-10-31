import type { CapabilityAvailability } from './claims';
export type EnterpriseFeature = 'sso' | 'scim' | 'retention_controls' | 'audit_export' |
  'data_residency' | 'private_deployment' | 'billing_procurement' | 'approval_workflow';
export interface EnterpriseCapability {
  feature: EnterpriseFeature;
  availability: CapabilityAvailability;
  description: string;
  verifiedAt: string | null;
}
export interface EnterpriseRequest {
  request_id: string;
  workspace_id: string | null;
  contact_email: string;
  requested_features: EnterpriseFeature[];
  notes: string;
  created_at: string;
}
/** NOT_CONNECTED: no `/api/enterprise/requests` calls until server support is verified. */
export const ENTERPRISE_REQUEST_API_AVAILABLE = false;
