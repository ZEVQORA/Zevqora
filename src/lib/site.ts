import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';
import { getSupabase } from './supabase';
import type { Plan, SiteContent } from './types';

/**
 * Fallbacks for every editable section. Published site_content rows override
 * them key by key, so the site renders without a network and a missing or
 * partial CMS row can never blank a page.
 */
export const DEFAULT_CONTENT: Required<SiteContent> = {
  hero: {
    announcement: null,
    announcement_href: null,
    headline: 'Make AI cheaper without guessing.',
    subheadline: 'ZEVQORA understands how your AI system executes, finds expensive or unreliable paths, and proves which changes are worth shipping.',
    supporting: 'Connect the execution evidence you already have. ZEVQORA builds an execution graph, diagnoses where cost and latency go, generates better execution plans, replays them on your real workload and rejects anything that breaks quality.',
    primary_cta: { label: 'Evaluate your AI workload', href: '/evaluation' },
    secondary_cta: { label: 'Explore the product', href: '/product' },
    trust_line: 'Measure. Replay. Verify. Then optimize.',
  },
  proof: {
    kind: 'Internal dogfooding benchmark',
    cases: 50,
    rejected: { cost_reduction: '42.01%', quality: '0.87', quality_floor: '0.95', reason: 'quality_floor' },
    verified: { cost_reduction: '12.32%', quality: '0.97', quality_floor: '0.95', ci95: '[-11.01%, 34.64%]' },
    qualifier: 'Internal 50-case dogfooding benchmark. Not customer evidence. The verified figure is a point estimate whose 95% confidence interval crosses zero.',
  },
  status: { banner: null, public_status: 'operational' },
  contact: { email: 'zevqora.ai@gmail.com' },
  home: {
    problem_title: 'AI cost is easy to cut. Product quality is easy to break.',
    problem_body: 'Spend grows with every agent step, retry and longer prompt. Observability tools show you the symptoms; they do not tell you which change is safe. ZEVQORA does the part that is hard: proving it.',
    loop_title: 'One loop from evidence to a decision.',
    loop_body: 'Every step is real product behaviour you can open and inspect. Nothing is recommended until it has been replayed on the workload it is meant to change.',
    audiences: [
      { title: 'CEO / Founder', body: 'See what AI costs per successful outcome, what has been proven to improve it, and what to approve next — with evaluated, projected and realized value never mixed.' },
      { title: 'CTO / Head of AI', body: 'Understand latency, reliability and provider concentration across workloads, and why a plan was chosen over its alternatives — with the frozen contract it passed.' },
      { title: 'Developer', body: 'Follow the execution graph from a diagnosis to the affected nodes, the source spans, the plan that changes them and the replay cases that judged it.' },
    ],
    integration_note: 'Supported today: OpenTelemetry GenAI spans, OpenInference spans, ZEVQORA trace files and repository scans. Other connectors are not claimed until they work.',
    cta_title: 'See what your AI workload could improve.',
    cta_body: 'Send us a short description of one AI workflow. We reply with what an evaluation would measure, what evidence it needs and how long it takes.',
  },
  product: {
    title: 'The product',
    intro: 'ZEVQORA is an autonomous AI systems engineer for AI products: it observes how your system executes, diagnoses waste, generates and tests better execution plans, and tells you which one is worth shipping — with the evidence.',
    features: [
      { title: 'Command Center', body: 'One surface for spend, cost per successful outcome, p95 latency, task success and the optimization pipeline — in CEO, CTO and Developer views of the same evidence.' },
      { title: 'Execution graph (ZevIR)', body: 'Every task, agent step, model call, tool call and retrieval as one graph, with cost, latency, retries and provenance on each node.' },
      { title: 'Diagnoses', body: 'Deterministic findings — redundant calls, retry amplification, context bloat, over-provisioned models, agent loops, duplicate retrieval — each with the evidence and what would prove it wrong.' },
      { title: 'Plan search', body: 'Compatible changes composed into execution plans, impossible and conflicting ones pruned, promising ones calibrated on a small sample, the best replayed in full.' },
      { title: 'Verified verdicts', body: 'VERIFIED, REJECTED or INCOMPLETE under a frozen Evaluation Contract. Cheaper but worse is REJECTED. Missing evidence is INCOMPLETE, never a pass.' },
      { title: 'Pareto frontier and decisions', body: 'Only VERIFIED plans compete. A stated policy — margin, latency, reliability, balanced — picks from the frontier and says why.' },
    ],
  },
  security_page: {
    title: 'Security and data boundaries',
    intro: 'ZEVQORA works on metadata first, keeps every claim traceable to its evidence, isolates every workspace on the server, and never changes production on its own.',
    points: [
      { title: 'Metadata-first evidence', body: 'Execution graphs (ZevIR) keep hashes, sizes and timings of inputs and outputs — never the content; raw content capture is refused. Replays need the recorded prompt, so an imported trace file keeps what you export: redact before import. Only the server API reads it.' },
      { title: 'Evidence provenance', body: 'Every node, diagnosis and verdict points back to the source span, trace or record it came from, with its hash and adapter version.' },
      { title: 'Tenant isolation', body: 'Every table is scoped to a workspace and checked on the server. Requests for another workspace get a plain 404, and the attempt is recorded as a security event.' },
      { title: 'Human approval', body: 'ZEVQORA prepares evidence and reviewable changes. A person decides what ships. There is no automatic merge, deployment or rollback.' },
      { title: 'No blind production changes', body: 'Replays run on recorded evidence. Simulated scenarios such as Bad-Day Replay are labelled as simulations, not production guarantees.' },
      { title: 'Audited administration', body: 'Every administrative change — content, feature flags, roles, credits — is written to an append-only audit log, and reading security events is itself audited.' },
    ],
  },
  evaluation_page: {
    title: 'Evaluate your AI workload',
    intro: 'Tell us about one AI workflow. We will tell you what ZEVQORA can measure, what evidence it needs, and whether an evaluation is likely to find anything worth proving.',
    what_you_get: ['A baseline: cost per successful outcome, p50/p95 latency, task success and reliability, from your own evidence', 'Diagnoses with the exact evidence behind each one', 'Candidate execution plans replayed under a contract you freeze first', 'VERIFIED, REJECTED or INCOMPLETE — with the reasons', 'An executive and a developer report you can keep'],
    response_note: 'A person reads every request. We reply by email; nothing is sent automatically.',
  },
  company_page: {
    title: 'Company',
    intro: 'ZEVQORA builds the engineer that tells AI teams which optimization is worth shipping — and proves it.',
    mission: 'Make AI lighter: cheaper, faster and more reliable, without trading away the quality users depend on.',
    principles: [
      { title: 'Evidence over estimates', body: 'An estimate decides what to test. Only a verified replay decides what to recommend.' },
      { title: 'Unknown is not zero', body: 'Missing cost, timing or outcomes stay unknown in every number we show.' },
      { title: 'Rejecting is a result', body: 'A cheaper change that breaks quality is rejected and explained. That is the product working.' },
      { title: 'People decide', body: 'ZEVQORA prepares the decision. It does not ship changes on its own.' },
    ],
  },
  footer: {
    tagline: 'Make AI lighter. Verified AI optimization for AI products.',
    note: 'Figures on this site are internal benchmarks or labelled synthetic illustrations, never customer results.',
  },
};

let contentCache: SiteContent | null = null;
let plansCache: Plan[] | null = null;

/** Admin preview: render the real pages with a draft value for one section. Never fetched by the public site. */
const OverrideContext = createContext<Partial<SiteContent> | null>(null);
export function SiteContentOverride({ value, children }: { value: Partial<SiteContent>; children: ReactNode }) {
  return createElement(OverrideContext.Provider, { value }, children);
}

/** True inside an admin preview: pages must not change document metadata or submit real forms. */
export function useIsPreview() {
  return useContext(OverrideContext) !== null;
}

function merge(base: Required<SiteContent>, rows: SiteContent | null, override: Partial<SiteContent> | null): Required<SiteContent> {
  const out = { ...base } as Record<string, unknown>;
  for (const source of [rows, override]) {
    if (!source) continue;
    for (const [k, v] of Object.entries(source)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = { ...(base as Record<string, Record<string, unknown>>)[k], ...(v as Record<string, unknown>) };
    }
  }
  return out as Required<SiteContent>;
}

export function useSiteContent() {
  const override = useContext(OverrideContext);
  const [rows, setRows] = useState<SiteContent | null>(contentCache);
  useEffect(() => {
    let active = true;
    if (contentCache) return;
    getSupabase().then(async (sb) => {
      if (!sb) return;
      const { data } = await sb.from('site_content').select('key,value');
      if (!active || !data) return;
      const next: SiteContent = {};
      for (const row of data as Array<{ key: string; value: unknown }>) (next as Record<string, unknown>)[row.key] = row.value;
      contentCache = next;
      setRows(next);
    });
    return () => {
      active = false;
    };
  }, []);
  return merge(DEFAULT_CONTENT, rows, override);
}

export function usePlans() {
  const [plans, setPlans] = useState<Plan[] | null>(plansCache);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (plansCache) return;
    getSupabase().then(async (sb) => {
      if (!sb) {
        if (active) setError('Pricing is temporarily unavailable.');
        return;
      }
      const { data, error: err } = await sb.from('plans').select('*').order('sort_order');
      if (!active) return;
      if (err || !data) {
        setError('Pricing is temporarily unavailable.');
        return;
      }
      plansCache = data as Plan[];
      setPlans(plansCache);
    });
    return () => {
      active = false;
    };
  }, []);
  return { plans, error };
}

export function invalidateSiteCaches() {
  contentCache = null;
  plansCache = null;
}

export function planPrice(plan: Plan, annual: boolean) {
  const monthly = plan.monthly_price_cents / 100;
  if (!annual) return monthly;
  return Math.round(monthly * (1 - plan.annual_discount_pct / 100) * 100) / 100;
}

/** Only same-origin absolute paths are accepted as a redirect target. */
export function safeNext(next: string | null | undefined, fallback = '/app') {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  return next;
}
