import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session';
import { NAV, useProjects } from './AppShell';
import { Kbd } from '@/components/ui/Misc';

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  run: () => void;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { me, activeWorkspace, setActiveWorkspaceId, setActiveProjectId, signOut } = useSession();
  const { projects } = useProjects();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = NAV.map((n) => ({ id: `nav:${n.to}`, label: `Go to ${n.label}`, group: 'Navigate', run: () => navigate(n.to) }));
    list.push({ id: 'act:analyze', label: 'Run analysis', hint: 'Opportunities → Run analysis', group: 'Actions', run: () => navigate('/app/opportunities?analyze=1') });
    list.push({ id: 'act:connect', label: 'Connect a runtime', group: 'Actions', run: () => navigate('/app/connections?new=1') });
    list.push({ id: 'act:project', label: 'Create project', group: 'Actions', run: () => navigate('/app/projects?new=1') });
    list.push({ id: 'act:invite', label: 'Invite a teammate', group: 'Actions', run: () => navigate('/app/team?invite=1') });
    for (const w of me?.workspaces || []) if (w.id !== activeWorkspace?.id) list.push({ id: `ws:${w.id}`, label: `Switch to ${w.name}`, group: 'Workspaces', run: () => { setActiveWorkspaceId(w.id); navigate('/app'); } });
    list.push({ id: 'proj:all', label: 'All projects', group: 'Projects', run: () => setActiveProjectId(null) });
    for (const p of projects) list.push({ id: `proj:${p.id}`, label: `Project: ${p.name}`, group: 'Projects', run: () => setActiveProjectId(p.id) });
    if (me?.isAdmin) {
      list.push({ id: 'admin:home', label: 'Admin: Control centre', group: 'Admin', run: () => navigate('/admin') });
      list.push({ id: 'admin:users', label: 'Admin: Users', group: 'Admin', run: () => navigate('/admin/users') });
      list.push({ id: 'admin:pricing', label: 'Admin: Pricing', group: 'Admin', run: () => navigate('/admin/pricing') });
      list.push({ id: 'admin:audit', label: 'Admin: Audit log', group: 'Admin', run: () => navigate('/admin/audit') });
    }
    list.push({ id: 'act:signout', label: 'Sign out', group: 'Account', run: () => void signOut().then(() => navigate('/')) });
    return list;
  }, [navigate, me, activeWorkspace, projects, setActiveWorkspaceId, setActiveProjectId, signOut]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.slice(0, 14);
    return commands.filter((c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)).slice(0, 14);
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);
  useEffect(() => setIndex(0), [query]);

  const run = (c: Command) => {
    onClose();
    c.run();
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[85] flex items-start justify-center px-4 pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
          <div className="absolute inset-0 bg-ink/20 backdrop-blur-[3px]" onClick={onClose} aria-hidden />
          <motion.div role="dialog" aria-modal="true" aria-label="Command palette" className="glass-pop relative w-full max-w-xl overflow-hidden rounded-xl" initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.99 }} transition={{ type: 'spring', stiffness: 420, damping: 34 }}>
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search size={16} className="text-subtle" aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(filtered.length - 1, i + 1)); }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
                  if (e.key === 'Enter' && filtered[index]) run(filtered[index]);
                  if (e.key === 'Escape') onClose();
                }}
                placeholder="Search actions, pages, projects…"
                aria-label="Search commands"
                className="text-body h-12 w-full bg-transparent text-ink outline-none placeholder:text-subtle"
              />
              <Kbd>esc</Kbd>
            </div>
            <ul role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
              {filtered.map((c, i) => (
                <li key={c.id} role="option" aria-selected={i === index}>
                  <button type="button" onMouseEnter={() => setIndex(i)} onClick={() => run(c)} className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-control', i === index ? 'bg-accent-subtle text-ink' : 'text-ink hover:bg-ink/5')}>
                    <span className="text-caption flex-1 truncate">{c.label}</span>
                    {c.hint && <span className="text-technical truncate text-subtle">{c.hint}</span>}
                    <span className="text-technical font-mono uppercase text-subtle">{c.group}</span>
                    {i === index && <ArrowRight size={13} className="text-accent-text" aria-hidden />}
                  </button>
                </li>
              ))}
              {!filtered.length && <li className="text-caption px-3 py-6 text-center text-subtle">No matching commands.</li>}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
