import { useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { track } from '@/lib/analytics';
import { useIsPreview, useSiteContent } from '@/lib/site';
import { useSeo } from '@/lib/seo';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field';
import { ZevFace, Zev } from '@/brand/Zev';
import { Section } from './Sections';
import { PageHero } from './PageHero';

const SPEND = [
  ['unknown', 'Prefer not to say'],
  ['under_1k', 'Under $1k / month'],
  ['1k_10k', '$1k – $10k / month'],
  ['10k_50k', '$10k – $50k / month'],
  ['50k_250k', '$50k – $250k / month'],
  ['over_250k', 'Over $250k / month'],
] as const;

type Errors = Partial<Record<'name' | 'email' | 'company' | 'workload' | 'consent' | 'form', string>>;

/** The real evaluation request: stored server-side, read by a person, answered by email. */
export default function EvaluationPage() {
  const { evaluation_page: page, contact } = useSiteContent();
  const preview = useIsPreview();
  useSeo({ title: 'Evaluate your AI workload — ZEVQORA', description: page.intro || 'Tell us about one AI workflow and we will tell you what ZEVQORA can measure and prove.', path: '/evaluation' });
  const [form, setForm] = useState({ name: '', email: '', company: '', role_title: '', workload: '', ai_spend_band: 'unknown', consent: false, website: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string; checked?: boolean; type?: string } }) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? Boolean(e.target.checked) : e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (preview) return;
    const next: Errors = {};
    if (form.name.trim().length < 2) next.name = 'Enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = 'Enter a valid work email.';
    if (!form.company.trim()) next.company = 'Enter your company.';
    if (form.workload.trim().length < 10) next.workload = 'Describe the workflow in a sentence or two.';
    if (!form.consent) next.consent = 'Please confirm we may contact you about this evaluation.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await api('/api/evaluation-requests', { method: 'POST', auth: false, body: { ...form, source: { path: '/evaluation', referrer: document.referrer || null, utm_source: new URLSearchParams(window.location.search).get('utm_source'), utm_campaign: new URLSearchParams(window.location.search).get('utm_campaign') } } });
      track('evaluation_submitted');
      setDone(true);
    } catch (err) {
      setErrors({ form: errorMessage(err, 'Could not send the request. Please retry.') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHero eyebrow="Evaluation" title={page.title} intro={page.intro} art={<Zev view="pose-sitting" height={200} alt="" />} />
      <Section rule={false}>
        <div className="container-page grid gap-10 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <h2 className="text-h3 text-ink">What an evaluation includes</h2>
            <ul className="mt-5 space-y-3">
              {page.what_you_get.map((w) => (
                <li key={w} className="flex items-start gap-2.5 text-[14.5px] text-ink">
                  <Check size={16} className="mt-0.5 shrink-0 text-verified" aria-hidden /> {w}
                </li>
              ))}
            </ul>
            <p className="mt-6 text-[13px] text-muted">{page.response_note}</p>
            <p className="mt-2 text-[13px] text-muted">Prefer email? <a className="font-medium text-accent-text" href={`mailto:${contact.email}`}>{contact.email}</a></p>
          </div>
          <div className="rounded-[22px] border border-line bg-surface p-6 shadow-[0_1px_2px_rgb(15_17_21/0.04),0_24px_60px_-40px_rgb(15_17_21/0.35)] sm:p-8">
            {done ? (
              <div role="status" className="flex flex-col items-center py-8 text-center">
                <ZevFace expression="delighted" size={72} />
                <h2 className="text-h3 mt-5 text-ink">Thank you — we have your request.</h2>
                <p className="mt-2 max-w-[44ch] text-[14.5px] text-muted">A person will read it and reply by email. Nothing has been connected to your systems.</p>
                <ButtonLink to="/technology" variant="secondary" className="mt-6">Read how the engine works</ButtonLink>
              </div>
            ) : (
              <form onSubmit={onSubmit} noValidate className="grid gap-4" aria-describedby={errors.form ? 'form-error' : undefined}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="ev-name" label="Name" error={errors.name}><Input id="ev-name" autoComplete="name" value={form.name} onChange={set('name')} invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'ev-name-error' : undefined} /></Field>
                  <Field id="ev-email" label="Work email" error={errors.email}><Input id="ev-email" type="email" autoComplete="email" value={form.email} onChange={set('email')} invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'ev-email-error' : undefined} /></Field>
                  <Field id="ev-company" label="Company" error={errors.company}><Input id="ev-company" autoComplete="organization" value={form.company} onChange={set('company')} invalid={Boolean(errors.company)} aria-describedby={errors.company ? 'ev-company-error' : undefined} /></Field>
                  <Field id="ev-role" label="Role (optional)"><Input id="ev-role" autoComplete="organization-title" value={form.role_title} onChange={set('role_title')} /></Field>
                </div>
                <Field id="ev-spend" label="Monthly AI spend (approximate)">
                  <Select id="ev-spend" value={form.ai_spend_band} onChange={set('ai_spend_band')}>
                    {SPEND.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </Field>
                <Field id="ev-workload" label="Which AI workflow should we look at?" hint="What it does, roughly how many calls, and what worries you (cost, latency, retries, quality). Please do not paste prompts, customer data or credentials." error={errors.workload}>
                  <Textarea id="ev-workload" value={form.workload} onChange={set('workload')} maxLength={2000} invalid={Boolean(errors.workload)} aria-describedby={errors.workload ? 'ev-workload-error' : 'ev-workload-hint'} />
                </Field>
                {/* Honeypot: hidden from people and assistive technology. */}
                <div aria-hidden className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
                  <label htmlFor="ev-website">Website</label>
                  <input id="ev-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
                </div>
                <div>
                  <Checkbox id="ev-consent" checked={form.consent} onChange={set('consent')} label="ZEVQORA may contact me by email about this evaluation." description="We store this request to answer it. No marketing list, no third-party sharing." aria-invalid={Boolean(errors.consent) || undefined} />
                  {errors.consent && <p role="alert" className="mt-1 text-technical text-rejected">{errors.consent}</p>}
                </div>
                {errors.form && <p id="form-error" role="alert" className="rounded-md border border-rejected/30 bg-rejected-bg px-3 py-2 text-[13px] text-rejected">{errors.form}</p>}
                <Button type="submit" size="lg" loading={busy} disabled={preview} className="w-full sm:w-auto" data-cta="evaluation.submit">Send evaluation request</Button>
                {preview && <p className="text-[12px] text-subtle">Preview: the form is disabled.</p>}
              </form>
            )}
          </div>
        </div>
      </Section>
    </>
  );
}
