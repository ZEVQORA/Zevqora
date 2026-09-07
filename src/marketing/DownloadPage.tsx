import { useEffect, useState } from 'react';
import { Download, Monitor, ShieldCheck } from 'lucide-react';
import { Section, Reveal } from './Sections';
import { ButtonAnchor, ButtonLink } from '@/components/ui/Button';
import { loadConfig, getConfigSync } from '@/lib/config';
import { Zev } from '@/brand/Zev';

const LOOP: Array<[string, string, string]> = [
  ['01', 'Connect a repository', 'Read-only scan of the folder you develop in. Secret-like files are skipped.'],
  ['02', 'Detect AI usage', 'Every model call site, provider and symbol. Nothing leaves your machine.'],
  ['03', 'Import execution traces', 'Your real requests, outputs and costs become the baseline evidence.'],
  ['04', 'Let Zev test it', 'A bounded candidate is replayed on your samples through your ZEVQORA account.'],
  ['05', 'Quality gate', 'Deterministic graders and gates decide PASS or FAIL. Cheaper alone never counts.'],
  ['06', 'Review the patch', 'An isolated worktree and branch, the diff, your tests, then a pull request you open.'],
];

export default function DownloadPage() {
  const [url, setUrl] = useState(getConfigSync().desktopDownloadUrl);
  useEffect(() => {
    document.title = 'ZEVQORA Desktop';
    loadConfig().then((c) => setUrl(c.desktopDownloadUrl));
  }, []);
  return (
    <>
      <Section rule={false} className="studio pt-14 lg:pt-20">
        <div className="container-page grid items-center gap-12 lg:grid-cols-[1.3fr_1fr]">
          <Reveal>
            <p className="text-eyebrow uppercase text-muted">ZEVQORA Desktop</p>
            <h1 className="text-display mt-5 max-w-[14ch] text-ink">The product runs on your machine.</h1>
            <p className="text-body-lg mt-6 max-w-[52ch] text-muted">ZEVQORA Desktop is the core product: it connects to a local repository, detects where your product calls models, diagnoses spend from your own traces, replays cheaper candidates, and only calls a saving verified when every gate passes. Source code never leaves your computer.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonAnchor href={url} size="lg">
                <Download size={16} aria-hidden /> Download for Windows
              </ButtonAnchor>
              <ButtonLink to="/signup" size="lg" variant="secondary">
                Create the account it signs into
              </ButtonLink>
            </div>
            <ul className="text-technical mt-8 space-y-1.5 font-mono text-subtle">
              <li>
                <Monitor size={12} className="mr-1.5 inline" aria-hidden /> Windows 10/11 · NSIS installer · bundles the local engine
              </li>
              <li>macOS build: not published yet. Runtime telemetry works on every platform.</li>
              <li>Signs in with the same ZEVQORA account as this site. Plan and Zev credit follow you.</li>
            </ul>
          </Reveal>
          <div className="hidden justify-center lg:flex">
            <Zev view="pose-thinking" height={240} />
          </div>
        </div>
      </Section>

      <Section>
        <div className="container-page">
          <Reveal>
            <p className="text-eyebrow uppercase text-muted">What happens inside</p>
            <h2 className="text-h2 mt-3 max-w-[24ch] text-ink">Measure. Replay. Verify. Then optimize.</h2>
          </Reveal>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {LOOP.map(([n, title, body]) => (
              <Reveal key={n}>
                <div className="plane h-full rounded-lg p-5">
                  <p className="text-technical font-mono text-accent-text">{n}</p>
                  <p className="text-h4 mt-2 text-ink">{title}</p>
                  <p className="text-caption mt-2 text-muted">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </Section>

      <Section>
        <div className="container-page grid gap-8 lg:grid-cols-2">
          <Reveal>
            <p className="text-eyebrow uppercase text-muted">Compute without a key on your device</p>
            <h2 className="text-h2 mt-3 text-ink">Model calls go through your account.</h2>
            <p className="text-body mt-4 max-w-[54ch] text-muted">The desktop engine never holds a provider credential. Replays and Zev requests are sent with your ZEVQORA session to the platform, which checks your plan and Zev credit, applies rate limits, calls the provider, and charges the provider-reported cost to your credit. A device-local OpenRouter key is optional and stays encrypted on that machine.</p>
          </Reveal>
          <Reveal>
            <div className="plane rounded-lg p-5">
              <ul className="text-caption space-y-3 text-muted">
                {[
                  'Read-only scans. Secret-like paths and files are skipped; nothing is uploaded during a scan.',
                  'Replays send only the sampled task text you imported, bounded by a spend cap.',
                  'Patches are written into an isolated Git worktree on a new branch. No auto-merge, no auto-deploy.',
                  'Runtime telemetry uses scoped, hashed, revocable tokens. No SSH, no shell access.',
                  'Admin and billing stay in the browser.',
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2.5">
                    <ShieldCheck size={15} className="mt-0.5 shrink-0 text-verified" aria-hidden /> {line}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </Section>
    </>
  );
}
