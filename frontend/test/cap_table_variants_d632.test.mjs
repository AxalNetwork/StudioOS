/**
 * D632 (#1390) — the cap table's draft variants, edited in place (Ops canvas
 * `ct-variants`), rendered from the real components in each state. D1029
 * (#2866) deleted the variants page: its address opens Scenarios, and the
 * editor and the form pinned here are the tool's (D1024).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { draftFromScenario, inputsFromDraft, variantSaveErrors } from '../src/pages/raise/captable/scenariosModel.js';
import { VariantEditor } from '../src/pages/raise/captable/ScenarioModelEditor.jsx';

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
  // D1024: scenarios are on the Raise + Grow plan (`studio`, D683), as the route's tier gate says.
  assert.deepEqual(variantSaveErrors({ status: 402 }), ['Editing a scenario needs the Raise + Grow plan.']);
  assert.deepEqual(variantSaveErrors({ status: 403 }), ['You can read this cap table, but not change it.']);
  const shown = words(html(h(VariantEditor, { draft: draftFromScenario(VARIANT), setDraft: () => {}, errors: ['At least one founder is required.'] })));
  assert.match(shown, /At least one founder is required\. Save variant/);
  const saved = words(html(h(VariantEditor, { draft: draftFromScenario(VARIANT), setDraft: () => {}, saved: true })));
  assert.match(saved, /Saved\. The main cap table did not change\./);
});

test('D1024: the editor is the Cap table tool\'s, named by Scenarios\' rename dialog', () => {
  const named = words(html(h(VariantEditor, { draft: draftFromScenario(VARIANT), setDraft: () => {}, naming: false })));
  assert.doesNotMatch(named, /Variant name/, 'Scenarios renames in a dialog');
  assert.match(named, /Save scenario/);
});
