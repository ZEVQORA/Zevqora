import { useEffect, useState } from 'react';
import { Download, Monitor } from 'lucide-react';
import { Section, Reveal } from './Sections';
import { ButtonAnchor, ButtonLink } from '@/components/ui/Button';
import { loadConfig, getConfigSync } from '@/lib/config';
import { Zev } from '@/brand/Zev';

export default function DownloadPage() {
  const [url, setUrl] = useState(getConfigSync().desktopDownloadUrl);
  useEffect(() => {
    document.title = 'Desktop engine — ZEVQORA';
    loadConfig().then((c) => setUrl(c.desktopDownloadUrl));
  }, []);
  return (
    <Section rule={false} className="studio pt-14 lg:pt-20">
      <div className="container-page grid items-center gap-12 lg:grid-cols-[1.3fr_1fr]">
        <Reveal>
          <p className="text-eyebrow uppercase text-muted">Desktop engine</p>
          <h1 className="text-display mt-5 max-w-[12ch] text-ink">Scan code locally.</h1>
          <p className="text-body-lg mt-6 max-w-[50ch] text-muted">The ZEVQORA desktop engine scans a repository on your machine, finds AI call sites and static opportunities, and runs replay experiments against imported traces. Source code never leaves your computer; only findings and evidence are shared with your workspace.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonAnchor href={url} size="lg">
              <Download size={16} aria-hidden /> Download for Windows
            </ButtonAnchor>
            <ButtonLink to="/app/connections" size="lg" variant="secondary">
              Connect a runtime instead
            </ButtonLink>
          </div>
          <ul className="text-technical mt-8 space-y-1.5 font-mono text-subtle">
            <li>
              <Monitor size={12} className="mr-1.5 inline" aria-hidden /> Windows 10/11 · NSIS installer · bundles the local FastAPI engine
            </li>
            <li>macOS build: not published yet. Runtime telemetry works on every platform.</li>
            <li>Signs in with the same ZEVQORA account as the web app.</li>
          </ul>
        </Reveal>
        <div className="hidden justify-center lg:flex">
          <Zev view="pose-thinking" height={240} />
        </div>
      </div>
    </Section>
  );
}
