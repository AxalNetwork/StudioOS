// D1604 (#3716) — Pitch deck studio v2: the seam. Every v2 surface whose
// route is not on main reads `deckV2Adapter.js`, which answers unavailable
// keyed to the issue that brings the route, reaches no network, and can never
// be printed as a zero. The shared words and the element catalogue
// (`deckV2Model.js`) route every element to main or to that seam.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_v2_adapter_d1604.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { codeOnly } from './_codeOnly.mjs';
import { readDecision } from './_decisions.mjs';
import * as adapter from '../src/pages/raise/pitch/deckV2Adapter.js';
import {
  ELEMENT_GROUPS, ELEMENTS, HOLD, LATER, NOT_ON, PEND, areaLabel, elementOnMain,
} from '../src/pages/raise/pitch/deckV2Model.js';
import { FOUNDER_OPTIONS } from '../src/lib/railOptions/founder.js';

const read = (p) => readFileSync(p, 'utf8');
const PITCH = 'frontend/src/pages/raise/pitch';
const HELPERS = new Set(['NOT_ON', 'SURFACES', 'unavailable', 'through', 'shown', 'availability']);

test('every adapter method answers unavailable, with the reason and the issue that brings its route', async () => {
  const methods = Object.keys(adapter).filter((k) => !HELPERS.has(k));
  assert.deepEqual(methods.sort(), Object.keys(adapter.SURFACES).sort(), 'a method with no SURFACES row, or a row with no method');
  assert.ok(methods.length >= 40);
  for (const name of methods) {
    const answer = await adapter[name]('synthetic-deck', { synthetic: true });
    assert.deepEqual(answer, { available: false, reason: NOT_ON, issue: adapter.SURFACES[name].issue }, name);
    assert.ok(Object.isFrozen(answer), `${name}: a surface must not be able to turn it into an answer`);
    assert.ok(answer.issue >= 3749 && answer.issue <= 3881, `${name}: #${answer.issue} is outside the deck v2 backlog`);
    assert.deepEqual(adapter.availability(name), answer, `${name}: the synchronous read agrees`);
  }
  assert.equal(adapter.availability('notASurface'), null);
  assert.equal(NOT_ON, 'Not switched on yet.', 'Team’s words (D1497)');
});

test('the adapter keys each surface to the plan’s issue (§6.2)', () => {
  const want = {
    grid: 3749, saveCard: 3751, discardDraft: 3751, batch: 3753, cancelBatch: 3753, elementModels: 3754,
    areasQuote: 3764, areasGenerate: 3764, history: 3767, narrativeOutline: 3768, themesV2: 3769, instruct: 3773,
    stagePlan: 3774, figures: 3775, deckUsage: 3776, arrange: 3777, imageEdit: 3778, elementsLibrary: 3779,
    diagrams: 3780, ventureElements: 3781, templates: 3782, myTemplates: 3782, saveAsTemplate: 3782, typedTables: 3787,
    media: 3788, presets: 3796, orgLocks: 3786, critique: 3799, remix: 3800, consistency: 3802, deckActions: 3808,
    brandLocks: 3819, pptxImport: 3809, investorLinks: 3812, comments: 3817, slideAnalytics: 3820,
    presence: 3824, cardStatus: 3826, rehearse: 3827, walkthrough: 3837, retryFailed: 3879, unseenBatches: 3879,
    markSeen: 3879, setDeckSource: 3881,
  };
  // #3882 merged as D1603: the .odp export left the seam for its real client (pitch_v2_states_d1604).
  assert.equal('exportOdp' in adapter, false, 'a surface whose route is on main is not in the adapter');
  assert.deepEqual(Object.fromEntries(Object.entries(adapter.SURFACES).map(([k, v]) => [k, v.issue])), want);
  for (const [k, v] of Object.entries(adapter.SURFACES)) assert.ok(typeof v.what === 'string' && v.what.length > 8, k);
});

test('the seam reaches no network, and no client method exists for a route that is not on main', () => {
  const src = codeOnly(read(`${PITCH}/deckV2Adapter.js`));
  assert.doesNotMatch(src, /request\(|fetch\(|XMLHttpRequest|lib\/api/);
  assert.doesNotMatch(codeOnly(read(`${PITCH}/deckV2Model.js`)), /request\(|fetch\(|lib\/api|from 'react'/);
  const client = [read('frontend/src/lib/api.js'), ...readdirSync('frontend/src/lib/api').filter((f) => f.endsWith('.js')).map((f) => read(`frontend/src/lib/api/${f}`))].join('\n');
  // #3925 brought GET /grid and deckGrid.js onto main; future routes stay on the seam.
  assert.match(codeOnly(read('cloudflare-worker/src/index.ts')), /app\.route\('\/api\/decks', deckGrid\)/);
  assert.match(codeOnly(read('cloudflare-worker/src/routes/deck_grid.ts')), /deckGrid\.get\('\/:id\{\[0-9\]\+\}\/grid'/);
  for (const path of ['/areas', '/stage-plan', '/figures', '/element-models', '/remix', '/draft', '/areas/instruct']) {
    assert.ok(!new RegExp(`['"\`]/decks/[^'"\`\\n]*${path.replace(/[$/{]/g, (c) => `\\${c}`)}`).test(client), `a client path for ${path} before its route is on main`);
  }
  assert.ok(!readdirSync('frontend/src/lib/api').some((f) => /^deck(Draft|Areas|Instruct|Stage|Figures|ElementModels)\.js$/.test(f)));
});

test('an unavailable answer is never printed as a zero, "$0.00" or "none"', async () => {
  const money = (v) => `$${Number(v).toFixed(2)}`;
  const off = await adapter.deckUsage('deck');
  assert.equal(adapter.shown(off, money), LATER);
  assert.equal(adapter.shown(off, () => '0'), LATER, 'the formatter never runs on an unavailable answer');
  assert.equal(adapter.shown(undefined, money), LATER);
  assert.equal(adapter.shown({ available: true, value: 0 }, money), '$0.00', 'a real zero the Worker states is shown');
  assert.equal(adapter.shown({ available: false, unreadable: true, issue: 3776 }, money), 'Could not be read');
});

test('through() is the swap: a value, a route that is still off, or unreadable, never empty', async () => {
  assert.deepEqual(await adapter.through(async () => ({ structures: [] }), 3749), { available: true, value: { structures: [] } });
  const e404 = Object.assign(new Error('nope'), { status: 404 });
  assert.deepEqual(await adapter.through(async () => { throw e404; }, 3749), { available: false, reason: NOT_ON, issue: 3749 });
  const e500 = Object.assign(new Error('The deck could not be read.'), { status: 500 });
  const bad = await adapter.through(async () => { throw e500; }, 3749);
  assert.equal(bad.unreadable, true);
  assert.equal(bad.available, false);
  assert.equal(bad.reason, 'The deck could not be read.');
});

test('the element picker: 8 groups, each item on main or on the seam, and the three owner marks', () => {
  assert.deepEqual(ELEMENT_GROUPS.map((g) => g.label), ['Text', 'Images', 'Graphics', 'Data', 'Diagrams', 'Venture records', 'Media & links']);
  const options = new Set(FOUNDER_OPTIONS.map((o) => o.key));
  for (const el of ELEMENTS) {
    if (el.adapter) {
      assert.ok(adapter.SURFACES[el.adapter], `${el.id}: no adapter method ${el.adapter}`);
      assert.equal(el.issue, adapter.SURFACES[el.adapter].issue, `${el.id}: the issue differs from the adapter's`);
      assert.equal(elementOnMain(el), false, el.id);
    } else {
      assert.ok(el.route || el.free, `${el.id} is neither on main nor on the seam`);
      assert.equal(elementOnMain(el), true, el.id);
    }
    if (el.option) assert.ok(options.has(el.option), `${el.id}: rail option ${el.option} is not on main`);
  }
  // Model choice lives in the AIRail: an element names its rail option, never a model.
  assert.ok(ELEMENTS.every((el) => !('model' in el)));
  assert.deepEqual(ELEMENTS.filter((e) => e.pending).map((e) => e.id), ['remove_bg']);
  assert.equal(PEND, '(pending owner)');
  const on = new Set(ELEMENTS.filter(elementOnMain).map((e) => e.id));
  for (const id of ['title', 'body', 'bullets', 'chart', 'table', 'timeline', 'metric', 'photo', 'upload', 'video', 'team_grid']) assert.ok(on.has(id), id);
  for (const id of ['use_of_funds', 'round_terms', 'flow', 'funnel', 'icons']) assert.ok(!on.has(id), id);
});

test('area labels and the hold line', () => {
  assert.equal(areaLabel({ c1: 5, c2: 8, r1: 4, r2: 6 }), 'c5–8 × r4–6');
  assert.equal(areaLabel({ c1: 1, c2: 12, r1: 1, r2: 1 }), 'c1–12 × r1');
  assert.equal(areaLabel({ c1: 3, c2: 3, r1: 2, r2: 2 }), 'c3 × r2');
  assert.equal(areaLabel({ c1: 8, c2: 5, r1: 1, r2: 2 }), null);
  assert.equal(areaLabel({ c1: 0, c2: 5, r1: 1, r2: 2 }), null);
  assert.equal(areaLabel(null), null);
  assert.equal(HOLD('$0.03'), 'Holds up to $0.03 · you pay what it uses');
});

test('D1604 records the intake, the seam and its rules', () => {
  const d = readDecision(1604);
  assert.match(d, /deckV2Adapter\.js/);
  assert.match(d, /Pitch Deck Studio v2 Page\.dc\.html/);
  assert.match(d, /No migration|Migration:\*\* none/i);
  const incoming = read('design/incoming/README.md');
  assert.match(incoming, /Pitch Deck Studio v2/);
  const page = read('design/incoming/Pitch Deck Studio v2 Page.dc.html');
  assert.match(page, /src="\/eadwyn-ai\.png"/);
  assert.match(page, /src="\/axal-mark\.png"/);
  assert.doesNotMatch(page, /uploads\/axal-logo|src="eadwyn-ai\.png"|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  assert.match(read('design/incoming/Pitch Deck Studio v2 · Boards.dc.html'), /<dc-import name="Pitch Deck Studio v2 Page"/);
});
