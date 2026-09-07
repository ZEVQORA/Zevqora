import { useState } from 'react';
import { ArrowRight, FolderOpen, ShieldCheck } from 'lucide-react';
import { Zev } from '@/brand/Zev';
import { useProduct } from '../store';
import { engineErrorMessage } from '../engine';
import { Button, Field, Modal, Note } from '../ui';
import { browserSupportsDirectoryPicker } from '../browserScan';

export function ConnectRepositoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { runtime, connectRepository } = useProduct();
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const choose = async () => {
    const chosen = await window.zevqoraDesktop?.selectFolder();
    if (chosen) setPath(chosen);
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await connectRepository(runtime === 'desktop' ? { path: path.trim(), name: name.trim() || undefined } : { name: name.trim() || undefined });
      if (result) {
        setPath('');
        setName('');
        onClose();
      }
    } catch (err) {
      setError(engineErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const desktop = runtime === 'desktop';
  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      size="lg"
      eyebrow="Connect repository"
      title="Give Zev a repository to understand."
      description={desktop ? 'Choose the folder you actually develop in. ZEVQORA inspects supported source files read-only and detects the AI stack without changing code.' : 'Pick the project folder in your browser. The scan runs on your machine; only detected call sites, findings and counts are sent to your workspace.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} loading={busy} disabled={desktop && !path.trim()}>
            {busy ? 'Detecting AI stack…' : desktop ? 'Connect and scan' : 'Choose folder and scan'} {!busy && <ArrowRight size={14} />}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_150px]">
        <div className="grid gap-4">
          {desktop ? (
            <Field label="Local project folder">
              <div className="flex gap-2">
                <input className="pinput mono min-w-0 flex-1" value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\projects\my-ai-product" />
                <Button variant="secondary" onClick={() => void choose()}><FolderOpen size={15} /> Browse</Button>
              </div>
            </Field>
          ) : (
            <Note tone="info">{browserSupportsDirectoryPicker() ? 'Your browser will ask which folder to open. Read-only access; nothing is written back.' : 'Your browser will open a folder picker. Files are read once for the scan; pick the folder again later if you prepare a change.'}</Note>
          )}
          <Field label={<span>Product name <span className="font-normal text-subtle">optional</span></span>}>
            <input className="pinput" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Support assistant" />
          </Field>
          <div className="rounded-xl border border-line bg-cloud p-3">
            <div className="flex items-start gap-3">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-verified" />
              <div className="text-[12.5px] text-muted"><b className="text-ink">Local trust boundary.</b> Secret-like paths, .git, dependencies and build output are skipped. Source text is not uploaded during this step.</div>
            </div>
          </div>
          {error && <Note tone="error">{error}</Note>}
        </div>
        <div className="hidden items-end justify-center md:flex">
          <Zev view="pose-sitting" height={150} />
        </div>
      </div>
    </Modal>
  );
}
