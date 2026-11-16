import { useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigationType,
} from "react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { ZevqoraLogo } from "@/brand/ZevqoraLogo";
import { ZevqoraWordmark } from "@/brand/ZevqoraWordmark";
import { useSession } from "@/lib/session";
import { useSiteContent } from "@/lib/site";

const NAV = [
  ["Product", "/product"],
  ["The engine", "/how-it-works"],
  ["Evidence", "/proof"],
  ["Pricing", "/pricing"],
  ["Security", "/security"],
];
export function SiteHeader() {
  const [open, setOpen] = useState(false),
    { status } = useSession(),
    location = useLocation(),
    reduced = useReducedMotion();
  useEffect(() => setOpen(false), [location.pathname]);
  // Ink header on every page (the live site's signature); it tightens into glass once scrolled.
  const light = false;
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  const target = status === "signed_in" ? "/app" : "/signup";
  const { status: siteStatus } = useSiteContent();
  return (
    <header className={`engine-header zv-header${scrolled ? " is-scrolled" : ""}`}>
      {siteStatus.banner && (
        <div className="engine-status-banner" role="status">
          {siteStatus.banner}
        </div>
      )}
      <div className="engine-header-inner">
        <Link className="engine-header-logo" to="/" aria-label="ZEVQORA home">
          <ZevqoraLogo variant={light ? "default" : "inverse"} size={24} />
        </Link>
        <nav aria-label="Primary">
          {NAV.map(([label, to]) => (
            <NavLink key={to} to={to}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="engine-header-actions">
          <Link to={status === "signed_in" ? "/app" : "/login"}>
            {status === "signed_in" ? "Workspace" : "Sign in"}
          </Link>
          <Link className="engine-button" to={target}>
            Start optimizing
            <ArrowUpRight size={14} />
          </Link>
          <button
            className="engine-menu-toggle"
            type="button"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            aria-controls="engine-mobile-menu"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            id="engine-mobile-menu"
            className="engine-mobile-menu"
            initial={reduced ? false : { opacity: 0, y: -15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
          >
            <div role="navigation" aria-label="Mobile">
              {[
                ...NAV,
                ["Our team", "/team"],
                ["Evaluate your workload", "/evaluation"],
              ].map(([label, to], i) => (
                <Link to={to} key={to}>
                  <small>0{i + 1}</small>
                  <span>{label}</span>
                  <ArrowUpRight size={22} />
                </Link>
              ))}
            </div>
            <Link to={target}>
              Let’s get lighter
              <ArrowUpRight size={25} />
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
export function SiteFooter() {
  const { contact, footer, status } = useSiteContent();
  const groups = [
    {
      name: "Product",
      links: [
        ["The product", "/product"],
        ["How it works", "/how-it-works"],
        ["Evidence", "/proof"],
        ["Pricing", "/pricing"],
        ["Desktop engine", "/download"],
      ],
    },
    {
      name: "Company",
      links: [
        ["The team", "/team"],
        ["Company", "/company"],
        ["Security", "/security"],
        ["Evaluate your workload", "/evaluation"],
        ["Say hello", `mailto:${contact.email}`],
      ],
    },
    {
      name: "Resources",
      links: [
        ["GitHub", "https://github.com/ZEVQORA/Zevqora"],
        ["Privacy", "/privacy"],
        ["Terms", "/terms"],
      ],
    },
  ];
  const operational = (status.public_status || "operational") === "operational";
  return (
    <footer className="engine-footer zv-foot">
      <div className="zv-foot-glow" aria-hidden />
      <div className="zv-foot-inner">
        <div className="zv-foot-top">
          <div className="zv-foot-brand">
            <Link to="/" aria-label="ZEVQORA home">
              <ZevqoraLogo variant="inverse" size={26} />
            </Link>
            <p className="zv-foot-claim">
              Intelligence, unburdened.
              <br />
              <span>A lighter way to build with AI.</span>
            </p>
            <div className="zv-foot-actions">
              <Link to="/signup" className="zv-foot-cta">
                Start optimizing <ArrowUpRight size={15} aria-hidden />
              </Link>
              <a href="https://github.com/ZEVQORA/Zevqora" target="_blank" rel="noreferrer" className="zv-foot-ghost">
                GitHub <ArrowUpRight size={15} aria-hidden />
              </a>
            </div>
            <p className={`zv-foot-status${operational ? "" : " is-degraded"}`}>
              <i aria-hidden /> {operational ? "All systems operational" : "Some systems degraded"}
            </p>
          </div>
          <div className="zv-foot-cols">
            {groups.map((g) => (
              <nav className="zv-foot-group" aria-label={g.name} key={g.name}>
                <h2>{g.name}</h2>
                <ul>
                  {g.links.map(([label, to]) => (
                    <li key={label}>
                      {to.startsWith("http") || to.startsWith("mailto:") ? (
                        <a href={to} target={to.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
                          {label}
                        </a>
                      ) : (
                        <Link to={to}>{label}</Link>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>
        <div className="zv-foot-wordmark" aria-hidden>
          <ZevqoraWordmark height={150} />
        </div>
        <div className="zv-foot-bottom">
          <span>© {new Date().getFullYear()} ZEVQORA. Make AI lighter.</span>
        </div>
        <p className="zv-foot-disclosure">
          {footer.note} First-party analytics without cookies; Do Not Track and
          GPC are respected. See <Link to="/privacy">Privacy</Link>.
        </p>
      </div>
    </footer>
  );
}
export function MarketingLayout() {
  const location = useLocation();
  const navigation = useNavigationType();
  const reduced = useReducedMotion();
  const page = location.pathname.split("/")[1] || "home";
  return (
    <div className={`marketing-app engine-world zv-site page-${page}`}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[90] focus:bg-white focus:p-4"
      >
        Skip to content
      </a>
      <SiteHeader />
      <motion.main
        id="main"
        key={location.pathname}
        initial={
          reduced
            ? false
            : { y: navigation === "POP" ? -42 : 58, opacity: 0.75 }
        }
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
      >
        <Outlet />
      </motion.main>
      <SiteFooter />
    </div>
  );
}
