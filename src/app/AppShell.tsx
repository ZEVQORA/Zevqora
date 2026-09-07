import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { Activity, BarChart3, BookOpen, ChevronsUpDown, FileText, FlaskConical, FolderKanban, Home, Lightbulb, LogOut, Menu, Monitor, Plug, Radio, Search, Settings, Shield, Users, X, PanelLeftClose, PanelLeftOpen, ChevronRight, Check, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session';
import { ZevqoraMark } from '@/brand/ZevqoraMark';
import { ZevqoraLogo } from '@/brand/ZevqoraLogo';
import { Avatar, Kbd } from '@/components/ui/Misc';
import { FullPageLoader } from '@/brand/BrandLoader';
import { CommandPalette } from './CommandPalette';
import { InspectorProvider, InspectorPanel } from './Inspector';
import { useAsync } from '@/lib/useAsync';
import { listProjects } from './data';
import type { Project } from '@/lib/types';

export const NAV = [
  { to: '/app', label: 'Overview', Icon: Home, end: true },
  { to: '/app/projects', label: 'Projects', Icon: FolderKanban },
  { to: '/app/opportunities', label: 'Opportunities', Icon: Lightbulb },
  { to: '/app/experiments', label: 'Experiments', Icon: FlaskConical },
  { to: '/app/runs', label: 'Runs / Replay', Icon: Activity },
  { to: '/app/evidence', label: 'Evidence', Icon: Shield },
  { to: '/app/runtime', label: 'Live Runtime', Icon: Radio },
  { to: '/app/connections', label: 'Connections', Icon: Plug },
  { to: '/app/reports', label: 'Reports', Icon: FileText },
  { to: '/app/usage', label: 'Usage', Icon: BarChart3 },
  { to: '/app/team', label: 'Team', Icon: Users },
  { to: '/app/settings', label: 'Settings', Icon: Settings },
  { to: '/app/docs', label: 'Docs', Icon: BookOpen },
  { to: '/download', label: 'Desktop app', Icon: Monitor },
];

interface ProjectsCtx {
  projects: Project[];
  loading: boolean;
  reload: () => Promise<void>;
  activeProject: Project | null;
}
const ProjectsContext = createContext<ProjectsCtx | null>(null);
export function useProjects() {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error('useProjects outside AppShell');
  return ctx;
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

function ProjectSwitcher() {
  const { projects, activeProject } = useProjects();
  const { setActiveProjectId } = useSession();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open} className="text-caption inline-flex h-8 items-center gap-1.5 rounded-md border border-line/70 bg-surface/70 px-2.5 text-ink transition-control hover:bg-surface">
        <FolderKanban size={13} className="text-subtle" aria-hidden />
        <span className="max-w-[160px] truncate">{activeProject ? activeProject.name : 'All projects'}</span>
        <ChevronsUpDown size={12} className="text-subtle" aria-hidden />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div role="listbox" className="glass-pop absolute left-0 top-full z-40 mt-1.5 w-60 rounded-lg p-1.5">
            <button type="button" role="option" aria-selected={!activeProject} onClick={() => { setActiveProjectId(null); setOpen(false); }} className={cn('text-caption flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-ink transition-control hover:bg-ink/5', !activeProject && 'bg-ink/5')}>
              All projects {!activeProject && <Check size={14} className="text-accent-text" />}
            </button>
            {projects.map((p) => (
              <button key={p.id} type="button" role="option" aria-selected={activeProject?.id === p.id} onClick={() => { setActiveProjectId(p.id); setOpen(false); }} className={cn('text-caption flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-ink transition-control hover:bg-ink/5', activeProject?.id === p.id && 'bg-ink/5')}>
                <span className="truncate">{p.name}</span>
                {activeProject?.id === p.id && <Check size={14} className="text-accent-text" />}
              </button>
            ))}
            {!projects.length && <p className="text-technical px-2.5 py-2 text-subtle">No projects yet.</p>}
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

export function AppShell() {
  const { me, activeWorkspace, activeProjectId, status } = useSession();
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

  const projectsQuery = useAsync(() => (activeWorkspace ? listProjects(activeWorkspace.id) : Promise.resolve([] as Project[])), [activeWorkspace?.id], { enabled: Boolean(activeWorkspace) });
  const reloadProjects = useCallback(() => projectsQuery.reload(true), [projectsQuery]);
  const projects = useMemo(() => projectsQuery.data || [], [projectsQuery.data]);
  const activeProject = useMemo(() => projects.find((p) => p.id === activeProjectId) || null, [projects, activeProjectId]);
  const projectsCtx = useMemo<ProjectsCtx>(() => ({ projects, loading: projectsQuery.loading, reload: reloadProjects, activeProject }), [projects, projectsQuery.loading, reloadProjects, activeProject]);

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
  const title = TITLES[location.pathname.split('/').slice(0, 3).join('/')] || 'Overview';

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
          {NAV.map((item) => (
            <li key={item.to}>
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
    <ProjectsContext.Provider value={projectsCtx}>
      <InspectorProvider>
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
                <ProjectSwitcher />
                <button type="button" onClick={() => setPaletteOpen(true)} className="text-caption hidden h-8 items-center gap-2 rounded-md border border-line/70 bg-surface/70 px-2.5 text-muted transition-control hover:bg-surface hover:text-ink md:inline-flex" aria-label="Open command palette">
                  <Search size={13} aria-hidden /> Search <Kbd>⌘K</Kbd>
                </button>
                <UserMenu />
              </div>
            </header>
            <main className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={location.pathname.split('/').slice(0, 4).join('/')} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }} className="mx-auto w-full max-w-[1320px]">
                  <Outlet />
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
          <InspectorPanel />
          <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
        </div>
      </InspectorProvider>
    </ProjectsContext.Provider>
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
