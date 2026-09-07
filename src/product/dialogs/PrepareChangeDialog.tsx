import { useMemo, useState } from 'react';
import { FolderOpen, GitBranch } from 'lucide-react';
import { useProduct } from '../store';
import { engineErrorMessage } from '../engine';
import { Button, Field, Modal, Note } from '../ui';
import type { Experiment, Implementation } from '../types';

export function PrepareChangeDialog({ experiment, onClose, onComplete }: { experiment: Experiment | null; onClose: () => void; onComplete: (implementation: Implementation) => Promise<void> | void }) {
  const { engine, runtime, selected, model, health, findings, pickedRepository, ensureRepository, setZevState } = useProduct();
  const [instructions, setInstructions] = useState('');
  const [runTests, setRunTests] = useState(false);
  const [testCommand, setTestCommand] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const finding = useMemo(() => (experiment ? findings.find((f) => f.id === experiment.finding_id) || null : null), [experiment, findings]);
  const staticFinding = Boolean(finding && finding.file_path !== 'runtime evidence');
  const browser = runtime === 'browser';
  const folderReady = !browser || Boolean(pickedRepository && (!selected || pickedRepository.rootPath === selected.root_path));

  if (!experiment || !selected) return null;

  const prepare = async () => {
    setBusy(true);
    setError('');
    setZevState('experimenting');
    try {
      let extra: { target_file?: string; source_text?: string } = {};
      if (browser) {
        if (!finding || !staticFinding) throw new Error('This experiment is not linked to a source-code finding, so there is no file to change.');
        const repo = await ensureRepository();
        if (!repo) throw new Error('Pick the repository folder so the file can be read.');
        const text = await repo.read(finding.file_path);
        if (text === null) throw new Error(`${finding.file_path} was not found in the folder you picked.`);
        extra = { target_file: finding.file_path, source_text: text };
      }
      const result = await engine.prepareImplementation(selected.id, {
        experiment_id: experiment.id,
        instructions: instructions.trim() || undefined,
        model: model.trim() || undefined,
        run_tests: !browser && runTests,
        test_command: !browser && runTests ? testCommand.trim() || undefined : undefined,
        ...extra,
      });
      setZevState('done');
      window.setTimeout(() => setZevState('idle'), 1200);
      await onComplete(result);
      onClose();
    } catch (err) {
      setError(engineErrorMessage(err));
      setZevState('idle');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(experiment)}
      onClose={busy ? () => undefined : onClose}
      eyebrow="Explicit source-change approval"
      title="Prepare an isolated change"
      description={browser ? 'ZEVQORA asks the model for a minimal one-file replacement that reflects the verified experiment and shows you the diff. Apply it on a branch yourself; nothing is merged or deployed.' : 'ZEVQORA creates a new Git worktree and branch, asks the model for a minimal one-file replacement that reflects the verified experiment, and shows you the diff. It will not merge or deploy.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="inverse" onClick={() => void prepare()} loading={busy} disabled={(!browser && runTests && !testCommand.trim()) || (browser && !staticFinding)}>
            <GitBranch size={14} /> {busy ? (browser ? 'Preparing patch…' : 'Preparing worktree…') : 'Prepare candidate'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {!health?.openrouter_configured && <Note tone="warn">A model provider is required to write the candidate. {browser ? 'Platform compute is not configured.' : 'Sign in for platform compute or add a local key in Settings.'}</Note>}
        {browser && !staticFinding && <Note tone="warn">Only experiments linked to a source-code finding can prepare a change. This one came from runtime evidence.</Note>}
        {browser && staticFinding && finding && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-cloud px-3 py-2.5 text-[12.5px] text-muted">
            <span>Target file <b className="mono text-ink">{finding.file_path}</b>{folderReady ? ' · read from the folder you picked' : ' · pick the repository folder to read it'}</span>
            {!folderReady && <Button size="xs" variant="secondary" onClick={() => void ensureRepository()}><FolderOpen size={12} /> Pick folder</Button>}
          </div>
        )}
        <Field label="Implementation guidance (optional)"><textarea className="ptextarea" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. preserve the public API and keep the baseline model as fallback" /></Field>
        {!browser && (
          <>
            <label className="pcheckbox"><input type="checkbox" checked={runTests} onChange={(e) => setRunTests(e.target.checked)} /><span><b>Run my project test command in the isolated worktree.</b><br />Executed only because you provide and approve it. Shell operators are refused.</span></label>
            {runTests && <Field label="Test command"><input className="pinput mono" value={testCommand} onChange={(e) => setTestCommand(e.target.value)} placeholder="pytest -q" /></Field>}
          </>
        )}
        <Note tone="info">{browser ? 'Files containing secret-like values are never sent or rewritten. The patch is yours to review and apply with git apply.' : 'Python targets always receive a compile check. Files containing secret-like values are never sent or rewritten.'}</Note>
        {error && <Note tone="error">{error}</Note>}
      </div>
    </Modal>
  );
}
