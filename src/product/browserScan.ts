/**
 * Local repository scanning in the browser. The user picks a folder; the same
 * scanner the platform ships runs here over the files, and only call sites,
 * findings and counts are uploaded. Source text never leaves the machine.
 */
import { classifyPath, scanFiles, MAX_SOURCE_FILE_BYTES } from '../../api/_lib/product/scanner.js';
import type { ScanUpload } from './types';

export interface PickedRepository {
  name: string;
  rootPath: string;
  fileCount: number;
  upload: ScanUpload;
  /** Read one source file again (for patch preparation). */
  read: (relPath: string) => Promise<string | null>;
}

const MAX_FILES = 6000;

type DirHandle = {
  name: string;
  values: () => AsyncIterable<FileSystemHandle & { kind: 'file' | 'directory'; getFile?: () => Promise<File> }>;
};

export function browserSupportsDirectoryPicker() {
  return typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

async function walk(dir: DirHandle, prefix: string, out: Array<{ path: string; handle: { getFile: () => Promise<File> } }>, skipped: { count: number }) {
  for await (const entry of dir.values()) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      const cls = classifyPath(`${rel}/x.py`);
      if (cls === 'skipped_sensitive') continue;
      await walk(entry as unknown as DirHandle, rel, out, skipped);
      if (out.length > MAX_FILES) return;
    } else {
      const cls = classifyPath(rel);
      if (cls === 'skipped_sensitive') skipped.count += 1;
      if (cls !== 'source') continue;
      out.push({ path: rel, handle: entry as unknown as { getFile: () => Promise<File> } });
      if (out.length > MAX_FILES) return;
    }
  }
}

async function buildUpload(entries: Array<{ path: string; file: () => Promise<File> }>, skipped: number): Promise<ScanUpload> {
  const files: Array<{ path: string; text: string }> = [];
  for (const entry of entries) {
    const f = await entry.file();
    if (f.size > MAX_SOURCE_FILE_BYTES) continue;
    files.push({ path: entry.path, text: await f.text() });
  }
  const result = scanFiles(files);
  return { files_scanned: result.files_scanned, skipped_sensitive_paths: skipped, detected_stack: result.detected_stack, ai_calls: result.ai_calls, findings: result.findings.map(({ evidence_status: _e, ...rest }) => rest) };
}

/** Chrome/Edge: File System Access API. Keeps handles so files can be re-read. */
export async function pickRepositoryWithPicker(): Promise<PickedRepository | null> {
  const picker = (window as unknown as { showDirectoryPicker: (opts?: { mode?: 'read' }) => Promise<DirHandle> }).showDirectoryPicker;
  let dir: DirHandle;
  try {
    dir = await picker({ mode: 'read' });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return null;
    throw error;
  }
  const entries: Array<{ path: string; handle: { getFile: () => Promise<File> } }> = [];
  const skipped = { count: 0 };
  await walk(dir, '', entries, skipped);
  const upload = await buildUpload(entries.map((e) => ({ path: e.path, file: () => e.handle.getFile() })), skipped.count);
  const byPath = new Map(entries.map((e) => [e.path, e.handle]));
  return {
    name: dir.name,
    rootPath: `browser://${dir.name}`,
    fileCount: entries.length,
    upload,
    read: async (relPath) => {
      const h = byPath.get(relPath.replace(/\\/g, '/'));
      if (!h) return null;
      return (await h.getFile()).text();
    },
  };
}

/** Fallback (Firefox/Safari): a directory <input>. Files are read once. */
export async function pickRepositoryWithInput(): Promise<PickedRepository | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    const cleanup = () => input.remove();
    input.addEventListener('change', async () => {
      try {
        const list = Array.from(input.files || []);
        if (!list.length) return resolve(null);
        const rootName = (list[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split('/')[0] || 'repository';
        let skipped = 0;
        const entries: Array<{ path: string; file: () => Promise<File> }> = [];
        const texts = new Map<string, File>();
        for (const f of list) {
          const rel = ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).split('/').slice(1).join('/');
          const cls = classifyPath(rel);
          if (cls === 'skipped_sensitive') skipped += 1;
          if (cls !== 'source') continue;
          entries.push({ path: rel, file: async () => f });
          texts.set(rel, f);
          if (entries.length > MAX_FILES) break;
        }
        const upload = await buildUpload(entries, skipped);
        resolve({ name: rootName, rootPath: `browser://${rootName}`, fileCount: entries.length, upload, read: async (relPath) => (texts.has(relPath) ? texts.get(relPath)!.text() : null) });
      } catch (error) {
        reject(error);
      } finally {
        cleanup();
      }
    });
    input.addEventListener('cancel', () => {
      cleanup();
      resolve(null);
    });
    input.click();
  });
}

export function pickRepository(): Promise<PickedRepository | null> {
  return browserSupportsDirectoryPicker() ? pickRepositoryWithPicker() : pickRepositoryWithInput();
}

/** Read a local JSONL trace export chosen by the user. */
export function pickTraceFile(): Promise<{ name: string; content: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.jsonl,.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) return resolve(null);
      const lowered = f.name.toLowerCase();
      if (lowered.includes('.env') || /secret|credential|private|token|key|production|backup|dump/.test(lowered)) {
        resolve({ name: f.name, content: '' });
        return;
      }
      if (f.size > 3_500_000) {
        resolve({ name: f.name, content: (await f.text()).slice(0, 3_500_000) });
        return;
      }
      resolve({ name: f.name, content: await f.text() });
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    input.click();
  });
}
