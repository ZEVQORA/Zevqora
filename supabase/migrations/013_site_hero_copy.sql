-- Homepage hero copy for the proof-engine positioning.
--
-- site_content rows override the code defaults in src/lib/site.ts, so the new
-- copy only reaches the live site once this row changes. Applying this
-- migration publishes the copy immediately: apply it together with the
-- release that ships the new homepage, not before.
--
-- Guarded: the row is replaced only while it still holds the original seed
-- text. A hero edited from /admin is left alone.

update public.site_content
set value = jsonb_build_object(
      'announcement', null,
      'announcement_href', null,
      'headline', 'Make AI cheaper without guessing.',
      'subheadline', null,
      'supporting', 'ZEVQORA connects code, runtime and workload evidence, finds expensive AI execution patterns, tests alternatives against the same representative workload, and shows you which change is safe to ship.',
      'primary_cta', jsonb_build_object('label', 'Run an evaluation', 'href', '/signup?intent=evaluation'),
      'secondary_cta', jsonb_build_object('label', 'See how it works', 'href', '/#how-it-works'),
      'trust_line', 'Measure. Replay. Verify. Then optimize.'
    ),
    updated_at = now()
where key = 'hero'
  and value->>'headline' = 'Make AI lighter.'
  and value->>'subheadline' = 'Cut AI COGS without cutting product quality.';
