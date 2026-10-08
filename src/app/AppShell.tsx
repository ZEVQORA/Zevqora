import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { BarChart3, BookOpen, Boxes, ClipboardCheck, ChevronsUpDown, FileCheck2, FlaskConical, FolderGit2, Gauge, GitPullRequest, Home, LayoutDashboard, Lightbulb, LogOut, Menu, MessageSquare, Monitor, Network, Plug, Scale, Search, Settings, Shield, Stethoscope, Users, X, PanelLeftClose, PanelLeftOpen, ChevronRight, Check, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session';
import { ZevqoraMark } from '@/brand/ZevqoraMark';
import { ZevqoraLogo } from '@/brand/ZevqoraLogo';
import { Avatar, Kbd } from '@/components/ui/Misc';
import { FullPageLoader } from '@/brand/BrandLoader';
import { CommandPalette } from './CommandPalette';
import { PresentationModeProvider, usePresentationMode, MODES } from '@/lib/mode';
import { Popover } from '@/components/ui/Overlay';
import { experienceApi, type CommandCenter } from '@/product/experience';
import { Bell, Eye } from 'lucide-react';

export const NAV: Array<{ to: string; label: string; Icon: typeof Home; end?: boolean; section?: string; flag?: string }> = [
  { to: '/app', label: 'Command Center', Icon: LayoutDashboard, end: true },
  { to: '/app/workloads', label: 'Workloads', Icon: Boxes },
  // Shown only to workspaces with the flag on (no global launch).
  { to: '/app/graph', label: 'Execution Graph', Icon: Network, flag: 'zevir_graph_ui' },
  { to: '/app/diagnoses', label: 'Diagnoses', Icon: Stethoscope },
  { to: '/app/optimize', label: 'Optimization', Icon: Gauge, flag: 'verified_optimization_vnext' },
  { to: '/app/experiments', label: 'Experiments', Icon: FlaskConical, end: true },
  { to: '/app/evidence', label: 'Evidence', Icon: FileCheck2 },
  { to: '/app/changes', label: 'Changes', Icon: GitPullRequest },
  { to: '/app/value', label: 'Value', Icon: Scale },
  { to: '/app/connections', label: 'Connections', Icon: Plug },
  { to: '/app/team', label: 'Team', Icon: Users, section: 'Workspace' },
  { to: '/app/settings', label: 'Settings', Icon: Settings },
  { to: '/app/project', label: 'Repository', Icon: FolderGit2, section: 'More' },
  { to: '/app/opportunities', label: 'Opportunities', Icon: Lightbulb, end: true },
  { to: '/app/evaluation', label: 'Evaluation', Icon: ClipboardCheck },
  { to: '/app/savings', label: 'Savings ledger', Icon: BarChart3 },
  { to: '/app/zev', label: 'Ask Zev', Icon: MessageSquare },
  { to: '/app/usage', label: 'Usage', Icon: BarChart3 },
  { to: '/app/docs', label: 'Docs', Icon: BookOpen },
  { to: '/download', label: 'Desktop app', Icon: Monitor },
];

/** A nav item behind a workspace flag is shown only where that flag is on. */
export function navVisible(item: { flag?: string }, features: Record<string, boolean> | undefined) {
  return !item.flag || Boolean(features?.[item.flag]);
}

/** Product routes render edge-to-edge (they carry their own toolbar and Evidence Inspector). */
const PRODUCT_PATHS = new Set(['/app', '/app/overview', '/app/workloads', '/app/graph', '/app/diagnoses', '/app/value', '/app/project', '/app/optimize', '/app/opportunities', '/app/experiments', '/app/evidence', '/app/savings', '/app/evaluation', '/app/changes', '/app/connections', '/app/zev']);
export function isProductPath(pathname: string) {
  return PRODUCT_PATHS.has(pathname.replace(/\/+$/, '') || '/app');
}

function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const { me, activeWorkspace, setActiveWorkspaceId } = useSession();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  if (!activeWorkspace) return null;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open} className={cn('flex w-full items-center gap-2.5 rounded-md border border-line/70 bg-surface/70 px-2.5 py-2 text-left transition-control hover:bg-surface', collapsed && 'justify-center px-0')}>
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-accent-subtle font-semibold text-accent-text">{activeWorkspace.name[0]?.toUpperCase()}</span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="text-caption block truncate font-medium text-ink">{activeWorkspace.name}</span>
              <span className="text-technical block truncate font-mono uppercase text-subtle">{activeWorkspace.plan} · {activeWorkspace.role}</span>
            </span>
            <ChevronsUpDown size={14} className="text-subtle" aria-hidden />
          </>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div role="listbox" className="glass-pop absolute left-0 top-full z-40 mt-1.5 w-64 rounded-lg p-1.5">
            {me?.workspaces.map((w) => (
              <button key={w.id} type="button" role="option" aria-selected={w.id === activeWorkspace.id} onClick={() => { setActiveWorkspaceId(w.id); setOpen(false); navigate('/app'); }} className={cn('flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-control hover:bg-ink/5', w.id === activeWorkspace.id && 'bg-ink/5')}>
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-accent-subtle text-[11px] font-semibold text-accent-text">{w.name[0]?.toUpperCase()}</span>
                <span className="text-caption min-w-0 flex-1 truncate text-ink">{w.name}</span>
                {w.id === activeWorkspace.id && <Check size={14} className="text-accent-text" aria-hidden />}
              </button>
            ))}
            <div className="my-1 border-t border-line" />
            <button type="button" onClick={() => { setOpen(false); navigate('/app/settings/workspace?create=1'); }} className="text-caption flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-muted transition-control hover:bg-ink/5 hover:text-ink">
              <Plus size={14} aria-hidden /> New workspace
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function UserMenu() {
  const { me, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const name = me?.profile.display_name || me?.profile.username || me?.user.email || 'Account';
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} className="inline-flex items-center gap-2 rounded-full p-0.5 transition-control hover:bg-ink/5">
        <Avatar name={name} src={me?.profile.avatar_url} size={30} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div role="menu" className="glass-pop absolute right-0 top-full z-40 mt-1.5 w-60 rounded-lg p-1.5">
            <div className="px-2.5 py-2">
              <p className="text-caption truncate font-medium text-ink">{name}</p>
              <p className="text-technical truncate text-subtle">{me?.user.email}</p>
            </div>
            <div className="my-1 border-t border-line" />
            <button type="button" role="menuitem" onClick={() => { setOpen(false); navigate('/app/settings'); }} className="text-caption flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-ink transition-control hover:bg-ink/5"><Settings size={14} /> Settings</button>
            {me?.isAdmin && (
              <button type="button" role="menuitem" onClick={() => { setOpen(false); navigate('/admin'); }} className="text-caption flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-ink transition-control hover:bg-ink/5"><Shield size={14} /> Admin</button>
            )}
            <button type="button" role="menuitem" onClick={() => { setOpen(false); void signOut().then(() => navigate('/')); }} className="text-caption flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-rejected transition-control hover:bg-rejected-bg"><LogOut size={14} /> Sign out</button>
          </div>
        </>
      )}
    </div>
  );
}

const TITLES: Record<string, string> = Object.fromEntries(NAV.map((n) => [n.to, n.label]));

/** Presentation view (CEO / CTO / Developer). Changes emphasis only — never permissions. */
function ModeMenu() {
  const { mode, setMode } = usePresentationMode();
  const current = MODES.find((m) => m.value === mode)!;
  return (
    <Popover
      label="Presentation view"
      trigger={(t) => (
        <button type="button" onClick={t.toggle} aria-expanded={t['aria-expanded']} aria-controls={t['aria-controls']} aria-haspopup="dialog" className="text-caption hidden h-8 items-center gap-1.5 rounded-md border border-line/70 bg-surface/70 px-2.5 text-muted transition-control hover:bg-surface hover:text-ink sm:inline-flex">
          <Eye size={13} aria-hidden /> {current.label} view
        </button>
      )}
    >
      {(close) => (
        <div className="w-64">
          <p className="px-2.5 pb-1.5 pt-1 text-[11px] text-subtle">Changes what is emphasised. Your workspace role still decides what you can see and do.</p>
          {MODES.map((m) => (
            <button key={m.value} type="button" aria-pressed={m.value === mode} onClick={() => { setMode(m.value); close(); }} className={cn('flex w-full flex-col rounded-md px-2.5 py-2 text-left transition-control hover:bg-ink/5', m.value === mode && 'bg-ink/5')}>
              <span className="text-caption font-medium text-ink">{m.label}</span>
              <span className="text-[11.5px] text-muted">{m.description}</span>
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

/** Notifications are the real decision queue: items waiting on a person, loaded when opened. */
function Notifications({ workspaceId }: { workspaceId: string }) {
  const [data, setData] = useState<CommandCenter['decision_queue'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const load = () => {
    setError(null);
    experienceApi.commandCenter(workspaceId, 30).then((cc) => setData(cc.decision_queue), (e: Error) => setError(e.message));
  };
  return (
    <Popover
      label="Needs attention"
      trigger={(t) => (
        <button type="button" onClick={() => { if (!t.open) load(); t.toggle(); }} aria-expanded={t['aria-expanded']} aria-controls={t['aria-controls']} aria-label="Needs attention" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-control hover:bg-ink/5 hover:text-ink">
          <Bell size={15} aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <div className="w-80 max-w-[85vw]">
          <p className="px-2.5 pb-1 pt-1 text-[11px] font-medium uppercase tracking-[0.06em] text-subtle">Needs attention</p>
          {error && <p className="px-2.5 py-2 text-[12px] text-rejected">{error}</p>}
          {!data && !error && <p className="px-2.5 py-2 text-[12px] text-muted">Loading…</p>}
          {data && !data.length && <p className="px-2.5 py-2 text-[12px] text-muted">Nothing is waiting on you.</p>}
          {data?.slice(0, 6).map((d, i) => (
            <button key={i} type="button" onClick={() => { close(); navigate(d.href); }} className="flex w-full flex-col rounded-md px-2.5 py-2 text-left transition-control hover:bg-ink/5">
              <span className="text-caption font-medium text-ink">{d.title}</span>
              <span className="text-[11.5px] text-muted">{d.product}</span>
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

export function AppShell() {
  const { me, activeWorkspace, status } = useSession();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('zevqora.sidebar') === 'collapsed';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);


  useEffect(() => {
    try {
      localStorage.setItem('zevqora.sidebar', collapsed ? 'collapsed' : 'open');
    } catch {
      /* ignore */
    }
  }, [collapsed]);
  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const base = location.pathname.split('/').slice(0, 3).join('/');
    document.title = `${TITLES[base] || 'ZEVQORA'} — ZEVQORA`;
  }, [location.pathname]);

  if (status === 'signed_in' && !me) return <FullPageLoader label="Loading your workspace" />;
  if (me && me.workspaces.length === 0) return <Navigate to="/app/onboarding" replace />;
  if (!activeWorkspace) return <FullPageLoader />;

  const crumbs = location.pathname.split('/').filter(Boolean).slice(1);
  const title = TITLES[location.pathname.split('/').slice(0, 3).join('/')] || 'Command Center';
  const productRoute = isProductPath(location.pathname);

  const sidebar = (
    <aside className={cn('glass-sidebar flex h-full flex-col', collapsed ? 'w-[68px]' : 'w-[248px]')}>
      <div className={cn('flex h-14 items-center border-b border-line/60 px-3', collapsed ? 'justify-center' : 'justify-between')}>
        <Link to="/app" aria-label="ZEVQORA overview" className="inline-flex items-center rounded-sm">
          {collapsed ? <ZevqoraMark height={22} /> : <ZevqoraLogo size={22} />}
        </Link>
        <button type="button" onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className={cn('hidden h-8 w-8 items-center justify-center rounded-md text-subtle transition-control hover:bg-ink/5 hover:text-ink lg:inline-flex', collapsed && 'absolute left-[70px] top-3 glass rounded-md')}>
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>
      <div className="px-2.5 pt-3">
        <WorkspaceSwitcher collapsed={collapsed} />
      </div>
      <nav aria-label="Application" className="scrollbar-thin mt-3 flex-1 overflow-y-auto px-2.5">
        <ul className="flex flex-col gap-0.5">
          {NAV.filter((item) => navVisible(item, activeWorkspace.features)).map((item) => (
            <li key={item.to} className={item.section ? 'mt-2 border-t border-line/60 pt-2' : undefined}>
              {item.section && !collapsed && <div className="text-technical px-2.5 pb-1 pt-1 font-medium uppercase tracking-[0.08em] text-subtle">{item.section}</div>}
              <NavLink to={item.to} end={item.end} title={collapsed ? item.label : undefined} className={({ isActive }) => cn('text-caption group flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-control', isActive ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(15_17_21/0.06),inset_0_0_0_1px_rgb(15_17_21/0.04)]' : 'text-muted hover:bg-surface/60 hover:text-ink', collapsed && 'justify-center px-0')}>
                {({ isActive }) => (
                  <>
                    <item.Icon size={16} className={cn('shrink-0', isActive ? 'text-accent-text' : 'text-subtle group-hover:text-ink')} aria-hidden />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </>
                )}
              </NavLink>
            </li>
          ))}
          {me?.isAdmin && (
            <li className="mt-2 border-t border-line/60 pt-2">
              <NavLink to="/admin" title="Admin" className={({ isActive }) => cn('text-caption group flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-control', isActive ? 'bg-surface text-ink' : 'text-muted hover:bg-surface/60 hover:text-ink', collapsed && 'justify-center px-0')}>
                <Shield size={16} className="shrink-0 text-subtle" aria-hidden />
                {!collapsed && <span>Admin</span>}
              </NavLink>
            </li>
          )}
        </ul>
      </nav>
      {!collapsed && (
        <div className="m-2.5 rounded-lg border border-line/60 bg-surface/60 p-3">
          <div className="flex items-center gap-2.5">
            <img src="/assets/zev/zev-face-calm-confidence.webp" alt="" width={28} height={28} className="h-7 w-7 rounded-full border border-line object-cover" style={{ objectPosition: '50% 38%' }} />
            <p className="text-technical text-muted">Zev only reports what the evidence supports.</p>
          </div>
        </div>
      )}
    </aside>
  );

  return (
    <PresentationModeProvider>
        <div className="app-env flex min-h-dvh">
          <div className="sticky top-0 hidden h-dvh shrink-0 lg:block">{sidebar}</div>
          <AnimatePresence>
            {mobileOpen && (
              <motion.div className="fixed inset-0 z-50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onClick={() => setMobileOpen(false)} aria-hidden />
                <motion.div className="absolute inset-y-0 left-0" initial={{ x: -260 }} animate={{ x: 0 }} exit={{ x: -260 }} transition={{ type: 'spring', stiffness: 400, damping: 36 }}>
                  {sidebar}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="glass-strong sticky top-0 z-30 flex h-14 items-center gap-3 rounded-none border-x-0 border-t-0 border-b border-b-line/60 px-4 lg:px-6">
              <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open navigation" className="-ml-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-ink lg:hidden">
                <Menu size={18} />
              </button>
              <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-caption text-muted sm:flex">
                <span className="truncate">{activeWorkspace.name}</span>
                <ChevronRight size={13} className="text-subtle" aria-hidden />
                <span className="truncate font-medium text-ink">{title}</span>
                {crumbs.length > 1 && (
                  <>
                    <ChevronRight size={13} className="text-subtle" aria-hidden />
                    <span className="truncate font-mono text-technical text-subtle">{crumbs[1].slice(0, 8)}</span>
                  </>
                )}
              </nav>
              <div className="ml-auto flex items-center gap-2">
                <ModeMenu />
                <Notifications workspaceId={activeWorkspace.id} />
                <button type="button" onClick={() => setPaletteOpen(true)} className="text-caption hidden h-8 items-center gap-2 rounded-md border border-line/70 bg-surface/70 px-2.5 text-muted transition-control hover:bg-surface hover:text-ink md:inline-flex" aria-label="Open command palette">
                  <Search size={13} aria-hidden /> Search <Kbd>⌘K</Kbd>
                </button>
                <UserMenu />
              </div>
            </header>
            <main className={cn('min-w-0 flex-1', !productRoute && 'px-4 py-6 lg:px-8 lg:py-8')}>
              {productRoute ? (
                <Outlet />
              ) : (
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={location.pathname.split('/').slice(0, 4).join('/')} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }} className="mx-auto w-full max-w-[1320px]">
                    <Outlet />
                  </motion.div>
                </AnimatePresence>
              )}
            </main>
          </div>
          <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
        </div>
    </PresentationModeProvider>
  );
}

export function PlanGateNotice({ children }: { children: ReactNode }) {
  return (
    <div className="text-caption flex items-center justify-between gap-3 rounded-md border border-accent/25 bg-accent-subtle px-3.5 py-2.5 text-accent-text">
      <span>{children}</span>
      <Link to="/app/usage" className="inline-flex items-center gap-1 whitespace-nowrap font-medium underline-offset-4 hover:underline">
        Upgrade <X size={0} />
      </Link>
    </div>
  );
}
