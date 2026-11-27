/**
 * D591 (#1218; S1's 1A and 2A) — the confirmed ICP recommends a customer
 * template and prefills a draft page, through one mapping
 * (`lib/brand/icpPrefill.js`). An unconfirmed ICP offers no generator.
 *
 * The Worker side (draft-only creation, ownership, the sanitizer and its caps)
 * is `cloudflare-worker/test/brand_icp_draft_d591.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  ICP_PREFILL_MAP, CUSTOMER_PAGE_TYPES, ctaForUrgency, icpLandingDraft, recommendCustomerTemplate,
} from '../src/lib/brand/icpPrefill.js';
import { TEMPLATES } from '../src/lib/brand/templates.js';
import { LAB_TOOLS } from '../src/lib/spinoutLabArsenal.js';
import IcpDefinitionCard from '../src/components/discovery/IcpDefinitionCard.jsx';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8');
const brandCode = codeOnly(read('pages/SpinoutLabBrandPage.jsx'));
const cardCode = codeOnly(read('components/discovery/IcpDefinitionCard.jsx'));

const ICP = {
  type: 'B2B', industry: 'Logistics', size: '20–50 employees', persona: 'Ops lead', geo: 'UK',
  pain1: 'Dispatch is done by phone.', alternative: 'A sheet', whyFail: 'Nobody trusts it.',
  outcome: 'Every truck out by 7am.', trigger: 'A missed delivery', metric: 'On-time rate',
  urgency: 'Aware — not yet looking', budget: 'Mid — $200/mo per team ceiling', objection: 'Tried software.',
  valueProp: 'Dispatch from one screen.', differentiator: 'Reads the drivers’ WhatsApp.', tone: 'Confident',
};
const meta = (status, fields = ICP) => JSON.stringify({ status, step: 5, version: 1, fields });
const project = (fields = ICP, status = 'confirmed') => ({ id: 1, name: 'Acme', sector: 'logistics', icp_definition_meta: meta(status, fields) });

test('the recommendation: two buyers → audience page; looking now → demo request; otherwise → waitlist', () => {
  assert.equal(recommendCustomerTemplate(project({ ...ICP, type: 'Both' })).templateId, 'customer-audience');
  assert.equal(recommendCustomerTemplate(project({ ...ICP, urgency: 'Active — looking now' })).templateId, 'customer-acquisition');
  assert.equal(recommendCustomerTemplate(project()).templateId, 'proof-builder');
  assert.equal(recommendCustomerTemplate(project({ ...ICP, urgency: 'Latent — does not know it is a problem' })).templateId, 'proof-builder');
  // Two buyer types wins over urgency: one page has to speak to both.
  assert.equal(recommendCustomerTemplate(project({ ...ICP, type: 'Both', urgency: 'Active — looking now' })).templateId, 'customer-audience');
  const rec = recommendCustomerTemplate(project());
  assert.equal(rec.pageType, 'Waitlist');
  assert.equal(rec.label, 'Proof Builder');
  assert.match(rec.reason, /^Waitlist page for a logistics startup: /, 'the sector is named');
  assert.doesNotMatch(recommendCustomerTemplate({ ...project(), sector: '' }).reason, / for a /);
  // Each page type is one of the customer templates the library ships.
  for (const id of Object.keys(CUSTOMER_PAGE_TYPES)) {
    assert.equal(TEMPLATES.find((t) => t.id === id)?.audience, 'customer', id);
  }
});

test('an unconfirmed ICP recommends nothing and drafts nothing', () => {
  for (const p of [project(ICP, 'draft'), { id: 1, icp_definition_meta: null }, { id: 1, icp_definition_meta: '{bad' }]) {
    assert.equal(recommendCustomerTemplate(p), null);
    assert.equal(icpLandingDraft(p), null);
    assert.equal(icpLandingDraft(p, 'proof-builder'), null, 'naming a template does not get round the confirmation');
  }
  assert.equal(icpLandingDraft(project(), 'capital-ready-kit'), null, 'only a customer template is prefilled');
});

test('the mapping, field by field', () => {
  const resolve = (from, p) => (from.startsWith('icp.') ? ICP[from.slice(4)] : p[from.slice(8)]);
  const at = (body, to) => {
    const m = /^content\.([a-z-]+)\.([a-z_]+)(?:\[0\]\.([a-z_0-9]+))?$/.exec(to);
    if (!m) return body[to];
    const v = body.content_json?.[m[1]]?.[m[2]];
    return m[3] ? v?.[0]?.[m[3]] : v;
  };
  const drafts = {
    'proof-builder': icpLandingDraft(project(), 'proof-builder'),
    'customer-acquisition': icpLandingDraft(project(), 'customer-acquisition'),
    'customer-audience': icpLandingDraft(project(), 'customer-audience'),
  };
  for (const m of ICP_PREFILL_MAP) {
    const tkey = /^content\.([a-z-]+)\./.exec(m.to)?.[1];
    for (const [id, body] of Object.entries(drafts)) {
      if (tkey && tkey !== id) {
        assert.equal(body.content_json?.[tkey], undefined, `${id} carries ${tkey}'s content`);
        continue;
      }
      const got = at(body, m.to);
      if (m.to === 'name') assert.equal(got, `Acme · ${TEMPLATES.find((t) => t.id === id).label}`);
      else if (m.note === 'ctaForUrgency') assert.equal(got, ctaForUrgency(ICP.urgency), `${id} ${m.to}`);
      else assert.equal(got, resolve(m.from, project()), `${id} ${m.to} ← ${m.from}`);
    }
  }
  assert.equal(drafts['proof-builder'].content_json, undefined, 'the waitlist page maps no template content');
  assert.deepEqual(
    Object.keys(drafts['customer-audience']).sort(),
    ['audience', 'audience_customer_body', 'audience_customer_cta', 'audience_customer_headline', 'content_json', 'cta_text', 'goal', 'headline', 'name', 'subheadline', 'template', 'template_kit'].sort(),
    'the draft carries the mapped fields and the template, and nothing that publishes',
  );
  assert.equal(ctaForUrgency('Active — looking now'), 'Book a demo');
  assert.equal(ctaForUrgency('Aware — not yet looking'), 'Join the waitlist');
  assert.equal(ctaForUrgency('Latent — does not know it is a problem'), 'See how it works');
  assert.equal(ctaForUrgency(undefined), 'Join the waitlist');
});

const card = (p, canEdit = true) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(IcpDefinitionCard, { project: p, canEdit })));

test('the ICP card offers "Generate landing page →" for a confirmed ICP, to someone who may edit it, and only then', () => {
  const on = card(project());
  assert.match(on, /data-testid="button-icp-generate-landing"/);
  assert.match(renderedText(on), /Proof Builder · Waitlist page for a logistics startup: /);
  for (const off of [card(project(ICP, 'draft')), card({ id: 1, icp_definition_meta: null }), card(project(), false)]) {
    assert.doesNotMatch(off, /button-icp-generate-landing|icp-landing-generator/);
  }
  // It creates through the owner-scoped page create, from the mapping, and says nothing is published.
  assert.match(cardCode, /const body = icpLandingDraft\(project\);/);
  assert.match(cardCode, /await api\.brandCreatePage\(project\.id, body\);/);
  assert.match(cardCode, /Nothing is published: review it in Brand & Pages, then publish it yourself\./);
  assert.doesNotMatch(cardCode, /brandPublish|\/publish/, 'the generator never publishes');
  assert.doesNotMatch(cardCode, /icp-landing-unrecorded/, 'the "not built" line is gone');
});

test('the Brand library shows the recommendation, and the template count is read, never typed', () => {
  assert.match(brandCode, /const icpRecommendation = useMemo\(\(\) => recommendCustomerTemplate\(project\), \[project\]\);/);
  assert.equal((brandCode.match(/\{icpRecommendation\?\.templateId === t\.id && <RecommendedBadge \/>\}/g) || []).length, 2, 'grid and list views both mark it');
  assert.match(brandCode, /Recommended from your confirmed ICP: \{icpRecommendation\.label\}\./);
  assert.match(brandCode, /data-testid="library-count">\{TEMPLATES\.length\} templates</);
  const brand = LAB_TOOLS.find((a) => a.id === 'brand');
  assert.equal(TEMPLATES.length, 18);
  assert.equal(brand.blurb, 'Eighteen templates, with lead routing.');
  assert.doesNotMatch(read('lib/spinoutLabArsenal.js'), /Sixteen templates/);
});
