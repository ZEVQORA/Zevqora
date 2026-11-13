/**
 * Connections shows "Data flowing" from connections.last_seen_at, so the
 * ingest route may move it only when at least one event was stored. An
 * authenticated request whose events are all rejected updates last_used_at
 * only.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const updates: Array<Record<string, unknown>> = [];
const connection = { id: 'conn-1', workspace_id: 'ws-1', project_id: 'proj-1', kind: 'server_telemetry', status: 'active', scopes: ['telemetry:write'], metadata: {} };

function table(name: string) {
  const q: Record<string, unknown> = {};
  const self = () => q;
  Object.assign(q, {
    select: self,
    eq: self,
    maybeSingle: async () => {
      if (name === 'connection_secrets') return { data: { connection_id: connection.id }, error: null };
      if (name === 'connections') return { data: connection, error: null };
      return { data: null, error: null };
    },
    update: (row: Record<string, unknown>) => {
      if (name === 'connections') updates.push(row);
      return { eq: async () => ({ error: null }) };
    },
    upsert: (rows: unknown[]) => ({ select: async () => ({ data: rows.map((_, i) => ({ id: `e${i}` })), error: null }) }),
  });
  return q;
}

vi.mock('../api/_lib/supabase.js', () => ({ adminClient: () => ({ from: table }) }));
vi.mock('../api/_lib/tokens.js', () => ({ parseConnectionToken: () => ({ hash: 'h' }) }));
vi.mock('../api/_lib/auth.js', () => ({ rateLimit: () => undefined, rateLimitRequest: () => undefined, requireUser: vi.fn(), requireWorkspaceRole: vi.fn(), roleRank: () => 1 }));
vi.mock('../api/_lib/pricing.js', () => ({ loadPricing: async () => ({}), normalizeModel: (provider: string, model: string) => ({ provider: provider || 'openai', model, key: model }), estimateCost: () => null }));

let dispatch: (req: Request) => Promise<Response>;
beforeAll(async () => {
  ({ dispatch } = await import('../api/_lib/router.js'));
  await import('../api/_lib/handlers/telemetry.js');
});
beforeEach(() => {
  updates.length = 0;
});

const ingest = (events: unknown[]) =>
  dispatch(new Request('https://x.test/api/telemetry/ingest', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer zq_test' }, body: JSON.stringify({ events }) }));

describe('telemetry ingest: last_seen_at means data received', () => {
  it('moves last_seen_at when an event is stored', async () => {
    const res = await ingest([{ model: 'gpt-4o-mini', input_tokens: 10, output_tokens: 2 }]);
    expect(res.status).toBe(200);
    expect((await res.json()).accepted).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toHaveProperty('last_seen_at');
  });

  it('leaves last_seen_at alone when every event is rejected', async () => {
    const res = await ingest([{ input_tokens: 10 }]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ accepted: 0, rejected: 1 });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toHaveProperty('last_used_at');
    expect(updates[0]).not.toHaveProperty('last_seen_at');
  });
});
