/**
 * Public knowledge for the homepage Ask Zev composer.
 *
 * Everything here is already published on the public website. It holds no
 * tenant, account, billing, trace or workspace data, and the support route
 * gives the model no tools: this list is the whole of what the assistant
 * knows. Keep each answer short, factual and free of invented customers,
 * savings or metrics.
 */

export const CONTACT_EMAIL_FALLBACK = 'zevqora.ai@gmail.com';

/** @typedef {{ id: string, question: string, keywords: string[], answer: string, links: { label: string, href: string }[] }} Entry */

/** @type {Entry[]} */
export const KNOWLEDGE = [
  {
    id: 'what',
    question: 'What does ZEVQORA do?',
    keywords: ['what', 'zevqora', 'does', 'product', 'explain', 'overview', 'optimiz', 'lighter', 'purpose'],
    answer:
      'ZEVQORA is an evidence-first AI optimization engineer. It observes how your AI system executes, builds an execution graph, finds expensive or unreliable paths, proposes lighter execution plans, replays them on your own workload and keeps only the changes that pass your quality gates. A person reviews every result before anything ships.',
    links: [
      { label: 'Explore the product', href: '/product' },
      { label: 'How the engine works', href: '/how-it-works' },
    ],
  },
  {
    id: 'connect',
    question: 'How do I connect my server?',
    keywords: ['connect', 'server', 'integrat', 'setup', 'set up', 'install', 'telemetry', 'ingest', 'opentelemetry', 'otel', 'openinference', 'trace', 'span', 'sdk', 'api key', 'stack', 'hook up', 'send data'],
    answer:
      'Create a scoped telemetry key in your workspace and send execution events to POST /api/telemetry/ingest, or import OpenTelemetry GenAI or OpenInference spans, or upload a sanitized trace file. Execution graphs keep hashes and sizes, not raw prompt content; an imported trace file keeps what you export, so redact before import. The Windows desktop app adds a local engine and repository access.',
    links: [
      { label: 'See the connection paths', href: '/how-it-works' },
      { label: 'Desktop app', href: '/download' },
    ],
  },
  {
    id: 'verify',
    question: 'Why verify before optimizing?',
    keywords: ['verify', 'verification', 'verified', 'why', 'proof', 'evidence', 'quality', 'gate', 'replay', 'test', 'rejected', 'incomplete', 'safe', 'risk', 'trust'],
    answer:
      'A cheaper model or shorter prompt can quietly break answers your users rely on. ZEVQORA replays each candidate on your real workload against frozen evaluation gates. A candidate is VERIFIED only when every required gate passes on the available evidence; otherwise it is REJECTED or INCOMPLETE. Missing coverage is never counted as zero, and VERIFIED does not mean deployed: a person still decides.',
    links: [
      { label: 'Read the evidence method', href: '/proof' },
      { label: 'Request an evaluation', href: '/evaluation' },
    ],
  },
  {
    id: 'team',
    question: 'Can I talk to your team?',
    keywords: ['talk', 'team', 'human', 'person', 'contact', 'email', 'sales', 'call', 'meeting', 'demo', 'support', 'help', 'reach', 'founder', 'someone'],
    answer:
      'Yes. Email the team and a person will read it and reply by email. For a structured review of your own AI workload, use the evaluation request form. This assistant is not a live person and cannot see any account or workspace.',
    links: [
      { label: 'Request an evaluation', href: '/evaluation' },
      { label: 'Meet the team', href: '/team' },
    ],
  },
  {
    id: 'pricing',
    question: 'How much does it cost?',
    keywords: ['price', 'pricing', 'cost', 'plan', 'plans', 'free', 'paid', 'billing', 'subscription', 'enterprise', 'trial', 'pay', 'credit'],
    answer:
      'The pricing page lists the published plans and what each includes. Zev credit covers provider cost during replay; analysis, telemetry and reports do not use replay credit. Enterprise identity, deployment and compliance needs are discussed and verified separately with the team.',
    links: [{ label: 'See pricing', href: '/pricing' }],
  },
  {
    id: 'security',
    question: 'What happens to my data?',
    keywords: ['security', 'secure', 'privacy', 'private', 'data', 'store', 'stored', 'gdpr', 'compliance', 'soc', 'encrypt', 'prompt content', 'retention', 'delete'],
    answer:
      'Execution graphs keep hashes and sizes rather than raw content, and workspace membership is enforced with row-level security on reads and server-checked roles on writes. An imported trace file keeps what you export, so redact it first. This public assistant does not store what you type here. The security page describes the controls in detail.',
    links: [
      { label: 'Security', href: '/security' },
      { label: 'Privacy', href: '/privacy' },
    ],
  },
  {
    id: 'desktop',
    question: 'Is there a desktop app?',
    keywords: ['desktop', 'windows', 'download', 'local', 'offline', 'electron', 'app', 'repository', 'git', 'worktree'],
    answer:
      'Yes, for Windows 10 and 11. It signs in to the same workspace, includes a local engine, and adds direct repository access with isolated Git worktrees so a proposed change can be reviewed before it is merged.',
    links: [{ label: 'Download for Windows', href: '/download' }],
  },
];

export const STARTER_QUESTIONS = KNOWLEDGE.slice(0, 4).map((e) => e.question);

const FALLBACK = {
  id: 'fallback',
  answer:
    'I can answer public questions about what ZEVQORA does, how to connect your stack, how verification works, pricing, security and the desktop app. For anything else, the team reads every email.',
  links: [
    { label: 'Explore the product', href: '/product' },
    { label: 'Contact the team', href: '/team' },
  ],
};

const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9/ ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Picks the closest public entry by keyword overlap. Deterministic and
 * offline: this is the whole answer path when generative support is off.
 */
export function matchKnowledge(message) {
  const text = ` ${normalize(message)} `;
  if (!text.trim()) return FALLBACK;
  const exact = KNOWLEDGE.find((e) => normalize(e.question) === text.trim());
  if (exact) return exact;
  let best = null;
  let bestScore = 0;
  for (const entry of KNOWLEDGE) {
    let score = 0;
    for (const k of entry.keywords) {
      // Stems ("optimiz", "integrat") match as prefixes; short words need a word boundary.
      const needle = k.length <= 4 ? ` ${k} ` : k;
      if (text.includes(needle)) score += k.length <= 4 ? 1 : 2;
    }
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return bestScore >= 2 && best ? best : FALLBACK;
}

/** The only context the generative model receives besides the visitor's own words. */
export function knowledgeDigest() {
  return KNOWLEDGE.map((e) => `Q: ${e.question}\nA: ${e.answer}\nPages: ${e.links.map((l) => l.href).join(', ')}`).join('\n\n');
}

/** Public internal routes an answer may link to. Anything else is dropped. */
export const ALLOWED_LINKS = new Set(['/', '/product', '/how-it-works', '/proof', '/evaluation', '/pricing', '/security', '/privacy', '/terms', '/team', '/company', '/download', '/signup']);
