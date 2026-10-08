/**
 * Website content schemas (vNext Part 3 CMS).
 *
 * Content is structured plain text: every field has a type and a length, links
 * must be same-site paths, https URLs or mailto addresses, and angle brackets
 * and control characters are removed. React renders it as text, so there is
 * no markup path for stored XSS — the sanitizer is a second wall, not the first.
 */
import { ApiError, num, str } from './http.js';

/** Drops control characters except tab and newlines. */
function stripControl(value) {
  let out = '';
  for (const ch of value) {
    const c = ch.charCodeAt(0);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127)) out += ch;
  }
  return out;
}

export function plainText(value) {
  return stripControl(String(value).replace(/[<>]/g, ''));
}

/** Same-site path (never protocol-relative), https URL, or mailto. Anything else is refused. */
export function safeHref(value, name = 'Link') {
  const v = str(value, { name, max: 300 });
  if (!v) return '';
  if (/^(\/(?!\/)[^\s<>"'`]*|https:\/\/[^\s<>"'`]+|mailto:[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]+)$/.test(v)) return v;
  throw new ApiError(400, `${name} must be a site path, an https URL or a mailto link.`, 'VALIDATION');
}

const text = (max, { required = false, label } = {}) => ({ type: 'text', max, required, label });
const longText = (max, { required = false, label } = {}) => ({ type: 'longtext', max, required, label });
const href = ({ label } = {}) => ({ type: 'href', label });
const cta = (label) => ({ type: 'cta', label });
const items = (max, fields, label) => ({ type: 'items', max, fields, label });
const strings = (max, itemMax, label) => ({ type: 'strings', max, itemMax, label });

/** Editable keys and their fields. Order here is the order the editor shows. */
export const SCHEMAS = Object.freeze({
  hero: {
    label: 'Homepage hero',
    fields: {
      announcement: text(160, { label: 'Announcement (optional)' }),
      announcement_href: href({ label: 'Announcement link' }),
      headline: text(80, { required: true, label: 'Headline' }),
      subheadline: text(200, { label: 'Hero description' }),
      supporting: longText(400, { label: 'Supporting text' }),
      primary_cta: cta('Primary CTA'),
      secondary_cta: cta('Secondary CTA'),
      trust_line: text(120, { label: 'Trust line' }),
    },
  },
  home: {
    label: 'Homepage sections',
    fields: {
      problem_title: text(120, { label: 'Problem — title' }),
      problem_body: longText(400, { label: 'Problem — body' }),
      loop_title: text(120, { label: 'Product loop — title' }),
      loop_body: longText(400, { label: 'Product loop — body' }),
      audiences: items(3, { title: text(60, { required: true }), body: longText(300, { required: true }) }, 'Who it is for'),
      integration_note: longText(300, { label: 'Integration note' }),
      cta_title: text(120, { label: 'Evaluation CTA — title' }),
      cta_body: longText(300, { label: 'Evaluation CTA — body' }),
    },
  },
  product: {
    label: 'Product page',
    fields: {
      title: text(120, { required: true, label: 'Title' }),
      intro: longText(500, { label: 'Introduction' }),
      features: items(8, { title: text(80, { required: true }), body: longText(300, { required: true }) }, 'Features'),
    },
  },
  security_page: {
    label: 'Security page',
    fields: {
      title: text(120, { required: true, label: 'Title' }),
      intro: longText(500, { label: 'Introduction' }),
      points: items(10, { title: text(80, { required: true }), body: longText(400, { required: true }) }, 'Security points'),
    },
  },
  evaluation_page: {
    label: 'Evaluation page',
    fields: {
      title: text(120, { required: true, label: 'Title' }),
      intro: longText(500, { label: 'Introduction' }),
      what_you_get: strings(8, 160, 'What the evaluation includes'),
      response_note: text(200, { label: 'Response note' }),
    },
  },
  company_page: {
    label: 'Company page',
    fields: {
      title: text(120, { required: true, label: 'Title' }),
      intro: longText(500, { label: 'Introduction' }),
      mission: longText(400, { label: 'Mission' }),
      principles: items(6, { title: text(80, { required: true }), body: longText(300, { required: true }) }, 'Principles'),
    },
  },
  footer: {
    label: 'Footer',
    fields: {
      tagline: text(160, { label: 'Tagline' }),
      note: text(240, { label: 'Disclaimer note' }),
    },
  },
  proof: {
    label: 'Proof (internal benchmark)',
    fields: {
      kind: text(80, { required: true, label: 'Kind' }),
      cases: { type: 'int', min: 1, max: 100000, required: true, label: 'Cases' },
      rejected: { type: 'object', label: 'Rejected candidate', fields: { cost_reduction: text(20, { required: true }), quality: text(20, { required: true }), quality_floor: text(20, { required: true }), reason: text(60) } },
      verified: { type: 'object', label: 'Verified candidate', fields: { cost_reduction: text(20, { required: true }), quality: text(20, { required: true }), quality_floor: text(20, { required: true }), ci95: text(60) } },
      qualifier: longText(400, { required: true, label: 'Qualifier' }),
    },
  },
  status: {
    label: 'Status banner',
    fields: {
      banner: text(200, { label: 'Banner (optional)' }),
      public_status: { type: 'enum', values: ['operational', 'degraded', 'maintenance'], label: 'Public status' },
    },
  },
  contact: {
    label: 'Contact',
    fields: { email: { type: 'email', required: true, label: 'Contact email' } },
  },
});

function field(spec, value, name) {
  const empty = value === undefined || value === null || value === '';
  switch (spec.type) {
    case 'text':
    case 'longtext': {
      const v = plainText(str(empty ? '' : value, { name, max: spec.max, required: spec.required }));
      return v || (spec.required ? v : null);
    }
    case 'href':
      return empty ? null : safeHref(value, name);
    case 'email': {
      const v = str(value, { name, max: 120, required: spec.required });
      if (v && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v)) throw new ApiError(400, `${name} is not a valid email.`, 'VALIDATION');
      return v || null;
    }
    case 'int':
      return num(value, { name, min: spec.min, max: spec.max, integer: true, required: spec.required });
    case 'enum':
      if (empty) return spec.values[0];
      if (!spec.values.includes(value)) throw new ApiError(400, `${name} must be one of ${spec.values.join(', ')}.`, 'VALIDATION');
      return value;
    case 'cta':
      if (!value || typeof value !== 'object') throw new ApiError(400, `${name} needs a label and a link.`, 'VALIDATION');
      return { label: plainText(str(value.label, { name: `${name} label`, max: 40, required: true })), href: safeHref(value.href, `${name} link`) || '/' };
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, `${name} must be an object.`, 'VALIDATION');
      const out = {};
      for (const [k, s] of Object.entries(spec.fields)) out[k] = field(s, value[k], `${name} ${k}`);
      return out;
    }
    case 'items': {
      if (empty) return [];
      if (!Array.isArray(value) || value.length > spec.max) throw new ApiError(400, `${name} must be a list of at most ${spec.max} items.`, 'VALIDATION');
      return value.map((item, i) => {
        if (!item || typeof item !== 'object') throw new ApiError(400, `${name} item ${i + 1} is invalid.`, 'VALIDATION');
        const out = {};
        for (const [k, s] of Object.entries(spec.fields)) out[k] = field(s, item[k], `${name} item ${i + 1} ${k}`);
        return out;
      });
    }
    case 'strings':
      if (empty) return [];
      if (!Array.isArray(value) || value.length > spec.max) throw new ApiError(400, `${name} must be a list of at most ${spec.max} lines.`, 'VALIDATION');
      return value.map((v, i) => plainText(str(v, { name: `${name} line ${i + 1}`, max: spec.itemMax, required: true })));
    default:
      throw new ApiError(500, 'Unknown content field type.', 'INTERNAL');
  }
}

/** Validates and normalizes a value for `key`. Unknown keys and unknown fields are refused. */
export function validateContent(key, value) {
  const schema = SCHEMAS[key];
  if (!schema) throw new ApiError(400, 'Unknown content key.', 'VALIDATION');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'Content must be an object.', 'VALIDATION');
  const unknown = Object.keys(value).filter((k) => !(k in schema.fields));
  if (unknown.length) throw new ApiError(400, `Unknown field: ${unknown[0]}.`, 'VALIDATION');
  const out = {};
  for (const [k, spec] of Object.entries(schema.fields)) out[k] = field(spec, value[k], spec.label || k);
  return out;
}

/** The editor's view of the schemas (labels, types, limits). */
export function schemaOut() {
  return Object.entries(SCHEMAS).map(([key, s]) => ({ key, label: s.label, fields: s.fields }));
}
