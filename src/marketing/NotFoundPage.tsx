import { Link } from 'react-router';
import { ZevqoraLogo } from '@/brand/ZevqoraLogo';
import { Zev } from '@/brand/Zev';
import { ButtonLink } from '@/components/ui/Button';

export default function NotFoundPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-16 text-center">
      <Link to="/" aria-label="ZEVQORA home">
        <ZevqoraLogo size={26} />
      </Link>
      <Zev view="pose-thinking" height={150} className="mt-10" />
      <h1 className="text-h2 mt-6 text-ink">This page doesn&rsquo;t exist.</h1>
      <p className="text-caption mt-2 max-w-[40ch] text-muted">The link may be old, or the page may have moved. Nothing here was measured.</p>
      <div className="mt-6 flex gap-3">
        <ButtonLink to="/">Home</ButtonLink>
        <ButtonLink to="/app" variant="secondary">
          Open ZEVQORA
        </ButtonLink>
      </div>
    </main>
  );
}
