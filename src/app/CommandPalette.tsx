import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Building2, Compass, LogOut, Search, ShieldCheck, Zap } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session';
import { NAV, navVisible } from './AppShell';
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
  const { me, activeWorkspace, setActiveWorkspaceId, signOut } = useSession();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = NAV.filter((n) => navVisible(n, activeWorkspace?.features)).map((n) => ({ id: `nav:${n.to}`, label: `Go to ${n.label}`, group: 'Navigate', run: () => navigate(n.to) }));
    list.push({ id: 'act:connect', label: 'Connect evidence', hint: 'Repository or execution traces', group: 'Actions', run: () => navigate('/app/connections') });
    list.push({ id: 'act:test', label: 'Test an opportunity', group: 'Actions', run: () => navigate('/app/opportunities') });
    list.push({ id: 'act:invite', label: 'Invite a teammate', group: 'Actions', run: () => navigate('/app/team?invite=1') });
    for (const w of me?.workspaces || []) if (w.id !== activeWorkspace?.id) list.push({ id: `ws:${w.id}`, label: `Switch to ${w.name}`, group: 'Workspaces', run: () => { setActiveWorkspaceId(w.id); navigate('/app'); } });
    if (me?.isAdmin) {
      list.push({ id: 'admin:home', label: 'Admin: Control centre', group: 'Admin', run: () => navigate('/admin') });
      list.push({ id: 'admin:users', label: 'Admin: Users', group: 'Admin', run: () => navigate('/admin/users') });
      list.push({ id: 'admin:pricing', label: 'Admin: Pricing', group: 'Admin', run: () => navigate('/admin/pricing') });
      list.push({ id: 'admin:audit', label: 'Admin: Audit log', group: 'Admin', run: () => navigate('/admin/audit') });
    }
    list.push({ id: 'act:signout', label: 'Sign out', group: 'Account', run: () => void signOut().then(() => navigate('/', { state: { site: true } })) });
    return list;
  }, [navigate, me, activeWorkspace, setActiveWorkspaceId, signOut]);

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

  const ICONS: Record<string, typeof Search> = { Navigate: Compass, Actions: Zap, Workspaces: Building2, Admin: ShieldCheck, Account: LogOut };
  let lastGroup = '';

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="zpal-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
          <div className="zpal-backdrop" onClick={onClose} aria-hidden />
          <motion.div role="dialog" aria-modal="true" aria-label="Command palette" className="zpal" initial={{ opacity: 0, y: -14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }} transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
            <div className="zpal-search">
              <Search size={18} aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setIndex((i) => Math.min(filtered.length - 1, i + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setIndex((i) => Math.max(0, i - 1));
                  } else if (e.key === 'Enter' && filtered[index]) {
                    e.preventDefault();
                    run(filtered[index]);
                  } else if (e.key === 'Escape') onClose();
                }}
                placeholder="Search actions, pages, projects…"
                aria-label="Search commands"
              />
              <Kbd>esc</Kbd>
            </div>
            <ul role="listbox" aria-label="Commands" className="zpal-list">
              {filtered.map((c, i) => {
                const Icon = ICONS[c.group] || ArrowRight;
                const header = c.group !== lastGroup;
                lastGroup = c.group;
                return (
                  <li key={c.id} role="option" aria-selected={i === index}>
                    {header && <p className="zpal-group">{c.group}</p>}
                    <button type="button" onMouseEnter={() => setIndex(i)} onClick={() => run(c)} className={cn('zpal-item', i === index && 'is-active')}>
                      <span className="zpal-icon" aria-hidden><Icon size={15} /></span>
                      <span className="zpal-label">{c.label}</span>
                      {c.hint && <span className="zpal-hint">{c.hint}</span>}
                      <ArrowRight size={14} className="zpal-go" aria-hidden />
                    </button>
                  </li>
                );
              })}
              {!filtered.length && <li className="zpal-empty">No matching commands.</li>}
            </ul>
            <div className="zpal-foot" aria-hidden>
              <span><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
              <span><Kbd>↵</Kbd> open</span>
              <span className="zpal-brand"><Kbd>⌘</Kbd><Kbd>K</Kbd> anywhere</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
