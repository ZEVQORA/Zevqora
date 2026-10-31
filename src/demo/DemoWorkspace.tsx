import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  CircleHelp,
  Coins,
  FileCheck2,
  FileText,
  Flag,
  FlaskConical,
  FolderGit2,
  FolderKanban,
  GitPullRequest,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { ZevqoraLogo } from "@/brand/ZevqoraLogo";
import { ZevFace } from "@/brand/Zev";
import { DemoViews } from "./DemoViews";
import { SCREEN_META } from "./data";
import "./demo.css";

const ENGINEERING = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "project", label: "Project", Icon: FolderGit2 },
  { id: "opportunities", label: "Opportunities", Icon: Lightbulb },
  { id: "experiments", label: "Experiments", Icon: FlaskConical },
  { id: "changes", label: "Changes", Icon: GitPullRequest },
  { id: "zev", label: "Zev", Icon: CircleHelp },
];
const WORKSPACE = [
  { id: "projects", label: "Projects", Icon: FolderKanban },
  { id: "runtime", label: "Runtime", Icon: Activity },
  { id: "runs", label: "Runs", Icon: ListChecks },
  { id: "evidence", label: "Evidence", Icon: FileCheck2 },
  { id: "connections", label: "Connections", Icon: ShieldCheck },
  { id: "reports", label: "Reports", Icon: FileText },
  { id: "usage", label: "Usage & billing", Icon: Coins },
  { id: "team", label: "Team", Icon: Users },
];
const ADMIN = [
  { id: "overview", label: "Control centre", Icon: LayoutDashboard },
  { id: "users", label: "Users", Icon: Users },
  { id: "workspaces", label: "Workspaces", Icon: FolderKanban },
  { id: "pricing", label: "Pricing & plans", Icon: Coins },
  { id: "content", label: "Website content", Icon: FileText },
  { id: "flags", label: "Feature flags", Icon: Flag },
  { id: "model-pricing", label: "Model pricing", Icon: Coins },
  { id: "audit", label: "Audit log", Icon: ListChecks },
  { id: "admins", label: "Admins", Icon: ShieldCheck },
];
export default function DemoWorkspace() {
  const location = useLocation(),
    [mobile, setMobile] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [search, setSearch] = useState("");
  const parts = location.pathname.split("/").filter(Boolean),
    admin = parts[1] === "admin",
    screen = (admin ? parts[2] : parts[1]) || "overview";
  const item = admin ? ADMIN.find((x) => x.id === screen) : null;
  const meta = admin
    ? [
        item?.label || "Control centre",
        screen === "overview"
          ? "A clear operational picture."
          : item?.label || "Control centre",
        "Internal controls, designed for deliberate, auditable decisions.",
      ]
    : SCREEN_META[screen] || SCREEN_META.overview;
  const pageTitle = meta[0];
  useEffect(() => {
    setMobile(false);
    setSearchOpen(false);
    document.title = `${pageTitle} · Interactive demo — ZEVQORA`;
  }, [location.pathname, pageTitle]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        setMobile(false);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const base = admin ? "/demo/admin" : "/demo";
  const navItems = [
    ...ENGINEERING,
    ...WORKSPACE,
    { id: "settings", label: "Settings", Icon: Settings },
    { id: "docs", label: "Docs", Icon: BookOpen },
  ];
  const links = (items: typeof ENGINEERING) =>
    items.map(({ id, label, Icon }) => (
      <NavLink
        key={id}
        to={`${base}/${id}`}
        className={({ isActive }) =>
          isActive || (id === "overview" && location.pathname === base)
            ? "active"
            : ""
        }
      >
        <Icon size={15} strokeWidth={1.6} />
        <span>{label}</span>
        {id === "opportunities" && <small>3</small>}
      </NavLink>
    ));
  return (
    <div className={`demo-app ${admin ? "demo-admin" : ""}`}>
      <a
        href="#demo-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[90] focus:bg-white focus:p-4"
      >
        Skip navigation
      </a>
      {mobile && (
        <button
          type="button"
          className="demo-mobile-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`demo-sidebar ${mobile ? "open" : ""}`}>
        <div className="demo-logo">
          <Link to="/" aria-label="ZEVQORA home">
            <ZevqoraLogo size={23} variant="inverse" />
          </Link>
          <button
            type="button"
            className="demo-sidebar-close"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          >
            <X size={18} />
          </button>
        </div>
        <Link
          className="demo-workspace-select"
          to={admin ? "/demo" : "/demo/projects"}
        >
          <span className="workspace-initial">{admin ? "A" : "S"}</span>
          <span>
            {admin ? "Administration" : "Support intelligence"}
            <small>{admin ? "Internal preview" : "Sample workspace"}</small>
          </span>
          <ChevronDown size={12} />
        </Link>
        <nav aria-label={admin ? "Admin preview" : "Workspace preview"}>
          <p>{admin ? "CONTROL CENTRE" : "ENGINEERING"}</p>
          {links(admin ? ADMIN : ENGINEERING)}
          {!admin && (
            <>
              <p>WORKSPACE</p>
              {links(WORKSPACE)}
            </>
          )}
        </nav>
        <div className="demo-sidebar-bottom">
          {!admin && (
            <Link className="demo-zev-card" to="/demo/zev">
              <ZevFace size={34} expression="calm-confidence" />
              <span>
                <b>Keep it light.</b>Let’s check the evidence.
              </span>
              <ArrowUpRight size={12} />
            </Link>
          )}
          <div className="demo-utility-links">
            {!admin && (
              <>
                <Link to="/demo/settings">
                  <Settings size={14} />
                  Settings
                </Link>
                <Link to="/demo/docs">
                  <BookOpen size={14} />
                  Documentation
                </Link>
              </>
            )}
            <Link to={admin ? "/demo" : "/demo/admin"}>
              <ShieldCheck size={14} />
              {admin ? "Back to workspace" : "Admin preview"}
            </Link>
            <Link to="/design">
              <ArrowLeft size={14} />
              All screens
            </Link>
          </div>
        </div>
      </aside>
      <div className="demo-body">
        <header className="demo-header">
          <button
            type="button"
            className="demo-mobile-toggle"
            aria-label="Open navigation"
            onClick={() => setMobile(true)}
          >
            <Menu size={19} />
          </button>
          <div className="demo-breadcrumb">
            {admin ? "Admin" : "Support intelligence"}
            <span>/</span>
            <b>{meta[0]}</b>
          </div>
          <div className="demo-header-actions">
            <button
              className="demo-search-button"
              type="button"
              onClick={() => setSearchOpen((v) => !v)}
            >
              <Search size={13} />
              <span>Jump to…</span>
              <kbd>⌘ K</kbd>
            </button>
            <span className="demo-avatar">SI</span>
          </div>
        </header>
        <div className="demo-banner">
          <span>
            <i />
            INTERACTIVE DEMO{" "}
            <b>Sample data. Changes stay in this browser session.</b>
          </span>
          <Link to="/signup">
            Start your own workspace
            <ArrowUpRight size={12} />
          </Link>
        </div>
        {searchOpen && (
          <div className="demo-search-panel">
            <label htmlFor="screen-search">Find a screen</label>
            <input
              id="screen-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Overview, evidence, settings…"
              autoFocus
            />
            <div>
              {(admin ? ADMIN : navItems)
                .filter((x) =>
                  x.label.toLowerCase().includes(search.toLowerCase()),
                )
                .map((x) => (
                  <Link key={x.id} to={`${base}/${x.id}`}>
                    {x.label}
                    <ArrowUpRight size={13} />
                  </Link>
                ))}
            </div>
            <button type="button" onClick={() => setSearchOpen(false)}>
              Close · Esc
            </button>
          </div>
        )}
        <main id="demo-main" className="demo-main">
          <div className="demo-page-title">
            <div>
              <p>
                {admin ? "ADMINISTRATION" : "YOUR WORKSPACE"} /{" "}
                {meta[0].toUpperCase()}
              </p>
              <h1>{meta[1]}</h1>
              <span>{meta[2]}</span>
            </div>
            <span className="demo-page-version">
              ZQ / {admin ? "CONTROL" : "WORKSPACE"}
              <br />
              DESIGN PREVIEW
            </span>
          </div>
          <DemoViews key={`${admin}-${screen}`} screen={screen} admin={admin} />
        </main>
        <footer className="demo-bottom">
          ZEVQORA / Measure. Replay. Verify. Then optimize.
          <Link to="/design">Explore all screens ↗</Link>
        </footer>
      </div>
    </div>
  );
}
