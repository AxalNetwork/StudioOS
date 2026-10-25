/**
 * D910 (#2694) — the Investor narrative's Story tab (NAR2), Insert a figure
 * (NAR3), the components (NAR21), dark (NAR20) and the phone frame (NAR19b).
 *
 * The model is pure; the page is mounted under CycleRoute, as the tool runs,
 * against the Worker's shapes: D908's `GET /api/cycles/raise/narrative/:version`
 * and D896's `GET /api/decks/sources`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/narrative_story_d910.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { BoundFigure, ClaimPill, GradeRamp, SectionDot, SourceKind, TypedClaim } from '../src/pages/raise/narrative/StoryComponents.jsx';
import {
  CLAIM_STATES, FOUNDERS_FIGURE, LIVE_DECK, MAX_BINDINGS, SAVE_FAILED, SECTIONS, STORY_UNREADABLE, BINDINGS_UNREADABLE,
  bindingFromItem, bindingsBySection, boundChip, cannotInsert, claimSegments, draftOf, figureStatus, insertGroups, moveSection,
  saveDialog, savePlan, sectionDot, storySections,
} from '../src/pages/raise/narrative/storyModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

/* ------------------------------------------------------------------ *
 * The Worker's shapes
 * ------------------------------------------------------------------ */

const H_MRR = 'a'.repeat(24);
const H_INT_NOW = 'b'.repeat(24);
const H_INT_OLD = 'c'.repeat(24);
const keys = SECTIONS.map((s) => s.key);
const items = (over = {}) => keys.map((key, i) => ({
  key, label: SECTIONS[i].label, store: SECTIONS[i].store, deck_key: null, position: i, audience_note: null, source: null, updated_at: null,
  body: { problem: 'Finance teams lose $18,400 a month to manual reconciliation.', solution: 'We close the books in a day.', traction: 'Revenue is growing.' }[key] ?? null,
  ...(over[key] || {}),
}));
const NARRATIVE = (v = 2, o = {}) => ({
  version: v,
  meta: { state: 'ok', live: v === 0, investor_type: 'seed_fund', deck_version: null, start_from: 'live', based_on_version: null, check_against: null },
  sections: o.sections ?? { state: 'ok', items: items(o.over) },
  positioning: { state: 'ok', core: [], overrides: [], effective: [] },
  bindings: o.bindings ?? { state: 'ok', items: [
    { section: 'traction', position: 0, source_key: 'grow.mrr', record_ref: 'project_metrics:9', as_of: '2026-09-30', grade: 'Measured', snapshot_hash: H_MRR },
    { section: 'problem', position: 0, source_key: 'validate.interviews', record_ref: 'customer_interviews:3', as_of: '2026-10-03', grade: 'Measured', snapshot_hash: H_INT_OLD },
    { section: 'team', position: 0, source_key: 'grow.churn', record_ref: null, as_of: '2026-08-01', grade: 'Stated', snapshot_hash: 'd'.repeat(24) },
  ] },
});
const SOURCES = { project_id: 3, coverage: {}, items: [
  { source_key: 'grow.mrr', area: 'grow', module: 'Grow › Revenue and traction', label: 'MRR', value: 16950, unit: 'usd', as_of: '2026-09-30', grade: 'Measured', source: 'Connector', href: '/grow/revenue', record_ref: 'project_metrics:9', snapshot_hash: H_MRR, state: 'recorded' },
  { source_key: 'validate.interviews', area: 'validate', module: 'Validate › Customer research', label: 'Customer interviews', value: 24, unit: 'count', as_of: '2026-10-20', grade: 'Measured', source: 'Recorded', href: '/validate/customer-research', record_ref: 'customer_interviews:3', snapshot_hash: H_INT_NOW, state: 'recorded' },
  { source_key: 'grow.churn', area: 'grow', module: 'Grow › Revenue and traction', label: 'Churn', value: null, unit: 'percent', as_of: null, grade: null, source: null, href: '/grow/revenue', record_ref: null, snapshot_hash: null, state: 'not_recorded' },
  { source_key: 'build.must_haves', area: 'build', module: 'Build › Prototype / MVP', label: 'Must-haves done', value: null, unit: 'count', as_of: null, grade: null, source: null, href: '/build/mvp', record_ref: null, snapshot_hash: null, state: 'unreadable' },
  { source_key: 'raise.mercury_balance', area: 'raise', module: 'Raise › Mercury', label: 'Cash balance', value: null, unit: 'usd', as_of: null, grade: null, source: null, href: null, record_ref: null, snapshot_hash: null, state: 'withheld' },
  { source_key: 'scoring.pmf_band', area: 'scoring', module: 'Scoring', label: 'Product-market fit band', value: null, unit: 'band', as_of: null, grade: null, source: null, href: null, record_ref: null, snapshot_hash: null, state: 'not_recorded', optional: true },
] };
const OPTIONS = { versions: [{ value: '2', label: 'v2 · seed fund' }, { value: '1', label: 'v1 · angel' }] };
const MODULE = { module: { slug: 'investor-narrative', name: 'Investor narrative', records_title: 'Versions' }, card: { state: 'empty', reason: 'No narrative saved yet.' }, records: { cols: [], rows: [], total: 0, page: 1, page_size: 25 } };

function handler(narrative = NARRATIVE(), sources = () => response(SOURCES), put = () => response({ ok: true })) {
  return (url, options = {}) => {
    if (options.method === 'PUT') return put(url, options);
    if (url.includes('/form-options')) return response(OPTIONS);
    if (/\/cycles\/raise\/narrative\/\d+\?/.test(url)) return typeof narrative === 'function' ? narrative(url) : response(narrative);
    if (url.includes('/decks/sources')) return sources(url);
    if (url.includes('/cycles/raise/modules/')) return response(MODULE);
    return response({});
  };
}

async function mounted(url, { phone = false, handle = handler() } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    h(Route, { path: '/raise/:slug', element: h(CycleRoute, { cycle: 'raise' }) }),
    h(Route, { path: '/raise/:slug/:id', element: h(CycleRoute, { cycle: 'raise', record: true }) }),
  ))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const fire = async (id, name, arg) => {
    const n = byId(id);
    assert.ok(n, `no ${id}`);
    await act(async () => { props(n)[name](arg); });
    await flush();
  };
  return {
    requests, flush, text: () => text(container), byId, props,
    textOf: (id) => text(byId(id)),
    testIds: () => nodes().map((n) => props(n)['data-testid']).filter(Boolean),
    click: (id) => fire(id, 'onClick', { preventDefault() {} }),
    type: (id, value) => fire(id, 'onChange', { target: { value } }),
    key: (id, key, altKey = false) => fire(id, 'onKeyDown', { key, altKey, preventDefault() {} }),
    puts: () => requests.filter((r) => r.method === 'PUT'),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const STORY = '/raise/investor-narrative/story?project_id=3&version=2';

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the sections are the Worker\'s, key for key, with their stores and limits', () => {
  const src = readFileSync('cloudflare-worker/src/services/narrative/store.ts', 'utf8');
  const worker = [...src.matchAll(/\{ key: '([a-z_]+)', label: '([^']+)', store: '([a-z]+)', deckKey: [^,]+, max: (\d+) \}/g)].map((m) => [m[1], m[2], m[3], Number(m[4])]);
  assert.equal(worker.length, 10, 'the Worker list was read');
  assert.deepEqual(SECTIONS.map((s) => [s.key, s.label, s.store, s.max]), worker);
});

test('a store that failed is null, never an empty story', () => {
  assert.equal(storySections(NARRATIVE(2, { sections: { state: 'unreadable' } })), null);
  assert.equal(bindingsBySection(NARRATIVE(2, { bindings: { state: 'unreadable' } })), null);
  const s = storySections(NARRATIVE());
  assert.deepEqual(s.map((x) => x.key), keys);
  assert.equal(s.find((x) => x.key === 'why_now').body, null, 'no words is null, never ""');
  assert.deepEqual(bindingsBySection(NARRATIVE()).get('traction').map((b) => b.source_key), ['grow.mrr']);
});

test('a typed number is a claim, "Founder\'s figure"; a name with a digit is not', () => {
  const claims = (t) => claimSegments(t).filter((x) => x.claim).map((x) => [x.text, x.state]);
  assert.deepEqual(claims('MRR of $18,400, up 6% a month from 42 customers, 14.2 months of runway.'),
    [['$18,400', FOUNDERS_FIGURE], ['6%', FOUNDERS_FIGURE], ['42', FOUNDERS_FIGURE], ['14.2', FOUNDERS_FIGURE]]);
  assert.deepEqual(claims('A B2B tool for Q3 teams'), []);
  assert.deepEqual(claims('Raising $1.5M'), [['$1.5M', FOUNDERS_FIGURE]]);
  assert.equal(claimSegments('No figures').map((x) => x.text).join(''), 'No figures');
});

test('a bound figure is fresh, stale, missing or unknown against the registry, and its chip says which', () => {
  const ok = { status: 'ok', items: SOURCES.items };
  const [mrr, interviews, churn] = NARRATIVE().bindings.items.map((b) => b).sort((a, b) => a.section.localeCompare(b.section)).reverse();
  assert.equal(figureStatus(NARRATIVE().bindings.items[0], ok), 'fresh');
  assert.equal(figureStatus(NARRATIVE().bindings.items[1], ok), 'stale', 'the interviews record changed since it was bound');
  assert.equal(figureStatus(NARRATIVE().bindings.items[2], ok), 'missing', 'churn is no longer recorded');
  assert.equal(figureStatus(NARRATIVE().bindings.items[0], { status: 'error' }), 'unknown');
  assert.equal(figureStatus({ source_key: 'build.must_haves', snapshot_hash: H_MRR }, ok), 'unknown', 'an unreadable item');
  void mrr; void interviews; void churn;
  const fresh = boundChip(NARRATIVE().bindings.items[0], ok);
  assert.deepEqual([fresh.state, fresh.label, fresh.value, fresh.chip.source, fresh.chip.record, fresh.chip.grade], ['normal', 'MRR', '$16,950', 'Connector', 'From Stripe', 'Measured']);
  const stale = boundChip(NARRATIVE().bindings.items[1], ok);
  assert.equal(stale.state, 'stale');
  assert.match(stale.note, /^Changed since /);
  const gone = boundChip(NARRATIVE().bindings.items[2], ok);
  assert.deepEqual([gone.state, gone.value, gone.note, gone.fill.text], ['missing', null, 'Not recorded on StudioOS', 'Add it in Grow › Revenue and traction ›']);
  assert.equal(boundChip(NARRATIVE().bindings.items[0], { status: 'error' }).value, null, 'no value without its record');
});

test('Insert a figure: what can be inserted, what cannot and why, and the binding it writes', () => {
  const mrr = SOURCES.items[0];
  assert.deepEqual(bindingFromItem(mrr), { source_key: 'grow.mrr', record_ref: 'project_metrics:9', as_of: '2026-09-30', grade: 'Measured', snapshot_hash: H_MRR });
  assert.equal(bindingFromItem(SOURCES.items[2]), null, 'nothing recorded, nothing to bind');
  assert.equal(cannotInsert(mrr, []), null);
  assert.equal(cannotInsert(mrr, [bindingFromItem(mrr)]), 'Already in this section');
  assert.equal(cannotInsert(SOURCES.items[1], Array.from({ length: MAX_BINDINGS }, (_, i) => ({ source_key: `x.y${i}` }))), `A section holds at most ${MAX_BINDINGS} figures`);
  assert.equal(cannotInsert(SOURCES.items[2], []), 'Not recorded on StudioOS');
  const groups = insertGroups(SOURCES.items);
  assert.deepEqual(groups.map((g) => [g.label, g.items.map((i) => i.source_key)]), [
    ['Validate', ['validate.interviews']], ['Build', ['build.must_haves']], ['Grow', ['grow.mrr', 'grow.churn']],
  ], 'withheld and Scoring are not story figures; a missing slot is listed');
  assert.deepEqual(insertGroups(SOURCES.items, 'churn').map((g) => g.items.map((i) => i.label)), [['Churn']]);
});

test('the dots, the order and the save plan', () => {
  const ok = { status: 'ok', items: SOURCES.items };
  const by = bindingsBySection(NARRATIVE());
  assert.equal(sectionDot({ body: null }, [], ok), 'Empty');
  assert.equal(sectionDot({ body: 'Words.' }, [], ok), 'Written');
  assert.equal(sectionDot({ body: 'Words.' }, by.get('problem'), ok), 'Stale');
  assert.equal(sectionDot({ body: null }, by.get('team'), ok), 'Stale', 'a missing figure needs the founder too');
  assert.deepEqual(moveSection(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
  assert.deepEqual(moveSection(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c'], 'the ends stay put');
  const sections = storySections(NARRATIVE());
  const saved = { sections, bindings: by };
  const draft = draftOf(sections, by);
  assert.deepEqual(savePlan(saved, draft), [], 'nothing changed, nothing sent');
  draft.byKey.problem.body = 'Finance teams lose days.';
  draft.byKey.team.note = 'Lead with the founders.';
  draft.byKey.solution.bindings = [bindingFromItem(SOURCES.items[0])];
  draft.order = moveSection(draft.order, 'problem', 1);
  const plan = savePlan(saved, draft);
  assert.deepEqual(plan.map((w) => [w.section, w.body]), [
    ['solution', { position: 0, bindings: [bindingFromItem(SOURCES.items[0])] }],
    ['problem', { body: 'Finance teams lose days.', position: 1 }],
    ['team', { audience_note: 'Lead with the founders.' }],
  ]);
  const d = saveDialog(plan, 2);
  assert.equal(d.title, 'Save version 2?');
  assert.deepEqual(d.lines, ['Solution: new place, 1 bound figure.', 'Problem: new words, new place.', 'Team: audience note.']);
  assert.match(d.deck, /^Problem is the deck’s words for v2: saving it changes this version’s deck wording and runs its check again\.$/);
  draft.byKey.why_now.body = '   ';
  assert.ok(!savePlan(saved, draft).some((w) => w.section === 'why_now'), 'blank is still not recorded');
  const cleared = draftOf(sections, by); cleared.byKey.solution.body = '';
  assert.deepEqual(savePlan(saved, cleared)[0].body, { body: null }, 'clearing sends null, never ""');
  const blind = draftOf(sections, null);
  blind.byKey.problem.bindings = [bindingFromItem(SOURCES.items[0])];
  assert.deepEqual(savePlan({ sections, bindings: null }, blind), [], 'with the bindings unreadable, none is sent: a write would replace the set');
});

/* ------------------------------------------------------------------ *
 * The components (NAR21)
 * ------------------------------------------------------------------ */

test('NAR21: every component in every state, each with dark classes', () => {
  const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
  for (const s of Object.keys(CLAIM_STATES)) assert.ok(html(h(ClaimPill, { state: s })).includes(s.replace(/'/g, '&#x27;')), s);
  assert.equal(Object.keys(CLAIM_STATES).length, 5, 'five claim states');
  for (const s of ['Empty', 'Written', 'Stale', 'Mismatch']) assert.match(html(h(SectionDot, { state: s })), new RegExp(`aria-label="${s}"`));
  for (const s of ['Connector', 'Document', 'Recorded', 'Signed', 'Typed']) assert.match(html(h(SourceKind, { source: s })), new RegExp(s));
  assert.match(html(h(GradeRamp)), /Measured.*Reviewed.*Sourced.*Stated.*Not recorded/);
  const ok = { status: 'ok', items: SOURCES.items };
  const all = NARRATIVE().bindings.items.map((b) => html(h(BoundFigure, { figure: boundChip(b, ok) })));
  assert.match(all[0], /bound-figure-normal/); assert.match(all[0], /\$16,950/); assert.match(all[0], /From Stripe/);
  assert.match(all[1], /bound-figure-stale/); assert.match(all[1], /Changed since/);
  assert.match(all[2], /bound-figure-missing/); assert.match(all[2], /Not recorded on StudioOS/); assert.match(all[2], /Add it in/);
  assert.match(html(h(TypedClaim, { text: '$18,400', state: FOUNDERS_FIGURE })), /\$18,400.*Founder&#x27;s figure/);
  const src = readFileSync('frontend/src/pages/raise/narrative/StoryComponents.jsx', 'utf8');
  for (const tone of ['emerald', 'red', 'amber', 'violet']) assert.match(src, new RegExp(`dark:[a-z-]*${tone}`), `${tone} has a dark pair (NAR20)`);
});

/* ------------------------------------------------------------------ *
 * The page (NAR2, NAR3)
 * ------------------------------------------------------------------ */

test('Story reads the narrative\'s stores and the registry, never the record, and draws the rail with its dots', async () => {
  const view = await mounted(STORY);
  try {
    const urls = view.requests.map((r) => r.url);
    assert.ok(urls.some((u) => u.includes('/cycles/raise/narrative/2?project=3')), 'D908\'s read');
    assert.ok(urls.some((u) => u.includes('/decks/sources?project_id=3')), 'PITCH\'s registry');
    assert.ok(!urls.some((u) => u.includes('/records/2?')), 'Story no longer reads the record');
    assert.match(view.textOf('story-rail-problem'), /Problem.*Stale/);
    assert.match(view.textOf('story-rail-solution'), /Solution.*Written/);
    assert.match(view.textOf('story-rail-why_now'), /Why now.*Empty/);
    assert.match(view.textOf('story-rail-team'), /Team.*Stale/, 'a missing figure');
    assert.match(view.textOf('story-writer'), /STORY · SECTION 1 OF 10/);
    assert.match(view.textOf('story-writer'), /Audience note · seed fund/);
  } finally { await view.close(); }
});

test('every figure on Story is bound or a claim, never a bare number', async () => {
  const view = await mounted(STORY);
  try {
    assert.match(view.textOf('story-reads-as'), /\$18,400.*Founder's figure/);
    assert.ok(view.testIds().includes('typed-claim'));
    assert.ok(view.testIds().includes('bound-figure-stale'), 'Problem\'s interviews figure moved');
    await view.click('story-rail-traction');
    assert.match(view.textOf('story-figures'), /MRR\$16,950.*Connector.*From Stripe.*Measured/);
    await view.click('story-rail-team');
    assert.match(view.textOf('story-figures'), /Churn.*Not recorded on StudioOS.*Add it in Grow › Revenue and traction/);
    const t = view.text();
    assert.doesNotMatch(t, /\[|Northwind/, 'no canvas sample');
  } finally { await view.close(); }
});

test('Save version opens a dialog that says what it changes, then writes one PUT per changed section', async () => {
  const view = await mounted(STORY);
  try {
    assert.equal(view.props(view.byId('story-save-open')).disabled, true, 'nothing to save yet');
    await view.type('story-words', 'Finance teams lose days every month-end.');
    await view.type('story-note', 'Lead with retention.');
    await view.click('story-save-open');
    assert.match(view.textOf('story-save'), /Save version 2\?.*Problem: new words, audience note\./);
    assert.match(view.textOf('story-save-deck'), /Problem is the deck’s words for v2/);
    assert.equal(view.puts().length, 0, 'the dialog writes nothing');
    await view.click('story-save-confirm');
    assert.deepEqual(view.puts().map((p) => [p.url.replace(/^.*\/api/, ''), p.body]), [
      ['/cycles/raise/narrative/2/sections/problem?project=3', { body: 'Finance teams lose days every month-end.', audience_note: 'Lead with retention.' }],
    ]);
    assert.ok(!view.testIds().includes('story-save'), 'the dialog closes');
    assert.ok(view.requests.filter((r) => r.method === 'GET' && r.url.includes('/narrative/2?')).length >= 2, 'the story is read again');
  } finally { await view.close(); }
});

test('Insert a figure lists the registry by area, says where a missing one goes, and binds the chosen one', async () => {
  const view = await mounted(STORY);
  try {
    await view.click('story-insert-open');
    const box = view.textOf('story-insert');
    assert.match(box, /Validate.*Customer interviews.*Build.*Must-haves done.*Could not be read.*Grow.*MRR.*Churn.*Not recorded on StudioOS/);
    assert.doesNotMatch(box, /Cash balance|Product-market fit/, 'withheld and Scoring stay out');
    assert.ok(view.testIds().includes('story-insert-missing-grow.churn'));
    await view.click('story-insert-grow.mrr');
    assert.ok(!view.testIds().includes('story-insert'), 'the popover closes');
    assert.match(view.textOf('story-figures'), /MRR\$16,950/);
    await view.click('story-save-open');
    await view.click('story-save-confirm');
    const put = view.puts()[0];
    assert.match(put.url, /\/sections\/problem\?project=3$/);
    assert.deepEqual(put.body.bindings.map((b) => b.source_key), ['validate.interviews', 'grow.mrr']);
    assert.deepEqual(put.body.bindings[1], { source_key: 'grow.mrr', record_ref: 'project_metrics:9', as_of: '2026-09-30', grade: 'Measured', snapshot_hash: H_MRR });
  } finally { await view.close(); }
});

test('Alt + arrow moves a section; plain arrows choose one; the new places are saved', async () => {
  const view = await mounted(STORY);
  try {
    await view.key('story-rail-problem', 'ArrowDown');
    assert.match(view.textOf('story-writer'), /Solution/, 'a plain arrow chooses the next section');
    await view.key('story-rail-solution', 'ArrowUp', true);
    // The test DOM does not detach a moved node, so the order is read from what Save sends.
    await view.click('story-save-open');
    await view.click('story-save-confirm');
    assert.deepEqual(view.puts().map((p) => [p.url.match(/sections\/([a-z_]+)/)[1], p.body]), [['solution', { position: 0 }], ['problem', { position: 1 }]]);
  } finally { await view.close(); }
});

test('a failed save keeps the text and says so; nothing after it is sent', async () => {
  const view = await mounted(STORY, { handle: handler(NARRATIVE(), undefined, () => response({ detail: 'The save was refused' }, 500)) });
  try {
    await view.type('story-words', 'New words.');
    await view.click('story-rail-solution');
    await view.type('story-words', 'Other words.');
    await view.click('story-save-open');
    await view.click('story-save-confirm');
    assert.equal(view.puts().length, 1, 'the second section is not sent after the first failed');
    assert.ok(view.textOf('story-save-failed').startsWith(SAVE_FAILED));
    assert.equal(view.props(view.byId('story-words')).value, 'Other words.', 'the text is kept');
  } finally { await view.close(); }
});

test('an unreadable store says so: the sections, the figures, or the registry', async () => {
  const sections = await mounted(STORY, { handle: handler(NARRATIVE(2, { sections: { state: 'unreadable' } })) });
  try { assert.equal(sections.textOf('story-unreadable'), STORY_UNREADABLE); } finally { await sections.close(); }
  const bound = await mounted(STORY, { handle: handler(NARRATIVE(2, { bindings: { state: 'unreadable' } })) });
  try {
    assert.match(bound.textOf('story-figures'), new RegExp(BINDINGS_UNREADABLE.slice(0, 30)));
    assert.equal(bound.props(bound.byId('story-insert-open')).disabled, true);
  } finally { await bound.close(); }
  const registry = await mounted(STORY, { handle: handler(NARRATIVE(), () => response({ detail: 'boom' }, 500)) });
  try {
    await registry.click('story-rail-traction');
    assert.match(registry.textOf('story-figures'), /A bound figure.*The sources could not be read/);
    assert.doesNotMatch(registry.textOf('story-figures'), /grow\.mrr/, 'a key is never shown as a name');
    assert.doesNotMatch(registry.textOf('story-figures'), /16,950/, 'no value without its record');
  } finally { await registry.close(); }
});

test('version 0, the live deck, is read only', async () => {
  const view = await mounted('/raise/investor-narrative/story?project_id=3&version=0', {
    handle: (u, o) => (u.includes('/form-options') ? response({ versions: [{ value: '0', label: 'v0 · live deck' }] }) : handler(NARRATIVE(0))(u, o)),
  });
  try {
    assert.equal(view.textOf('story-live-deck'), LIVE_DECK);
    assert.ok(!view.testIds().includes('story-words'), 'no editor');
    assert.ok(!view.testIds().includes('story-save-open'), 'no Save');
    assert.match(view.textOf('story-rail'), /Read only/);
  } finally { await view.close(); }
});

test('NAR19b: on a phone the rail is a section select, and the writer is full width', async () => {
  const view = await mounted(STORY, { phone: true });
  try {
    assert.ok(view.testIds().includes('story-section-select'));
    assert.ok(!view.testIds().includes('story-rail'));
    await view.type('story-section-select', 'traction');
    assert.match(view.textOf('story-writer'), /Traction/);
  } finally { await view.close(); }
});
