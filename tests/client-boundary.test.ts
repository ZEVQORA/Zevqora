import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Migration 012 grants the browser roles SELECT only, on a fixed list of
// tables. Browser code that writes through supabase-js, calls an RPC, or reads
// a table outside that list would fail at runtime with a permission error, so
// catch it here instead.

const ROOT = join(__dirname, '..');
const BROWSER_READABLE = new Set(['projects', 'opportunities', 'experiments', 'evaluation_cases', 'analysis_runs', 'connections', 'site_content', 'plans', 'model_pricing', 'profiles', 'subscriptions', 'credit_balances', 'admin_roles', 'workspaces', 'workspace_members', 'workspace_invites', 'telemetry_events', 'usage_events', 'credit_ledger',
  // 016: member-scoped SELECT on ZevIR graph rows (no raw content). The product UI still reads them through /api/zevir.
  'zevir_graphs', 'zevir_nodes', 'zevir_edges', 'zevir_evidence_refs']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

const files = sourceFiles(join(ROOT, 'src')).map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, 'utf8') }));

describe('browser data boundary', () => {
  it('never writes to Supabase tables from browser code', () => {
    const offenders = files.flatMap((f) => {
      const hits = [...f.text.matchAll(/\.from\(\s*['"`](\w+)['"`]\s*\)[\s\S]{0,40}?\.(insert|update|upsert|delete)\(/g)];
      return hits.map((m) => `${f.path}: ${m[1]}.${m[2]}()`);
    });
    expect(offenders).toEqual([]);
  });

  it('never calls database RPCs from browser code', () => {
    const offenders = files.filter((f) => /\.rpc\(/.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('reads only tables the browser role is granted', () => {
    const tables = new Set(files.flatMap((f) => [...f.text.matchAll(/\.from\(\s*['"`](\w+)['"`]\s*\)/g)].map((m) => m[1])));
    expect(tables.size).toBeGreaterThan(0);
    expect([...tables].filter((t) => !BROWSER_READABLE.has(t))).toEqual([]);
  });

  it('keeps the server-only tables out of browser code entirely', () => {
    const serverOnly = /\b(connection_secrets|desktop_auth_handoffs|admin_audit_log|feature_flags|zevir_ingest_runs|evaluation_contracts|optimization_runs|performance_snapshots|optimization_diagnoses|plan_searches|execution_plans|plan_calibrations|plan_decisions|bad_day_profiles|bad_day_results|site_events|product_events|security_events|evaluation_requests|site_content_revisions|engine_(?:products|ai_calls|findings|traces|plans|executions|evaluations|implementations))\b/;
    const offenders = files.filter((f) => new RegExp(`\\.from\\(\\s*['"\`]${serverOnly.source}`).test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
