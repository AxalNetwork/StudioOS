/** D6040 (#6040): both module layouts show recorded facts without fabricating missing values.
 *
 * From frontend/test/README.md (moved by #6472): `build_facts_6040.test.mjs` (D6040) renders
 * present, null, zero and unreadable Build facts through both desktop and phone module pages.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import CycleModulePage from '../src/pages/cycles/CycleModulePage.jsx';
import PhoneModulePage from '../src/pages/cycles/PhoneModulePage.jsx';
import { renderedText } from './_renderedText.mjs';

const cases = [
  ['founding-team', { option_pool_pct: 12, option_pool_source: 'record', cofounder_decision: { outcome: 'searching', note: 'Need a product partner' }, agreement_reason: 'Individual signing status is not recorded.' }, /Option pool12%Source: Cap table record/, /Need a product partner/],
  ['company-creation', { ip: { origin: 'university', institution: 'Example University', tto_status: 'negotiating', ip: ['patent_filed'] }, incorporation: { entity: 'ccorp', override_reason: 'Venture financing' }, filings: 3, next_filing_due: '2027-03-01' }, /Example University/, /3Source: Company creation filing records/],
  ['product-roadmap', { items: 5, shipped_this_month: 0 }, /Items5/, /Shipped this month0/],
];
for (const Page of [CycleModulePage, PhoneModulePage]) {
  function draw(slug, facts, status = 'ready') {
    const data = { facts, card: { slug, name: 'Build module', state: 'empty', series: [] }, module: { name: 'Build module' }, records: { cols: [], rows: [], total: 0, page: 1, page_size: 20 } };
    return renderedText(renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Page, { cycle: 'build', slug, data, status })))).replace(/\s+/g, ' ');
  }
  for (const [slug, facts, first, second] of cases) {
    test(`${Page.name}: ${slug} shows facts and sources`, () => {
      const text = draw(slug, facts);
      assert.match(text, first);
      assert.match(text, second);
      assert.match(text, /Source:/);
    });
    test(`${Page.name}: ${slug} nulls stay Not recorded and failed reads stay Unreadable`, () => {
      assert.match(draw(slug, null), /Not recorded/);
      assert.doesNotMatch(draw(slug, null), /Option pool0%|Items0|Filings0|Shipped this month0/);
      assert.match(draw(slug, facts, 'unreadable'), /Unavailable.*could not be read/);
      assert.doesNotMatch(draw(slug, facts, 'unreadable'), first);
    });
  }
}
