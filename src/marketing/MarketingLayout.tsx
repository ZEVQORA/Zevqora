import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Menu, X } from 'lucide-react';
import { ZevqoraLogo } from '@/brand/ZevqoraLogo';
import { useSession } from '@/lib/session';
import { useSiteContent } from '@/lib/site';
import { SupportZevLauncher } from './SupportZevLauncher';

const NAV = [['Product', '/product'], ['Evidence', '/proof'], ['Pricing', '/pricing']] as const;

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLElement>(null);
  const { status } = useSession();
  const { status: siteStatus } = useSiteContent();
  const location = useLocation();
  const reduced = useReducedMotion();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 40);
    update(); window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  useEffect(() => {
    if (!open) return;
    const overflow = document.body.style.overflow;
    const background = Array.from(document.querySelectorAll<HTMLElement>('.marketing-app > main, .marketing-app > footer'));
    const inert = background.map(element => element.inert);
    background.forEach(element => { element.inert = true; });
    document.body.style.overflow = 'hidden';
    menu.current?.querySelector<HTMLAnchorElement>('a[href]')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); toggle.current?.focus(); }
      if (event.key !== 'Tab') return;
      const links = menu.current?.querySelectorAll<HTMLAnchorElement>('a[href]');
      if (!links?.length) return;
      if (event.shiftKey && document.activeElement === links[0]) { event.preventDefault(); toggle.current?.focus(); }
      else if (event.shiftKey && document.activeElement === toggle.current) { event.preventDefault(); links[links.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === links[links.length - 1]) { event.preventDefault(); toggle.current?.focus(); }
    };
    const media = window.matchMedia?.('(min-width: 801px)');
    const resize = () => { if (media?.matches) setOpen(false); };
    media?.addEventListener('change', resize);
    document.addEventListener('keydown', keyboard);
    return () => {
      document.body.style.overflow = overflow;
      background.forEach((element, i) => { element.inert = inert[i]; });
      document.removeEventListener('keydown', keyboard);
      media?.removeEventListener('change', resize);
    };
  }, [open]);
  return <header className="atelier-header" data-scrolled={scrolled} data-menu={open}>
    {siteStatus.banner && <div className="atelier-status" role="status">{siteStatus.banner}</div>}
    <div className="atelier-header-inner">
      <Link to="/" aria-label="ZEVQORA home" tabIndex={open ? -1 : undefined} onClick={() => setOpen(false)}><ZevqoraLogo variant="inverse" size={27} /></Link>
      <nav className="atelier-nav" aria-label="Primary">{NAV.map(([label, to]) => <NavLink key={to} to={to}>{label}</NavLink>)}</nav>
      <div className="atelier-header-actions">
        <Link to={status === 'signed_in' ? '/app' : '/login'}>{status === 'signed_in' ? 'Workspace' : 'Sign in'}</Link>
        <button ref={toggle} className="atelier-menu-toggle" type="button" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls="atelier-navigation" onClick={() => setOpen(value => !value)}>{open ? <X size={22} /> : <Menu size={22} />}</button>
      </div>
    </div>
    <AnimatePresence>{open && <motion.nav ref={menu} className="atelier-mobile-menu" id="atelier-navigation" aria-label="Mobile" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .2 }}>
      {[...NAV, ['How it works', '/how-it-works'], ['Security', '/security'], ['Company', '/company']].map(([label, to]) => <Link key={to} to={to}>{label}</Link>)}
      <Link className="atelier-mobile-start" to={status === 'signed_in' ? '/app' : '/signup'}>{status === 'signed_in' ? 'Open workspace' : 'Get started'}</Link>
    </motion.nav>}</AnimatePresence>
  </header>;
}

export function SiteFooter() {
  const { contact } = useSiteContent();
  return <footer className="atelier-footer">
    <div className="atelier-footer-main">
      <Link to="/" aria-label="ZEVQORA home"><ZevqoraLogo size={27} /></Link>
      <nav aria-label="Explore ZEVQORA">{[...NAV, ['Security', '/security'], ['Company', '/company']].map(([label, to]) => <Link key={to} to={to}>{label}</Link>)}<a href={`mailto:${contact.email}`}>Contact</a></nav>
    </div>
    <div className="atelier-footer-bottom"><span>© {new Date().getFullYear()} ZEVQORA</span><nav aria-label="Legal"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></nav></div>
  </footer>;
}

export function MarketingLayout() {
  const { pathname } = useLocation();
  const page = pathname.split('/')[1] || 'home';
  return <div className={`marketing-app engine-world atelier-world page-${page}`}>
    <a href="#main" className="atelier-skip">Skip to content</a>
    <SiteHeader />
    <main className="atelier-main" id="main"><Outlet /></main>
    <SiteFooter />
    <SupportZevLauncher />
  </div>;
}
