import { useEffect, useState } from 'react';
import { getSupabase } from './supabase';
import type { Plan, SiteContent } from './types';

/** Fallbacks mirror the seeded site_content rows so the site renders without a network. */
export const DEFAULT_CONTENT: Required<SiteContent> = {
  hero: {
    announcement: null,
    announcement_href: null,
    headline: 'Make AI lighter.',
    subheadline: 'Cut AI COGS without cutting product quality.',
    supporting: 'ZEVQORA finds expensive AI execution, tests cheaper alternatives, replays the same workload, verifies quality, and only recommends changes that earn trust.',
    primary_cta: { label: 'Start optimizing', href: '/signup' },
    secondary_cta: { label: 'See how it works', href: '/#how-it-works' },
    trust_line: 'Measure. Replay. Verify. Then optimize.',
  },
  proof: {
    kind: 'Internal dogfooding benchmark',
    cases: 50,
    rejected: { cost_reduction: '42.01%', quality: '0.87', quality_floor: '0.95', reason: 'quality_floor' },
    verified: { cost_reduction: '12.32%', quality: '0.97', quality_floor: '0.95', ci95: '[-11.01%, 34.64%]' },
    qualifier: 'Internal 50-case dogfooding benchmark. Not customer evidence. The verified figure is a point estimate whose 95% confidence interval crosses zero.',
  },
  status: { banner: null, public_status: 'operational' },
  contact: { email: 'zevqora.ai@gmail.com' },
};

let contentCache: SiteContent | null = null;
let plansCache: Plan[] | null = null;

export function useSiteContent() {
  const [content, setContent] = useState<Required<SiteContent>>(() => ({ ...DEFAULT_CONTENT, ...(contentCache || {}) }) as Required<SiteContent>);
  useEffect(() => {
    let active = true;
    if (contentCache) return;
    getSupabase().then(async (sb) => {
      if (!sb) return;
      const { data } = await sb.from('site_content').select('key,value');
      if (!active || !data) return;
      const next: SiteContent = {};
      for (const row of data) (next as Record<string, unknown>)[row.key] = row.value;
      contentCache = next;
      setContent({ ...DEFAULT_CONTENT, ...next } as Required<SiteContent>);
    });
    return () => {
      active = false;
    };
  }, []);
  return content;
}

export function usePlans() {
  const [plans, setPlans] = useState<Plan[] | null>(plansCache);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (plansCache) return;
    getSupabase().then(async (sb) => {
      if (!sb) {
        if (active) setError('Pricing is temporarily unavailable.');
        return;
      }
      const { data, error: err } = await sb.from('plans').select('*').order('sort_order');
      if (!active) return;
      if (err || !data) {
        setError('Pricing is temporarily unavailable.');
        return;
      }
      plansCache = data as Plan[];
      setPlans(plansCache);
    });
    return () => {
      active = false;
    };
  }, []);
  return { plans, error };
}

export function invalidateSiteCaches() {
  contentCache = null;
  plansCache = null;
}

export function planPrice(plan: Plan, annual: boolean) {
  const monthly = plan.monthly_price_cents / 100;
  if (!annual) return monthly;
  return Math.round(monthly * (1 - plan.annual_discount_pct / 100) * 100) / 100;
}

/** Only same-origin absolute paths are accepted as a redirect target. */
export function safeNext(next: string | null | undefined, fallback = '/app') {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  return next;
}
