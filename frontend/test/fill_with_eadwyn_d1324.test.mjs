// D1324 (#3485), Fill with Eadwyn part 1:
//   - the founder's brand Save sends what "Auto-fill with AI" proposed and the
//     founder kept, so `PUT /api/brand/landing/by-project/:pid` records it
//     (the Worker half is cloudflare-worker/test/brand_save_provenance_d1324.test.ts);
//   - an Eadwyn mark's hover names no model and no option key: `fillRunLine`
//     says the control's label, or its page.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fill_with_eadwyn_d1324.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fillRunLine, optionLabel } from '../src/lib/fillRun.js';
import { keptProposals, proposalsFrom, PROPOSED_FIELDS } from '../src/lib/brand/proposals.js';
import { FillMark, marketFillMark } from '../src/ui/FillMark.jsx';
import { codeOnly } from './_codeOnly.mjs';

const RUN = { usage_log_id: 41, rail_page: 'Founder · Grow · Distribution', rail_option: 'form:landing', charged_microusd: 1200, est_cost_usd: null };

test('the run line says the control’s label, else its page, never the option key or a usage row', () => {
  assert.equal(optionLabel('Founder · Grow · Distribution', 'form:landing'), 'Auto-fill with AI');
  assert.equal(fillRunLine(RUN), 'Run: Auto-fill with AI · charged $0.0012');
  assert.equal(fillRunLine({ ...RUN, rail_option: 'fill:unlisted' }), 'Run: Founder · Grow · Distribution · charged $0.0012');
  assert.equal(fillRunLine({ ...RUN, rail_option: null, rail_page: null }), 'Run: an Eadwyn run · charged $0.0012');
  // A key two pages share is read by its page.
  assert.equal(optionLabel('Founder · Validate · Experiments and evidence', 'fill:hypothesis'), 'Draft a hypothesis');
  assert.equal(optionLabel('No such page', 'no:such-key'), null);
  // `explain:question` is the founder's "Explain" on Studio and the partner's "Explain this question" on Home.
  assert.equal(optionLabel('Founder · Studio', 'explain:question'), 'Explain');
  assert.equal(optionLabel('Home', 'explain:question'), 'Explain this question');
  assert.equal(optionLabel('Some other page', 'explain:question'), null, 'a shared key on an unknown page is not guessed');
  for (const run of [RUN, { ...RUN, rail_option: 'fill:unlisted' }, { ...RUN, rail_option: null, rail_page: null }]) {
    assert.doesNotMatch(fillRunLine(run), /\b(fill|form|draft|ask):|usage row/, JSON.stringify(run));
  }
});

test('an Eadwyn mark’s hover names no model and no option key', () => {
  const fill = { edited: true, proposed_value: '$4.2B', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', citation: { source: 'Gartner 2026', quote: 'The market is $4.2B.' },
    run: { usage_log_id: 9, rail_page: 'Founder · Spin-Out Lab · Market', rail_option: 'fill:market', charged_microusd: 900 } };
  const html = renderToStaticMarkup(React.createElement(FillMark, { mark: marketFillMark(fill) }));
  const title = /title="([^"]*)"/.exec(html)?.[1] || '';
  assert.match(title, /Eadwyn proposed this and you changed it/);
  assert.match(title, /Run: Founder · Spin-Out Lab · Market/);
  assert.doesNotMatch(title, /Model|llama|@cf\//i, 'no model name');
  assert.doesNotMatch(title, /fill:|form:/, 'no option key');
});

test('the brand page sends only what Eadwyn proposed and the founder kept, with its Save', () => {
  assert.deepEqual(PROPOSED_FIELDS, ['name', 'headline', 'subheadline', 'tagline', 'cta_text']);
  const proposed = proposalsFrom({ ai_generated: true, name: 'Harbour', headline: 'Ship together', tagline: 'Every shipment visible', content: { x: 1 } });
  assert.deepEqual(proposed, { name: 'Harbour', headline: 'Ship together', tagline: 'Every shipment visible' });
  assert.deepEqual(keptProposals({ name: 'Harbour', headline: 'Ship it together', tagline: 'Every shipment visible' }, proposed), { name: 'Harbour', tagline: 'Every shipment visible' });
  assert.deepEqual(keptProposals({ name: '' }, { name: '' }), {}, 'nothing kept from nothing');
  assert.deepEqual(keptProposals({ content_json: 'x', logo_url: 'u', name: 'Harbour' }, { content_json: 'x', logo_url: 'u', name: 'Harbour' }), { name: 'Harbour' }, 'only the page’s own copy columns');

  const page = codeOnly(readFileSync('frontend/src/pages/BrandBuilderPage.jsx', 'utf8'));
  assert.match(page, /setAiProposed\(proposalsFrom\(r\)\);/);
  assert.match(page, /const kept = keptProposals\(draft, aiProposed\);/);
  assert.match(page, /api\.brandSaveLanding\(projectId, Object\.keys\(kept\)\.length \? \{ \.\.\.draft, ai_proposals: kept, ai_model: aiModel\.current \} : draft\)/);
  // Recorded once, and never filed against another venture's page.
  assert.ok([...page.matchAll(/setAiProposed\(\{\}\)/g)].length >= 2);
  assert.match(page, /useEffect\(\(\) => \{ setAiProposed\(\{\}\); aiModel\.current = null; \}, \[projectId\]\);/);
});
