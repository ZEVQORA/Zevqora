/**
 * The engine routes driven through the real router, with auth mocked and an
 * in-memory stand-in for the service-role Supabase client. Covers the
 * security-relevant rules end to end: the project floor, role checks, and a
 * data-boundary confirmation that only the server can stamp.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ApiError } from '../api/_lib/http.js';
import { planExactReuse } from '../api/_lib/product/strategies.js';
import { executePlan } from '../api/_lib/product/executor.js';

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
let role = 'member';
const USER = { id: 'user-1', email: 'fixture@example.invalid' };
const RANK: Record<string, number> = { viewer: 1, member: 2, admin: 3, owner: 4 };

/** Just enough of the supabase-js query builder for these routes. */
function from(table: string) {
  db[table] ||= [];
  const filters: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  let inserted: Row[] | null = null;
  const rows = () => db[table].filter((r) => filters.every((f) => f(r)));
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
    is: (k: string, v: unknown) => (filters.push((r) => (r[k] ?? null) === v), q),
    order: () => q,
    limit: () => q,
    insert: (value: Row | Row[]) => {
      inserted = (Array.isArray(value) ? value : [value]).map((r) => ({ id: randomUUID(), created_at: new Date().toISOString(), ...r }));
      db[table].push(...inserted);
      return q;
    },
    update: (value: Row) => ((patch = value), q),
    delete: () => q,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    single: async () => {
      if (inserted) return { data: inserted[0], error: null };
      if (patch) for (const r of rows()) Object.assign(r, patch);
      return { data: rows()[0] ?? null, error: null };
    },
    then: (resolve: (v: { data: Row[]; error: null; count: number }) => unknown) => {
      if (patch) for (const r of rows()) Object.assign(r, patch);
      return Promise.resolve(resolve({ data: rows(), error: null, count: rows().length }));
    },
  };
  return q;
}
const admin = { from };

vi.mock('../api/_lib/auth.js', () => ({
  requireUser: async () => ({ user: USER, admin }),
  requireWorkspaceRole: async (_a: unknown, _ws: string, _uid: string, min = 'viewer') => {
    if (RANK[role] < RANK[min]) throw new ApiError(403, `Requires ${min}.`, 'FORBIDDEN');
    return role;
  },
  rateLimit: () => undefined,
  rateLimitRequest: () => undefined,
  roleRank: (r: string) => RANK[r] || 0,
}));

let dispatch: (req: Request) => Promise<Response>;
beforeAll(async () => {
  ({ dispatch } = await import('../api/_lib/router.js'));
  await import('../api/_lib/handlers/engine.js');
});

const WS = randomUUID();
let productId: string;
let executionId: string;

beforeEach(async () => {
  for (const k of Object.keys(db)) delete db[k];
  role = 'member';
  productId = randomUUID();
  db.engine_products = [{ id: productId, workspace_id: WS, name: 'support', root_path: 'workload://support', source: 'browser', archived_at: null, evaluation_requirements: { quality_floor: 0.95, min_samples: 10 }, evaluation_trial: null }];
  const inputs = ['a', 'b', 'c'];
  db.engine_traces = [0, 1, 2, 3, 4, 5].map((i) => ({ id: `t${i}`, product_id: productId, workspace_id: WS, request_id: `r${i}`, symbol: 'classify', workflow: 'support', provider: 'openai', model: 'openai/gpt-4o', input_text: `msg ${inputs[i % 3]}`, output_text: ['billing', 'technical', 'account'][i % 3], expected_output: ['billing', 'technical', 'account'][i % 3], input_tokens: 40, output_tokens: 2, latency_ms: 600, cost_usd: 0.003, cost_source: 'imported_external', metadata: {}, protected: false, timestamp: `2026-09-0${i + 1}T00:00:00Z` }));
  const plan = { ...planExactReuse(db.engine_traces as never, { id: 'f1', symbol: 'classify' }), id: randomUUID(), product_id: productId };
  db.engine_plans = [plan];
  const execution = await executePlan({ plan, traces: db.engine_traces as never, complete: async () => { throw new Error('no provider'); }, pricing: new Map(), allowedModels: new Set() });
  executionId = randomUUID();
  db.engine_executions = [{ ...execution, id: executionId, candidate_plan_id: plan.id, product_id: productId }];
  db.engine_evaluations = [];
  db.engine_findings = [];
});

const post = (path: string, body: unknown) => dispatch(new Request(`https://x.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

describe('POST /evaluations', () => {
  it('holds the experiment to the project floor even when the request lowers it', async () => {
    const res = await post(`/api/engine/products/${productId}/evaluations`, { candidate_execution_id: executionId, gate_config: { min_samples: 1, quality_floor: 0.1, require_fallback: false, latency_informational: true, require_latency: false } });
    expect(res.status).toBe(200);
    const evaluation = await res.json();
    expect(evaluation.status).toBe('INCOMPLETE');
    expect(evaluation.gates.find((g: { name: string }) => g.name === 'minimum_samples').threshold).toBe(10);
    expect(evaluation.gates.find((g: { name: string }) => g.name === 'quality_floor').threshold).toBe(0.95);
  });

  it('refuses a viewer', async () => {
    role = 'viewer';
    const res = await post(`/api/engine/products/${productId}/evaluations`, { candidate_execution_id: executionId });
    expect(res.status).toBe(403);
    expect(db.engine_evaluations).toHaveLength(0);
  });
});

describe('POST /requirements', () => {
  it('only admins change the floor', async () => {
    const denied = await post(`/api/engine/products/${productId}/requirements`, { evaluation_requirements: { quality_floor: 0.6 } });
    expect(denied.status).toBe(403);
    expect((db.engine_products[0].evaluation_requirements as Row).quality_floor).toBe(0.95);
    role = 'admin';
    const ok = await post(`/api/engine/products/${productId}/requirements`, { evaluation_requirements: { quality_floor: 0.97, min_samples: 20 } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).evaluation_requirements).toMatchObject({ quality_floor: 0.97, min_samples: 20, frozen_by: USER.id });
  });

  it('rejects an out-of-range floor', async () => {
    role = 'admin';
    const res = await post(`/api/engine/products/${productId}/requirements`, { evaluation_requirements: { quality_floor: 0.2 } });
    expect(res.status).toBe(422);
  });
});

describe('POST /trial', () => {
  it('ignores a client-sent boundary confirmation and stamps its own', async () => {
    const forged = await post(`/api/engine/products/${productId}/trial`, { trial: { customer: 'Acme', data_boundary_confirmed: { at: '2020-01-01', by: 'someone-else' } } });
    expect(forged.status).toBe(200);
    expect((await forged.json()).evaluation_trial.data_boundary_confirmed).toBeUndefined();
    const confirmed = await post(`/api/engine/products/${productId}/trial`, { trial: {}, confirm_data_boundary: true });
    const body = await confirmed.json();
    expect(body.evaluation_trial.data_boundary_confirmed.by).toBe(USER.id);
    expect(body.evaluation_trial.customer).toBe('Acme');
  });

  it('refuses a viewer', async () => {
    role = 'viewer';
    const res = await post(`/api/engine/products/${productId}/trial`, { trial: { customer: 'Acme' } });
    expect(res.status).toBe(403);
  });
});

describe('GET /economics', () => {
  it('returns baseline provenance with its gaps', async () => {
    db.engine_traces[0].cost_usd = null;
    const res = await dispatch(new Request(`https://x.test/api/engine/products/${productId}/economics`));
    const e = await res.json();
    expect(e.baseline.cost).toMatchObject({ known: 5, unknown: 1, complete: false });
    expect(e.baseline.gaps.some((g: string) => g.startsWith('cost_unknown'))).toBe(true);
  });
});
