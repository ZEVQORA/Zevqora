import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Menu, X } from 'lucide-react';
import { ZevqoraLogo } from '@/brand/ZevqoraLogo';
import { ButtonLink } from '@/components/ui/Button';
import { useSession } from '@/lib/session';
import { useSiteContent } from '@/lib/site';
import { cn } from '@/lib/cn';

const NAV = [
  { label: 'Product', href: '/#product' },
  { label: 'How it works', href: '/#how-it-works' },
  { label: 'Proof', href: '/#proof' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Security', href: '/security' },
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

  const signedIn = status === 'signed_in';
  return (
    <header className={cn('sticky top-0 z-40 transition-[background-color,border-color,box-shadow] duration-[320ms] ease-[cubic-bezier(0.2,0,0,1)]', scrolled ? 'glass-strong rounded-none border-x-0 border-t-0 border-b border-b-line/70' : 'border-b border-transparent')}>
      {content.status.banner && (
        <div className="border-b border-line bg-ink px-4 py-2 text-center text-caption text-[#F7F8FA]">{content.status.banner}</div>
      )}
      <div className="container-wide flex h-[64px] items-center justify-between gap-8">
        <Link to="/" aria-label="ZEVQORA home" className="rounded-sm py-2">
          <ZevqoraLogo size={26} />
        </Link>
        <nav aria-label="Primary" className="hidden lg:block">
          <ul className="flex items-center gap-8">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link to={item.href} className="text-nav rounded-sm py-2 text-muted transition-control hover:text-ink">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-2">
          {signedIn ? (
            <ButtonLink to="/app" size="sm" className="hidden sm:inline-flex">
              Open ZEVQORA
            </ButtonLink>
          ) : (
            <>
              <NavLink to="/login" className="text-nav hidden rounded-sm px-3 py-2 text-muted transition-control hover:text-ink sm:inline-block">
                Sign in
              </NavLink>
              <ButtonLink to={content.hero.primary_cta.href} size="sm" className="hidden sm:inline-flex">
                {content.hero.primary_cta.label}
              </ButtonLink>
            </>
          )}
          <button type="button" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((v) => !v)} className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-md text-ink lg:hidden">
            {open ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
          </button>
        </div>
      </div>
      {open && (
        <div className="glass-strong rounded-none border-x-0 border-t border-t-line lg:hidden">
          <nav aria-label="Mobile" className="container-wide py-4">
            <ul className="flex flex-col">
              {NAV.map((item) => (
                <li key={item.href} className="border-b border-line">
                  <Link to={item.href} className="text-h4 block py-3.5 text-ink">
                    {item.label}
                  </Link>
                </li>
              ))}
              {!signedIn && (
                <li className="border-b border-line">
                  <Link to="/login" className="text-h4 block py-3.5 text-ink">
                    Sign in
                  </Link>
                </li>
              )}
            </ul>
            <ButtonLink to={signedIn ? '/app' : content.hero.primary_cta.href} size="lg" className="mt-4 w-full">
              {signedIn ? 'Open ZEVQORA' : content.hero.primary_cta.label}
            </ButtonLink>
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
      { label: 'How it works', href: '/#how-it-works' },
      { label: 'Proof', href: '/#proof' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Security', href: '/security' },
      { label: 'Desktop engine', href: '/download' },
    ],
    Company: [
      { label: 'Team', href: '/team' },
      { label: 'Become a design partner', href: '/signup' },
      { label: 'Contact', href: `mailto:${content.contact.email}`, external: true },
      { label: 'GitHub', href: 'https://github.com/ZEVQORA/Zevqora', external: true },
    ],
    Legal: [
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
            <p className="text-caption mt-5 max-w-[34ch] text-muted">AI cost optimization engineer for AI products. Measure, replay, verify, then optimize.</p>
            <p className="text-technical mt-4 font-mono text-subtle">Cheaper isn&rsquo;t verified.</p>
          </div>
          {Object.entries(groups).map(([group, links]) => (
            <nav key={group} aria-label={group}>
              <h2 className="text-eyebrow uppercase text-subtle">{group}</h2>
              <ul className="mt-5 flex flex-col gap-3">
                {links.map((l) => (
                  <li key={l.href}>
                    {l.external ? (
                      <a href={l.href} className="text-caption rounded-sm text-muted transition-control hover:text-ink" target={l.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
                        {l.label}
                      </a>
                    ) : (
                      <Link to={l.href} className="text-caption rounded-sm text-muted transition-control hover:text-ink">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-14 flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-technical font-mono text-subtle">© {new Date().getFullYear()} ZEVQORA. Figures on this site are internal benchmarks or labelled illustrations, never customer results.</p>
          <p className="text-technical font-mono text-subtle">Built in Mongolia for global AI teams.</p>
        </div>
      </div>
    </footer>
  );
}

export function MarketingLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-button focus:shadow-lift">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
