// #4046 Group B3 — the brand builder's "Auto-fill with AI" becomes the standard
// Ask (the owner's call 4). It keeps its own endpoint and D1324's provenance;
// what changes is the control and its rule:
//   - the one control is the standard Ask (`FillFormTrigger`), named "Ask" on
//     the rail; no "Auto-fill with AI" is left;
//   - Ask places a value only where the field is open (blank, the page's own
//     default, or what Ask placed last), so a founder's own words are never
//     overwritten, nor a field they typed into while Ask ran;
//   - a template section the founder changed keeps their words;
//   - a placed value reads "Not saved" until Save, and Save sends only what
//     Ask placed and the founder kept.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/brand_ask_4046.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import BrandBuilderPage from '../src/pages/BrandBuilderPage.jsx';
import { api } from '../src/lib/api.js';
import { optionLabel } from '../src/lib/fillRun.js';
import { OPEN_DEFAULTS, placeAsk, placeAskContent } from '../src/lib/brand/proposals.js';
import { getRecommendedTemplatesForAudience } from '../src/lib/brand/flow.js';
import { mountContracts } from './_contracts_dom.mjs';

const PAGE = 'Founder · Grow · Distribution';

test('placeAsk: blank, default and last-placed fields are open; the founder\'s own words are not', () => {
  // Mutation checked: the `!cur` test dropped → the blank subheadline is not filled; the founder test dropped → the headline is overwritten.
  const answer = { name: 'Harbour', headline: 'Ship together', subheadline: 'Dispatch, visible', tagline: 'Every load', cta_text: 'Book a demo' };
  const draft = { name: 'Harbour Co', headline: 'Founder headline', subheadline: '', tagline: 'Old Ask line', cta_text: OPEN_DEFAULTS.cta_text };
  assert.deepEqual(placeAsk(draft, answer, { tagline: 'Old Ask line' }), { subheadline: 'Dispatch, visible', tagline: 'Every load', cta_text: 'Book a demo' });
  assert.deepEqual(placeAsk({ cta_text: 'Talk to us' }, { cta_text: 'Book a demo' }), {}, 'a CTA the founder wrote stays');
  assert.deepEqual(placeAsk({}, { headline: '  ' }), {}, 'an empty answer places nothing');
});

test('placeAskContent: a section changed from its default keeps the founder\'s words', () => {
  const defaults = { hero: 'Default hero', items: [{ t: 'a' }] };
  assert.deepEqual(placeAskContent({ hero: 'Mine', items: [{ t: 'a' }] }, defaults, { hero: 'Ask hero', items: [{ t: 'b' }] }), { hero: 'Mine', items: [{ t: 'b' }] });
  assert.deepEqual(placeAskContent(undefined, defaults, { hero: 'Ask hero' }), { hero: 'Ask hero', items: [{ t: 'a' }] });
  assert.deepEqual(placeAskContent({ hero: '' }, defaults, { hero: 'Ask hero' }), { hero: 'Ask hero', items: [{ t: 'a' }] });
  // Review finding: a second Ask refreshes a section that still holds what Ask wrote last.
  assert.deepEqual(placeAskContent({ hero: 'Ask hero' }, defaults, { hero: 'Ask hero 2' }, { hero: 'Ask hero' }).hero, 'Ask hero 2');
  assert.deepEqual(placeAskContent({ hero: 'Mine' }, defaults, { hero: 'Ask hero 2' }, { hero: 'Ask hero' }).hero, 'Mine');
});

test('the one control is the standard Ask; nothing reads "Auto-fill with AI"', () => {
  assert.equal(optionLabel(PAGE, 'form:landing'), 'Ask');
  const page = readFileSync('frontend/src/pages/BrandBuilderPage.jsx', 'utf8');
  const code = page.split('\n').filter((l) => !/^\s*(\/\/|\/?\*|\{\/\*)/.test(l)).join('\n');
  assert.doesNotMatch(code, />\s*Auto-fill with AI\s*</);
  assert.match(code, /<FillFormTrigger aiOff=\{!aiOn\} onOpen=\{autofill\} disabled=\{autofillBusy \|\| !projectId\} \/>/);
  assert.match(code, /useRailOption\(autofillBusy \? 'form:landing' : null, 'Ask'\)/);
  const matrix = readFileSync('cloudflare-worker/src/services/ai/railMatrix.json', 'utf8');
  assert.ok(!matrix.includes('"optionLabel": "Auto-fill with AI"'), 'regenerate it: node scripts/build-rail-matrix.mjs');
});

async function mount(answerWith) {
  const original = { ...api }; const saves = [];
  const answers = Array.isArray(answerWith) ? [...answerWith] : [answerWith];
  let release; let pending = new Promise((r) => { release = r; });
  api.listProjects = async () => [{ id: 1, name: 'Harbour', description: 'Local dispatch for small fleets' }];
  api.brandGetLanding = async () => ({ name: 'Harbour', template: 'minimal', audience: 'customer', headline: 'Founder headline', tagline: 'Founder tagline', theme_color: '#7c3aed' });
  api.brandListWaitlist = async () => ({ signups: [] });
  api.brandGetPreviewUrl = async () => ({});
  api.brandListTemplates = async () => ({ templates: [] });
  api.myAiSpend = api.aiPricing = async () => null;
  api.brandAutofillLanding = () => pending;
  const nextRun = () => { pending = new Promise((r) => { release = r; }); };
  api.brandSaveLanding = async (id, body) => { saves.push([id, structuredClone(body)]); return { ...body }; };
  const m = await mountContracts(React.createElement(BrandBuilderPage), '/build/brand');
  for (let i = 0; i < 4; i += 1) await m.flush();
  const byTestId = (id) => m.nodes().find((n) => m.props(n)?.['data-testid'] === id);
  return {
    ...m, saves, byTestId,
    async ask() { await act(async () => { m.props(byTestId('fill-form-trigger')).onClick(); }); },
    async answer() { const a = answers.shift(); await act(async () => { release(a); await pending; }); await m.flush(); nextRun(); },
    async pickKit() {
      const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
      const kit = getRecommendedTemplatesForAudience('customer').find((t) => t.visualTemplate !== 'minimal');
      const pick = m.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).includes(kit.label));
      assert.ok(pick, kit.label);
      await act(async () => { m.props(pick).onClick(); }); await m.flush();
    },
    async typeInto(placeholder, value) {
      const n = m.nodes().find((x) => m.props(x)?.placeholder === placeholder);
      assert.ok(n, placeholder);
      await act(async () => { m.props(n).onChange({ target: { value } }); }); await m.flush();
    },
    async close() { await m.unmount(); Object.assign(api, original); },
  };
}

test('the page: Ask fills the open fields, marks them "Not saved", and Save sends only what was kept', async () => {
  // Mutation checked: the "typed while Ask ran" filter dropped → the CTA the founder typed is overwritten.
  const m = await mount({ ai_generated: true, model: 'm', name: 'Harbour', headline: 'Ask headline', subheadline: 'Ask subheadline', cta_text: 'Book a demo', content: {} });
  try {
    assert.ok(m.byTestId('brand-ask'), 'the page draws its one Ask');
    await m.ask();
    await m.typeInto('CTA button text', 'Talk to us');
    await m.answer();
    assert.ok(m.byTestId('brand-placed-subheadline'), 'a placed value reads "Not saved"');
    assert.equal(!!m.byTestId('brand-placed-headline'), false, 'the founder\'s headline was not touched');
    await m.click('Save');
    const [, body] = m.saves.at(-1);
    assert.equal(body.headline, 'Founder headline');
    assert.equal(body.subheadline, 'Ask subheadline');
    assert.equal(body.cta_text, 'Talk to us', 'typed while Ask ran: the founder\'s');
    assert.deepEqual(body.ai_proposals, { subheadline: 'Ask subheadline' }, 'only what Ask placed and the founder kept');
  } finally { await m.close(); }
});

test('the page: copy step 2 seeded from the template kit is the page\'s, so Ask may replace it', async () => {
  // Review finding (high): before, a kit-seeded headline counted as the founder's and Ask never filled it.
  // Mutation checked: the askOpen seed in chooseTemplate dropped → the headline stays the kit's.
  const m = await mount({ ai_generated: true, model: 'm', headline: 'Ask headline', content: {} });
  try {
    await m.pickKit();
    await m.ask();
    await m.answer();
    await m.click('Save');
    assert.equal(m.saves.at(-1)[1].headline, 'Ask headline');
  } finally { await m.close(); }
});

test('the page: a fallback answer (no model) is marked and stays open to the next Ask, and is never filed as Eadwyn\'s', async () => {
  // Review finding (medium): fallback text got no "Not saved" mark and locked the field against the next Ask.
  const m = await mount([
    { ai_generated: false, subheadline: 'Fallback subheadline', content: {} },
    { ai_generated: true, model: 'm', subheadline: 'Ask subheadline', content: {} },
  ]);
  try {
    await m.ask(); await m.answer();
    assert.ok(m.byTestId('brand-placed-subheadline'), 'fallback text reads "Not saved" too');
    await m.ask(); await m.answer();
    await m.click('Save');
    const [, body] = m.saves.at(-1);
    assert.equal(body.subheadline, 'Ask subheadline', 'the next Ask replaces what Ask placed');
    assert.deepEqual(body.ai_proposals, { subheadline: 'Ask subheadline' });
    assert.equal(body.ai_model, 'm');
  } finally { await m.close(); }
});
