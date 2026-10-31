export const OPPORTUNITIES = [
  {
    id: "opp_01",
    title: "Right-size intent classification",
    operation: "classify.intent",
    strategy: "Model routing",
    potential: "$218.40",
    confidence: "High",
    status: "Ready to test",
    file: "src/ai/classify.ts:42",
    body: "A high-capacity model handles a narrow classification task. Compare a smaller candidate on the same captured intents before changing the route.",
  },
  {
    id: "opp_02",
    title: "Cache repeated FAQ responses",
    operation: "answer.faq",
    strategy: "Exact cache",
    potential: "$126.80",
    confidence: "Medium",
    status: "Needs samples",
    file: "src/ai/answer.ts:87",
    body: "Repeated normalized request hashes suggest an exact-match cache opportunity. Collect representative misses and freshness-sensitive cases first.",
  },
  {
    id: "opp_03",
    title: "Trim retrieval context",
    operation: "summarize.thread",
    strategy: "Context reduction",
    potential: "$83.00",
    confidence: "Medium",
    status: "Ready to test",
    file: "src/ai/summarize.ts:29",
    body: "The observed retrieval payload includes repeated passages. Test a bounded context reduction and preserve the information required by the output contract.",
  },
];
export const EXPERIMENTS = [
  {
    id: "exp_d",
    name: "Candidate D",
    operation: "classify.intent",
    state: "Verified",
    reduction: "12.32%",
    quality: "0.97",
    cases: 50,
    note: "Internal benchmark. Point estimate; 95% CI [−11.01%, 34.64%] crosses zero.",
  },
  {
    id: "exp_a",
    name: "Rejected candidate",
    operation: "classify.intent",
    state: "Rejected",
    reduction: "42.01%",
    quality: "0.87",
    cases: 50,
    note: "Internal benchmark. Quality 0.87 missed the frozen 0.95 floor. Not a recommendation.",
  },
  {
    id: "exp_ctx",
    name: "Context trim",
    operation: "summarize.thread",
    state: "Candidate",
    reduction: "—",
    quality: "—",
    cases: 0,
    note: "Illustrative candidate. No replay has been run and no savings have been verified.",
  },
];
export const SCREEN_META: Record<string, [string, string, string]> = {
  overview: [
    "Overview",
    "Your AI, in focus.",
    "See the work, understand the cost, choose the next useful test.",
  ],
  project: [
    "Project",
    "The work behind the workload.",
    "A local repository scan, connected evidence and a clear path forward.",
  ],
  opportunities: [
    "Opportunities",
    "A useful place to start.",
    "Evidence-backed candidates, with potential clearly separated from results.",
  ],
  experiments: [
    "Experiments",
    "Every candidate earns its result.",
    "Replay evidence, quality decisions and measured outcomes, together.",
  ],
  changes: [
    "Changes",
    "The evidence. The diff. Your call.",
    "Review a candidate patch before anything reaches your production system.",
  ],
  zev: [
    "Zev",
    "A little help, in context.",
    "Ask about the evidence and the next step in your engineering loop.",
  ],
  dashboard: [
    "Workspace dashboard",
    "Your workspace, at a glance.",
    "A shared view of projects, runtime activity and reviewable evidence.",
  ],
  projects: [
    "Projects",
    "One place for every workload.",
    "Group the code, connections and evidence that belong together.",
  ],
  runs: [
    "Runs",
    "Follow every execution.",
    "A readable history of captured runtime calls and replay activity.",
  ],
  evidence: [
    "Evidence",
    "Nothing without its source.",
    "Inspect the provenance and completeness behind each experiment.",
  ],
  runtime: [
    "Runtime",
    "What the system actually does.",
    "Call metadata, token use, latency and cost across your operations.",
  ],
  connections: [
    "Connections",
    "Connect with clear boundaries.",
    "Scoped, revocable access. You decide what the workspace can read.",
  ],
  reports: [
    "Reports",
    "Work worth reviewing.",
    "A portable record of the workload, experiment and gate decisions.",
  ],
  usage: [
    "Usage & billing",
    "Room to do useful work.",
    "Plan limits, replay credit and retention, visible before you use them.",
  ],
  team: [
    "Team",
    "Better decisions, together.",
    "A workspace with clear roles and shared evidence.",
  ],
  settings: [
    "Settings",
    "Make the workspace yours.",
    "Profile, workspace preferences and security controls.",
  ],
  docs: [
    "Documentation",
    "A clear way in.",
    "Connect metadata, prepare evidence and understand the verification loop.",
  ],
  onboarding: [
    "Get started",
    "Start with one workload.",
    "A short setup that makes the next step obvious.",
  ],
  states: [
    "Interface states",
    "Clarity at every boundary.",
    "Loading, empty, error and permission states share the same system.",
  ],
};
export function statusClass(value: string) {
  return /verified|active|connected|complete|passed|owner/i.test(value)
    ? "verified"
    : /reject|fail|revoke/i.test(value)
      ? "rejected"
      : /pending|sample|needs/i.test(value)
        ? "warning"
        : "blue";
}
