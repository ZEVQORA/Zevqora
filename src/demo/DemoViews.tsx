import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  FileCode2,
  FileText,
  FlaskConical,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  Lightbulb,
  LockKeyhole,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { CopyButton } from "@/components/ui/Misc";
import { Zev, ZevFace } from "@/brand/Zev";
import { SpendChart } from "@/marketing/ProductPreview";
import { REFERENCE_PLANS } from "@/lib/referencePlans";
import { EXPERIMENTS, OPPORTUNITIES, statusClass } from "./data";

function Badge({ value }: { value: string }) {
  return (
    <span className={`z-status ${statusClass(value)}`}>
      {/verified|passed|complete|active/i.test(value) ? (
        <Check size={10} />
      ) : /reject/i.test(value) ? (
        <X size={10} />
      ) : null}
      {value}
    </span>
  );
}
function Card({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`d-card ${className}`}>
      <div className="d-card-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Metrics({ values }: { values?: Array<[string, string, string]> }) {
  return (
    <div className="d-metrics">
      {(
        values || [
          ["Measured AI spend", "$2,481.60", "Captured execution · 7 days"],
          ["Potential savings", "$428.20", "Estimate · not verified"],
          ["Replay experiments", "03", "1 passed · 1 rejected · 1 candidate"],
          ["Quality floor", "0.95", "Frozen before replay"],
        ]
      ).map(([label, value, hint], i) => (
        <div key={label} className="d-metric">
          <div>
            <span>{label}</span>
            {i === 1 ? (
              <ArrowDownRight size={15} />
            ) : i === 3 ? (
              <ShieldCheck size={15} />
            ) : (
              <Activity size={15} />
            )}
          </div>
          <strong>{value}</strong>
          <small>{hint}</small>
          <div className={`d-mini-chart d-mini-${i}`} aria-hidden="true">
            {[14, 22, 19, 28, 25, 33, 29, 39, 37, 46, 43, 50].map((h, n) => (
              <i
                key={n}
                style={{ height: `${i === 1 ? 52 - h * 0.65 : h}%` }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
function DemoHint({ children }: { children: ReactNode }) {
  return (
    <p className="d-hint">
      <ShieldCheck size={13} />
      {children}
    </p>
  );
}
function Toolbar({
  query,
  onQuery,
  children,
}: {
  query: string;
  onQuery: (v: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className="d-toolbar">
      <div className="d-search">
        <Search size={14} />
        <input
          aria-label="Search records"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search this view…"
        />
      </div>
      {children}
    </div>
  );
}

function Overview() {
  const [period, setPeriod] = useState("7");
  return (
    <>
      <div className="d-overview-intro">
        <span>
          <i />
          SAMPLE WORKSPACE / SUPPORT INTELLIGENCE
        </span>
        <select
          aria-label="Overview period"
          className="d-select"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
        </select>
      </div>
      <Metrics
        values={
          period === "30"
            ? [
                [
                  "Measured AI spend",
                  "$9,842.10",
                  "Captured execution · 30 days",
                ],
                ["Potential savings", "$1,706.40", "Estimate · not verified"],
                [
                  "Replay experiments",
                  "03",
                  "1 passed · 1 rejected · 1 candidate",
                ],
                ["Quality floor", "0.95", "Frozen before replay"],
              ]
            : undefined
        }
      />
      <div className="d-grid-main">
        <Card
          title="Inference cost"
          subtitle="A measured baseline. A testable alternative."
          action={
            <span className="d-legend">
              <i />
              Baseline <b />
              Candidate
            </span>
          }
        >
          <div className="d-chart">
            <SpendChart variant={period === "30" ? 1 : 0} />
          </div>
          <div className="d-chart-footer">
            <span>Illustrative cost comparison</span>
            <Link to="/demo/runtime">
              Explore runtime
              <ArrowUpRight size={12} />
            </Link>
          </div>
        </Card>
        <Card
          title="Where the work goes"
          subtitle="Spend by operation · sample data"
        >
          <div className="d-allocation">
            {[
              ["Intent classification", 64, "$1,588.22"],
              ["Thread summarization", 24, "$595.58"],
              ["FAQ responses", 12, "$297.80"],
            ].map(([label, n, value], i) => (
              <div key={String(label)}>
                <div>
                  <span>{label}</span>
                  <b>{value}</b>
                </div>
                <div className="d-bar">
                  <i style={{ width: `${n}%`, opacity: 1 - i * 0.26 }} />
                </div>
                <small>{n}% of measured spend</small>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="d-grid-main">
        <Card
          title="Worth testing next"
          subtitle="Potential savings require replay."
          action={
            <Link className="d-text-link" to="/demo/opportunities">
              View all
              <ArrowUpRight size={12} />
            </Link>
          }
        >
          <div className="d-opportunity-list">
            {OPPORTUNITIES.map((o, i) => (
              <Link key={o.id} to="/demo/opportunities">
                <span className="d-item-icon">
                  <Lightbulb size={16} />
                </span>
                <span>
                  <b>{o.title}</b>
                  <small>
                    {o.strategy} · {o.operation}
                  </small>
                </span>
                <strong>
                  {o.potential}
                  <small>potential / month</small>
                </strong>
                <ChevronRight size={14} />
                <i className="sr-only">{i}</i>
              </Link>
            ))}
          </div>
        </Card>
        <Card title="A note from Zev" className="d-zev-summary">
          <Zev height={130} view="pose-thinking" />
          <p>
            A lower cost is an interesting lead.
            <br />
            <b>Quality decides what comes next.</b>
          </p>
          <Link to="/demo/zev" className="d-text-link">
            Ask about the evidence
            <ArrowUpRight size={12} />
          </Link>
        </Card>
      </div>
      <DemoHint>
        All dashboard values are illustrative. The experiment fixtures are
        labelled internal benchmarks.
      </DemoHint>
    </>
  );
}

function OpportunityView() {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("All strategies"),
    [selected, setSelected] = useState<(typeof OPPORTUNITIES)[number] | null>(
      null,
    );
  const rows = OPPORTUNITIES.filter(
    (o) =>
      `${o.title} ${o.operation}`.toLowerCase().includes(query.toLowerCase()) &&
      (filter === "All strategies" || filter === o.strategy),
  );
  return (
    <>
      <div className="d-summary-strip">
        <div>
          <span>03</span>Opportunities
        </div>
        <div>
          <span>$428.20</span>Potential / month
        </div>
        <div>
          <ShieldCheck size={15} />
          Replay required before verification
        </div>
      </div>
      <Card
        title="Candidate opportunities"
        subtitle="Each finding points to the work and its supporting evidence."
      >
        <Toolbar query={query} onQuery={setQuery}>
          <select
            className="d-select"
            aria-label="Filter strategy"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            {[
              "All strategies",
              "Model routing",
              "Exact cache",
              "Context reduction",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Toolbar>
        <div className="d-table-wrap">
          <table className="d-table">
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>Strategy</th>
                <th>Potential / mo</th>
                <th>Confidence</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td>
                    <button
                      className="d-cell-title"
                      type="button"
                      onClick={() => setSelected(o)}
                    >
                      {o.title}
                      <small>{o.operation}</small>
                    </button>
                  </td>
                  <td>{o.strategy}</td>
                  <td className="mono">{o.potential}</td>
                  <td>{o.confidence}</td>
                  <td>
                    <Badge value={o.status} />
                  </td>
                  <td>
                    <button
                      className="d-icon-button"
                      type="button"
                      aria-label={`Inspect ${o.title}`}
                      onClick={() => setSelected(o)}
                    >
                      <ArrowUpRight size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <div className="d-empty">
              <Search size={28} />
              <h3>No matching opportunities.</h3>
              <p>Try another operation or strategy.</p>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setFilter("All strategies");
                }}
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      </Card>
      <DemoHint>
        Potential is a telemetry-derived estimate. It is never reported as
        verified savings.
      </DemoHint>
      <Dialog
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.title || "Opportunity"}
        description="Illustrative opportunity · no production changes"
      >
        <div className="d-detail">
          <Badge value={selected?.status || ""} />
          <p>{selected?.body}</p>
          <dl>
            <div>
              <dt>Operation</dt>
              <dd>{selected?.operation}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{selected?.file}</dd>
            </div>
            <div>
              <dt>Potential saving</dt>
              <dd>{selected?.potential} / month · estimate</dd>
            </div>
            <div>
              <dt>Quality floor</dt>
              <dd>0.95 · configured before replay</dd>
            </div>
          </dl>
          <Link className="z-button z-button-blue" to="/demo/experiments">
            <FlaskConical size={14} />
            Explore replay results
          </Link>
        </div>
      </Dialog>
    </>
  );
}

function ExperimentsView() {
  const [filter, setFilter] = useState("All experiments"),
    [selected, setSelected] = useState<(typeof EXPERIMENTS)[number] | null>(
      null,
    );
  const rows = EXPERIMENTS.filter(
    (e) => filter === "All experiments" || e.state === filter,
  );
  return (
    <>
      <Metrics
        values={[
          ["Experiments", "03", "Internal benchmark fixtures"],
          ["Verified", "01", "Point estimate · CI crosses zero"],
          ["Rejected", "01", "Quality floor protected"],
          ["Awaiting replay", "01", "No verified result"],
        ]}
      />
      <Card
        title="Replay history"
        subtitle="A decision is only useful when its evidence stays attached."
      >
        <div
          className="d-filter-tabs"
          role="group"
          aria-label="Experiment status"
        >
          {["All experiments", "Verified", "Rejected", "Candidate"].map((v) => (
            <button
              type="button"
              key={v}
              aria-pressed={filter === v}
              onClick={() => setFilter(v)}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="d-table-wrap">
          <table className="d-table">
            <thead>
              <tr>
                <th>Experiment</th>
                <th>Cost reduction</th>
                <th>Quality / floor</th>
                <th>Cases</th>
                <th>Decision</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>
                    <button
                      type="button"
                      className="d-cell-title"
                      onClick={() => setSelected(e)}
                    >
                      {e.name}
                      <small>{e.operation}</small>
                    </button>
                  </td>
                  <td className="mono">
                    {e.reduction}
                    {e.state === "Verified" && (
                      <small className="d-cell-note">point estimate*</small>
                    )}
                  </td>
                  <td className="mono">{e.quality} / 0.95</td>
                  <td className="mono">{e.cases || "—"}</td>
                  <td>
                    <Badge value={e.state} />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="d-icon-button"
                      aria-label={`Inspect ${e.name}`}
                      onClick={() => setSelected(e)}
                    >
                      <ArrowUpRight size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <DemoHint>
        Internal 50-case benchmark. Not customer evidence. Candidate D 95% CI:
        [−11.01%, 34.64%].
      </DemoHint>
      <Dialog
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name || "Experiment"}
        description="Internal benchmark / experiment inspector"
        size="md"
      >
        <div className="d-detail">
          <Badge value={selected?.state || ""} />
          <p>{selected?.note}</p>
          <dl>
            <div>
              <dt>Measured reduction</dt>
              <dd>{selected?.reduction}</dd>
            </div>
            <div>
              <dt>Quality</dt>
              <dd>{selected?.quality}</dd>
            </div>
            <div>
              <dt>Quality floor</dt>
              <dd>0.95</dd>
            </div>
            <div>
              <dt>Cases</dt>
              <dd>{selected?.cases || "Not replayed"}</dd>
            </div>
          </dl>
          {selected?.state !== "Candidate" && (
            <div className="d-gates">
              {[
                "Minimum samples",
                "Evidence completeness",
                "Execution success",
                "Quality floor",
                "Cost improvement",
                "Latency regression",
              ].map((g) => (
                <div key={g}>
                  <span>{g}</span>
                  <Badge
                    value={
                      g === "Quality floor" && selected?.state === "Rejected"
                        ? "Failed"
                        : "Passed"
                    }
                  />
                </div>
              ))}
            </div>
          )}
          <div className="z-actions">
            <Link to="/proof" className="z-button z-button-line">
              Read the source evidence
              <ArrowUpRight size={14} />
            </Link>
            {selected?.state === "Verified" && (
              <Link to="/demo/changes" className="z-button z-button-blue">
                Review a sample change
                <ArrowRight size={14} />
              </Link>
            )}
          </div>
        </div>
      </Dialog>
    </>
  );
}

function ProjectView() {
  const [scanned, setScanned] = useState(true),
    [file, setFile] = useState("classify.ts");
  return (
    <>
      <div className="d-project-banner">
        <span className="d-repository-icon">
          <FolderGit2 size={25} />
        </span>
        <div>
          <h2>support-intelligence</h2>
          <p>Local repository · TypeScript · main</p>
        </div>
        <span className="z-status blue">
          <GitBranch size={10} /> READ-ONLY SCAN
        </span>
        <button
          type="button"
          className="z-button z-button-line"
          onClick={() => setScanned((v) => !v)}
        >
          {scanned ? "Show pre-scan state" : "Load sample scan"}
        </button>
      </div>
      {!scanned ? (
        <div className="d-empty">
          <FolderGit2 size={35} />
          <h3>Your code is a good place to begin.</h3>
          <p>
            Choose a local repository in the live product. This preview loads an
            illustrative scan.
          </p>
          <button type="button" onClick={() => setScanned(true)}>
            Load sample scan
            <ArrowRight size={14} />
          </button>
        </div>
      ) : (
        <>
          <Metrics
            values={[
              ["AI call sites", "08", "Across 3 source files"],
              ["Providers", "02", "OpenAI · OpenRouter"],
              ["Connected traces", "50", "Representative benchmark cases"],
              ["Opportunities", "03", "Candidates for testing"],
            ]}
          />
          <div className="d-code-browser">
            <aside>
              <span>AI CALL SITES</span>
              {["classify.ts", "summarize.ts", "answer.ts"].map((f) => (
                <button
                  className={file === f ? "active" : ""}
                  type="button"
                  key={f}
                  onClick={() => setFile(f)}
                >
                  <FileCode2 size={13} />
                  {f}
                  <small>{f === "classify.ts" ? "4" : "2"}</small>
                </button>
              ))}
            </aside>
            <div>
              <div className="d-code-top">
                <span>src / ai / {file}</span>
                <span>SAMPLE SOURCE</span>
              </div>
              <pre className="d-code">
                <span className="code-muted">
                  {"// Read-only sample scan\n"}
                </span>
                <b>{"export async function "}</b>
                {file.replace(".ts", "")}
                {
                  '(input: string) {\n  const result = await client.chat.completions.create({\n    model: "gpt-4o",\n    messages: [\n      { role: "system", content: taskInstructions },\n      { role: "user", content: input }\n    ]\n  });\n  return result;\n}'
                }
              </pre>
              <div className="d-code-callout">
                <Lightbulb size={15} />
                <span>
                  Opportunity: compare a bounded alternative on representative
                  traces.
                </span>
                <Link to="/demo/opportunities">
                  Inspect
                  <ArrowUpRight size={11} />
                </Link>
              </div>
            </div>
          </div>
        </>
      )}
      <DemoHint>
        Sample code only. No filesystem access or source upload occurs in this
        demo.
      </DemoHint>
    </>
  );
}

function ProjectsView() {
  const [projects, setProjects] = useState([
      "Support intelligence",
      "Research assistant",
      "Document pipeline",
    ]),
    [adding, setAdding] = useState(false),
    [name, setName] = useState(""),
    [query, setQuery] = useState("");
  function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setProjects((p) => [...p, name.trim()]);
    setAdding(false);
    setName("");
  }
  return (
    <>
      <div className="d-view-actions">
        <p>{projects.length} projects in this sample workspace</p>
        <button
          type="button"
          className="z-button z-button-blue"
          onClick={() => setAdding(true)}
        >
          <Plus size={14} />
          New project
        </button>
      </div>
      <Toolbar query={query} onQuery={setQuery} />
      <div className="d-projects-grid">
        {projects
          .filter((p) => p.toLowerCase().includes(query.toLowerCase()))
          .map((p, i) => (
            <Link
              to="/demo/project"
              key={`${p}-${i}`}
              className="d-project-card"
            >
              <div>
                <span className="d-item-icon">
                  <FolderGit2 size={21} />
                </span>
                <ArrowUpRight size={15} />
              </div>
              <h2>{p}</h2>
              <p>
                {i < 3
                  ? [
                      "Classification, FAQ and thread summaries.",
                      "Retrieval, synthesis and research workflows.",
                      "Extraction and structured document output.",
                    ][i]
                  : "New project in this demo session."}
              </p>
              <div className="d-project-card-footer">
                <Badge value={i < 3 ? "Connected" : "Pending setup"} />
                <span>
                  {i < 3 ? `${8 - i * 2} call sites` : "No evidence yet"}
                </span>
              </div>
            </Link>
          ))}
      </div>
      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Create a sample project"
        description="Local demo only. No account or repository is connected."
      >
        <form onSubmit={add} className="d-form">
          <label htmlFor="project-name">
            Project name
            <input
              id="project-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Customer support"
              maxLength={60}
            />
          </label>
          <p>
            In your live workspace you can attach a repository and scoped
            connections after creating the project.
          </p>
          <button className="z-button z-button-blue" type="submit">
            Add to this demo
            <Plus size={14} />
          </button>
        </form>
      </Dialog>
    </>
  );
}

const PATCH =
  "diff --git a/src/classify.ts b/src/classify.ts\n--- a/src/classify.ts\n+++ b/src/classify.ts\n@@ -12,3 +12,3 @@\n // Illustrative patch. Not a production recommendation.\n-const model = baselineModel;\n+const model = verifiedCandidate;\n return classify(input, { model });";
function ChangesView() {
  const [tab, setTab] = useState("Diff"),
    [reviewed, setReviewed] = useState(false);
  function download() {
    const blob = new Blob([PATCH], { type: "text/plain" }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "zevqora-demo-change.patch";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <div className="d-change-title">
        <div className="d-item-icon">
          <GitPullRequest size={23} />
        </div>
        <div>
          <h2>A bounded model alternative</h2>
          <p>Sample change · 1 file changed · 1 addition · 1 deletion</p>
        </div>
        <Badge value={reviewed ? "Reviewed in demo" : "Awaiting review"} />
      </div>
      <div className="d-filter-tabs" role="group" aria-label="Change detail">
        {["Diff", "Evidence", "Review checklist"].map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Diff" ? (
        <div className="d-diff">
          <div className="d-code-top">
            <span>
              <FileCode2 size={13} /> src/classify.ts
            </span>
            <CopyButton value={PATCH} size="xs" />
          </div>
          <pre>
            {PATCH.split("\n").map((line, i) => (
              <div
                className={
                  line.startsWith("+")
                    ? "add"
                    : line.startsWith("-")
                      ? "del"
                      : line.startsWith("@@")
                        ? "hunk"
                        : ""
                }
                key={i}
              >
                <span>{i + 1}</span>
                <code>{line}</code>
              </div>
            ))}
          </pre>
        </div>
      ) : tab === "Evidence" ? (
        <Card
          title="Attached evidence"
          subtitle="A patch needs a replay record."
        >
          <div className="d-detail" style={{ padding: 25 }}>
            <dl>
              <div>
                <dt>Example result</dt>
                <dd>Candidate D · internal benchmark</dd>
              </div>
              <div>
                <dt>Quality</dt>
                <dd>0.97 / floor 0.95</dd>
              </div>
              <div>
                <dt>Cost reduction</dt>
                <dd>12.32% · point estimate</dd>
              </div>
              <div>
                <dt>95% CI</dt>
                <dd>[−11.01%, 34.64%]</dd>
              </div>
            </dl>
            <p>
              The patch is illustrative. The benchmark does not validate this
              sample source code.
            </p>
          </div>
        </Card>
      ) : (
        <Card
          title="Before you ship"
          subtitle="Your team owns the production decision."
        >
          <div className="d-checklist">
            {[
              "Read the complete diff",
              "Inspect replay samples and provenance",
              "Review confidence interval and limitations",
              "Run your own tests and behaviour checks",
              "Plan production observation and rollback",
            ].map((x) => (
              <label key={x}>
                <input type="checkbox" />
                {x}
              </label>
            ))}
          </div>
        </Card>
      )}
      <div className="d-view-actions" style={{ marginTop: 25 }}>
        <DemoHint>
          Demo patch only. No branch, pull request or deployment is created.
        </DemoHint>
        <div className="z-actions" style={{ margin: 0 }}>
          <button
            type="button"
            className="z-button z-button-line"
            onClick={download}
          >
            <Download size={14} />
            Export sample patch
          </button>
          <button
            className="z-button z-button-blue"
            type="button"
            onClick={() => setReviewed((v) => !v)}
          >
            <Check size={14} />
            {reviewed ? "Reopen review" : "Mark reviewed in demo"}
          </button>
        </div>
      </div>
    </>
  );
}

function ZevView() {
  const [messages, setMessages] = useState<
      Array<{ user: boolean; text: string }>
    >([]),
    [input, setInput] = useState("");
  function send(text: string) {
    if (!text.trim()) return;
    const answer = /reject|42|quality/i.test(text)
      ? "The cheaper candidate scored 0.87 against the frozen quality floor of 0.95. It was rejected, even though its measured cost was 42.01% lower. Candidate D scored 0.97 and passed the gates; its 12.32% reduction is still only a point estimate because the 95% confidence interval crosses zero."
      : /next|start|test/i.test(text)
        ? "Start with intent classification. Inspect the representative traces, choose a bounded candidate and set the quality floor before replay. Potential savings are an estimate until the experiment passes every configured gate. Open Opportunities to inspect the sample finding."
        : "In this sample workspace, the evidence is the useful starting point. Open an opportunity to see its source, then inspect an experiment for quality, cost, case count and gate decisions. This is a scripted design demo; I am not making a live model request.";
    setMessages((m) => [
      ...m,
      { user: true, text },
      { user: false, text: answer },
    ]);
    setInput("");
  }
  return (
    <div className="d-chat">
      <div className="d-chat-top">
        <ZevFace size={36} expression="friendly-idle" />
        <div>
          <b>Zev</b>
          <span>Your optimization companion</span>
        </div>
        <span className="z-status blue">SCRIPTED DEMO</span>
      </div>
      <div className="d-chat-messages" aria-live="polite">
        {!messages.length ? (
          <div className="d-chat-welcome">
            <Zev view="pose-sitting" height={160} alt="Zev, ready to help" />
            <h2>Let’s make it a little lighter.</h2>
            <p>
              Ask about the workload, the evidence, or the next useful step.
            </p>
            <div>
              {[
                "Why was the cheaper candidate rejected?",
                "What should I test next?",
                "What does verified mean?",
              ].map((t) => (
                <button type="button" key={t} onClick={() => send(t)}>
                  {t}
                  <ArrowUpRight size={12} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div className={`d-message ${m.user ? "user" : "zev"}`} key={i}>
              {!m.user && <ZevFace size={28} />}
              <p>{m.text}</p>
            </div>
          ))
        )}
      </div>
      <form
        className="d-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <label className="sr-only" htmlFor="zev-message">
          Ask Zev
        </label>
        <input
          id="zev-message"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your evidence…"
          maxLength={1000}
        />
        <button
          aria-label="Send message to demo Zev"
          type="submit"
          disabled={!input.trim()}
        >
          <Send size={16} />
        </button>
      </form>
      <p className="d-chat-disclaimer">
        Scripted responses, sample context. No model request, account action or
        credit usage.
      </p>
    </div>
  );
}

type RecordSet = {
  title: string;
  subtitle: string;
  columns: string[];
  rows: string[][];
  add?: string;
};
const RECORDS: Record<string, RecordSet> = {
  runs: {
    title: "Execution history",
    subtitle: "Captured metadata · illustrative values",
    columns: ["Trace", "Operation", "Model", "Cost", "Status"],
    rows: [
      ["req_8f2c41", "classify.intent", "gpt-4o-mini", "$0.0004", "Complete"],
      ["req_8f2c43", "summarize.thread", "gpt-4o", "$0.0192", "Complete"],
      ["req_8f2c44", "classify.intent", "gpt-4o", "$0.0188", "Complete"],
      ["req_8f2c45", "answer.faq", "gpt-4o", "$0.0191", "Complete"],
    ],
  },
  evidence: {
    title: "Evidence records",
    subtitle: "Provenance belongs beside the result.",
    columns: ["Evidence", "Source", "Cases", "Reference", "Status"],
    rows: [
      [
        "Candidate D replay",
        "Internal benchmark",
        "50",
        "candidate-d",
        "Complete",
      ],
      [
        "Rejected candidate replay",
        "Internal benchmark",
        "50",
        "phase4c-v2",
        "Complete",
      ],
      [
        "Context trim samples",
        "Illustrative import",
        "0",
        "Not captured",
        "Needs samples",
      ],
    ],
  },
  connections: {
    title: "Workspace connections",
    subtitle: "Each connection has a scope you can inspect.",
    columns: ["Connection", "Kind", "Project", "Scope", "Status"],
    rows: [
      [
        "Support runtime",
        "Telemetry",
        "Support intelligence",
        "metadata:write",
        "Active",
      ],
      [
        "Local repository",
        "Browser scan",
        "Support intelligence",
        "read-only / local",
        "Connected",
      ],
      [
        "Research runtime",
        "Telemetry",
        "Research assistant",
        "metadata:write",
        "Pending",
      ],
    ],
    add: "Add connection",
  },
  reports: {
    title: "Experiment reports",
    subtitle: "Keep the outcome, the constraints and the context together.",
    columns: ["Report", "Workload", "Cases", "Decision", "Status"],
    rows: [
      [
        "Candidate D review",
        "classify.intent",
        "50",
        "Verified · point estimate",
        "Complete",
      ],
      [
        "Rejected candidate review",
        "classify.intent",
        "50",
        "Quality floor failed",
        "Complete",
      ],
      [
        "Context evaluation",
        "summarize.thread",
        "0",
        "Awaiting evidence",
        "Pending",
      ],
    ],
  },
  team: {
    title: "Workspace members",
    subtitle: "Fictional sample identities · no invitations are sent.",
    columns: ["Member", "Email", "Role", "Workspace", "Status"],
    rows: [
      [
        "Alex Morgan",
        "alex@example.com",
        "Owner",
        "Support intelligence",
        "Active",
      ],
      ["Sam Lee", "sam@example.com", "Admin", "Support intelligence", "Active"],
      [
        "Jordan Park",
        "jordan@example.com",
        "Member",
        "Support intelligence",
        "Pending",
      ],
    ],
    add: "Invite member",
  },
  "admin-users": {
    title: "Users",
    subtitle: "Sample accounts · production actions remain server-enforced.",
    columns: ["User", "Email", "Plan", "Workspaces", "Status"],
    rows: [
      ["Alex Morgan", "alex@example.com", "Pro", "2", "Active"],
      ["Sam Lee", "sam@example.com", "Starter", "1", "Active"],
      ["Jordan Park", "jordan@example.com", "Free", "1", "Pending"],
    ],
  },
  "admin-workspaces": {
    title: "Workspaces",
    subtitle: "An operational view of sample workspace records.",
    columns: ["Workspace", "Owner", "Plan", "Members", "Status"],
    rows: [
      ["Support intelligence", "alex@example.com", "Pro", "3", "Active"],
      ["Research assistant", "sam@example.com", "Starter", "2", "Active"],
      ["Document pipeline", "jordan@example.com", "Free", "1", "Pending"],
    ],
  },
  "admin-pricing": {
    title: "Plan configuration",
    subtitle:
      "Reference plans from migration 004 · no billing edits are applied.",
    columns: ["Plan", "Monthly", "Zev credit", "Replay cases", "Status"],
    rows: REFERENCE_PLANS.map((p) => [
      p.name,
      `$${p.monthly_price_cents / 100}`,
      `$${p.limits.credits_usd}`,
      String(p.limits.replay_samples),
      "Active",
    ]),
  },
  "admin-model-pricing": {
    title: "Model pricing reference",
    subtitle: "Historical repository snapshot · not current market pricing.",
    columns: ["Model", "Provider", "Input / 1M", "Output / 1M", "Status"],
    rows: [
      ["gpt-4o", "OpenAI", "$2.50", "$10.00", "Snapshot"],
      ["gpt-4o-mini", "OpenAI", "$0.15", "$0.60", "Snapshot"],
      ["gemini-2.5-pro", "Google", "$1.25", "$10.00", "Snapshot"],
    ],
  },
  "admin-audit": {
    title: "Audit trail",
    subtitle:
      "Illustrative events · every real mutation is audited on the server.",
    columns: ["Action", "Actor", "Resource", "When", "Status"],
    rows: [
      [
        "workspace.updated",
        "alex@example.com",
        "Support intelligence",
        "Today, 10:42",
        "Complete",
      ],
      [
        "connection.created",
        "sam@example.com",
        "Support runtime",
        "Today, 09:20",
        "Complete",
      ],
      [
        "experiment.completed",
        "system / sample",
        "Candidate D",
        "Yesterday, 16:05",
        "Complete",
      ],
    ],
  },
  "admin-admins": {
    title: "Administrative access",
    subtitle: "Sample roles only. No permissions are granted in this demo.",
    columns: ["Admin", "Email", "Role", "Access", "Status"],
    rows: [
      [
        "Alex Morgan",
        "alex@example.com",
        "Super admin",
        "Control centre",
        "Active",
      ],
      ["Sam Lee", "sam@example.com", "Admin", "Workspace operations", "Active"],
    ],
  },
};
function RecordsView({ screen }: { screen: string }) {
  const source = RECORDS[screen] || RECORDS.runs;
  const [rows, setRows] = useState(source.rows),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<string[] | null>(null),
    [add, setAdd] = useState(false),
    [name, setName] = useState("");
  const filtered = rows.filter((row) =>
    row.join(" ").toLowerCase().includes(query.toLowerCase()),
  );
  function addRow(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setRows((r) => [
      ...r,
      screen === "team"
        ? [
            name.trim(),
            "sample@example.com",
            "Member",
            "Support intelligence",
            "Pending",
          ]
        : [
            name.trim(),
            "Telemetry",
            "Support intelligence",
            "metadata:write",
            "Pending",
          ],
    ]);
    setAdd(false);
    setName("");
  }
  return (
    <>
      <div className="d-view-actions">
        <p>{rows.length} sample records</p>
        {source.add && (
          <button
            type="button"
            className="z-button z-button-blue"
            onClick={() => setAdd(true)}
          >
            <Plus size={14} />
            {source.add}
          </button>
        )}
      </div>
      <Card title={source.title} subtitle={source.subtitle}>
        <Toolbar query={query} onQuery={setQuery} />
        <div className="d-table-wrap">
          <table className="d-table">
            <thead>
              <tr>
                {source.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, n) => (
                    <td key={n}>
                      {n === 0 ? (
                        <button
                          type="button"
                          className="d-cell-title"
                          onClick={() => setSelected(row)}
                        >
                          {cell}
                        </button>
                      ) : n === row.length - 1 ? (
                        <Badge value={cell} />
                      ) : (
                        cell
                      )}
                    </td>
                  ))}
                  <td>
                    <button
                      type="button"
                      className="d-icon-button"
                      aria-label={`Inspect ${row[0]}`}
                      onClick={() => setSelected(row)}
                    >
                      <ArrowUpRight size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && (
            <div className="d-empty">
              <Search size={27} />
              <h3>No matching records.</h3>
              <button type="button" onClick={() => setQuery("")}>
                Clear search
              </button>
            </div>
          )}
        </div>
      </Card>
      <DemoHint>
        This view uses sample records. Account data, token scopes and admin
        roles are unchanged.
      </DemoHint>
      <Dialog
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.[0] || "Record"}
        description="Sample record inspector"
      >
        <div className="d-detail">
          <dl>
            {source.columns.map((col, i) => (
              <div key={col}>
                <dt>{col}</dt>
                <dd>{selected?.[i]}</dd>
              </div>
            ))}
          </dl>
          <p>
            {screen === "evidence" || screen === "reports"
              ? "Internal benchmark records retain their limitations. A replay result applies to the selected cases and configured gates."
              : screen === "connections"
                ? "The live application shows a token only once, stores its hash and enforces project scope on the server. This preview does not generate a token."
                : "This is a design preview. Production reads and writes use the existing authenticated API."}
          </p>
          {screen === "reports" || screen === "evidence" ? (
            <Link to="/proof" className="z-button z-button-line">
              Open benchmark context
              <ArrowUpRight size={14} />
            </Link>
          ) : null}
        </div>
      </Dialog>
      <Dialog
        open={add}
        onClose={() => setAdd(false)}
        title={source.add || "Add sample"}
        description="Local demonstration only. No email, API request or token is created."
      >
        <form className="d-form" onSubmit={addRow}>
          <label htmlFor="record-name">
            {screen === "team" ? "Sample member name" : "Connection name"}
            <input
              id="record-name"
              value={name}
              required
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder={
                screen === "team" ? "e.g. Taylor" : "e.g. Production runtime"
              }
            />
          </label>
          <p>
            {screen === "team"
              ? "The sample member appears as pending. This form never sends an invitation."
              : "The sample connection uses metadata:write scope and appears as pending."}
          </p>
          <button className="z-button z-button-blue" type="submit">
            Add sample
            <Plus size={14} />
          </button>
        </form>
      </Dialog>
    </>
  );
}

function RuntimeView() {
  const [operation, setOperation] = useState("All operations");
  return (
    <>
      <div className="d-view-actions">
        <p>Illustrative telemetry · last 7 days</p>
        <select
          className="d-select"
          aria-label="Runtime operation"
          value={operation}
          onChange={(e) => setOperation(e.target.value)}
        >
          {[
            "All operations",
            "classify.intent",
            "summarize.thread",
            "answer.faq",
          ].map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </div>
      <Metrics
        values={[
          [
            "Model calls",
            operation === "All operations" ? "18,420" : "6,140",
            "Illustrative captured calls",
          ],
          [
            "Inference cost",
            operation === "All operations" ? "$2,481.60" : "$827.20",
            "Provider / snapshot cost sources",
          ],
          ["p95 latency", "1,980 ms", "Representative sample"],
          ["Error rate", "0.32%", "59 calls in this sample"],
        ]}
      />
      <Card
        title={`Execution cost / ${operation}`}
        subtitle="Illustrative time series"
        action={
          <span className="z-status blue">
            <Activity size={10} />
            METADATA ONLY
          </span>
        }
      >
        <div className="d-chart large">
          <SpendChart variant={operation === "All operations" ? 0 : 1} />
        </div>
      </Card>
      <div style={{ marginTop: 22 }}>
        <RecordsView screen="runs" />
      </div>
    </>
  );
}

function UsageView() {
  const [plan, setPlan] = useState("pro");
  const selected = REFERENCE_PLANS.find((p) => p.id === plan)!;
  return (
    <>
      <div className="d-billing-banner">
        <div>
          <span>WORKSPACE PLAN</span>
          <h2>
            {selected.name}
            <b>Reference plan</b>
          </h2>
          <p>
            Illustrative usage. Checkout and billing require your live account.
          </p>
        </div>
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          className="d-select"
          aria-label="Preview plan limits"
        >
          {REFERENCE_PLANS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="d-projects-grid">
        <Card title="Zev replay credit" subtitle="Provider cost during replay">
          <div className="d-quota">
            <strong>
              ${((selected.limits.credits_usd || 0) * 0.72).toFixed(2)}
              <small>remaining</small>
            </strong>
            <div className="d-bar">
              <i style={{ width: "72%" }} />
            </div>
            <p>
              ${selected.limits.credits_usd} included per month · sample usage
            </p>
          </div>
        </Card>
        <Card title="Projects" subtitle="Workloads in this workspace">
          <div className="d-quota">
            <strong>
              3<small>/ {selected.limits.projects || "unlimited"}</small>
            </strong>
            <div className="d-bar">
              <i
                style={{
                  width: selected.limits.projects
                    ? `${Math.min(3 / selected.limits.projects, 1) * 100}%`
                    : "10%",
                }}
              />
            </div>
            <p>Choose a plan with room for your workloads.</p>
          </div>
        </Card>
        <Card title="Retention" subtitle="Call metadata history">
          <div className="d-quota">
            <strong>
              {selected.limits.telemetry_retention_days}
              <small>days</small>
            </strong>
            <ShieldCheck size={24} color="#468bff" />
            <p>Use a shorter workspace window if you need it.</p>
          </div>
        </Card>
      </div>
      <div className="d-billing-note">
        <LockKeyhole size={21} />
        <div>
          <h3>Clear limits. Deliberate spend.</h3>
          <p>
            Replays check your plan, credit and configured cap before provider
            execution. Retried requests are accounted for idempotently on the
            server.
          </p>
        </div>
        <Link className="d-text-link" to="/pricing">
          Compare plans
          <ArrowUpRight size={13} />
        </Link>
      </div>
    </>
  );
}

function SettingsView() {
  const [tab, setTab] = useState("Profile"),
    [saved, setSaved] = useState(false),
    [revoked, setRevoked] = useState(false);
  return (
    <>
      <div className="d-filter-tabs" role="group" aria-label="Settings section">
        {["Profile", "Workspace", "Security"].map((t) => (
          <button
            type="button"
            key={t}
            aria-pressed={tab === t}
            onClick={() => {
              setTab(t);
              setSaved(false);
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="d-settings-layout">
        <aside>
          <h2>
            {tab === "Profile"
              ? "A familiar workspace."
              : tab === "Workspace"
                ? "Set the boundaries."
                : "Keep access deliberate."}
          </h2>
          <p>
            {tab === "Profile"
              ? "Your profile and communication preferences follow your account."
              : tab === "Workspace"
                ? "Workspace name, sample capture and retention belong in one clear place."
                : "Inspect sessions and connection access. Server policies enforce your role."}
          </p>
          <Zev view="pose-sitting" height={125} />
        </aside>
        <Card
          title={`${tab} preferences`}
          subtitle="Changes are local to this demo."
        >
          <form
            className="d-form"
            onSubmit={(e) => {
              e.preventDefault();
              setSaved(true);
            }}
            key={tab}
          >
            {tab === "Profile" ? (
              <>
                <label htmlFor="display-name">
                  Display name
                  <input
                    id="display-name"
                    defaultValue="Alex Morgan"
                    required
                  />
                </label>
                <label htmlFor="profile-email">
                  Email
                  <input
                    id="profile-email"
                    defaultValue="alex@example.com"
                    type="email"
                    required
                  />
                </label>
                <label htmlFor="timezone">
                  Timezone
                  <select id="timezone" defaultValue="Asia/Ulaanbaatar">
                    <option>Asia/Ulaanbaatar</option>
                    <option>UTC</option>
                    <option>America/New_York</option>
                  </select>
                </label>
                <label className="d-checkbox">
                  <input type="checkbox" defaultChecked />
                  Experiment completion updates
                </label>
                <label className="d-checkbox">
                  <input type="checkbox" />
                  Weekly summary
                </label>
              </>
            ) : tab === "Workspace" ? (
              <>
                <label htmlFor="workspace-name">
                  Workspace name
                  <input
                    id="workspace-name"
                    defaultValue="Support intelligence"
                    required
                  />
                </label>
                <label htmlFor="retention">
                  Telemetry retention
                  <select id="retention" defaultValue="30">
                    <option value="7">7 days</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days · plan dependent</option>
                  </select>
                </label>
                <label className="d-checkbox">
                  <input type="checkbox" />
                  Opt in to sanitized sample capture
                </label>
                <p>
                  Sample capture is opt-in. Production settings remain subject
                  to the workspace owner’s plan and role.
                </p>
              </>
            ) : (
              <>
                <div className="d-security-setting">
                  <ShieldCheck size={22} />
                  <div>
                    <b>Current sample session</b>
                    <p>Browser · design preview</p>
                  </div>
                  <Badge value="Active" />
                </div>
                <div className="d-security-setting">
                  <LockKeyhole size={22} />
                  <div>
                    <b>Secondary sample session</b>
                    <p>Illustrative session record</p>
                  </div>
                  <button
                    type="button"
                    className="d-text-link"
                    onClick={() => setRevoked((v) => !v)}
                  >
                    {revoked ? "Restore demo session" : "Revoke in demo"}
                  </button>
                </div>
                {revoked && (
                  <p role="status">
                    Sample session marked revoked. No real access changed.
                  </p>
                )}
                <Link className="d-text-link" to="/forgot-password">
                  Password recovery page
                  <ArrowUpRight size={12} />
                </Link>
              </>
            )}
            {tab !== "Security" && (
              <button className="z-button z-button-blue" type="submit">
                Save in this demo
                <Check size={14} />
              </button>
            )}
            {saved && (
              <p className="d-saved" role="status">
                <CheckCircle2 size={14} />
                Preferences updated in this demo only.
              </p>
            )}
          </form>
        </Card>
      </div>
    </>
  );
}

const DOCS: Record<string, { title: string; body: string; code: string }> = {
  "Quick start": {
    title: "Start with one representative workload.",
    body: "Create a project, connect metadata and inspect the real execution baseline. For replay, prepare representative request and output samples before choosing a candidate.",
    code: "1. Create a project\n2. Scan the repository locally\n3. Connect runtime metadata\n4. Import representative traces\n5. Test a bounded candidate\n6. Inspect every gate\n7. Review the patch",
  },
  Telemetry: {
    title: "Send metadata with a scoped token.",
    body: "Create the connection in your live workspace. Tokens are shown once. Keep them on your server, and revoke them when the connection is no longer needed.",
    code: 'POST /api/telemetry/ingest\nAuthorization: Bearer <your-scoped-token>\nContent-Type: application/json\n\n{ "events": [{\n  "trace_id": "example_request",\n  "provider": "openai",\n  "model": "gpt-4o",\n  "operation": "classify.intent",\n  "status": "ok",\n  "input_tokens": 812,\n  "output_tokens": 14,\n  "latency_ms": 1980,\n  "cost_usd": 0.0188\n}] }',
  },
  Replay: {
    title: "Same cases. A bounded alternative.",
    body: "A replay compares a candidate to captured baseline evidence. Choose representative samples, set the spend cap and freeze quality constraints before running.",
    code: "baseline evidence\n  ↳ request + baseline output\n  ↳ model + cost source\n  ↳ representative case set\n\ncandidate\n  ↳ bounded strategy\n  ↳ frozen quality constraints\n  ↳ explicit spend cap\n\nresult\n  ↳ measured comparison\n  ↳ provenance + gate decisions",
  },
  Verification: {
    title: "Every configured gate must pass.",
    body: "Minimum samples, evidence completeness, execution success, quality, cost and latency are checked together. A candidate that fails remains rejected, with the reason visible.",
    code: "minimum_samples        → required\nevidence_completeness  → required\nexecution_success      → required\nquality_floor          → required\ncost_improvement       → required\nlatency_regression     → bounded\n\nall gates pass → verified on this replay\nany gate fails → rejected / needs evidence",
  },
};
function DocsView() {
  const [tab, setTab] = useState("Quick start"),
    doc = DOCS[tab];
  return (
    <div className="d-docs">
      <nav aria-label="Documentation topics">
        {Object.keys(DOCS).map((t) => (
          <button
            type="button"
            className={tab === t ? "active" : ""}
            key={t}
            onClick={() => setTab(t)}
          >
            <FileText size={14} />
            {t}
            <ChevronRight size={12} />
          </button>
        ))}
        <Link to="/security">
          <ShieldCheck size={14} />
          Security overview
          <ArrowUpRight size={12} />
        </Link>
      </nav>
      <article>
        <span className="d-docs-kicker">
          ZEVQORA DOCS / {tab.toUpperCase()}
        </span>
        <h2>{doc.title}</h2>
        <p>{doc.body}</p>
        <div className="d-docs-code">
          <div>
            <Terminal size={13} />
            <span>
              {tab === "Telemetry"
                ? "HTTP / EXAMPLE PAYLOAD"
                : "WORKFLOW REFERENCE"}
            </span>
            <CopyButton value={doc.code} size="xs" />
          </div>
          <pre>{doc.code}</pre>
        </div>
        <div className="d-docs-callout">
          <ShieldCheck size={19} />
          <p>
            This is a compact frontend guide. Use your live workspace and
            repository documentation for configured limits, authentication and
            deployment details.
          </p>
        </div>
        <a
          href="https://github.com/ZEVQORA/Zevqora"
          target="_blank"
          rel="noreferrer"
          className="d-text-link"
        >
          Read repository documentation
          <ArrowUpRight size={13} />
        </a>
      </article>
    </div>
  );
}

function OnboardingView() {
  const [step, setStep] = useState(0),
    [name, setName] = useState("Support intelligence");
  return (
    <div className="d-onboarding">
      <div className="d-onboarding-steps">
        {["Workspace", "Evidence", "Your first step"].map((s, i) => (
          <span
            className={step === i ? "active" : step > i ? "done" : ""}
            key={s}
          >
            <b>{step > i ? <Check size={12} /> : `0${i + 1}`}</b>
            {s}
          </span>
        ))}
      </div>
      <div className="d-onboarding-content">
        <Zev view={step === 1 ? "pose-thinking" : "pose-waving"} height={150} />
        <h2>
          {
            [
              "A name for your work.",
              "Start with useful evidence.",
              "A clearer view is ready.",
            ][step]
          }
        </h2>
        <p>
          {
            [
              "Choose the workload you want to understand first.",
              "In the live app, scan a repository and connect runtime traces. This demo uses a prepared sample.",
              "Explore the sample workspace, inspect an opportunity and see why quality decides the result.",
            ][step]
          }
        </p>
        {step === 0 && (
          <label htmlFor="onboarding-name">
            Workspace name
            <input
              id="onboarding-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
        )}
        {step === 1 && (
          <div className="d-onboarding-evidence">
            <FolderGit2 size={20} />
            <span>
              support-intelligence
              <small>Sample repository · 8 AI call sites</small>
            </span>
            <Badge value="Prepared sample" />
          </div>
        )}
        {step < 2 ? (
          <button
            className="z-button z-button-blue"
            type="button"
            disabled={!name.trim()}
            onClick={() => setStep((s) => s + 1)}
          >
            Continue
            <ArrowRight size={14} />
          </button>
        ) : (
          <Link to="/demo" className="z-button z-button-blue">
            Open {name}
            <ArrowUpRight size={14} />
          </Link>
        )}
        {step > 0 && (
          <button
            type="button"
            className="d-onboarding-back"
            onClick={() => setStep((s) => s - 1)}
          >
            Back
          </button>
        )}
      </div>
      <DemoHint>
        Sample setup only. No account, workspace or connection is created.
      </DemoHint>
    </div>
  );
}

function StatesView() {
  return (
    <div className="d-state-grid">
      <Card
        title="Loading"
        subtitle="A stable layout while the evidence arrives."
      >
        <div className="d-state-body">
          <div className="skeleton h-6 w-2/3" />
          <div className="skeleton mt-4 h-24 w-full" />
          <div className="skeleton mt-4 h-4 w-1/2" />
        </div>
      </Card>
      <Card title="Empty" subtitle="A useful first action.">
        <div className="d-empty">
          <FolderGit2 size={32} />
          <h3>No repository connected yet.</h3>
          <p>Start with one workload to get a clearer view.</p>
          <Link to="/demo/onboarding">
            Explore setup
            <ArrowRight size={13} />
          </Link>
        </div>
      </Card>
      <Card
        title="Connection unavailable"
        subtitle="Explain the boundary, preserve the work."
      >
        <div className="d-empty">
          <Activity size={32} />
          <h3>The runtime is unavailable.</h3>
          <p>
            Your evidence stays available. Check the scoped connection in your
            live workspace.
          </p>
          <Link to="/demo/connections">
            Review connections
            <ArrowRight size={13} />
          </Link>
        </div>
      </Card>
      <Card
        title="Permission required"
        subtitle="A clear explanation before an action."
      >
        <div className="d-empty">
          <LockKeyhole size={32} />
          <h3>An owner needs to make this change.</h3>
          <p>Workspace billing and admin roles are enforced by the server.</p>
          <Link to="/demo/team">
            View sample roles
            <ArrowRight size={13} />
          </Link>
        </div>
      </Card>
    </div>
  );
}

function AdminControls({ content = false }: { content?: boolean }) {
  const [saved, setSaved] = useState(false),
    [flags, setFlags] = useState([true, true, false]);
  return (
    <Card
      title={content ? "Public website content" : "Feature configuration"}
      subtitle="Local administrative preview · no production mutation"
    >
      <div className="d-admin-editor">
        {content ? (
          <form
            className="d-form"
            onSubmit={(e) => {
              e.preventDefault();
              setSaved(true);
            }}
          >
            <label htmlFor="hero-headline">
              Hero headline
              <input
                id="hero-headline"
                defaultValue="Make AI lighter."
                required
              />
            </label>
            <label htmlFor="hero-subline">
              Supporting line
              <textarea
                id="hero-subline"
                defaultValue="Cut AI COGS without cutting product quality."
                rows={3}
                required
              />
            </label>
            <label htmlFor="status-banner">
              Public status banner
              <input id="status-banner" placeholder="No active banner" />
            </label>
            <button type="submit" className="z-button z-button-blue">
              Save in this demo
              <Check size={14} />
            </button>
            {saved && (
              <p className="d-saved" role="status">
                Sample content saved locally. The website is unchanged.
              </p>
            )}
          </form>
        ) : (
          <>
            {[
              ["cloud_replay", "Bounded candidate replay on platform compute."],
              ["telemetry", "Scoped runtime metadata ingestion."],
              ["new_gate_preview", "Illustrative unreleased gate preview."],
            ].map(([flag, description], i) => (
              <div key={flag} className="d-admin-flag">
                <div>
                  <b>{flag}</b>
                  <p>{description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={flags[i]}
                  aria-label={flag}
                  onClick={() =>
                    setFlags((f) => f.map((v, n) => (n === i ? !v : v)))
                  }
                >
                  <span />
                </button>
              </div>
            ))}
            <DemoHint>Switches only change this demo’s local state.</DemoHint>
          </>
        )}
      </div>
    </Card>
  );
}

function AdminOverview() {
  return (
    <>
      <Metrics
        values={[
          ["Sample workspaces", "03", "Fictional administrative dataset"],
          ["Active users", "02", "1 additional pending account"],
          ["Replay jobs", "03", "Internal benchmark fixtures"],
          ["Audit coverage", "On", "Illustrative audit trail"],
        ]}
      />
      <div className="d-admin-overview">
        <Card
          title="Operations, with boundaries"
          subtitle="Deliberate actions. Inspectable history."
        >
          <div className="d-admin-status">
            {[
              "Session and role checks",
              "Workspace isolation",
              "Credit accounting",
              "Audit logging",
            ].map((s) => (
              <div key={s}>
                <ShieldCheck size={17} />
                <span>{s}</span>
                <Badge value="Configured" />
              </div>
            ))}
          </div>
        </Card>
        <Card
          title="Public experience"
          subtitle="A consistent system from first visit to daily work."
        >
          <div className="d-admin-links">
            {[
              ["Website content", "/demo/admin/content"],
              ["Pricing & plans", "/demo/admin/pricing"],
              ["Feature flags", "/demo/admin/flags"],
            ].map(([t, to]) => (
              <Link to={to} key={t}>
                {t}
                <ArrowUpRight size={15} />
              </Link>
            ))}
          </div>
        </Card>
      </div>
      <RecordsView screen="admin-audit" />
    </>
  );
}

export function DemoViews({
  screen,
  admin,
}: {
  screen: string;
  admin: boolean;
}) {
  if (admin) {
    if (screen === "overview") return <AdminOverview />;
    if (screen === "content" || screen === "flags")
      return <AdminControls content={screen === "content"} />;
    return <RecordsView screen={`admin-${screen}`} />;
  }
  switch (screen) {
    case "overview":
    case "dashboard":
      return <Overview />;
    case "project":
      return <ProjectView />;
    case "projects":
      return <ProjectsView />;
    case "opportunities":
      return <OpportunityView />;
    case "experiments":
      return <ExperimentsView />;
    case "changes":
      return <ChangesView />;
    case "zev":
      return <ZevView />;
    case "runtime":
      return <RuntimeView />;
    case "usage":
      return <UsageView />;
    case "settings":
      return <SettingsView />;
    case "docs":
      return <DocsView />;
    case "onboarding":
      return <OnboardingView />;
    case "states":
      return <StatesView />;
    case "runs":
    case "evidence":
    case "connections":
    case "reports":
    case "team":
      return <RecordsView screen={screen} />;
    default:
      return (
        <div className="d-empty">
          <h2>Let’s find a clearer view.</h2>
          <Link to="/demo">
            Open the sample overview
            <ArrowRight size={15} />
          </Link>
        </div>
      );
  }
}
