import { Link } from 'react-router';
import { FolderGit2, Radio, ScanSearch, ShieldCheck, Upload } from 'lucide-react';
import { ProductFrame } from '../Frame';
import { useProduct } from '../store';
import { useProductDialogs } from '../dialogs/context';
import { Button, Card, CardHeader, Empty, KeyValue, StatusChip } from '../ui';
import { relativeTime } from '../format';

/** Evidence sources for the selected project, what each one sends, and its state. */
export default function ConnectionsView() {
  const { selected, economics, aiCalls, runScan, importTraceFile, zevState, runtime, canEdit } = useProduct();
  const dialogs = useProductDialogs();

  if (!selected) {
    return (
      <ProductFrame>
        <Empty title="Nothing connected yet" description="Connect the repository you develop in, or a workload you can export traces from. ZEVQORA reads what you give it and changes nothing." action={<Button onClick={dialogs.openConnect}><FolderGit2 size={15} /> Connect evidence</Button>} />
      </ProductFrame>
    );
  }

  const isWorkload = selected.root_path.startsWith('workload://');
  const scanned = Boolean(selected.last_scan_at);
  const traces = economics?.trace_count ?? 0;
  const baseline = economics?.baseline;

  return (
    <ProductFrame>
      <div className="mb-6">
        <div className="peyebrow">Connections</div>
        <h1 className="ph1">Evidence sources for {selected.name}.</h1>
        <p className="plede">Each source says what it reads, what leaves your machine and what state it is in.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={<span className="inline-flex items-center gap-2"><FolderGit2 size={15} /> Repository</span>}
            description={isWorkload ? 'This project is a workload without a repository.' : selected.root_path}
            action={<StatusChip status={isWorkload ? 'disconnected' : scanned ? 'ok' : 'waiting'} label={isWorkload ? 'NOT USED' : scanned ? 'SCANNED' : 'NOT SCANNED'} />}
          />
          <div className="pcard-body">
            {isWorkload ? (
              <p className="text-[13px] text-muted">Code evidence is optional. Without it ZEVQORA can still establish a baseline and run experiments from traces; it cannot prepare a code change.</p>
            ) : (
              <>
                <KeyValue items={[
                  ['Scanned in', selected.source === 'desktop' ? 'Desktop engine (this machine)' : 'Your browser (this machine)'],
                  ['Last scan', scanned ? relativeTime(selected.last_scan_at) : 'never'],
                  ['Files scanned', String(selected.files_scanned ?? '—')],
                  ['Sensitive paths skipped', String(selected.skipped_sensitive_paths ?? '—')],
                  ['AI call sites found', String(aiCalls.length)],
                  ['Leaves your machine', 'AI call locations and findings only. Source files are not uploaded.'],
                ]} />
                {canEdit && <div className="mt-4"><Button size="sm" variant="secondary" onClick={() => void runScan().catch(() => undefined)} loading={zevState === 'scanning'}><ScanSearch size={14} /> {scanned ? 'Scan again' : 'Scan now'}</Button></div>}
              </>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title={<span className="inline-flex items-center gap-2"><Upload size={15} /> Execution traces</span>}
            description="Recorded requests and outputs the baseline and replays are built from."
            action={<StatusChip status={traces ? (baseline?.stale ? 'waiting' : 'ok') : 'waiting'} label={traces ? (baseline?.stale ? 'STALE' : `${traces} TRACES`) : 'NONE'} />}
          />
          <div className="pcard-body">
            <KeyValue items={[
              ['Traces', String(traces)],
              ['Newest', economics?.latest_evidence_at ? relativeTime(economics.latest_evidence_at) : '—'],
              ['Cost known', baseline ? `${baseline.cost.known} of ${baseline.trace_count}` : '—'],
              ['Gradable (expected answer)', baseline ? `${baseline.evaluation_coverage.with_expected_output} of ${baseline.trace_count}` : '—'],
              ['Stored', 'As you export them, prompts and outputs included. Redact before import.'],
            ]} />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {canEdit && <Button size="sm" onClick={() => void importTraceFile()}><Upload size={14} /> Import traces (JSON / JSONL)</Button>}
              <Link to="/app/docs" className="text-[12.5px] text-muted underline underline-offset-4 hover:text-ink">Trace format</Link>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title={<span className="inline-flex items-center gap-2"><Radio size={15} /> Live runtime ingestion</span>} action={<StatusChip status="disconnected" label="NOT AVAILABLE" />} />
          <div className="pcard-body">
            <p className="text-[13px] text-muted">Streaming production calls straight into the proof engine is not available yet. Export a representative sample of traces and import them instead; the experiment is the same.</p>
          </div>
        </Card>

        <Card>
          <CardHeader title={<span className="inline-flex items-center gap-2"><ShieldCheck size={15} /> Data boundary</span>} />
          <div className="pcard-body">
            <ul className="space-y-2 text-[13px] text-muted">
              <li>Replays send the recorded prompt of each selected case to the candidate model through the ZEVQORA platform key{runtime === 'desktop' ? ', or your local key if you configured one' : ''}.</li>
              <li>Preparing a change sends the one file being changed, only when you ask.</li>
              <li>Traces and evaluations are served only through the API, to members of this workspace.</li>
            </ul>
          </div>
        </Card>
      </div>
    </ProductFrame>
  );
}
