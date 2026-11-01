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
const HELPERS = new Set(['NOT_ON', 'SURFACES', 'SWAPPED', 'unavailable', 'through', 'shown', 'availability']);
import { deckGridApi } from '../src/lib/api/deckGrid.js';
import { deckStageApi } from '../src/lib/api/deckStage.js';
import { deckRemixApi } from '../src/lib/api/deckRemix.js';
import { deckElementModelsApi } from '../src/lib/api/deckElementModels.js';

test('every adapter method answers unavailable, with the reason and the issue that brings its route', async () => {
  const methods = Object.keys(adapter).filter((k) => !HELPERS.has(k));
  assert.deepEqual(methods.sort(), Object.keys(adapter.SURFACES).sort(), 'a method with no SURFACES row, or a row with no method');
  assert.ok(methods.length >= 40);
  // D1499 (#3749) swapped grid, D1522 (#3774) stagePlan, D1553 (#3800) remix, D1503 (#3754) elementModels; D1565 (#3812)
  // the investor links. A swapped surface's body calls its client through().
  assert.deepEqual([...adapter.SWAPPED], ['grid', 'stagePlan', 'remix', 'elementModels', 'investorLinks', 'withdrawInvestorLink', 'setDeckSource'], 'the rows whose routes are on main');
  const seam = codeOnly(read(`${PITCH}/deckV2Adapter.js`));
  for (const name of ['investorLinks', 'withdrawInvestorLink']) {
    assert.match(seam, new RegExp(`export const ${name} = [^\\n]*through\\(\\(\\) => deckInvestorLinksApi\\.${name}\\(`), `${name} is wired to its client`);
    assert.equal(adapter.availability(name), null, `${name} is on`);
  }
  for (const name of methods.filter((n) => !adapter.SWAPPED.includes(n))) {
    const answer = await adapter[name]('synthetic-deck', { synthetic: true });
    assert.deepEqual(answer, { available: false, reason: NOT_ON, issue: adapter.SURFACES[name].issue }, name);
    assert.ok(Object.isFrozen(answer), `${name}: a surface must not be able to turn it into an answer`);
    assert.ok(answer.issue >= 3749 && answer.issue <= 3881, `${name}: #${answer.issue} is outside the deck v2 backlog`);
    assert.deepEqual(adapter.availability(name), answer, `${name}: the synchronous read agrees`);
  }
  assert.equal(adapter.availability('notASurface'), null);
  assert.equal(NOT_ON, 'Not switched on yet.', 'Team’s words (D1497)');
});

test('D1499 (#3749): grid is swapped — it answers through deckGridApi.grid, and its menu row is no longer Coming later', async () => {
  const real = deckGridApi.grid;
  const asked = [];
  try {
    deckGridApi.grid = async (id) => { asked.push(id); return { deck_id: 7, aspect: '4:3', structures: [], cards: [] }; };
    assert.deepEqual(await adapter.grid(7), { available: true, value: { deck_id: 7, aspect: '4:3', structures: [], cards: [] } });
    assert.deepEqual(asked, [7], 'the deck version it was asked for');
    deckGridApi.grid = async () => { throw Object.assign(new Error('nope'), { status: 404 }); };
    assert.deepEqual(await adapter.grid(7), { available: false, reason: NOT_ON, issue: 3749 }, 'a route that answers 404 is still off');
    deckGridApi.grid = async () => { throw Object.assign(new Error('The deck could not be read.'), { status: 500 }); };
    const bad = await adapter.grid(7);
    assert.equal(bad.unreadable, true, 'anything else is unreadable, never an empty grid');
  } finally { deckGridApi.grid = real; }
  assert.equal(adapter.availability('grid'), null, 'a swapped row greys nothing');
  assert.equal(adapter.SURFACES.grid.issue, 3749, 'the row stays, so the plan’s table reads whole');
});

test('D1503 (#3754): elementModels is swapped — it answers through deckElementModelsApi.read, and the AIRail greys nothing for it', async () => {
  const real = deckElementModelsApi.read;
  const asked = [];
  try {
    deckElementModelsApi.read = async (id) => { asked.push(id); return { deck_id: 7, elements: [], groups: [] }; };
    assert.deepEqual(await adapter.elementModels(7), { available: true, value: { deck_id: 7, elements: [], groups: [] } });
    assert.deepEqual(asked, [7]);
    deckElementModelsApi.read = async () => { throw Object.assign(new Error('nope'), { status: 404 }); };
    assert.deepEqual(await adapter.elementModels(7), { available: false, reason: NOT_ON, issue: 3754 });
    deckElementModelsApi.read = async () => { throw Object.assign(new Error('The picks could not be read.'), { status: 503 }); };
    assert.equal((await adapter.elementModels(7)).unreadable, true, 'anything else is unreadable, never an empty list');
  } finally { deckElementModelsApi.read = real; }
  assert.equal(adapter.availability('elementModels'), null);
});

test('D1522 (#3774): stagePlan is swapped — it answers through deckStageApi.stagePlan with the stage and investor type asked', async () => {
  const real = deckStageApi.stagePlan;
  const asked = [];
  try {
    deckStageApi.stagePlan = async (id, opts) => { asked.push([id, opts]); return { deck_id: 7, stage: 'seed', order: [], warnings: [] }; };
    assert.deepEqual(await adapter.stagePlan(7, { stage: 'seed' }), { available: true, value: { deck_id: 7, stage: 'seed', order: [], warnings: [] } });
    assert.deepEqual(asked, [[7, { stage: 'seed' }]]);
    deckStageApi.stagePlan = async () => { throw Object.assign(new Error('nope'), { status: 404 }); };
    assert.deepEqual(await adapter.stagePlan(7), { available: false, reason: NOT_ON, issue: 3774 }, 'a route that answers 404 is still off');
    deckStageApi.stagePlan = async () => { throw Object.assign(new Error('The deck could not be read.'), { status: 500 }); };
    assert.equal((await adapter.stagePlan(7)).unreadable, true, 'anything else is unreadable, never an empty plan');
  } finally { deckStageApi.stagePlan = real; }
  assert.equal(adapter.availability('stagePlan'), null, 'the Stage chips and the menu row are no longer Coming later');
});

test('D1553 (#3800): remix is swapped — it posts the card on screen (and a block to remove) through deckRemixApi.remix', async () => {
  const real = deckRemixApi.remix;
  const asked = [];
  try {
    deckRemixApi.remix = async (id, card, opts) => { asked.push([id, card, opts]); return { deck_id: 7, current: 'custom', card, options: [] }; };
    const card = { blocks: [{ id: 'b1' }] };
    assert.deepEqual(await adapter.remix(7, card, { remove: 'b1' }), { available: true, value: { deck_id: 7, current: 'custom', card, options: [] } });
    assert.deepEqual(asked, [[7, card, { remove: 'b1' }]]);
    deckRemixApi.remix = async () => { throw Object.assign(new Error('nope'), { status: 404 }); };
    assert.deepEqual(await adapter.remix(7, card), { available: false, reason: NOT_ON, issue: 3800 });
  } finally { deckRemixApi.remix = real; }
  assert.equal(adapter.availability('remix'), null, 'its menu row is no longer Coming later');
});

test('the adapter keys each surface to the plan’s issue (§6.2)', () => {
  const want = {
    grid: 3749, saveCard: 3751, discardDraft: 3751, batch: 3753, cancelBatch: 3753, elementModels: 3754,
    areasQuote: 3764, areasGenerate: 3764, history: 3767, narrativeOutline: 3768, instruct: 3773,
    stagePlan: 3774, figures: 3775, deckUsage: 3776, arrange: 3777, imageEdit: 3778, elementsLibrary: 3779,
    diagrams: 3780, ventureElements: 3781, templates: 3782, myTemplates: 3782, saveAsTemplate: 3782, typedTables: 3787,
    media: 3788, presets: 3796, orgLocks: 3786, critique: 3799, remix: 3800, consistency: 3802, deckActions: 3808,
    brandLocks: 3819, pptxImport: 3809, investorLinks: 3812, withdrawInvestorLink: 3812, comments: 3817, slideAnalytics: 3820,
    presence: 3824, cardStatus: 3826, rehearse: 3827, walkthrough: 3837, retryFailed: 3879, unseenBatches: 3879,
    markSeen: 3879, setDeckSource: 3881,
  };
  // #3882 merged as D1603: the .odp export left the seam for its real client (pitch_v2_states_d1604).
  // #3769 merged as D1517: the six themes arrive through GET /api/decks/model, so `themesV2` left the seam.
  assert.equal('themesV2' in adapter, false, 'the six themes need no adapter method');
  assert.equal('exportOdp' in adapter, false, 'a surface whose route is on main is not in the adapter');
  assert.deepEqual(Object.fromEntries(Object.entries(adapter.SURFACES).map(([k, v]) => [k, v.issue])), want);
  for (const [k, v] of Object.entries(adapter.SURFACES)) assert.ok(typeof v.what === 'string' && v.what.length > 8, k);
});

test('the seam reaches no network, and no client method exists for a route that is not on main', () => {
  const src = codeOnly(read(`${PITCH}/deckV2Adapter.js`));
  assert.doesNotMatch(src, /request\(|fetch\(|XMLHttpRequest/);
  // A swapped row's client is the only `lib/api` the seam may import (D1499's `deckGrid.js`, D1522's `deckStage.js`, D1553's `deckRemix.js`, D1503's `deckElementModels.js`, D1565's `deckInvestorLinks.js`).
  assert.deepEqual([...src.matchAll(/from '([^']*lib\/api[^']*)'/g)].map((x) => x[1]).sort(), ['../../../lib/api/dataRoom.js', '../../../lib/api/deckElementModels.js', '../../../lib/api/deckGrid.js', '../../../lib/api/deckInvestorLinks.js', '../../../lib/api/deckRemix.js', '../../../lib/api/deckStage.js']);
  assert.match(codeOnly(read('cloudflare-worker/src/index.ts')), /app\.route\(['"]\/api\/decks['"],\s*deckInvestorLinks\)/);
  assert.doesNotMatch(codeOnly(read(`${PITCH}/deckV2Model.js`)), /request\(|fetch\(|lib\/api|from 'react'/);
  const client = [read('frontend/src/lib/api.js'), ...readdirSync('frontend/src/lib/api').filter((f) => f.endsWith('.js')).map((f) => read(`frontend/src/lib/api/${f}`))].join('\n');
  // #3749 part 1 merged as #3925: Grid has a real read route and client (main's check, kept by the merge).
  assert.match(codeOnly(read('cloudflare-worker/src/routes/deck_grid.ts')), /deckGrid\.get\(['"]\/:id\{\[0-9\]\+\}\/grid['"]/);
  assert.match(codeOnly(read('cloudflare-worker/src/index.ts')), /app\.route\(['"]\/api\/decks['"],\s*deckGrid\)/);
  // D1522 (#3774): the stage plan has its route and client too.
  assert.match(codeOnly(read('cloudflare-worker/src/routes/deck_stage.ts')), /deckStage\.get\(['"]\/:id\{\[0-9\]\+\}\/stage-plan['"]/);
  assert.match(codeOnly(read('cloudflare-worker/src/index.ts')), /app\.route\(['"]\/api\/decks['"],\s*deckStage\)/);
  // D1553 (#3800): Remix has its route and client.
  assert.match(codeOnly(read('cloudflare-worker/src/routes/deck_remix.ts')), /deckRemix\.post\(['"]\/:id\{\[0-9\]\+\}\/remix['"]/);
  assert.match(codeOnly(read('cloudflare-worker/src/index.ts')), /app\.route\(['"]\/api\/decks['"],\s*deckRemix\)/);
  // D1503 (#3754): the element models route is on main, with its client.
  assert.match(codeOnly(read('cloudflare-worker/src/routes/deck_element_models.ts')), /deckElementModels\.get\(['"]\/:id\{\[0-9\]\+\}\/element-models['"]/);
  assert.match(codeOnly(read('cloudflare-worker/src/index.ts')), /app\.route\(['"]\/api\/decks['"],\s*deckElementModels\)/);
  for (const path of ['/areas', '/figures', '/draft', '/areas/instruct']) {
    assert.ok(!new RegExp(`['"\`]/decks/[^'"\`\\n]*${path.replace(/[$/{]/g, (c) => `\\${c}`)}`).test(client), `a client path for ${path} before its route is on main`);
  }
  assert.ok(!readdirSync('frontend/src/lib/api').some((f) => /^deck(Draft|Areas|Instruct|Figures)\.js$/.test(f)));
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
