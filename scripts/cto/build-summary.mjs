/**
 * Builds the sanitized, machine-readable release-gate summary that is committed
 * under docs/handoff/, from a run-gates.mjs output directory.
 *
 *   node scripts/cto/build-summary.mjs --run <dir> --out <file> [--baseline <dir>] [--artifact <repo path of the proof-loop copy>]
 *
 * The summary names the exact commit the gates ran on (`tested_commit`). A later
 * commit that only adds this evidence cannot carry its own SHA; verify with
 * `git diff --stat <tested_commit> HEAD` that nothing outside docs/handoff changed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const runDir = arg('--run');
const outFile = arg('--out');
if (!runDir || !outFile) {
  console.error('usage: build-summary.mjs --run <dir> --out <file> [--baseline <dir>] [--artifact <path>]');
  process.exit(2);
}
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const sha256 = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const strip = (s) => ({ id: s.id, command: s.command, cwd: s.cwd, started_at: s.started_at, duration_ms: s.duration_ms, exit_code: s.exit_code, status: s.status, counts: s.counts ? Object.fromEntries(Object.entries(s.counts).filter(([k]) => k !== 'raw')) : null, counts_line: s.counts?.raw ?? null, note: s.note, log: s.log });

const run = readJson(path.join(runDir, 'summary.json'));
const proofPath = path.join(runDir, 'proof-loop.json');
const proof = fs.existsSync(proofPath) ? readJson(proofPath) : null;
const baselineDir = arg('--baseline');
const baseline = baselineDir ? readJson(path.join(baselineDir, 'summary.json')) : null;

const out = {
  schema: 'zevqora.cto-release-gates-summary.v2',
  sanitized: 'no secret values, keys, tokens or customer data; local user paths removed',
  tested_commit: run.git.sha,
  tested_branch: run.git.branch,
  tested_tree_dirty: run.git.dirty,
  generated_at: run.generated_at,
  host: run.host,
  run_summary_sha256: sha256(path.join(runDir, 'summary.json')),
  result: { steps: run.steps.length, pass: run.steps.filter((s) => s.status === 'PASS').length, blocked: run.steps.filter((s) => s.status === 'BLOCKED').map((s) => s.id), not_passing: run.steps.filter((s) => !['PASS', 'BLOCKED'].includes(s.status)).map((s) => s.id) },
  steps: run.steps.map(strip),
  gate_status: {
    staging_e2e: 'BLOCKED — npm run test:staging not executed against any target (no isolated deployment; staging credentials and write approval not provided)',
    live_customer_proof: 'BLOCKED — no authorized real workload; proof loop is FIXTURE PROOF on a synthetic workload only',
  },
  proof_loop: proof && { label: proof.label, git_sha: proof.source.git_sha, artifact: arg('--artifact'), artifact_sha256: sha256(proofPath), invariant_sha256: proof.reproducibility.invariant_sha256, verdicts_run_1: proof.record_run_1.verify.counts, verdicts_run_2: proof.verify_run_2.counts, incomplete_candidate_replay: proof.record_run_1.incomplete.candidate_replay?.status ?? null },
  baseline_run: baseline && { tested_commit: baseline.git.sha, note: 'unmodified main plus the then-uncommitted runner script', generated_at: baseline.generated_at, steps: baseline.steps.map(strip) },
};
const text = JSON.stringify(out, null, 2).replace(/C:\\\\Users\\\\[^\\\\"]+/g, 'C:\\\\Users\\\\<user>');
fs.writeFileSync(outFile, text + '\n');
console.log(`written ${outFile} (tested_commit ${out.tested_commit}, ${out.result.pass}/${out.result.steps} PASS, blocked: ${out.result.blocked.join(', ') || 'none'})`);
