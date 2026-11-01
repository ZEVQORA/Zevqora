/**
 * ZevIR backfill: project existing engine evidence into ZevIR (shadow).
 *
 * Deterministic and idempotent — it runs the same projection as
 * POST /api/engine/products/:id/zevir/build, so re-running it writes nothing
 * when the evidence has not changed. engine_* tables are only read.
 *
 *   node scripts/zevir-backfill.mjs                       # dry run: counts only, writes nothing
 *   node scripts/zevir-backfill.mjs --apply               # write graphs for every product
 *   node scripts/zevir-backfill.mjs --apply --workspace <uuid> [--product <uuid>]
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
 * Does not consult the zevir_shadow flag: running it is the explicit decision.
 */
import { adminClient } from '../api/_lib/supabase.js';
import { ENGINE_TRACE_COLUMNS, engineTracesToGraphs } from '../api/_lib/zevir/adapters/engine.js';
import { projectEngineProduct } from '../api/_lib/zevir/store.js';
import { LIMITS } from '../api/_lib/zevir/contracts.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const apply = args.includes('--apply');
const workspace = flag('--workspace');
const only = flag('--product');

const admin = adminClient();
let q = admin.from('engine_products').select('id,workspace_id,project_id,name,archived_at').is('archived_at', null).order('created_at', { ascending: true });
if (workspace) q = q.eq('workspace_id', workspace);
if (only) q = q.eq('id', only);
const { data: products, error } = await q;
if (error) throw error;

let failures = 0;
for (const product of products || []) {
  try {
    if (!apply) {
      const { data: traces, error: tErr } = await admin.from('engine_traces').select(ENGINE_TRACE_COLUMNS).eq('product_id', product.id).limit(LIMITS.maxEngineTraces + 1);
      if (tErr) throw tErr;
      const { graphs, rejected } = engineTracesToGraphs(traces || [], { product });
      const incomplete = graphs.filter((g) => g.status === 'incomplete').length;
      console.log(`[dry-run] ${product.id} ${product.name}: ${traces.length} traces → ${graphs.length} graphs (${incomplete} incomplete), ${rejected.length} rejected`);
      continue;
    }
    const { run, reused } = await projectEngineProduct({ admin, product, userId: null, prune: true });
    console.log(`${product.id} ${product.name}: ${reused ? 'unchanged (reused run)' : run.status} ${JSON.stringify(run.result?.counts || {})} pruned=${run.result?.pruned ?? 0}`);
  } catch (err) {
    failures += 1;
    console.error(`${product.id} ${product.name}: FAILED ${err?.message || err}`);
  }
}
console.log(`${apply ? 'applied' : 'dry run'}: ${(products || []).length} products, ${failures} failed`);
process.exit(failures ? 1 : 0);
