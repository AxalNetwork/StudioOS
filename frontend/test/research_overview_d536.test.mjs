/**
 * D536 (#1082) — the frontend half of the Research overview, before the panel.
 *
 * The panel itself waits for the owner's approval of the design canvas. What
 * ships now: the D527 client module for GET /api/research/overview, and the
 * founder desk no longer printing "0 researched" for a missing count, nor
 * calling the platform's member companies "the company directory".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const DESK = read('frontend/src/pages/founder/FounderResearchDesk.jsx');

test('researchOverview.js calls the one Worker route, and api.js re-exports it in its block', () => {
  const mod = read('frontend/src/lib/api/researchOverview.js');
  assert.match(mod, /request\(`\/research\/overview\$\{top \? `\?top=\$\{encodeURIComponent\(top\)\}` : ''\}`\)/);
  const api = read('frontend/src/lib/api.js');
  const block = api.slice(api.indexOf('// api-modules:begin'), api.indexOf('// api-modules:end'));
  assert.match(block, /^export \* from '\.\/api\/researchOverview\.js';$/m);
  const index = read('cloudflare-worker/src/index.ts');
  assert.ok(index.indexOf("app.route('/api/research/overview', researchOverview)") >= 0);
  assert.ok(index.indexOf("app.route('/api/research/overview'") < index.indexOf("app.route('/api/research', research)"),
    'the overview must be mounted before /api/research');
});

/** The helper as the desk defines it, run on its own. */
function fundCountMeta() {
  const src = DESK.match(/function fundCountMeta\(funds\) \{[\s\S]*?\n\}/)[0];
  return new Function(`${src}; return fundCountMeta;`)();
}

test('the fund card never prints a count it was not given', () => {
  assert.doesNotMatch(DESK, /researched_count \?\? 0/, 'the `?? 0` is back');
  const f = fundCountMeta();
  assert.equal(f(undefined), 'Not recorded');
  assert.equal(f({}), 'Not recorded');
  assert.equal(f({ researched_count: null }), 'Not recorded');
  assert.equal(f({ researched_count: 'n/a' }), 'Not recorded');
  assert.equal(f({ researched_count: 3 }), '3 researched');
  assert.equal(f({ researched_count: 0 }), '0 researched', 'an empty store is a fact about the store');
  assert.match(DESK, /meta=\{sourceMeta\('funds', fundCountMeta\(data\.funds\)\)\}/);
});

test('the Company profiles card says it counts platform companies, not the research directory', () => {
  const card = DESK.slice(DESK.indexOf('id="a7-companies"'), DESK.indexOf('</section>', DESK.indexOf('id="a7-companies"')));
  // The count stays `N returned` (research_zone_states pins it, zero included);
  // the card's text names what it counts.
  assert.match(card, /These are the companies on the platform, not the research directory/);
  assert.match(card, /No company on the platform is visible to you yet; the research directory is under Companies/);
  assert.doesNotMatch(card, /available from the company directory/, 'member companies were called the directory');
});
