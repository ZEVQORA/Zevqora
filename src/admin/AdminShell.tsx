import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Activity, Building2, DollarSign, FileText, Flag, LayoutDashboard, ListChecks, Menu, ShieldCheck, Users, X, ArrowLeft, Coins } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ZevqoraLogo } from '@/brand/ZevqoraLogo';
import { useSession } from '@/lib/session';
import { Avatar } from '@/components/ui/Misc';

const NAV = [
  { to: '/admin', label: 'Control centre', Icon: LayoutDashboard, end: true },
  { to: '/admin/users', label: 'Users', Icon: Users },
  { to: '/admin/workspaces', label: 'Workspaces', Icon: Building2 },
  { to: '/admin/pricing', label: 'Pricing & plans', Icon: DollarSign },
  { to: '/admin/content', label: 'Website content', Icon: FileText },
  { to: '/admin/flags', label: 'Feature flags', Icon: Flag },
  { to: '/admin/model-pricing', label: 'Model pricing', Icon: Coins },
  { to: '/admin/audit', label: 'Audit log', Icon: ListChecks },
  { to: '/admin/admins', label: 'Admins', Icon: ShieldCheck },
];

export function AdminShell() {
  const { me } = useSession();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    document.title = 'Admin — ZEVQORA';
  }, []);
  const sidebar = (
    <aside className="flex h-full w-[248px] flex-col bg-brand-ink text-[#F7F8FA]" data-surface="ink">
      <div className="flex h-14 items-center justify-between border-b border-line px-4">
        <Link to="/admin" aria-label="Admin home"><ZevqoraLogo variant="inverse" size={22} /></Link>
        <span className="rounded-sm border border-warning/40 bg-warning-bg px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-warning">Internal</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Admin">
        <ul className="flex flex-col gap-0.5">
          {NAV.map((n) => (
            <li key={n.to}>
              <NavLink to={n.to} end={n.end} className={({ isActive }) => cn('text-caption flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-control', isActive ? 'bg-surface text-ink' : 'text-muted hover:bg-surface/60 hover:text-ink')}>
                <n.Icon size={15} aria-hidden /> {n.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="border-t border-line p-3">
        <Link to="/app" className="text-caption inline-flex items-center gap-2 text-muted hover:text-ink"><ArrowLeft size={14} /> Back to app</Link>
      </div>
    </aside>
  );
  return (
    <div className="app-env flex min-h-dvh">
      <div className="sticky top-0 hidden h-dvh shrink-0 lg:block">{sidebar}</div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/30" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0">{sidebar}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass-strong sticky top-0 z-30 flex h-14 items-center gap-3 rounded-none border-x-0 border-t-0 border-b border-b-line/60 px-4 lg:px-6">
          <button type="button" onClick={() => setOpen((v) => !v)} aria-label="Toggle admin navigation" className="inline-flex h-9 w-9 items-center justify-center rounded-md lg:hidden">{open ? <X size={18} /> : <Menu size={18} />}</button>
          <p className="text-caption text-muted"><span className="font-medium text-ink">Admin control centre</span> · server-enforced · every mutation audited</p>
          <div className="ml-auto flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 font-mono text-technical text-subtle"><Activity size={12} /> {me?.adminRole}</span>
            <Avatar name={me?.profile.display_name || me?.user.email} src={me?.profile.avatar_url} size={28} />
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-[1320px]"><Outlet /></div>
        </main>
      </div>
    </div>
  );
}
