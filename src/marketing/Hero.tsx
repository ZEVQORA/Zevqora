import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'motion/react';
import { Check, X } from 'lucide-react';
import { ButtonLink } from '@/components/ui/Button';
import { ZevqoraMark } from '@/brand/ZevqoraMark';
import { useSiteContent } from '@/lib/site';

const HeroMark3D = lazy(() => import('@/brand/HeroMark3D').then((m) => ({ default: m.HeroMark3D })));

function useFinePointer() {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(pointer: fine) and (min-width: 1024px)');
    const update = () => setFine(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return fine;
}

/**
 * The proof card is the argument in one glance: a candidate that was cheaper
 * and still rejected, because quality missed the frozen floor.
 */
function ProofCard({ className }: { className?: string }) {
  const { proof } = useSiteContent();
  return (
    <div className={className} role="figure" aria-label="Example verification result: a cheaper candidate rejected by the quality gate">
      <div className="glass-strong rounded-xl p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-eyebrow uppercase text-subtle">Candidate</span>
          <span className="inline-flex items-center gap-1.5 rounded-sm bg-rejected-bg px-2 py-1 font-mono text-technical text-rejected">
            <X size={11} strokeWidth={2.5} aria-hidden /> REJECTED
          </span>
        </div>
        <p className="mt-3 text-[2.1rem] font-semibold leading-none tracking-[-0.03em] text-ink tnum">{proof.rejected.cost_reduction} cheaper</p>
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4">
          <div>
            <dt className="text-eyebrow uppercase text-subtle">Quality</dt>
            <dd className="mt-1 font-mono text-caption text-rejected tnum">{proof.rejected.quality}</dd>
          </div>
          <div>
            <dt className="text-eyebrow uppercase text-subtle">Required</dt>
            <dd className="mt-1 font-mono text-caption text-ink tnum">{proof.rejected.quality_floor}</dd>
          </div>
        </dl>
        <p className="text-caption mt-4 border-t border-line pt-3 text-muted">Cheaper isn&rsquo;t verified.</p>
      </div>
    </div>
  );
}

function VerifiedChip({ className }: { className?: string }) {
  const { proof } = useSiteContent();
  return (
    <div className={className} aria-hidden>
      <div className="glass rounded-lg px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-verified-bg text-verified">
            <Check size={12} strokeWidth={3} />
          </span>
          <span className="font-mono text-technical text-ink tnum">{proof.verified.cost_reduction} · quality {proof.verified.quality}</span>
        </div>
        <p className="text-technical mt-1 text-subtle">Verified on replay. Point estimate.</p>
      </div>
    </div>
  );
}

function StaticHeroMark() {
  return (
    <div className="relative mx-auto flex h-[260px] w-[240px] items-center justify-center">
      <div className="absolute inset-x-8 bottom-6 h-16 rounded-full bg-[#1f3f7a]/25 blur-2xl" aria-hidden />
      <ZevqoraMark height={200} style={{ filter: 'drop-shadow(0 18px 30px rgba(31,63,122,0.28))' }} />
    </div>
  );
}

export function Hero() {
  const { hero } = useSiteContent();
  const fine = useFinePointer();
  const reduced = useReducedMotion();

  // Secondary parallax layers follow the pointer at lower intensity than the mark.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 90, damping: 18, mass: 0.8 });
  const sy = useSpring(py, { stiffness: 90, damping: 18, mass: 0.8 });
  const cardX = useTransform(sx, (v) => v * 14);
  const cardY = useTransform(sy, (v) => v * 10);
  const chipX = useTransform(sx, (v) => v * -8);
  const chipY = useTransform(sy, (v) => v * -6);
  const envX = useTransform(sx, (v) => v * 5);
  const envY = useTransform(sy, (v) => v * 4);

  useEffect(() => {
    if (!fine || reduced) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        px.set(Math.max(-1, Math.min(1, (e.clientX / window.innerWidth - 0.5) * 2)));
        py.set(Math.max(-1, Math.min(1, (e.clientY / window.innerHeight - 0.5) * 2)));
      });
    };
    const reset = () => {
      px.set(0);
      py.set(0);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', reset);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', reset);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [fine, reduced, px, py]);

  return (
    <section className="hero-env relative overflow-hidden border-b border-line">
      <div className="container-wide grid items-center gap-14 py-16 lg:grid-cols-12 lg:gap-8 lg:py-24">
        <div className="lg:col-span-6">
          {hero.announcement && (
            <Link to={hero.announcement_href || '/pricing'} className="glass mb-6 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-caption text-ink">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
              {hero.announcement}
            </Link>
          )}
          <p className="text-eyebrow uppercase text-muted">AI cost optimization engineer</p>
          <h1 className="text-display mt-5 max-w-[12ch] text-ink">
            {hero.headline.replace(/\.$/, '')}
            <span className="text-brand">.</span>
          </h1>
          <p className="text-h3 mt-6 max-w-[30ch] font-medium text-ink">{hero.subheadline}</p>
          <p className="text-body-lg mt-5 max-w-[46ch] text-muted">{hero.supporting}</p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <ButtonLink to={hero.primary_cta.href} size="lg">
              {hero.primary_cta.label}
            </ButtonLink>
            <ButtonLink to={hero.secondary_cta.href} size="lg" variant="secondary">
              {hero.secondary_cta.label}
            </ButtonLink>
          </div>
          <p className="text-technical mt-8 font-mono text-subtle">{hero.trust_line}</p>
        </div>

        <div className="relative lg:col-span-6">
          <motion.div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ x: envX, y: envY }}>
            <div className="absolute left-[10%] top-[8%] h-[70%] w-[80%] rounded-full bg-[radial-gradient(closest-side,rgba(70,139,255,0.16),transparent_70%)]" />
            <div className="dotgrid absolute inset-[12%] rounded-[32px] opacity-60 [mask-image:radial-gradient(closest-side,black,transparent)]" />
          </motion.div>

          <div className="relative mx-auto flex max-w-[560px] items-center justify-center py-6 lg:py-10">
            {fine ? (
              <Suspense fallback={<StaticHeroMark />}>
                <HeroMark3D size={330} />
              </Suspense>
            ) : (
              <StaticHeroMark />
            )}

            <motion.div className="absolute -bottom-2 left-0 w-[236px] sm:-left-2 lg:-left-6" style={fine && !reduced ? { x: cardX, y: cardY } : undefined}>
              <ProofCard />
            </motion.div>
            <motion.div className="absolute -top-1 right-0 hidden sm:block lg:-right-2" style={fine && !reduced ? { x: chipX, y: chipY } : undefined}>
              <VerifiedChip />
            </motion.div>
          </div>
          <p className="text-technical mt-4 text-center font-mono text-subtle lg:text-right">Example from our internal benchmark. Not a production savings claim.</p>
        </div>
      </div>
    </section>
  );
}
