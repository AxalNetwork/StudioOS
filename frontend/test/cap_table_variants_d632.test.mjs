/**
 * D632 (#1390) — the cap table's draft variants, edited in place (Ops canvas
 * `ct-variants`), rendered from the real components in each state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  CapTableVariantsView, VariantEditor, draftFromScenario, inputsFromDraft, variantSaveErrors, variantHref,
} from '../src/pages/CapTableVariantsPage.jsx';
import { ScenarioComparePanel } from '../src/pages/CapTablePage.jsx';

const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const words = (markup) => {
  let out = '';
  let inTag = false;
  for (const ch of String(markup)) {
    if (ch === '<') { inTag = true; out += ' '; } else if (ch === '>' && inTag) inTag = false;
    else if (!inTag) out += ch;
  }
  return out.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
};

const VARIANT = {
  uid: 'v-1', name: 'Bigger seed', is_variant: 1, project_id: 4,
  inputs: {
    founders: [{ name: 'Ada', shares: 4000000 }, { name: 'Grace', shares: 4000000 }],
    option_pool_pct: 10,
    safes: [{ name: 'Angel', amount: 250000, cap: 8000000, discount: 0.2, basis: 'post_money' }],
    rounds: [{ name: 'Seed', investment: 1500000, pre_money: 6000000, post_round_pool_pct: 12 }],
    exit_value: null,
  },
};
const READY = { kind: 'ready', projectId: 4, canonical: { uid: 'main', name: 'Main' }, variants: [VARIANT, { uid: 'v-2', name: 'Bridge first' }] };

test('the editor draws each group, with Not recorded where a variant stores nothing', () => {
  const draft = draftFromScenario(VARIANT);
  const markup = html(h(VariantEditor, { draft, setDraft: () => {} }));
  const text = words(markup);
  for (const g of ['Founders', 'Option pool', 'SAFEs', 'Rounds', 'Exit value']) {
    assert.match(markup, new RegExp(`data-testid="variant-group-${g}"`), g);
  }
  assert.match(text, /Name Shares Vesting/);
  assert.match(text, /Pool Size Granted/);
  assert.match(text, /Investor Amount Cap · discount/);
  assert.match(text, /Round Raise Pre-money/);
  assert.match(markup, /Variant name<\/span><input [^>]*value="Bigger seed"/);
  assert.match(markup, /aria-label="Founder 2 name"[^>]*value="Grace"/);
  assert.match(markup, /aria-label="SAFE 1 discount, percent"[^>]*value="20"/, 'a 0.2 discount reads as 20 percent');
  assert.match(markup, /aria-label="Round 1 pre-money"[^>]*value="6000000"/);
  assert.equal((text.match(/Not recorded · vesting is not part of a variant/g) || []).length, 2, 'once per founder');
  assert.match(text, /Not recorded · grants are not part of a variant/);
  assert.match(text, /Exit value: none has been set for this variant\./);

  const withExit = words(html(h(VariantEditor, { draft: { ...draft, exit_value: '40000000' }, setDraft: () => {} })));
  assert.doesNotMatch(withExit, /none has been set/);
  assert.match(withExit, /40,000,000/);
});

test('the form round-trips the stored inputs, keeping fields it does not edit', () => {
  const { errors, inputs } = inputsFromDraft(draftFromScenario(VARIANT));
  assert.deepEqual(errors, []);
  assert.deepEqual(inputs, VARIANT.inputs, 'nothing is lost or invented by opening and saving');

  const edited = draftFromScenario(VARIANT);
  edited.exit_value = '40,000,000';
  edited.safes[0].discount = '';
  edited.founders[0].shares = 'lots';
  const out = inputsFromDraft(edited);
  assert.equal(out.inputs.exit_value, 40000000);
  assert.equal('discount' in out.inputs.safes[0], false, 'a blank discount is left out, not sent as zero');
  assert.deepEqual(out.errors, ['Founder 1 shares is not a number.']);
});

test('a refused save reads as the route\'s sentences', () => {
  const e = Object.assign(new Error('x'), { status: 400, data: { code: 'invalid_inputs', errors: ['At least one founder is required.'] } });
  assert.deepEqual(variantSaveErrors(e), ['At least one founder is required.']);
  assert.deepEqual(variantSaveErrors({ status: 402 }), ['Editing a variant needs the Growth plan.']);
  assert.deepEqual(variantSaveErrors({ status: 403 }), ['You can read this cap table, but not change it.']);
  const shown = words(html(h(VariantEditor, { draft: draftFromScenario(VARIANT), setDraft: () => {}, errors: ['At least one founder is required.'] })));
  assert.match(shown, /At least one founder is required\. Save variant/);
  const saved = words(html(h(VariantEditor, { draft: draftFromScenario(VARIANT), setDraft: () => {}, saved: true })));
  assert.match(saved, /Saved\. The main cap table did not change\./);
});

test('the page: tabs, the main table as a link only, and the editor for the chosen variant', () => {
  const editor = h(VariantEditor, { draft: draftFromScenario(VARIANT), setDraft: () => {} });
  const markup = html(h(CapTableVariantsView, { read: READY, selectedUid: 'v-1', editor }));
  const text = words(markup);
  assert.match(text, /Cap table Draft variants Model alternatives without touching the main cap table\. The main table stays one per company\. New variant/);
  assert.match(text, /Bigger seed Bridge first Main cap table/);
  assert.match(markup, /aria-current="page"[^>]*href="\/raise\/cap-table\/variants\/v-1"/);
  assert.match(markup, /href="\/raise\/cap-table\/variants\/v-2"/);
  assert.match(markup, /href="\/raise\/capital\/cap-table"[^>]*>Main cap table</);
  assert.match(markup, /data-testid="variant-editor"/);
  assert.doesNotMatch(markup, /variants\/main/, 'the main table is never opened as a variant');
});

test('the page: loading, empty, missing and unreadable', () => {
  const loading = html(h(CapTableVariantsView, { read: { kind: 'loading' } }));
  assert.match(words(loading), /Loading variants…/);
  assert.doesNotMatch(loading, /variant-new|variants-empty/);

  const empty = words(html(h(CapTableVariantsView, { read: { ...READY, variants: [] } })));
  assert.match(empty, /No draft variants yet\. The main cap table is the only table\./);
  assert.match(empty, /New variant/);

  const unread = html(h(CapTableVariantsView, { read: { kind: 'unreadable', message: 'Network down.' } }));
  assert.match(words(unread), /Variants could not be read just now\. Network down\. Try again/);
  assert.doesNotMatch(unread, /No draft variants yet|variant-new/);

  const main = words(html(h(CapTableVariantsView, { read: { kind: 'missing', message: 'This is the main cap table, not a draft variant. Edit it on the cap table page.' } })));
  assert.match(main, /This is the main cap table, not a draft variant\./);
});

test('the compare panel links each draft variant to its editor, and not the main table', () => {
  const markup = html(h(ScenarioComparePanel, {
    data: { canonical: { uid: 'main', name: 'Main', result: null }, variants: [{ uid: 'v-1', name: 'Bigger seed', result: null }] },
    loading: false, error: null, onClose: () => {}, onRefresh: () => {},
  }));
  assert.match(markup, /data-testid="variant-edit-v-1"/);
  assert.match(markup, /href="\/raise\/cap-table\/variants\/v-1"/);
  assert.doesNotMatch(markup, /variant-edit-main/);
  assert.equal(variantHref('a b'), '/raise/cap-table/variants/a%20b');
});

test('the page saves through the in-place edit, never the main-table upsert', () => {
  const src = readFileSync(new URL('../src/pages/CapTableVariantsPage.jsx', import.meta.url), 'utf8');
  assert.match(src, /client\.updateCapTableScenario\(variant, \{ name, inputs \}\)/);
  assert.doesNotMatch(src, /createCapTableScenario|project_id: /, 'no write that could replace the main cap table');
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /path="\/raise\/cap-table\/variants\/:variant" element=\{guard\(\['admin', 'founder'\]/);
});
