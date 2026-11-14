/**
 * D591 (#1218) — the confirmed ICP prefills a customer landing page.
 *
 * S1 decided 1A and 2A on #1218: keep the 18 templates
 * (`lib/brand/templates.js`) and recommend one by page type and sector, and
 * prefill field by field from the confirmed ICP (`projects.icp_definition_meta`,
 * D353) and the startup record. This module is the ONE mapping: every source
 * field → the landing field or template content key it fills. Nothing here
 * writes copy of its own beyond the CTA labels, which follow the ICP's
 * urgency answer.
 *
 * The draft is created through `POST /brand/landing/by-project/:pid/pages`,
 * which is owner-scoped and creates an unpublished page; `content_json` goes
 * through the Worker's `sanitizeLandingContent`, and every mapped string is
 * capped here at that sanitizer's limit first. Nothing publishes without the
 * founder's own action in Brand & Pages.
 *
 * Pure: no React, no I/O, so the tests import it directly.
 */
import { TEMPLATES } from './templates.js';
import { readIcpDefinition } from '../icpDefinition.js';

/** `sanitizeLandingContent`'s per-string cap (`MAX_STR`, landingTemplates.ts). */
export const LANDING_MAX_STR = 2000;

/**
 * The customer templates, as the page types the Customer Templates canvas
 * names. The 18 templates carry no sector variants, so the page type is the
 * axis a recommendation can actually move along.
 */
export const CUSTOMER_PAGE_TYPES = {
  'proof-builder': 'Waitlist',
  'customer-acquisition': 'Demo request',
  'customer-audience': 'Homepage for several buyers',
};

const URGENCY_ACTIVE = 'Active';
const cap = (v) => (typeof v === 'string' ? v.trim().slice(0, LANDING_MAX_STR) : '');

/**
 * Which customer template to recommend, and why, from the confirmed ICP and
 * the startup's sector. Returns null when there is no confirmed ICP: the
 * library's own `recommended` flags then stand, and nothing is claimed.
 *
 *   - two kinds of buyer (type "Both")  → customer-audience, one page with a
 *     segment switcher;
 *   - buyers looking now (urgency "Active…") → customer-acquisition, waitlist
 *     or demo;
 *   - otherwise (aware, latent)         → proof-builder, validate demand first.
 */
export function recommendCustomerTemplate(project) {
  const def = readIcpDefinition(project?.icp_definition_meta);
  if (def.state !== 'confirmed') return null;
  const f = def.fields || {};
  const sector = cap(project?.sector);
  let templateId;
  let why;
  if (f.type === 'Both') {
    templateId = 'customer-audience';
    why = 'your ICP sells to two kinds of buyer, so one page switches its headline per segment';
  } else if (String(f.urgency || '').startsWith(URGENCY_ACTIVE)) {
    templateId = 'customer-acquisition';
    why = 'your ICP is actively looking, so the page offers a waitlist and a demo';
  } else {
    templateId = 'proof-builder';
    why = 'your ICP is not looking yet, so the page validates demand with a waitlist first';
  }
  const tpl = TEMPLATES.find((t) => t.id === templateId);
  return {
    templateId,
    label: tpl?.label || templateId,
    pageType: CUSTOMER_PAGE_TYPES[templateId],
    reason: `${CUSTOMER_PAGE_TYPES[templateId]} page${sector ? ` for a ${sector} startup` : ''}: ${why}.`,
  };
}

/** The CTA label for the ICP's urgency answer. */
export function ctaForUrgency(urgency) {
  const u = String(urgency || '');
  if (u.startsWith('Active')) return 'Book a demo';
  if (u.startsWith('Latent')) return 'See how it works';
  return 'Join the waitlist';
}

/**
 * THE MAPPING. `to` is a landing-page field (headline, subheadline, cta_text,
 * the customer audience block) or `content.<template>.<key>`; `from` names the
 * ICP answer (`icp.<key>`) or the startup record (`project.<key>`).
 */
export const ICP_PREFILL_MAP = [
  { to: 'name', from: 'project.name', note: 'the page name is the startup and the template' },
  { to: 'headline', from: 'icp.valueProp' },
  { to: 'subheadline', from: 'icp.outcome' },
  { to: 'cta_text', from: 'icp.urgency', note: 'ctaForUrgency' },
  { to: 'audience_customer_headline', from: 'icp.valueProp' },
  { to: 'audience_customer_body', from: 'icp.outcome' },
  { to: 'audience_customer_cta', from: 'icp.urgency', note: 'ctaForUrgency' },
  { to: 'content.customer-acquisition.problem_lead', from: 'icp.pain1' },
  { to: 'content.customer-acquisition.product_lead', from: 'icp.differentiator' },
  { to: 'content.customer-audience.segments[0].label', from: 'icp.persona' },
  { to: 'content.customer-audience.segments[0].headline', from: 'icp.valueProp' },
  { to: 'content.customer-audience.segments[0].subhead', from: 'icp.outcome' },
  { to: 'content.customer-audience.problem_lead', from: 'icp.pain1' },
  { to: 'content.customer-audience.how_lead', from: 'icp.differentiator' },
];

/**
 * The create body for a draft customer page, from the confirmed ICP. Returns
 * null for an ICP that is not confirmed: there is no generator to offer.
 * `templateId` defaults to the recommendation.
 */
export function icpLandingDraft(project, templateId) {
  const def = readIcpDefinition(project?.icp_definition_meta);
  if (def.state !== 'confirmed') return null;
  const rec = recommendCustomerTemplate(project);
  const tpl = TEMPLATES.find((t) => t.id === (templateId || rec?.templateId));
  if (!tpl || tpl.audience !== 'customer') return null;
  const f = def.fields || {};
  const cta = ctaForUrgency(f.urgency);
  const body = {
    name: cap(`${cap(project?.name) || 'Startup'} · ${tpl.label}`),
    template: tpl.visualTemplate,
    template_kit: tpl.id,
    audience: 'customer',
    goal: tpl.primaryGoal,
    headline: cap(f.valueProp),
    subheadline: cap(f.outcome),
    cta_text: cta,
    audience_customer_headline: cap(f.valueProp),
    audience_customer_body: cap(f.outcome),
    audience_customer_cta: cta,
  };
  const content = {};
  if (tpl.visualTemplate === 'customer-acquisition') {
    content['customer-acquisition'] = { problem_lead: cap(f.pain1), product_lead: cap(f.differentiator) };
  } else if (tpl.visualTemplate === 'customer-audience') {
    content['customer-audience'] = {
      segments: [{ label: cap(f.persona), headline: cap(f.valueProp), subhead: cap(f.outcome) }],
      problem_lead: cap(f.pain1),
      how_lead: cap(f.differentiator),
    };
  }
  if (Object.keys(content).length) body.content_json = content;
  return body;
}
