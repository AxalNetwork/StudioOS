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
import { deckDraftApi } from '../src/lib/api/deckDraft.js';
import { deckGridApi } from '../src/lib/api/deckGrid.js';
import { deckStageApi } from '../src/lib/api/deckStage.js';
import { deckRemixApi } from '../src/lib/api/deckRemix.js';
import { deckTypedValuesApi } from '../src/lib/api/deckTypedValues.js';
import { deckCheckApi } from '../src/lib/api/deckCheck.js';
import { deckElementModelsApi } from '../src/lib/api/deckElementModels.js';
import { deckRehearsalsApi } from '../src/lib/api/deckRehearsals.js';
import { deckFiguresApi } from '../src/lib/api/deckFigures.js';
import { deckCommentsApi } from '../src/lib/api/deckComments.js';

import { deckBatchesApi, parseSse } from '../src/lib/api/deckBatches.js';
import { deckCoeditApi } from '../src/lib/api/deckCoedit.js';
import { deckVentureElementsApi } from '../src/lib/api/deckVentureElements.js';

test('every adapter method answers unavailable, with the reason and the issue that brings its route', async () => {
  const methods = Object.keys(adapter).filter((k) => !HELPERS.has(k));
  assert.deepEqual(methods.sort(), Object.keys(adapter.SURFACES).sort(), 'a method with no SURFACES row, or a row with no method');
  assert.ok(methods.length >= 40);
  // #4134: SWAPPED is derived, never listed. A row is swapped exactly when its method's body answers through
  // its client (`through(() => <client>Api.<method>(…), SURFACES.<row>.issue)`), and off exactly when the body is
  // `off('<row>')`. D1543's ventureElements chooses `.element` or `.list` inside that call. Mutation checked: turn a
  // swapped row back to `off(...)` (or wire an off row) and the two sets part.
  const body = (src, name) => (src.match(new RegExp(`^export const ${name} = ([^\\n]*)$`, 'm')) || [])[1] || '';
  const code = codeOnly(read(`${PITCH}/deckV2Adapter.js`));
  const wired = methods.filter((n) => /\bthrough\(\(\) => [^\n]*\b[a-z][A-Za-z]*Api\./.test(body(code, n)));
  const local = methods.filter((n) =>
    (n === 'history' && body(code, n) === 'async () => Object.freeze({ available: true, value: gridOps });')
    || (n === 'arrange' && /arrangeCard\(card, selection, op, opts\)/.test(body(code, n))));
  const offRows = methods.filter((n) => body(code, n) === `off('${n}');`);
  assert.deepEqual([...adapter.SWAPPED].sort(), [...wired, ...local].sort(), 'SWAPPED is exactly the remote and browser-local rows');
  assert.deepEqual([...wired, ...local, ...offRows].sort(), [...methods].sort(), 'every row is remote, browser-local history or Arrange, or off(\'<row>\')');
  assert.match(body(code, 'arrange'), /arrangeCard\(card, selection, op, opts\)/, 'arrange edits locally before the existing card save');
  for (const n of wired) assert.match(body(code, n), new RegExp(`SURFACES\\.${n}\\.issue\\);$`), `${n} keys its own row's issue`);
  // A floor, so a parser that stopped matching cannot pass on two empty lists. D1541 (#3779) elementsLibrary is one of them.
  for (const n of ['grid', 'saveCard', 'stagePlan', 'remix', 'comments', 'ventureElements', 'elementsLibrary']) assert.ok(adapter.SWAPPED.includes(n), `${n} is swapped on main`);
  const seam = codeOnly(read(`${PITCH}/deckV2Adapter.js`));
  // D1544 (#3784): imageVary prices an image edit through deckImageEditsApi.quote.
  assert.match(seam, /export const imageVary = [^\n]*through\(\(\) => deckImageEditsApi\.quote\(/);
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

test('D1538 (#3787): typedTables is swapped — it answers through deckTypedValuesApi.list, and a refusal is never an empty list', async () => {
  // Mutation checked: typedTables left as off('typedTables') → the available answer fails; the issue key changed → the 404 answer fails.
  const real = deckTypedValuesApi.list;
  const asked = [];
  try {
    const values = [{ key: 'customers', label: 'Customers', value: 42, unit: 'count', grade: 'Stated', typed_by: { id: 1, name: 'Avery Stone' }, typed_at: '2026-11-01 10:00:00' }];
    deckTypedValuesApi.list = async (id) => { asked.push(id); return { deck_id: 7, values }; };
    assert.deepEqual(await adapter.typedTables(7), { available: true, value: { deck_id: 7, values } });
    assert.deepEqual(asked, [7]);
    deckTypedValuesApi.list = async () => { throw Object.assign(new Error('nope'), { status: 404 }); };
    assert.deepEqual(await adapter.typedTables(7), { available: false, reason: NOT_ON, issue: 3787 });
    deckTypedValuesApi.list = async () => { throw Object.assign(new Error('The figures could not be read.'), { status: 500 }); };
    assert.equal((await adapter.typedTables(7)).unreadable, true, 'unreadable, never an empty list');
  } finally { deckTypedValuesApi.list = real; }
  assert.equal(adapter.availability('typedTables'), null);
  assert.match(codeOnly(read('cloudflare-worker/src/index.ts')), /app\.route\(['"]\/api\/decks['"],\s*deckTypedValues\)/, 'the route is mounted');
});

test('D1580 (#3827): rehearse is swapped — it answers through deckRehearsalsApi.list, and a refusal is never an empty list', async () => {
  // Mutation checked: rehearse left as off('rehearse') → the available answer fails; the issue key changed → the 404 answer fails.
  const real = deckRehearsalsApi.list;
  try {
    deckRehearsalsApi.list = async (id) => ({ deck_id: id, rehearsals: [] });
    assert.deepEqual(await adapter.rehearse(7), { available: true, value: { deck_id: 7, rehearsals: [] } });
    deckRehearsalsApi.list = async () => { throw Object.assign(new Error('Not found'), { status: 404 }); };
    assert.deepEqual(await adapter.rehearse(7), { available: false, reason: NOT_ON, issue: 3827 });
    deckRehearsalsApi.list = async () => { throw Object.assign(new Error('The rehearsals could not be read.'), { status: 500 }); };
    assert.equal((await adapter.rehearse(7)).unreadable, true, 'unreadable, never an empty list');
  } finally { deckRehearsalsApi.list = real; }
  assert.equal(adapter.availability('rehearse'), null);
});

test('D1523 (#3775): figures is swapped — it answers through deckFiguresApi.list, and a refusal is never a row of zeros', async () => {
  // Mutation checked: figures left as off('figures') → the available answer fails; the issue key changed → the 404 answer fails.
  const real = deckFiguresApi.list;
  const asked = [];
  try {
    const reply = { deck_id: 7, figures: [{ card: 0, block_id: 'm1', kind: 'metric', label: 'Customers', at: null, state: 'stated', value: '42', source: null }], counts: { linked: 0, stated: 1, uncited: 0, not_recorded: 0 } };
    deckFiguresApi.list = async (id) => { asked.push(id); return reply; };
    assert.deepEqual(await adapter.figures(7), { available: true, value: reply });
    assert.deepEqual(asked, [7]);
    deckFiguresApi.list = async () => { throw Object.assign(new Error('nope'), { status: 404 }); };
    assert.deepEqual(await adapter.figures(7), { available: false, reason: NOT_ON, issue: 3775 });
    deckFiguresApi.list = async () => { throw Object.assign(new Error('The figures could not be read.'), { status: 500 }); };
    const bad = await adapter.figures(7);
    assert.equal(bad.unreadable, true, 'anything else is unreadable');
    assert.equal(bad.reason, 'The figures could not be read.');
    assert.doesNotMatch(adapter.shown(bad, (v) => String(v.counts?.linked ?? 0)), /^0$/, 'never "0 figures"');
  } finally { deckFiguresApi.list = real; }
  assert.equal(adapter.availability('figures'), null);
  assert.match(codeOnly(read('cloudflare-worker/src/index.ts')), /app\.route\(['"]\/api\/decks['"],\s*deckFigures\)/, 'the route is mounted');
  // Only the editor's Check claims reads it: Present, the share viewer and the print page never do.
  for (const f of ['PitchPresent.jsx', 'PrintExtras.jsx', 'ShareViewerParts.jsx', 'ShareDialog.jsx', 'ExportDialog.jsx']) {
    assert.doesNotMatch(codeOnly(read(`${PITCH}/${f}`)), /\bfigures\s*(as\s+\w+\s*)?[,}]|deckFiguresApi|checkCounts|toReview/, `${f} reads no badge`);
  }
});

test('D1555 (#3802): consistency is swapped — the check read\'s `consistency`, null for a reader, unreadable on a failure', async () => {
  const real = deckCheckApi.read;
  try {
    const found = { state: 'ok', findings: [{ key: 'use_of_funds:raise', rule: 'use_of_funds', message: 'Use of funds $1.8M does not match the raise $2M.', cards: [1, 2] }] };
    deckCheckApi.read = async (id) => ({ deck_id: id, consistency: found });
    assert.deepEqual(await adapter.consistency(7), { available: true, value: found });
    deckCheckApi.read = async () => ({ deck_id: 7 });
    assert.deepEqual(await adapter.consistency(7), { available: true, value: null }, 'a reader who is not the founder');
    deckCheckApi.read = async () => { throw Object.assign(new Error('The check could not be read.'), { status: 500 }); };
    assert.equal((await adapter.consistency(7)).unreadable, true);
  } finally { deckCheckApi.read = real; }
  assert.equal(adapter.availability('consistency'), null);
});

test('the adapter keys each surface to the plan’s issue (§6.2)', () => {
  const want = {
    grid: 3749, saveCard: 3751, discardDraft: 3751, draft: 3751, batch: 3753, cancelBatch: 3753, elementModels: 3754,
    areasQuote: 3764, areasGenerate: 3764, history: 3767, narrativeOutline: 3768, instruct: 3773,
    stagePlan: 3774, figures: 3775, deckUsage: 3776, arrange: 3777, imageEdit: 3778, imageVary: 3784, elementsLibrary: 3779,
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
  // A swapped row's client is the only `lib/api` the seam may import (#4134: a rule, not a list). Each import names
  // one `<name>Api` from `lib/api/<name>.js` (a deck client, or #3881's `dataRoomApi`), the imports stand in file-name order (so two swaps add lines
  // at different places), and every one is used by a swapped row's body. Mutation checked: an unused client import,
  // or two imports out of order, fails here. D1541's `deckElements.js` is one of those lines.
  const imports = [...src.matchAll(/^import \{ ([a-z][A-Za-z]*Api) \} from '\.\.\/\.\.\/\.\.\/lib\/api\/([a-z][A-Za-z]*)\.js';$/gm)].map((x) => ({ name: x[1], file: x[2] }));
  assert.equal(imports.length, [...src.matchAll(/from '([^']*lib\/api[^']*)'/g)].length, 'every lib/api import is one `import { <name>Api } from .../lib/api/<name>.js` line');
  assert.ok(imports.length >= 10, 'the seam imports the clients of its swapped rows');
  const files = imports.map((i) => i.file);
  assert.deepEqual(files, [...files].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())), 'the lib/api imports stand in file-name order');
  const bodies = adapter.SWAPPED.map((n) => (src.match(new RegExp(`^export const ${n} = ([^\\n]*)$`, 'm')) || [])[1] || '').join('\n');
  for (const { name, file } of imports) {
    assert.equal(name, `${file}Api`, `${file}.js exports ${file}Api`);
    assert.ok(bodies.includes(`${name}.`), `${name} is imported but no swapped row calls it`);
  }
  // D1549 (#3796): the presets route is on main, with its client; orgLocks reads the same reply.
  assert.match(codeOnly(read('cloudflare-worker/src/routes/deck_model_presets.ts')), /deckModelPresets\.get\(['"]\/:id\{\[0-9\]\+\}\/model-presets['"]/);
  assert.match(codeOnly(read('cloudflare-worker/src/index.ts')), /app\.route\(['"]\/api\/decks['"],\s*deckModelPresets\)/);
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
  // D1580 (#3827): the rehearsals route is on main, with its client.
  assert.match(codeOnly(read('cloudflare-worker/src/routes/deck_rehearsals.ts')), /deckRehearsals\.get\(['"]\/:id\{\[0-9\]\+\}\/rehearsals['"]/);
  assert.match(codeOnly(read('cloudflare-worker/src/index.ts')), /app\.route\(['"]\/api\/decks['"],\s*deckRehearsals\)/);
  // D1523 (#3775): the figures route is on main, with its client.
  assert.match(codeOnly(read('cloudflare-worker/src/routes/deck_figures.ts')), /r\.get\(['"]\/:id\{\[0-9\]\+\}\/figures['"]/);
  // D1501 (#3751): the working copy has its routes (`/:id/draft`, `/:id/cards/:uid`) and its client.
  assert.match(codeOnly(read('cloudflare-worker/src/routes/deck_draft.ts')), /deckDraft\.get\(['"]\/:id\{\[0-9\]\+\}\/draft['"]/);
  assert.match(codeOnly(read('cloudflare-worker/src/index.ts')), /app\.route\(['"]\/api\/decks['"],\s*deckDraft\)/);
  // D1502 part 2 (#3753): a generation run's read, stream and Stop have their routes and client.
  assert.match(codeOnly(read('cloudflare-worker/src/routes/deck_batches.ts')), /deckBatches\.get\(`\/areas\/batches\/:uid\$\{UID\}`/);
  assert.match(codeOnly(read('cloudflare-worker/src/routes/deck_batches.ts')), /deckBatches\.post\(`\/areas\/batches\/:uid\$\{UID\}\/cancel`/);
  assert.match(codeOnly(read('cloudflare-worker/src/index.ts')), /app\.route\(['"]\/api\/decks['"],\s*deckBatches\)/);
  // D1512 (#3764): Generate into areas has its routes (quote, admit, proposals, accept, discard) and its client.
  assert.match(codeOnly(read('cloudflare-worker/src/routes/deck_areas.ts')), /deckAreas\.post\(['"]\/:id\{\[0-9\]\+\}\/areas\/quote['"]/);
  assert.match(codeOnly(read('cloudflare-worker/src/routes/deck_areas.ts')), /deckAreas\.post\(['"]\/:id\{\[0-9\]\+\}\/areas['"]/);
  assert.match(codeOnly(read('cloudflare-worker/src/index.ts')), /app\.route\(['"]\/api\/decks['"],\s*deckAreas\)/);
  for (const path of ['/areas/instruct']) {
    assert.ok(!new RegExp(`['"\`]/decks/[^'"\`\\n]*${path.replace(/[$/{]/g, (c) => `\\${c}`)}`).test(client), `a client path for ${path} before its route is on main`);
  }
  assert.ok(!readdirSync('frontend/src/lib/api').some((f) => /^deckInstruct\.js$/.test(f)));
});

test('an unavailable answer is never printed as a zero, "$0.00" or "none"', async () => {
  const money = (v) => `$${Number(v).toFixed(2)}`;
  // D1524 (#3776) swapped deckUsage, and D1573 (#3820) slideAnalytics; `walkthrough` is still on the seam.
  const off = await adapter.walkthrough('deck');
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
  for (const id of ['flow', 'funnel', 'icons']) assert.ok(!on.has(id), id);
  // D1543 (#3781): the six venture-record items are keyed to their route and on main. Only the logo wall is
  // free: the others carry a model job in DECK_ELEMENT_JOBS (model_use_cases_3934 holds that a free item has none).
  const venture = ['team_bios', 'logo_wall', 'use_of_funds', 'round_terms', 'interview_quote', 'cap_table'];
  for (const id of venture) {
    const e = ELEMENTS.find((x) => x.id === id);
    assert.deepEqual([e.adapter, e.issue, e.free, e.route, e.option], [undefined, undefined, id === 'logo_wall' ? true : undefined, 'GET /api/decks/:id/venture-elements/:element', null], id);
    assert.ok(on.has(id), id);
  }
  assert.ok(!ELEMENTS.some((e) => e.adapter === 'ventureElements'), 'no item waits on the swapped row');
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

test('D1501 (#3751): saveCard, discardDraft and draft are swapped — each answers through deckDraftApi, and a 404 is still off', async () => {
  const real = { ...deckDraftApi };
  const asked = [];
  try {
    deckDraftApi.saveCard = async (...a) => { asked.push(['saveCard', ...a]); return { ok: true, card: { uid: 'c1', rev: 2 } }; };
    deckDraftApi.discard = async (...a) => { asked.push(['discard', ...a]); return { ok: true, discarded: 3 }; };
    deckDraftApi.draft = async (...a) => { asked.push(['draft', ...a]); return { deck_id: 7, cards: [] }; };
    assert.deepEqual(await adapter.saveCard(7, 'c1', { title: 'T' }, 1, { ord: 2 }), { available: true, value: { ok: true, card: { uid: 'c1', rev: 2 } } });
    assert.deepEqual(await adapter.discardDraft(7), { available: true, value: { ok: true, discarded: 3 } });
    assert.deepEqual(await adapter.draft(7), { available: true, value: { deck_id: 7, cards: [] } });
    assert.deepEqual(asked, [['saveCard', 7, 'c1', { title: 'T' }, 1, { ord: 2 }], ['discard', 7], ['draft', 7]]);
    deckDraftApi.draft = async () => { throw Object.assign(new Error('nope'), { status: 404 }); };
    assert.deepEqual(await adapter.draft(7), { available: false, reason: NOT_ON, issue: 3751 }, 'unavailable on a 404, like the others');
  } finally { Object.assign(deckDraftApi, real); }
  for (const name of ['saveCard', 'discardDraft', 'draft']) assert.equal(adapter.availability(name), null, `${name} greys nothing`);
});

test('D1570 (#3817): comments is swapped — it answers through deckCommentsApi.list, and a 404 is still off', async () => {
  const real = deckCommentsApi.list;
  const asked = [];
  try {
    const reply = { deck_id: 7, version: 2, viewer: { user_id: 3, kind: 'founder', can_manage: true }, people: [], comments: [], open: 0 };
    deckCommentsApi.list = async (id) => { asked.push(id); return reply; };
    assert.deepEqual(await adapter.comments(7), { available: true, value: reply });
    assert.deepEqual(asked, [7]);
    deckCommentsApi.list = async () => { throw Object.assign(new Error('nope'), { status: 404 }); };
    assert.deepEqual(await adapter.comments(7), { available: false, reason: NOT_ON, issue: 3817 }, 'a reader the route does not admit sees it off');
    deckCommentsApi.list = async () => { throw Object.assign(new Error('The comments could not be read.'), { status: 500 }); };
    assert.equal((await adapter.comments(7)).unreadable, true, 'anything else is unreadable, never an empty thread');
  } finally { deckCommentsApi.list = real; }
  assert.equal(adapter.availability('comments'), null);
});


test('D1543 (#3781): ventureElements is swapped — one element through deckVentureElementsApi.element, all through .list, a gate refusal keeps its code and line', async () => {
  // Mutation checked: ventureElements left as off('ventureElements') → the available answer fails; through() dropping
  // the code → the gate assert fails; element and list swapped → the asked assert fails.
  const real = { ...deckVentureElementsApi };
  const asked = [];
  try {
    const one = { deck_id: 7, element: 'round_terms', available: true, blocks: [], bindings: [], model: null, label: 'Proposed, subject to counsel' };
    deckVentureElementsApi.element = async (...a) => { asked.push(['element', ...a]); return one; };
    deckVentureElementsApi.list = async (...a) => { asked.push(['list', ...a]); return { deck_id: 7, elements: {} }; };
    assert.deepEqual(await adapter.ventureElements(7, 'round_terms', { final: false }), { available: true, value: one });
    assert.deepEqual(await adapter.ventureElements(7, null, { includeCapTable: true }), { available: true, value: { deck_id: 7, elements: {} } });
    assert.deepEqual(asked, [['element', 7, 'round_terms', { final: false }], ['list', 7, { includeCapTable: true }]]);
    for (const [code, line] of [
      ['no_consent', 'Only quotes from sessions with recorded consent can be used.'],
      ['no_permission', "Harbor Synth hasn't given permission to show their logo."],
      ['not_included', 'Totals only · never shown in shared links unless you include it'],
      ['subject_to_counsel', 'Proposed, subject to counsel'],
    ]) {
      deckVentureElementsApi.element = async () => { throw Object.assign(new Error(line), { status: 409, code }); };
      const a = await adapter.ventureElements(7, 'logo_wall');
      assert.deepEqual([a.available, a.code, a.reason, a.issue], [false, code, line, 3781], code);
    }
    deckVentureElementsApi.element = async () => { throw Object.assign(new Error('nope'), { status: 404 }); };
    assert.deepEqual(await adapter.ventureElements(7, 'team_bios'), { available: false, reason: NOT_ON, issue: 3781 }, 'a 404 is still off');
  } finally { Object.assign(deckVentureElementsApi, real); }
  assert.equal(adapter.availability('ventureElements'), null);
  assert.match(codeOnly(read('cloudflare-worker/src/index.ts')), /app\.route\(['"]\/api\/decks['"],\s*deckVentureElements\)/, 'the route is mounted');
  assert.match(codeOnly(read('cloudflare-worker/src/routes/deck_venture_elements.ts')), /\.get\(['"]\/:id\{\[0-9\]\+\}\/venture-elements\/:element['"]/);
  assert.match(read('frontend/src/lib/apiModules.generated.js'), /^export \* from '\.\/api\/deckVentureElements\.js';$/m, 'one line in the generated D527 block (#4105)');
});

test('D1577 (#3824): presence is swapped — it answers through deckCoeditApi.presence; 503 presence_off and a 404 are still off', async () => {
  const real = deckCoeditApi.presence;
  try {
    const asked = [];
    const reply = { deck_id: 7, editors: [{ user_id: 2, name: 'Synthetic member', colour: '#2563eb', card: 'c1', area: 'b1', cursor: null }] };
    deckCoeditApi.presence = async (id) => { asked.push(id); return reply; };
    assert.deepEqual(await adapter.presence(7), { available: true, value: reply });
    assert.deepEqual(asked, [7]);
    deckCoeditApi.presence = async () => { throw Object.assign(new Error('Seeing who else is editing is not switched on yet.'), { status: 503, code: 'presence_off' }); };
    assert.deepEqual(await adapter.presence(7), { available: false, reason: 'Seeing who else is editing is not switched on yet.', issue: 3824 }, 'a Worker without the binding');
    deckCoeditApi.presence = async () => { throw Object.assign(new Error('nope'), { status: 404 }); };
    assert.deepEqual(await adapter.presence(7), { available: false, reason: NOT_ON, issue: 3824 });
  } finally { deckCoeditApi.presence = real; }
});

test('D1502 (#3753): batch and cancelBatch answer through deckBatchesApi; the stream parser keeps what has not ended', async () => {
  // Mutation checked: cancelBatch left off(…) → its answer is unavailable and this fails.
  const real = { batch: deckBatchesApi.batch, cancel: deckBatchesApi.cancel };
  const asked = [];
  deckBatchesApi.batch = async (uid) => { asked.push(['batch', uid]); return { uid, state: 'running' }; };
  deckBatchesApi.cancel = async (uid) => { asked.push(['cancel', uid]); return { uid, state: 'cancelled' }; };
  try {
    assert.deepEqual(await adapter.batch('run-1'), { available: true, value: { uid: 'run-1', state: 'running' } });
    assert.deepEqual(await adapter.cancelBatch('run-1'), { available: true, value: { uid: 'run-1', state: 'cancelled' } });
    assert.deepEqual(asked, [['batch', 'run-1'], ['cancel', 'run-1']]);
    assert.equal(adapter.availability('batch'), null);
    deckBatchesApi.cancel = async () => { throw Object.assign(new Error('Only the member who started this run can stop it.'), { status: 403 }); };
    assert.deepEqual(await adapter.cancelBatch('run-1'), { available: false, unreadable: true, reason: 'Only the member who started this run can stop it.', issue: 3753, status: 403, data: null });
  } finally { Object.assign(deckBatchesApi, real); }
  const { events, rest } = parseSse('event: snapshot\ndata: {"state":"running"}\n\nevent: step_done\ndata: {"seq":0}\n\nevent: area_busy\ndata: {"att');
  assert.deepEqual(events, [{ event: 'snapshot', data: { state: 'running' } }, { event: 'step_done', data: { seq: 0 } }]);
  assert.equal(rest, 'event: area_busy\ndata: {"att');
  assert.deepEqual(parseSse('event: x\ndata: not json\n\n').events, [], 'a malformed event is skipped');
});
