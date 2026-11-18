import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { BarChart3, BookOpen, Boxes, ClipboardCheck, ChevronsUpDown, FileCheck2, FlaskConical, FolderGit2, Gauge, GitPullRequest, Home, LayoutDashboard, Lightbulb, LogOut, Menu, MessageSquare, Monitor, Network, Plug, Scale, Search, Settings, Shield, SquarePen, Stethoscope, Users, X, PanelLeftClose, PanelLeftOpen, ChevronRight, Check, Plus, CircleHelp, Compass, Code2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session';
import { ZevqoraMark } from '@/brand/ZevqoraMark';
import { ZevqoraLogo } from '@/brand/ZevqoraLogo';
import { Avatar, Kbd } from '@/components/ui/Misc';
import { FullPageLoader } from '@/brand/BrandLoader';
import { CommandPalette } from './CommandPalette';
import { ProductTour, PRODUCT_TOUR_STEPS, productTourStorageKey, type TourOutcome } from './ProductTour';
import { PresentationModeProvider } from '@/lib/mode';
import { Popover } from '@/components/ui/Overlay';
import { experienceApi, type CommandCenter } from '@/product/experience';
import { useZevConversations } from '@/product/zevChat';
import { Bell, Moon, Sun } from 'lucide-react';

/** First name for the welcome (same rule as the chat home: display name, then username). */
const welcomeName = (p: { display_name: string | null; username: string | null } | null | undefined) =>
  (p?.display_name?.trim() || p?.username?.trim() || '').split(/\s+/)[0].slice(0, 40);
import './shell.css';

export type NavGroup = 'Home' | 'Work' | 'Workspace';

/**
 * App navigation. Primary items follow what a person comes to do: ask Zev, see
 * the overview, then the work (workloads, evidence, connections) and the
 * workspace. Less frequent routes sit under "More" and stay in the command
 * palette. No route is removed, so every deep link keeps working; flags still
 * hide what a workspace does not have; nothing here grants permission.
 */
export const NAV: Array<{ to: string; label: string; Icon: typeof Home; end?: boolean; group?: NavGroup; more?: boolean; flag?: string }> = [
  { to: '/app', label: 'Ask Zev', Icon: MessageSquare, end: true, group: 'Home' },
  { to: '/app/command', label: 'Overview', Icon: LayoutDashboard, group: 'Home' },
  { to: '/app/workloads', label: 'Workloads', Icon: Boxes, group: 'Work' },
  // Shown only to workspaces with the flag on (no global launch).
  { to: '/app/graph', label: 'Execution Graph', Icon: Network, flag: 'zevir_graph_ui', group: 'Work' },
  { to: '/app/optimize', label: 'Optimization', Icon: Gauge, flag: 'verified_optimization_vnext', group: 'Work' },
  { to: '/app/evidence', label: 'Evidence', Icon: FileCheck2, group: 'Work' },
  { to: '/app/connections', label: 'Connections', Icon: Plug, group: 'Work' },
  { to: '/app/team', label: 'Team', Icon: Users, group: 'Workspace' },
  { to: '/app/settings', label: 'Settings', Icon: Settings, group: 'Workspace' },
  { to: '/app/diagnoses', label: 'Diagnoses', Icon: Stethoscope, more: true },
  { to: '/app/experiments', label: 'Experiments', Icon: FlaskConical, end: true, more: true },
  { to: '/app/changes', label: 'Changes', Icon: GitPullRequest, more: true },
  { to: '/app/zev', label: 'Zev workbench', Icon: Code2, more: true },
  { to: '/app/value', label: 'Value', Icon: Scale, more: true },
  { to: '/app/opportunities', label: 'Opportunities', Icon: Lightbulb, end: true, more: true },
  { to: '/app/evaluation', label: 'Evaluation', Icon: ClipboardCheck, more: true },
  { to: '/app/savings', label: 'Savings ledger', Icon: BarChart3, more: true },
  { to: '/app/project', label: 'Repository', Icon: FolderGit2, more: true },
  { to: '/app/usage', label: 'Usage', Icon: BarChart3, more: true },
  { to: '/app/enterprise', label: 'Enterprise', Icon: Shield, more: true },
  { to: '/app/docs', label: 'Docs', Icon: BookOpen, more: true },
  { to: '/download', label: 'Desktop app', Icon: Monitor, more: true },
];

export const NAV_GROUPS: NavGroup[] = ['Home', 'Work', 'Workspace'];

/** Visible primary items grouped in order, and the visible "More" items. */
export function navSections(features: Record<string, boolean> | undefined) {
  const visible = NAV.filter((n) => navVisible(n, features));
  const groups = NAV_GROUPS.map((g) => [g, visible.filter((n) => !n.more && n.group === g)] as const).filter(([, items]) => items.length > 0);
  return { groups, more: visible.filter((n) => n.more) };
}

type NavItem = (typeof NAV)[number];

function SideLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  return (
    <NavLink to={item.to} end={item.end} title={collapsed ? item.label : undefined} aria-label={collapsed ? item.label : undefined} className={({ isActive }) => cn('zx-link', isActive && 'is-active', collapsed && 'is-rail')}>
      <item.Icon size={17} className="shrink-0" aria-hidden />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  );
}

/** A nav item behind a workspace flag is shown only where that flag is on. */
export function navVisible(item: { flag?: string }, features: Record<string, boolean> | undefined) {
  return !item.flag || Boolean(features?.[item.flag]);
}

/** Product routes render edge-to-edge (they carry their own toolbar and Evidence Inspector). */
const PRODUCT_PATHS = new Set(['/app', '/app/command', '/app/overview', '/app/workloads', '/app/graph', '/app/diagnoses', '/app/value', '/app/project', '/app/optimize', '/app/opportunities', '/app/experiments', '/app/evidence', '/app/savings', '/app/evaluation', '/app/changes', '/app/connections', '/app/zev']);
export function isProductPath(pathname: string) {
  return PRODUCT_PATHS.has(pathname.replace(/\/+$/, '') || '/app');
}

/**
 * Workspace switcher. A solid dark menu that matches the sidebar (readable in
 * both themes), above every app layer, closed by Escape, a click outside or
 * Tab, and fully operable with the arrow keys. Focus returns to the trigger.
 */
export function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const { me, activeWorkspace, setActiveWorkspaceId } = useSession();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const items = menu.current?.querySelectorAll<HTMLElement>('[data-ws-item]');
    const current = menu.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    (current || items?.[0])?.focus();
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!activeWorkspace) return null;

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const onMenuKey = (e: ReactKeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[data-ws-item]') || [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="zshell-workspaces"
        aria-label={`Workspace: ${activeWorkspace.name}. Switch workspace`}
        className={cn('zshell-ws flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-control', collapsed && 'justify-center px-0')}
      >
        <span className="zshell-ws-initial">{activeWorkspace.name[0]?.toUpperCase()}</span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="zshell-ws-name block truncate">{activeWorkspace.name}</span>
              <span className="zshell-ws-meta block truncate">{activeWorkspace.plan} · {activeWorkspace.role}</span>
            </span>
            <ChevronsUpDown size={15} aria-hidden />
          </>
        )}
      </button>
      {open && (
        <div ref={menu} id="zshell-workspaces" className="zshell-pop" onKeyDown={onMenuKey}>
          <p className="zshell-pop-label" id="zshell-workspaces-label">Workspaces</p>
          <div role="listbox" aria-labelledby="zshell-workspaces-label">
            {me?.workspaces.map((w) => (
              <button
                key={w.id}
                data-ws-item
                type="button"
                role="option"
                aria-selected={w.id === activeWorkspace.id}
                onClick={() => {
                  setActiveWorkspaceId(w.id);
                  close();
                  navigate('/app');
                }}
                className="zshell-pop-item"
              >
                <span className="zshell-ws-initial is-small">{w.name[0]?.toUpperCase()}</span>
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                <span className="zshell-pop-role">{w.role}</span>
                {w.id === activeWorkspace.id && <Check size={15} aria-label="Current workspace" />}
              </button>
            ))}
          </div>
          <div className="zshell-pop-sep" />
          <button
            data-ws-item
            type="button"
            onClick={() => {
              close(false);
              navigate('/app/settings/workspace?create=1');
            }}
            className="zshell-pop-item is-action"
          >
            <Plus size={15} aria-hidden /> New workspace
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The account card at the foot of the sidebar (as in ChatGPT / Claude): the
 * person, their plan, and a menu that opens upward. Closed by Escape, a click
 * outside, or choosing an item.
 */
function AccountMenu({ rail }: { rail: boolean }) {
  const { me, activeWorkspace, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const trigger = useRef<HTMLButtonElement>(null);
  const name = me?.profile.display_name || me?.profile.username || me?.user.email || 'Account';
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };
  return (
    <div className="zx-account">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        title={rail ? name : undefined}
        className={cn('zx-account-btn', rail && 'is-rail')}
      >
        <Avatar name={name} src={me?.profile.avatar_url} size={30} />
        {!rail && (
          <>
            <span className="zx-account-text">
              <b>{name}</b>
              <small>{activeWorkspace ? `${activeWorkspace.plan} plan` : me?.user.email}</small>
            </span>
            <ChevronsUpDown size={15} aria-hidden className="zx-account-chev" />
          </>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <div role="menu" className={cn('zx-menu zx-account-menu', rail && 'is-rail')}>
            <div className="zx-menu-head">
              <b>{name}</b>
              <small>{me?.user.email}</small>
            </div>
            <div className="zx-menu-sep" />
            <button type="button" role="menuitem" onClick={() => go('/app/settings')} className="zx-menu-item"><Settings size={15} aria-hidden /> Settings</button>
            <button type="button" role="menuitem" onClick={() => go('/app/usage')} className="zx-menu-item"><BarChart3 size={15} aria-hidden /> Usage &amp; plan</button>
            <button type="button" role="menuitem" onClick={() => go('/app/docs')} className="zx-menu-item"><BookOpen size={15} aria-hidden /> Docs</button>
            {me?.isAdmin && <button type="button" role="menuitem" onClick={() => go('/admin')} className="zx-menu-item"><Shield size={15} aria-hidden /> Admin</button>}
            <button type="button" role="menuitem" onClick={() => go('/?site=1')} className="zx-menu-item"><Home size={15} aria-hidden /> View website</button>
            <div className="zx-menu-sep" />
            <button type="button" role="menuitem" onClick={() => { setOpen(false); void signOut().then(() => navigate('/', { state: { site: true } })); }} className="zx-menu-item is-danger"><LogOut size={15} aria-hidden /> Sign out</button>
          </div>
        </>
      )}
    </div>
  );
}

/** Starts a fresh Zev conversation on the chat home. */
function NewChatButton({ rail }: { rail: boolean }) {
  const { activeWorkspace } = useSession();
  const { newChat } = useZevConversations(activeWorkspace?.id || null);
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className={cn('zx-newchat', rail && 'is-rail')}
      onClick={() => {
        newChat();
        navigate('/app');
      }}
      title={rail ? 'New chat' : undefined}
      aria-label={rail ? 'New chat' : undefined}
    >
      <SquarePen size={16} aria-hidden />
      {!rail && <span>New chat</span>}
    </button>
  );
}

/** The tab's recent Zev conversations (in memory only; a reload starts fresh). */
function RecentChats() {
  const { activeWorkspace } = useSession();
  const { list, activeId, open, remove } = useZevConversations(activeWorkspace?.id || null);
  const navigate = useNavigate();
  const location = useLocation();
  const onHome = location.pathname.replace(/\/+$/, '') === '/app';
  return (
    <>
      {list.length > 0 && (
        <div className="zx-recent">
          <p className="zx-group-label">Recent</p>
          <ul>
            {list.slice(0, 12).map((c) => (
              <li key={c.id} className={cn(onHome && c.id === activeId && 'is-active')}>
                <button
                  type="button"
                  className="zx-recent-item"
                  onClick={() => {
                    open(c.id);
                    navigate('/app');
                  }}
                  aria-current={onHome && c.id === activeId ? 'page' : undefined}
                  title={c.title}
                >
                  {c.title}
                </button>
                <button type="button" className="zx-recent-del" onClick={() => remove(c.id)} aria-label={`Delete chat: ${c.title}`}>
                  <X size={13} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

const TITLES: Record<string, string> = Object.fromEntries(NAV.map((n) => [n.to, n.label]));

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
        <button type="button" onClick={() => { if (!t.open) load(); t.toggle(); }} aria-expanded={t['aria-expanded']} aria-controls={t['aria-controls']} aria-label="Needs attention" className="zshell-icon-btn">
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

/** Always-visible Help: the tour (replay or resume), Zev, and the docs. */
function HelpMenu({ onTour, resumeStep }: { onTour: () => void; resumeStep: number | null }) {
  const navigate = useNavigate();
  return (
    <Popover
      label="Help"
      className="zshell-help"
      trigger={(t) => (
        <button type="button" onClick={t.toggle} aria-expanded={t['aria-expanded']} aria-controls={t['aria-controls']} aria-haspopup="dialog" className="zshell-icon-btn gap-1.5 px-2.5" title="Help" data-tour="help">
          <CircleHelp size={18} aria-hidden />
          <span className="hidden text-caption sm:inline">Help</span>
        </button>
      )}
    >
      {(close) => (
        <div className="w-64 max-w-[85vw]">
          <button type="button" onClick={() => { close(); onTour(); }} className="zshell-menu-item">
            <Compass size={15} aria-hidden />
            <span>
              <b>{resumeStep !== null ? `Resume the tour (step ${resumeStep + 1} of ${PRODUCT_TOUR_STEPS.length})` : 'Take the tour'}</b>
              <small>Five short steps. Skip or pause any time.</small>
            </span>
          </button>
          <button type="button" onClick={() => { close(); navigate('/app'); }} className="zshell-menu-item">
            <MessageSquare size={15} aria-hidden />
            <span>
              <b>How ZEVQORA works</b>
              <small>Ask Zev, or open the written guide on the home screen.</small>
            </span>
          </button>
          <button type="button" onClick={() => { close(); navigate('/app/docs'); }} className="zshell-menu-item">
            <BookOpen size={15} aria-hidden />
            <span>
              <b>Docs</b>
              <small>Trace format, connections and verdicts.</small>
            </span>
          </button>
        </div>
      )}
    </Popover>
  );
}

/** Light or dark workspace. A per-device display preference only (never sent to the server). */
type Theme = 'light' | 'dark';
const THEME_KEY = 'zevqora.theme';
function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* storage unavailable */
  }
  return 'light';
}
function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* the choice still applies for this visit */
    }
    // Portals (palette, popovers, tour) read the theme from the document root.
    const root = document.documentElement;
    root.dataset.appTheme = theme;
    return () => {
      delete root.dataset.appTheme;
    };
  }, [theme]);
  return { theme, toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const dark = theme === 'dark';
  return (
    <button type="button" onClick={onToggle} className="zshell-icon-btn zv-theme-toggle" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'} aria-pressed={dark}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={theme} initial={{ rotate: -90, scale: 0.5, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} exit={{ rotate: 90, scale: 0.5, opacity: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 22 }} style={{ display: 'inline-flex' }}>
          {dark ? <Sun size={17} aria-hidden /> : <Moon size={17} aria-hidden />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

const DESKTOP_QUERY = '(min-width: 1024px)';
function useIsDesktop() {
  const [desktop, setDesktop] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(DESKTOP_QUERY).matches : true));
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(DESKTOP_QUERY);
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return desktop;
}

function readTourState(key: string | null): { outcome: TourOutcome | null; step: number | null } {
  if (!key) return { outcome: null, step: null };
  try {
    const raw = localStorage.getItem(key);
    if (raw === 'done') return { outcome: 'done', step: null };
    if (raw === 'skipped') return { outcome: 'skipped', step: null };
    if (raw?.startsWith('paused:')) {
      const n = Number(raw.slice(7));
      return { outcome: 'paused', step: Number.isInteger(n) && n >= 0 && n < PRODUCT_TOUR_STEPS.length ? n : 0 };
    }
  } catch {
    /* storage unavailable */
  }
  return { outcome: null, step: null };
}

export function AppShell() {
  const { me, activeWorkspace, status } = useSession();
  const location = useLocation();
  const desktop = useIsDesktop();
  const { theme, toggleTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('zevqora.sidebar') === 'collapsed';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const tourScope = me?.user?.id && activeWorkspace?.id ? productTourStorageKey(me.user.id, activeWorkspace.id) : null;
  const [tourState, setTourState] = useState(() => readTourState(tourScope));
  useEffect(() => setTourState(readTourState(tourScope)), [tourScope]);
  // A member who has never seen the tour in this workspace gets a one-time welcome on the
  // chat home (owner request, 2026-11-15). Closing it in any way records an outcome, so it
  // never appears twice; afterwards the tour opens only from Help.
  const [tourIntro, setTourIntro] = useState(false);
  const isHome = location.pathname.replace(/\/+$/, '') === '/app';
  useEffect(() => {
    if (!tourScope || !isHome || tourState.outcome !== null || tourOpen) return;
    const id = window.setTimeout(() => {
      setTourIntro(true);
      setTourOpen(true);
    }, 900);
    return () => window.clearTimeout(id);
  }, [tourScope, isHome, tourState.outcome, tourOpen]);
  const closeTour = (outcome: TourOutcome = 'paused', step?: number) => {
    setTourIntro(false);
    const value = outcome === 'paused' ? `paused:${step ?? 0}` : outcome;
    if (tourScope) {
      try {
        localStorage.setItem(tourScope, value);
      } catch {
        /* Closing still works in memory. */
      }
    }
    setTourState({ outcome, step: outcome === 'paused' ? step ?? 0 : null });
    setTourOpen(false);
  };
  const resumeStep = tourState.outcome === 'paused' ? tourState.step : null;

  useEffect(() => {
    try {
      localStorage.setItem('zevqora.sidebar', collapsed ? 'collapsed' : 'open');
    } catch {
      /* ignore */
    }
  }, [collapsed]);
  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    if (desktop) setMobileOpen(false);
  }, [desktop]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    const base = location.pathname.split('/').slice(0, 3).join('/');
    document.title = `${TITLES[base] || 'ZEVQORA'} — ZEVQORA`;
  }, [location.pathname]);

  if (status === 'signed_in' && !me) return <FullPageLoader label="Loading your workspace" />;
  if (me && me.workspaces.length === 0) return <Navigate to="/app/onboarding" replace />;
  if (!activeWorkspace) return <FullPageLoader />;

  const crumbs = location.pathname.split('/').filter(Boolean).slice(1);
  const title = TITLES[location.pathname.split('/').slice(0, 3).join('/')] || 'Ask Zev';
  const productRoute = isProductPath(location.pathname);
  const sections = navSections(activeWorkspace.features);
  // "More" opens by itself when you are on one of its pages, so the current item is never hidden.
  const showMore = moreOpen || sections.more.some((n) => location.pathname === n.to || location.pathname.startsWith(n.to + '/'));
  const navExpanded = desktop ? !collapsed : mobileOpen;
  const toggleNav = () => (desktop ? setCollapsed((v) => !v) : setMobileOpen((v) => !v));

  const renderSidebar = (rail: boolean, drawer: boolean) => (
    <aside id={drawer ? 'app-sidebar-drawer' : 'app-sidebar'} aria-label="Navigation" className={cn('zx-side', rail && 'is-rail')}>
      <div className="zx-side-top">
        <Link to="/app" aria-label="ZEVQORA home" className="zx-logo">
          {rail ? <ZevqoraMark height={22} /> : <ZevqoraLogo variant={theme === 'dark' ? 'inverse' : 'default'} size={21} />}
        </Link>
        {drawer ? (
          <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close navigation" className="zx-icon-btn" autoFocus>
            <X size={18} aria-hidden />
          </button>
        ) : (
          !rail && (
            <button type="button" onClick={() => setCollapsed(true)} aria-label="Collapse navigation" aria-controls="app-sidebar" aria-expanded title="Collapse navigation" className="zx-icon-btn">
              <PanelLeftClose size={18} aria-hidden />
            </button>
          )
        )}
      </div>
      {rail && !drawer && (
        <button type="button" onClick={() => setCollapsed(false)} aria-label="Expand navigation" aria-controls="app-sidebar" aria-expanded={false} title="Expand navigation" className="zx-icon-btn zx-expand">
          <PanelLeftOpen size={18} aria-hidden />
        </button>
      )}
      <div className="zx-side-ws">
        <WorkspaceSwitcher collapsed={rail} />
      </div>
      <div className="zx-side-new">
        <NewChatButton rail={rail} />
      </div>
      <div className="zx-side-scroll scrollbar-thin">
        <nav aria-label="Application" className="zx-nav">
          <ul>
            {sections.groups.map(([group, items]) => (
              <li key={group} className={group === 'Home' ? undefined : 'zx-group'}>
                {!rail && group !== 'Home' && <p className="zx-group-label">{group}</p>}
                <ul>
                  {items.map((item) => (
                    <li key={item.to}>
                      <SideLink item={item} collapsed={rail} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {sections.more.length > 0 && (
              <li className="zx-group">
                <button
                  type="button"
                  onClick={() => setMoreOpen((v) => !v)}
                  aria-expanded={showMore}
                  aria-controls={drawer ? 'app-nav-more-drawer' : 'app-nav-more'}
                  title={rail ? 'More' : undefined}
                  aria-label={rail ? 'More' : undefined}
                  className={cn('zx-link', rail && 'is-rail')}
                >
                  <ChevronRight size={17} className={cn('shrink-0 transition-transform', showMore && 'rotate-90')} aria-hidden />
                  {!rail && <span>More</span>}
                </button>
                {showMore && (
                  <ul id={drawer ? 'app-nav-more-drawer' : 'app-nav-more'}>
                    {sections.more.map((item) => (
                      <li key={item.to}>
                        <SideLink item={item} collapsed={rail} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )}
            {me?.isAdmin && (
              <li className="zx-group">
                <NavLink to="/admin" title={rail ? 'Admin' : undefined} aria-label={rail ? 'Admin' : undefined} className={({ isActive }) => cn('zx-link', isActive && 'is-active', rail && 'is-rail')}>
                  <Shield size={17} className="shrink-0" aria-hidden />
                  {!rail && <span>Admin</span>}
                </NavLink>
              </li>
            )}
          </ul>
        </nav>
        {!rail && <RecentChats />}
      </div>
      <div className="zx-side-foot">
        <AccountMenu rail={rail} />
      </div>
    </aside>
  );

  return (
    <PresentationModeProvider>
      <div className="app-env workspace-experience zx-app flex min-h-dvh" data-theme={theme} data-surface={theme === 'dark' ? 'ink' : undefined}>
        <div className="zx-side-dock sticky top-0 hidden h-dvh shrink-0 lg:block">{renderSidebar(collapsed, false)}</div>
        <AnimatePresence>
          {mobileOpen && !desktop && (
            <motion.div className="fixed inset-0 z-50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="zx-scrim absolute inset-0" onClick={() => setMobileOpen(false)} aria-hidden />
              <motion.div className="absolute inset-y-0 left-0 w-[290px] max-w-[86vw]" initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ type: 'spring', stiffness: 400, damping: 36 }}>
                {renderSidebar(false, true)}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="zx-top">
            {!desktop && (
              <button type="button" onClick={toggleNav} aria-label="Open navigation" aria-expanded={navExpanded} aria-controls="app-sidebar-drawer" title="Open navigation" className="zx-icon-btn">
                <Menu size={19} aria-hidden />
              </button>
            )}
            <nav aria-label="Breadcrumb" className="zx-crumbs">
              <span className="zx-crumb-ws">{activeWorkspace.name}</span>
              <ChevronRight size={13} className="zx-crumb-sep" aria-hidden />
              <span className="zx-crumb-title">{title}</span>
              {crumbs.length > 1 && (
                <>
                  <ChevronRight size={13} className="zx-crumb-sep is-md" aria-hidden />
                  <span className="zx-crumb-id">{crumbs[1].slice(0, 8)}</span>
                </>
              )}
            </nav>
            <div className="zx-top-actions">
              <button type="button" onClick={() => setPaletteOpen(true)} className="zx-search" aria-label="Open command palette">
                <Search size={14} aria-hidden /> <span>Search</span> <Kbd>⌘K</Kbd>
              </button>
              <Notifications workspaceId={activeWorkspace.id} />
              <HelpMenu onTour={() => setTourOpen(true)} resumeStep={resumeStep} />
              <ThemeToggle theme={theme} onToggle={toggleTheme} />
            </div>
          </header>
          <main className={cn('zx-main min-w-0 flex-1', !productRoute && 'px-4 py-6 lg:px-8 lg:py-8')}>
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
        <ProductTour open={tourOpen && Boolean(tourScope)} onClose={closeTour} startAt={resumeStep ?? 0} intro={tourIntro} name={welcomeName(me?.profile) || undefined} />
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
