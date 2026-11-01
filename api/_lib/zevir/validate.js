/**
 * Contract validation: JSON Schema 2020-12 (Ajv v8) for shape, plus the graph
 * invariants a schema cannot express — unique stable keys, edge endpoints
 * that exist, provenance for every node, and a hash that matches.
 *
 * The workspace invariants (every row in one workspace, no cross-tenant edge)
 * are enforced again by the database's composite foreign keys.
 */
import { createRequire } from 'node:module';
import Ajv2020Module from 'ajv/dist/2020.js';
import { graphHash } from './hash.js';

const Ajv2020 = Ajv2020Module.default || Ajv2020Module;
const require = createRequire(import.meta.url);
const SCHEMAS = {
  node: require('../../../schemas/zevir/v0.1/node.schema.json'),
  edge: require('../../../schemas/zevir/v0.1/edge.schema.json'),
  evidence: require('../../../schemas/zevir/v0.1/evidence-ref.schema.json'),
  graph: require('../../../schemas/zevir/v0.1/graph.schema.json'),
  envelope: require('../../../schemas/zevir/v0.1/ingest-envelope.schema.json'),
};

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
for (const schema of [SCHEMAS.node, SCHEMAS.edge, SCHEMAS.evidence]) ajv.addSchema(schema);
const compiled = {
  node: ajv.getSchema(SCHEMAS.node.$id),
  edge: ajv.getSchema(SCHEMAS.edge.$id),
  evidence: ajv.getSchema(SCHEMAS.evidence.$id),
  graph: ajv.compile(SCHEMAS.graph),
  envelope: ajv.compile(SCHEMAS.envelope),
};

export const schemas = SCHEMAS;

function describe(errors) {
  return (errors || []).slice(0, 10).map((e) => `${e.instancePath || '/'} ${e.message}${e.params?.allowedValues ? ` (${e.params.allowedValues.join(', ')})` : ''}`);
}

function check(name, value) {
  const fn = compiled[name];
  const ok = fn(value);
  return ok ? { ok: true, errors: [] } : { ok: false, errors: describe(fn.errors) };
}

export const validateNode = (node) => check('node', node);
export const validateEdge = (edge) => check('edge', edge);
export const validateEvidenceRef = (ref) => check('evidence', ref);
export const validateEnvelope = (envelope) => check('envelope', envelope);

/** Schema + graph invariants. Returns { ok, errors }. Does not enforce DAG semantics: loops and retries are valid. */
export function validateGraph(graph) {
  const shape = check('graph', graph);
  if (!shape.ok) return shape;
  const errors = [];
  const keys = new Set();
  for (const n of graph.nodes) {
    if (keys.has(n.stable_key)) errors.push(`duplicate stable_key ${n.stable_key}`);
    keys.add(n.stable_key);
  }
  const edgeKeys = new Set();
  for (const e of graph.edges) {
    if (!keys.has(e.source)) errors.push(`edge ${e.kind} source ${e.source} is not a node of this graph`);
    if (!keys.has(e.target)) errors.push(`edge ${e.kind} target ${e.target} is not a node of this graph`);
    const id = `${e.source}|${e.kind}|${e.target}`;
    if (edgeKeys.has(id)) errors.push(`duplicate edge ${e.kind} ${e.source} → ${e.target}`);
    edgeKeys.add(id);
  }
  const proven = new Set();
  for (const r of graph.evidence) {
    if (r.node !== null && !keys.has(r.node)) errors.push(`evidence points at unknown node ${r.node}`);
    if (r.node) proven.add(r.node);
  }
  for (const k of keys) if (!proven.has(k)) errors.push(`node ${k} has no evidence reference`);
  if (graph.root && !keys.has(graph.root)) errors.push('root is not a node of this graph');
  const gapCount = graph.completeness.gaps.length;
  if ((graph.status === 'complete') !== (gapCount === 0)) errors.push(`status ${graph.status} disagrees with ${gapCount} completeness gaps`);
  if (graphHash(graph) !== graph.graph_hash) errors.push('graph_hash does not match the graph');
  return { ok: errors.length === 0, errors: errors.slice(0, 20) };
}
