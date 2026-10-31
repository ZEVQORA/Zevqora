import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Menu, X } from 'lucide-react';
import { ZevqoraLogo } from '@/brand/ZevqoraLogo';
import { ButtonLink } from '@/components/ui/Button';
import { useSession } from '@/lib/session';
import { useSiteContent } from '@/lib/site';
import { cn } from '@/lib/cn';

const NAV = [
  { label: 'Product', href: '/product' },
  { label: 'How it works', href: '/technology' },
  { label: 'Evidence', href: '/evaluation' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Security', href: '/security' },
  { label: 'Team', href: '/team' },
];

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { status } = useSession();
  const location = useLocation();
  const content = useSiteContent();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => setOpen(false), [location]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const signedIn = status === 'signed_in';
  return (
    <header className={cn('sticky top-0 z-40 transition-[background-color,border-color,box-shadow] duration-[320ms] ease-[cubic-bezier(0.2,0,0,1)]', scrolled || open ? 'glass-strong rounded-none border-x-0 border-t-0 border-b border-b-line/70' : 'border-b border-transparent')}>
      {content.status.banner && <div className="border-b border-line bg-ink px-4 py-2 text-center text-caption text-[#F7F8FA]">{content.status.banner}</div>}
      <div className="container-wide flex h-[68px] items-center justify-between gap-6">
        <Link to="/" aria-label="ZEVQORA home" className="rounded-sm py-2">
          <ZevqoraLogo size={26} />
        </Link>
        <nav aria-label="Primary" className="hidden lg:block">
          <ul className="flex items-center gap-9">
            {NAV.map((item) => (
              <li key={item.href}>
                <NavLink to={item.href} className={({ isActive }) => cn('text-nav rounded-sm py-2 transition-control hover:text-ink', isActive ? 'text-ink' : 'text-muted')}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-2">
          {signedIn ? (
            <ButtonLink to="/app" size="sm" className="hidden sm:inline-flex">Open ZEVQORA</ButtonLink>
          ) : (
            <>
              <NavLink to="/login" className="text-nav hidden rounded-sm px-3 py-2 text-muted transition-control hover:text-ink md:inline-block">Sign in</NavLink>
              <ButtonLink to={content.hero.secondary_cta.href} size="sm" variant="secondary" className="hidden xl:inline-flex" data-cta="nav.secondary">{content.hero.secondary_cta.label}</ButtonLink>
              <ButtonLink to={content.hero.primary_cta.href} size="sm" className="hidden sm:inline-flex" data-cta="nav.primary">{content.hero.primary_cta.label}</ButtonLink>
            </>
          )}
          <button type="button" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen((v) => !v)} className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-md text-ink lg:hidden">
            {open ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
          </button>
        </div>
      </div>
      {open && (
        <div id="mobile-nav" className="border-t border-t-line lg:hidden">
          <nav aria-label="Mobile" className="container-wide py-4">
            <ul className="flex flex-col">
              {NAV.map((item) => (
                <li key={item.href} className="border-b border-line">
                  <Link to={item.href} className="text-h4 block py-3.5 text-ink">{item.label}</Link>
                </li>
              ))}
              {!signedIn && (
                <li className="border-b border-line">
                  <Link to="/login" className="text-h4 block py-3.5 text-ink">Sign in</Link>
                </li>
              )}
            </ul>
            <div className="mt-4 grid gap-2">
              <ButtonLink to={signedIn ? '/app' : content.hero.primary_cta.href} size="lg" className="w-full" data-cta="mobile.primary">{signedIn ? 'Open ZEVQORA' : content.hero.primary_cta.label}</ButtonLink>
              {!signedIn && <ButtonLink to={content.hero.secondary_cta.href} size="lg" variant="secondary" className="w-full" data-cta="mobile.secondary">{content.hero.secondary_cta.label}</ButtonLink>}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

export function SiteFooter() {
  const content = useSiteContent();
  const groups: Record<string, Array<{ label: string; href: string; external?: boolean }>> = {
    Product: [
      { label: 'Product', href: '/product' },
      { label: 'Technology', href: '/technology' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Desktop engine', href: '/download' },
    ],
    Company: [
      { label: 'Company', href: '/company' },
      { label: 'Team', href: '/team' },
      { label: 'Evaluate your workload', href: '/evaluation' },
      { label: 'Contact', href: `mailto:${content.contact.email}`, external: true },
    ],
    Trust: [
      { label: 'Security', href: '/security' },
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
    ],
  };
  return (
    <footer data-surface="ink" className="bg-canvas">
      <div className="container-page py-16">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <ZevqoraLogo variant="inverse" size={26} />
            <p className="text-caption mt-5 max-w-[34ch] text-muted">{content.footer.tagline}</p>
            <p className="text-technical mt-4 font-mono text-subtle">Measure. Replay. Verify. Then optimize.</p>
          </div>
          {Object.entries(groups).map(([group, links]) => (
            <nav key={group} aria-label={group}>
              <h2 className="text-eyebrow uppercase text-subtle">{group}</h2>
              <ul className="mt-5 flex flex-col gap-3">
                {links.map((l) => (
                  <li key={l.href}>
                    {l.external ? (
                      <a href={l.href} className="text-caption rounded-sm text-muted transition-control hover:text-ink">{l.label}</a>
                    ) : (
                      <Link to={l.href} className="text-caption rounded-sm text-muted transition-control hover:text-ink">{l.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-14 flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-technical font-mono text-subtle">© {new Date().getFullYear()} ZEVQORA. {content.footer.note}</p>
          <p className="text-technical font-mono text-subtle">First-party analytics without cookies; Do Not Track and GPC are respected. See Privacy.</p>
        </div>
      </div>
    </footer>
  );
}

export function MarketingLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-button focus:shadow-lift">Skip to content</a>
      <SiteHeader />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
