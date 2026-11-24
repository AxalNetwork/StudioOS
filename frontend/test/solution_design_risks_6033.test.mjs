/**
 * D6033 (#6033, BD25, BD32–BD34) — Solution design's Risks list.
 *
 *   1. the words: severity and state as word and glyph, No owner / You / a name, Not tied to a
 *      feature, No mitigation recorded, the range line, filters from ten risks, and the bodies
 *      Add and Edit send (Edit never sends owner or feature, and refuses an edit that changes nothing);
 *   2. mounted: the rows from `GET /cycles/build/risks`, a feature-less Build Plan risk among them;
 *      Edit closes a risk through `PATCH /cycles/build/risks/:id` and re-reads;
 *   3. Add a risk sends `POST /cycles/build/risks` with owner and feature, refuses an empty title
 *      before sending, and shows the Worker's refusal as given;
 *   4. empty reads "No risks recorded" with Add a risk; a failed read is Unavailable with Try again
 *      and still offers Add; a reader gets no Add and no Edit; the phone draws cards;
 *   5. the Build def mounts the list on Solution design only, also before the first feature on a phone,
 *      and every client path is a mounted Worker route.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/solution_design_risks_6033.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { h, mountForm, propsOf, textOf } from './_form_d695.mjs';
import {
  addBody, editBody, featureText, filterChips, headCounts, listView, mitigationText, ownerText, rangeText, severityOf, showFilters, stateOf,
} from '../src/pages/cycles/solutionDesignRisksModel.js';
import SolutionDesignRisks from '../src/pages/cycles/SolutionDesignRisks.jsx';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const COUNTS = { all: 3, open: 2, mitigating: 1, closed: 0, tied: 1, untied: 2, high: 2, medium: 1, low: 0 };
const ROWS = [
  { id: 2, title: 'Synthetic tied risk', severity: 'high', state: 'mitigating', mitigation: 'Synthetic review step', owner: { you: true, name: 'Synthetic Owner' }, feature: { id: 7, title: 'Synthetic import' }, from_plan: false },
  { id: 3, title: 'Synthetic plan risk', severity: 'high', state: 'open', mitigation: null, owner: { you: false, name: 'Synthetic Member' }, feature: null, from_plan: true },
  { id: 1, title: 'Synthetic loose risk', severity: 'medium', state: 'open', mitigation: null, owner: null, feature: null, from_plan: false },
];
const page = (over = {}) => ({ rows: ROWS, total: 3, page: 1, per_page: 25, pages: 1, counts: COUNTS, can_write: true,
  choices: { owners: [{ value: '13', label: 'Synthetic Member' }], features: [{ value: '7', label: 'Synthetic import' }] }, ...over });

/** A fetch stub: each GET answers the next of `reads` (a body, a status, or an Error), and every request is kept. */
function stubFetch(reads, writes = []) {
  const seen = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    seen.push([method, String(url).replace(/^.*?\/api\//, '/api/'), init.body ? JSON.parse(init.body) : null]);
    const next = method === 'GET' ? reads.shift() : writes.shift() ?? { ok: true };
    if (next instanceof Error) throw next;
    if (typeof next === 'number') return new Response(JSON.stringify({ detail: 'Synthetic failure' }), { status: next, headers: { 'content-type': 'application/json' } });
    if (next?.status) return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify(next ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { seen, restore: () => { globalThis.fetch = orig; } };
}
const settle = async (m) => { for (let i = 0; i < 6; i++) await m.flush(); };
const press = (node) => { assert.ok(node, 'the control exists'); return act(async () => propsOf(node).onClick?.({ preventDefault() {}, stopPropagation() {} })); };
const submitForm = (node) => { assert.ok(node, 'the form exists'); return act(async () => propsOf(node).onSubmit({ preventDefault() {} })); };
const type = (node, value) => { assert.ok(node, 'the field exists'); return act(async () => propsOf(node).onChange({ target: { value } })); };

test('1. the list’s words, filters and the bodies Add and Edit send', () => {
  // Mutation checked: the glyph dropped from a severity → no ▲; "You" ignored → the owner's name; a blank mitigation
  // drawn as text; filters from one risk; the range's upper bound past the total; Edit sending owner_user_id;
  // an unchanged edit sent; Add sending a feature of "0".
  assert.deepEqual([severityOf('high'), stateOf('mitigating')].map((s) => `${s.glyph} ${s.word}`), ['▲ High', '◐ Mitigating']);
  assert.equal(severityOf('urgent').word, 'Not recorded', 'an unknown severity is not guessed');
  assert.deepEqual(ROWS.map(ownerText), ['You', 'Synthetic Member', 'No owner']);
  assert.deepEqual(ROWS.map(featureText), ['Synthetic import', 'Not tied to a feature', 'Not tied to a feature']);
  assert.deepEqual([mitigationText(ROWS[0]), mitigationText({ mitigation: '  ' })], ['Mitigation · Synthetic review step', 'No mitigation recorded']);
  assert.deepEqual(headCounts(COUNTS), { recorded: 3, bySeverity: [
    { key: 'high', word: 'High', glyph: '▲', tone: 'bad', count: 2 }, { key: 'medium', word: 'Medium', glyph: '◆', tone: 'warn', count: 1 },
    { key: 'low', word: 'Low', glyph: '▽', tone: 'grey', count: 0 }] });
  assert.equal(rangeText({ page: 1, per_page: 25, total: 7 }), '1–7 of 7 · 25 per page');
  assert.equal(rangeText({ page: 2, per_page: 25, total: 30 }), '26–30 of 30 · 25 per page');
  assert.equal(rangeText({ total: 0 }), '0 of 0 · 25 per page');
  assert.deepEqual([showFilters(COUNTS), showFilters({ all: 10 })], [false, true], 'filters appear from ten risks (BD32)');
  assert.deepEqual(filterChips(COUNTS).map((g) => g.options.map((o) => `${o.label} ${o.count}`)),
    [['All 3', 'Open 2', 'Mitigating 1', 'Closed 0'], ['All 3', 'Tied to a feature 1', 'Not tied to a feature 2']]);
  assert.deepEqual(listView('ready', { rows: [] }, {}), { kind: 'empty' });
  assert.deepEqual(listView('ready', { rows: [] }, { state: 'closed' }), { kind: 'no-match' }, 'a filter that matches none is not "No risks recorded"');
  assert.deepEqual(listView('unavailable', null), { kind: 'unavailable' });
  assert.deepEqual(addBody({ title: '  Synthetic risk ', severity: 'high', owner: '13', feature: '0', mitigation: '' }),
    { body: { title: 'Synthetic risk', severity: 'high', owner_user_id: 13, feature_id: null, mitigation: null } });
  assert.deepEqual(addBody({ title: ' ', severity: 'high' }), { error: 'Name the risk.' });
  assert.deepEqual(editBody({ title: 'Synthetic plan risk', severity: 'high', state: 'closed', mitigation: '' }, ROWS[1]),
    { body: { title: 'Synthetic plan risk', severity: 'high', state: 'closed', mitigation: null } });
  assert.deepEqual(editBody({ title: 'Synthetic plan risk', severity: 'high', state: 'open', mitigation: '' }, ROWS[1]), { error: 'Change something to save.' });
  assert.ok(!('owner_user_id' in editBody({ title: 'x', severity: 'low', state: 'open' }, ROWS[1]).body), 'Edit never sends the owner');
});

test('2. mounted: the rows, a feature-less Build Plan risk among them; Edit closes a risk and re-reads', async () => {
  // Mutation checked: the feature link drawn for a feature-less risk; "From the Build Plan" never drawn; the PATCH sent
  // to POST; the list not re-read after a save; onChanged not called → the counts card keeps its old severities.
  const f = stubFetch([page(), page({ rows: [ROWS[0], { ...ROWS[1], state: 'closed' }, ROWS[2]] })]);
  let changed = 0;
  const m = await mountForm(h(SolutionDesignRisks, { projectId: 1, search: '?project=1', phone: false, onChanged: () => { changed += 1; } }), { modal: true });
  try {
    await settle(m);
    assert.equal(f.seen[0][1], '/api/cycles/build/risks?project=1');
    const text = m.text();
    assert.match(text, /Risks\s*· 3 recorded/);
    assert.match(text, /Synthetic plan risk\s*From the Build Plan/);
    assert.match(text, /No owner/);
    assert.match(text, /Not tied to a feature/);
    assert.match(text, /○ No mitigation recorded/);
    assert.match(text, /Not recorded yet/, 'Addressed by test is stored nowhere');
    assert.match(text, /1–3 of 3 · 25 per page/);
    const link = m.nodes().find((n) => n.tagName === 'A' && /Synthetic import/.test(textOf(n)));
    assert.equal(propsOf(link).href, '/build/solution-design/7?project=1');
    assert.equal(m.by('risks-filters'), undefined, 'three risks draw no filters');
    await press(m.by('risk-edit-3'));
    assert.match(m.text(), /Edit risk[\s\S]*Owner\s*Synthetic Member\s*· read only[\s\S]*Feature\s*Not tied to a feature\s*· read only/);
    const closed = m.nodes().find((n) => n.tagName === 'INPUT' && propsOf(n).type === 'radio' && propsOf(n).value === 'closed');
    await act(async () => propsOf(closed).onChange());
    await submitForm(m.nodes().find((n) => n.tagName === 'FORM' && propsOf(n).id === 'risk-edit-form'));
    await settle(m);
    assert.deepEqual(f.seen[1], ['PATCH', '/api/cycles/build/risks/3?project=1', { title: 'Synthetic plan risk', severity: 'high', state: 'closed', mitigation: null }]);
    assert.equal(f.seen[2][0], 'GET', 'the list is read again');
    assert.equal(changed, 1, 'the module is re-read so the counts card follows');
    assert.equal(m.by('risk-edit-dialog'), undefined, 'the dialog closes on save');
  } finally { await m.unmount(); f.restore(); }
});

test('3. Add a risk sends owner and feature, refuses an empty title first, and shows the Worker’s refusal', async () => {
  // Mutation checked: the title check removed → an empty POST; the owner select ignored → owner_user_id null;
  // the refusal swallowed → no alert; the dialog closed on a refusal → the typed risk lost.
  const f = stubFetch([page(), page()], [{ status: 400, body: { detail: 'Owner is not a member of this company' } }, { id: 9 }]);
  const m = await mountForm(h(SolutionDesignRisks, { projectId: 1, phone: false }), { modal: true });
  try {
    await settle(m);
    await press(m.by('risks-add'));
    assert.match(m.text(), /Owner and feature can’t be changed after the risk is added yet\./);
    const form = () => m.nodes().find((n) => n.tagName === 'FORM' && propsOf(n).id === 'risk-add-form');
    await submitForm(form());
    await settle(m);
    assert.match(m.text(), /Name the risk\./);
    assert.equal(f.seen.filter(([method]) => method === 'POST').length, 0, 'nothing is sent without a title');
    const el = (id) => m.nodes().find((n) => propsOf(n).id === id);
    await type(el('risk-add-title'), 'Synthetic payment risk');
    await type(el('risk-add-owner'), '13');
    await type(el('risk-add-feature'), '7');
    await submitForm(form());
    await settle(m);
    assert.deepEqual(f.seen.find(([method]) => method === 'POST'),
      ['POST', '/api/cycles/build/risks?project=1', { title: 'Synthetic payment risk', severity: 'high', owner_user_id: 13, feature_id: 7, mitigation: null }]);
    assert.match(m.text(), /Owner is not a member of this company/, 'the Worker’s sentence, as given');
    assert.ok(m.by('risk-add-dialog'), 'a refusal keeps the dialog and what was typed');
    await submitForm(form());
    await settle(m);
    assert.equal(m.by('risk-add-dialog'), undefined);
  } finally { await m.unmount(); f.restore(); }
});

test('4. empty, unavailable, reader and phone', async () => {
  // Mutation checked: Add dropped from the empty state; Unavailable drawn as "No risks recorded"; Add hidden when the
  // read failed; Edit offered to a reader; the phone drawing the table.
  let f = stubFetch([page({ rows: [], total: 0, counts: { all: 0 } })]);
  let m = await mountForm(h(SolutionDesignRisks, { projectId: 1, phone: false }));
  try {
    await settle(m);
    assert.match(m.text(), /No risks recorded\s*Name what could stop the MVP, and who watches it\./);
    assert.ok(m.by('risks-add'));
  } finally { await m.unmount(); f.restore(); }

  f = stubFetch([500, page()]);
  m = await mountForm(h(SolutionDesignRisks, { projectId: 1, phone: false }));
  try {
    await settle(m);
    assert.match(m.text(), /Risks are unavailable/);
    assert.match(m.text(), /The counts above and the features still work\. Adding a risk still works\./);
    assert.doesNotMatch(m.text(), /No risks recorded/);
    assert.ok(m.by('risks-add'), 'Add still works when the list cannot be read');
    await m.click('Try again');
    await settle(m);
    assert.match(m.text(), /3 recorded/);
  } finally { await m.unmount(); f.restore(); }

  f = stubFetch([page({ can_write: false, choices: undefined })]);
  m = await mountForm(h(SolutionDesignRisks, { projectId: 1, phone: false }));
  try {
    await settle(m);
    assert.equal(m.by('risks-add'), undefined);
    assert.equal(m.by('risk-edit-2'), undefined, 'a reader edits nothing');
  } finally { await m.unmount(); f.restore(); }

  f = stubFetch([page()]);
  m = await mountForm(h(SolutionDesignRisks, { projectId: 1, phone: true }));
  try {
    await settle(m);
    assert.ok(m.by('risks-cards'));
    assert.equal(m.by('risks-table'), undefined);
    assert.match(m.text(), /Synthetic plan risk[\s\S]*Synthetic Member · Not tied to a feature/);
  } finally { await m.unmount(); f.restore(); }
});

test('5. the Build def mounts the list on Solution design only, and its paths are mounted Worker routes', () => {
  const def = read('frontend/src/pages/cycles/defs/build.jsx');
  assert.match(def, /'solution-design': \(_module, \{ projectId, reload, search \}\) => \(\s*<SolutionDesignRisks/);
  assert.match(def, /aboveRecordsWhenEmpty: \['solution-design'\]/, 'shown on a phone before the first feature');
  assert.match(read('frontend/src/pages/cycles/CycleRoute.jsx'), /def\.aboveRecordsWhenEmpty\?\.includes\(slug\)/);
  const worker = read('cloudflare-worker/src/routes/cycle_build.ts');
  assert.match(worker, /app\.get\('\/risks'/);
  assert.match(worker, /app\.patch\('\/risks\/:id'/);
  assert.match(read('frontend/src/lib/api/buildRisks.js'), /`\/cycles\/build\/risks\?\$\{p\.toString\(\)\}`/);
});
