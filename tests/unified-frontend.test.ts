import { describe, expect, it } from 'vitest';
import { metricLabel, isVerifiableVerdict, type EvidenceMetric } from '../src/lib/contracts/claims';
import { SETUP_CATALOG, disconnectedGateway } from '../src/lib/clients/integrations';
import { PUBLIC_SUPPORT_MODE } from '../src/lib/contracts/support';
import { ENTERPRISE_REQUEST_API_AVAILABLE } from '../src/lib/contracts/enterprise';

const metric: EvidenceMetric = { value: null, unit: 'USD', claim: 'OBSERVED', sourceId: null,
  windowStart: null, windowEnd: null, sampleCount: null, coverage: null };

describe('unified frontend trust boundaries', () => {
  it('does not turn missing dollars into zero', () => {
    expect(metricLabel(metric)).toBe('Unknown');
    expect(metricLabel({ ...metric, value: 0 })).toBe('$0.00');
  });
  it('accepts evaluator verdicts only', () => {
    expect(isVerifiableVerdict('VERIFIED')).toBe(true);
    expect(isVerifiableVerdict('REJECTED')).toBe(true);
    expect(isVerifiableVerdict('INCOMPLETE')).toBe(true);
    expect(isVerifiableVerdict('DEPLOYED')).toBe(false);
  });
  it('never treats an unverified provider card as an active connection', () => {
    expect(SETUP_CATALOG.every((e) => e.availability !== 'available')).toBe(true);
    expect(SETUP_CATALOG.some((e) => e.id === 'otel-genai')).toBe(true);
    expect(SETUP_CATALOG.find((e) => e.id === 'openai-direct')?.availability).toBe('not_implemented');
  });
  it('does not silently switch to synthetic successful connection data', async () => {
    await expect(disconnectedGateway.listWorkspaceConnections('workspace-A')).rejects.toMatchObject({ code: 'INTEGRATION_NOT_CONNECTED' });
    await expect(disconnectedGateway.testConnection('workspace-A', 'secret-connection')).rejects.toMatchObject({ code: 'INTEGRATION_NOT_CONNECTED' });
  });
  it('public support and enterprise request APIs remain offline without backend', () => {
    expect(PUBLIC_SUPPORT_MODE).toBe('public_faq');
    expect(ENTERPRISE_REQUEST_API_AVAILABLE).toBe(false);
  });
});
