/** Owner follow-up: every pricing tab changes both cards and comparisons;
 * LP Access follows all four investor plans, on desktop and phone alike. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ViewModeContext from '../src/contexts/ViewModeContext.js';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { PricingBody } from '../src/pages/PricingPage.jsx';
import { publicPricingApi } from '../src/lib/api/publicPricing.js';
import { readFileSync } from 'node:fs';
import { installDocument } from './_contracts_dom.mjs';

const text = n => n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '';
const walk = n => [n, ...(n.childNodes || []).flatMap(walk)];
const props = n => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const cls = (n, c) => (props(n).className || '').split(' ').includes(c);
const expected = [
  ['Founder', ['Free', 'Validate + Build', 'Raise + Grow'], 'Customer interviews', ['5', 'Unlimited', 'Unlimited']],
  ['Investor', ['Investor Basic', 'Investor Plus', 'Investor Pro', 'Institutional'], 'AI-assisted research', ['—', 'Standard limits', 'Higher limits', 'Negotiated']],
  ['Advisors', ['Advisor Basic', 'Advisor Pro', 'Advisory Firm'], 'Reach in matching', ['Standard', 'More', 'More']],
  ['Operating Partners', ['Partner Basic', 'Operating Partner Pro', 'Partner Firm'], 'Proposals, pipeline and delivery', ['—', '', '']],
];

for (const member of [false, true]) {
  test(`pricing tabs keep cards and desktop/phone comparisons together (${member ? 'member' : 'visitor'})`, async () => {
    const restore = installDocument();
    const createElement = document.createElement.bind(document);
    document.createElement = tag => {
      const node = createElement(tag);
      // Match the DOM's clearing/reparenting semantics used when keyed sections move.
      let value = '';
      Object.defineProperty(node, 'textContent', { get() { return this.childNodes.length ? this.childNodes.map(text).join('') : value; }, set(v) { this.childNodes = []; value = String(v); } });
      const append = node.appendChild.bind(node);
      node.appendChild = child => { if (child.parentNode) child.parentNode.removeChild(child); return append(child); };
      const insert = node.insertBefore.bind(node);
      node.insertBefore = (child, ref) => { if (child.parentNode) child.parentNode.removeChild(child); return insert(child, ref); };
      node.querySelector = () => null; // No geometry in this DOM; tab scrolling is browser-only.
      return node;
    };
    const original = { ...publicPricingApi };
    publicPricingApi.plansAndPacks = async () => ({ plans: [], packs: [] });
    publicPricingApi.aiModels = async () => ({ ok: true, models: [{ id: 'test-model', name: 'Synthetic model', group: 'Reasoning', billed: { tokens_in: 0.3 }, unit_words: { tokens_in: 'per 1M input tokens' }, pages: [] }] });
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ['/pricing?utm_source=test#plans'] },
        React.createElement(PricingBody, { user: member ? {} : null }))));
      const nodes = () => walk(container);
      const click = async label => {
        const button = nodes().find(n => n.tagName === 'BUTTON' && text(n) === label);
        await act(async () => props(button).onClick());
      };
      for (const [label, names, feature, values] of [...expected, expected[0]]) {
        await click(label);
        assert.deepEqual(nodes().filter(n => cls(n, 'axp-card-name')).map(text), names, `${label} cards`);
        assert.equal(nodes().filter(n => cls(n, 'axp-compare')).length, 1, `${label} has one comparison`);
        const compare = nodes().find(n => cls(n, 'axp-compare'));
        assert.ok(compare, `${label} comparison exists`);
        const desktop = walk(compare).find(n => cls(n, 'axp-desk'));
        assert.deepEqual(walk(desktop).filter(n => cls(n, 'axp-th')).map(text), names, `${label} comparison columns`);
        const row = walk(desktop).find(n => cls(n, 'axp-row') && text(n.childNodes[0]) === feature);
        assert.deepEqual(row.childNodes.slice(1).map(text), values, `${label} comparison values`);
        const phone = walk(compare).find(n => cls(n, 'axp-phone'));
        assert.deepEqual(walk(phone).filter(n => cls(n, 'axp-chip')).map(text), names, `${label} phone picker`);
        const phoneRow = walk(phone).find(n => cls(n, 'axp-row') && text(n.childNodes[0]) === feature);
        assert.equal(text(phoneRow.childNodes[1]), values[1], `${label} default phone comparison`);
        await click(names.at(-1));
        assert.equal(text(walk(phone).find(n => cls(n, 'axp-row') && text(n.childNodes[0]) === feature).childNodes[1]), values.at(-1), `${label} phone plan changes`);
      }
      await click('Models');
      assert.equal(nodes().filter(n => cls(n, 'axp-card-name')).length, 0, 'Models removes role plan cards');
      assert.equal(nodes().filter(n => cls(n, 'axp-compare')).length, 1, 'Models keeps a plan comparison');
      for (const [label, names, feature, values] of expected) {
        const key = { Founder: 'founder', Investor: 'investor', Advisors: 'advisor', 'Operating Partners': 'operating-partner' }[label];
        const button = nodes().find(n => props(n)['data-testid'] === `models-compare-${key}`);
        await act(async () => props(button).onClick());
        assert.equal(props(nodes().find(n => props(n)['data-testid'] === 'pricing-tab-models'))['aria-selected'], true, 'comparison picker stays on Models');
        assert.equal(props(button)['aria-pressed'], true, `${label} comparison selected`);
        const compare = nodes().find(n => cls(n, 'axp-compare'));
        assert.deepEqual(walk(compare).filter(n => cls(n, 'axp-th')).map(text), names, `${label} Models comparison headers`);
        assert.equal(cls(compare, 'axp-sec'), false, 'embedded comparison keeps single page gutters');
        assert.equal(nodes().filter(n => props(n).id === 'axp-models-compare-h').length, 1, 'one Models comparison heading');
        const desktop = walk(compare).find(n => cls(n, 'axp-desk'));
        const row = walk(desktop).find(n => cls(n, 'axp-row') && text(n.childNodes[0]) === feature);
        assert.deepEqual(row.childNodes.slice(1).map(text), values, `${label} Models comparison values`);
        const phone = walk(compare).find(n => cls(n, 'axp-phone'));
        const chips = walk(phone).filter(n => cls(n, 'axp-chip'));
        assert.deepEqual(chips.map(text), names, `${label} Models phone plans`);
        assert.equal(text(walk(phone).find(n => cls(n, 'axp-row') && text(n.childNodes[0]) === feature).childNodes[1]), values[1], `${label} Models phone default resets`);
        await act(async () => props(chips.at(-1)).onClick());
        assert.equal(text(walk(phone).find(n => cls(n, 'axp-row') && text(n.childNodes[0]) === feature).childNodes[1]), values.at(-1), `${label} Models phone plan changes`);
      }
      assert.ok(nodes().some(n => cls(n, 'axp-models') && text(n).includes('Synthetic model')), 'Models shows its model table');
      await click('Investor');
      const grid = nodes().find(n => cls(n, 'axp-grid'));
      const lp = nodes().find(n => cls(n, 'axp-lp'));
      assert.equal(grid.childNodes.length, 4, 'four investor plans');
      assert.ok(grid.parentNode === lp.parentNode && grid.parentNode.childNodes.indexOf(grid) < grid.parentNode.childNodes.indexOf(lp), 'LP Access is below the four investor plans');
      await click('Founder');
      assert.equal(nodes().filter(n => cls(n, 'axp-lp')).length, 0, 'LP Access belongs only to Investor');
      let releasePlans;
      publicPricingApi.plansAndPacks = () => new Promise(resolve => { releasePlans = resolve; });
      await click('Models');
      const loading = nodes().find(n => cls(n, 'axp-model-comparison'));
      assert.ok(walk(loading).some(n => props(n)['aria-busy'] === 'true'), 'Models plan comparison has its own loading state');
      assert.ok(text(nodes().find(n => cls(n, 'axp-models'))).includes('Synthetic model'), 'model rates stay readable while plans load');
      await act(async () => releasePlans({ plans: [], packs: [] }));
      assert.equal(nodes().filter(n => cls(n, 'axp-compare')).length, 1, 'comparison appears when plans resolve');
      publicPricingApi.plansAndPacks = async () => { throw new Error('synthetic plan failure'); };
      await click('Founder');
      await click('Models');
      assert.ok(text(nodes().find(n => cls(n, 'axp-model-comparison'))).includes('Prices unavailable'), 'plan failure is visible inside the comparison');
      assert.ok(text(nodes().find(n => cls(n, 'axp-models'))).includes('Synthetic model'), 'plan failure keeps model rates');
      publicPricingApi.plansAndPacks = async () => ({ plans: [], packs: [] });
      await click('Try again');
      assert.equal(nodes().filter(n => cls(n, 'axp-compare')).length, 1, 'comparison retry recovers');
      publicPricingApi.aiModels = async () => { throw new Error('synthetic model failure'); };
      await click('Founder');
      await click('Models');
      assert.equal(nodes().filter(n => cls(n, 'axp-compare')).length, 1, 'model failure keeps the plan comparison');
      assert.ok(text(nodes().find(n => cls(n, 'axp-models'))).includes('Prices unavailable'), 'model failure stays visible');
    } finally {
      await act(async () => root.unmount());
      Object.assign(publicPricingApi, original);
      restore();
    }
  });
}

// The order changes at all widths; its former bottom margin must move with it.
test('LP Access has space above it after the plans', () => {
  const css = readFileSync(new URL('../src/pages/pricing.css', import.meta.url), 'utf8');
  assert.match(css.match(/\.axp-lp \{([^}]+)\}/)[1], /margin-top: 20px/);
});


test('direct Models links default to the member audience or Founder for visitors', () => {
  for (const [role, key] of [[null, 'founder'], ['investor', 'investor'], ['advisor', 'advisor'], ['partner', 'operating-partner']]) {
    const html = renderToStaticMarkup(React.createElement(ViewModeContext.Provider, { value: role ? { shellRole: role } : null },
      React.createElement(MemoryRouter, { initialEntries: ['/pricing?for=models'] }, React.createElement(PricingBody, { user: role ? {} : null }))));
    assert.match(html, new RegExp(`aria-pressed="true" data-testid="models-compare-${key}"`), `${role || 'visitor'} Models default`);
    assert.equal((html.match(/id="axp-models-compare-h"/g) || []).length, 1, 'one comparison heading');
  }
});
