/**
 * D1114 (#2994) — the Investor narrative's gaps: Story's "Ask Eadwyn ▾"
 * (NAR2) with AI assistance off (NAR17b) and a run the tokens cannot cover
 * (NAR17c); bound figures inside the sentence (NAR2, NAR20); Home's From
 * Mercury "Insert in Story" (NAR1); and NAR4's "accepted by [Name]".
 *
 * The model is pure; Story is mounted under CycleRoute, as the tool runs,
 * against the Worker's shapes (D908's read, D896's sources, D1114's draft).
 * Every figure here is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/narrative_gaps_d1114.test.mjs
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
import MercuryRaiseFeed from '../src/pages/cycles/MercuryRaiseFeed.jsx';
import { __resetAssistModeForTest } from '../src/hooks/useAssistMode.js';
import { ADD_TOKENS_PATH } from '../src/lib/aiTokens.js';
import { SECTIONS, boundChip, draftOf, inlineSegments, insertAt, runRefusal, savePlan, unplacedFigures } from '../src/pages/raise/narrative/storyModel.js';
import { MERCURY_STORY_KEY, insertInStoryHref, provenance } from '../src/pages/raise/narrative/narrativeModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const H_MRR = 'a'.repeat(24);
const keys = SECTIONS.map((s) => s.key);
const WORDS = { problem: 'Finance teams close the month by hand.', traction: 'MRR reached $16,950 this quarter, from 42 pilots.' };
const items = () => keys.map((key, i) => ({ key, label: SECTIONS[i].label, store: SECTIONS[i].store, deck_key: null, position: i, audience_note: null, source: null, updated_at: null, body: WORDS[key] ?? null }));
const NARRATIVE = () => ({
  version: 2,
  meta: { state: 'ok', live: false, investor_type: 'seed_fund', deck_version: null, start_from: 'blank', based_on_version: null, check_against: null },
  sections: { state: 'ok', items: items() },
  positioning: { state: 'ok', core: [], overrides: [], effective: [] },
  bindings: { state: 'ok', items: [{ section: 'traction', position: 0, source_key: 'grow.mrr', record_ref: 'project_metrics:9', as_of: '2026-09-30', grade: 'Measured', snapshot_hash: H_MRR }] },
});
const MRR = { source_key: 'grow.mrr', area: 'grow', module: 'Grow › Revenue and traction', label: 'MRR', value: 16950, unit: 'usd', as_of: '2026-09-30', grade: 'Measured', source: 'Connector', href: '/grow/revenue', record_ref: 'project_metrics:9', snapshot_hash: H_MRR, state: 'recorded' };
const MERC = { source_key: 'grow.mercury_revenue', area: 'grow', module: 'Grow › Revenue and traction', label: 'Revenue last month', value: 1721000, unit: 'cents', as_of: '2026-10-01', grade: 'Measured', source: 'Connector', href: '/grow/revenue', record_ref: 'mercury_raise_facts:4', snapshot_hash: 'e'.repeat(24), state: 'recorded' };
const SOURCES = { project_id: 3, coverage: {}, items: [MRR, MERC] };
const OPTIONS = { versions: [{ value: '2', label: 'v2 · seed fund' }] };
const MODULE = { module: { slug: 'investor-narrative', name: 'Investor narrative', records_title: 'Versions' }, card: { state: 'empty', reason: 'No narrative saved yet.' }, records: { cols: [], rows: [], total: 0, page: 1, page_size: 25 } };
const DRAFT = { version: 2, section: 'traction', mode: 'shorten', text: 'Pilots turn into paying customers.', removed: 1 };

function handler({ draft = () => response(DRAFT) } = {}) {
  return (url, options = {}) => {
    if (options.method === 'PUT') return response({ ok: true });
    if (options.method === 'POST' && url.includes('/draft')) return draft(url, options);
    if (url.includes('/form-options')) return response(OPTIONS);
    if (/\/cycles\/raise\/narrative\/\d+\?/.test(url)) return response(NARRATIVE());
    if (url.includes('/decks/sources')) return response(SOURCES);
    if (url.includes('/cycles/raise/modules/')) return response(MODULE);
    return response({});
  };
}

async function mounted(url, { handle = handler(), aiOff = false } = {}) {
  const restore = installDocument();
  __resetAssistModeForTest();
  try { if (aiOff) globalThis.localStorage.setItem('assist_mode:raise', 'false'); else globalThis.localStorage.removeItem('assist_mode:raise'); } catch { /* no storage */ }
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => {
    requests.push({ url: String(u), method: options.method || 'GET', headers: options.headers || {}, body: options.body ? JSON.parse(options.body) : null });
    return handle(String(u), options);
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    h(Route, { path: '/raise/:slug/:id', element: h(CycleRoute, { cycle: 'raise', record: true }) }),
  ))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const fire = async (id, name, arg) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n)[name](arg); }); await flush(); };
  return {
    requests, byId, props: (id) => props(byId(id)),
    has: (id) => Boolean(byId(id)),
    textOf: (id) => text(byId(id)),
    all: (id) => nodes().filter((n) => props(n)['data-testid'] === id),
    click: (id) => fire(id, 'onClick', { preventDefault() {} }),
    type: (id, value, caret) => fire(id, 'onChange', { target: { value, selectionStart: caret ?? String(value).length } }),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const STORY = '/raise/investor-narrative/story?project_id=3&version=2';
const header = (r, name) => r.headers?.[name] ?? r.headers?.get?.(name) ?? null;

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('a bound figure sits inside the sentence where its value is; any other typed number stays a claim', () => {
  const sources = { status: 'ok', items: SOURCES.items };
  const fig = { binding: NARRATIVE().bindings.items[0], view: boundChip(NARRATIVE().bindings.items[0], sources) };
  const segs = inlineSegments(WORDS.traction, [fig]);
  assert.deepEqual(segs.map((s) => (s.figure ? `[${s.figure.binding.source_key}]` : s.claim ? `{${s.text}}` : s.text)).join(''),
    'MRR reached [grow.mrr] this quarter, from {42} pilots.');
  assert.deepEqual(unplacedFigures(WORDS.traction, [fig]), [], 'placed, so not listed under the words');
  assert.deepEqual(unplacedFigures('Revenue is growing.', [fig]), [fig], 'not in the words yet, so listed');
  assert.equal(inlineSegments('$16,950 and $16,950', [fig]).filter((s) => s.figure).length, 1, 'one figure binds one place');
  const later = inlineSegments('From 42 pilots, MRR reached $16,950.', [fig]);
  assert.deepEqual(later.filter((x) => x.figure).map((x) => x.text), ['$16,950'], 'a figure binds its own value, not the first number');
  assert.ok(later.some((x) => x.claim && x.text === '42'), 'the other number stays a claim');
});

test('Insert puts the value where the cursor is, with the spaces the sentence needs', () => {
  assert.deepEqual(insertAt('Revenue reached this quarter.', 15, '$16,950'), { text: 'Revenue reached $16,950 this quarter.', caret: 23 });
  assert.equal(insertAt('Revenue was', null, '$16,950').text, 'Revenue was $16,950', 'no cursor: the end');
  assert.equal(insertAt('', 0, '$16,950').text, '$16,950');
  assert.equal(insertAt('Up to.', 5, '6%').text, 'Up to 6%.', 'no space before punctuation');
});

test('a refused run says what happened: out of tokens with nothing charged, the switch off, or the Worker\'s sentence', () => {
  const t = runRefusal({ status: 402, code: 'budget_user_month', data: { message: 'Not enough AI tokens. Add AI tokens or wait for next month’s allowance.' } });
  assert.deepEqual([t.kind, t.text], ['tokens', 'Not enough AI tokens. Add AI tokens or wait for next month’s allowance.']);
  assert.match(t.sub, /allowance first, then your AI tokens\. Nothing was charged\./);
  assert.equal(runRefusal({ status: 403, code: 'assist_off' }).kind, 'off');
  assert.equal(runRefusal({ status: 422, data: { detail: 'There are no words in Traction to shorten yet.' } }).text, 'There are no words in Traction to shorten yet.');
  assert.doesNotMatch(runRefusal({ status: 500, message: 'ai_unavailable' }).text, /ai_unavailable/, 'never a code');
});

test('accepted words are saved as Eadwyn\'s until the founder types over them', () => {
  const sections = items().map((s) => ({ ...s, note: '' }));
  const draft = draftOf(sections, new Map());
  draft.byKey.solution = { ...draft.byKey.solution, body: 'A close tool.', source: 'eadwyn' };
  assert.deepEqual(savePlan({ sections, bindings: new Map() }, draft)[0].body, { body: 'A close tool.', source: { kind: 'eadwyn' } });
  draft.byKey.solution.source = null;
  assert.deepEqual(savePlan({ sections, bindings: new Map() }, draft)[0].body, { body: 'A close tool.' }, 'typed over: no source');
});

test('Insert in Story opens on the same record Story binds; NAR4 names who accepted', () => {
  const worker = read('cloudflare-worker/src/services/decks/sources.ts');
  for (const [fact, key] of Object.entries(MERCURY_STORY_KEY)) assert.match(worker, new RegExp(`key: '${key.replace('.', '\\.')}'[^}]*fact: '${fact}'`), `${fact} is ${key} in the registry`);
  assert.equal(insertInStoryHref('revenue_last_month', '?project_id=3&version=2&tab=x'), '/raise/investor-narrative/story?project_id=3&version=2&insert=grow.mercury_revenue');
  assert.equal(insertInStoryHref('months', '?project_id=3'), null, 'a figure Story cannot bind has no door');
  assert.equal(provenance({ kind: 'eadwyn' }, 'Fay Founder'), 'Proposed by Eadwyn, accepted by Fay Founder');
  assert.equal(provenance({ kind: 'eadwyn' }, null), 'Proposed by Eadwyn, accepted', 'no name recorded: none guessed');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

test('mounted Story: the bound figure is drawn inside the sentence in "Reads as"', async () => {
  const m = await mounted(STORY);
  try {
    await m.click('story-rail-traction');
    assert.ok(m.has('story-inline-figure'), 'drawn inline');
    assert.match(m.textOf('story-reads-as'), /MRR reached MRR\s*\$16,950.*this quarter, from 42.*pilots\./s);
    assert.ok(m.has('story-figure-placed') && !m.has('story-figure-unplaced'));
  } finally { await m.close(); }
});

test('mounted Ask Eadwyn: one run names its option, writes nothing; Accept puts the words in; Save sends them as Eadwyn\'s', async () => {
  const m = await mounted(STORY);
  try {
    await m.click('story-rail-traction');
    await m.click('story-ask-open');
    assert.match(m.textOf('story-ask-menu'), /Draft this section.*Shorten.*Plain words/s);
    await m.click('story-ask-shorten');
    const post = m.requests.find((r) => r.method === 'POST' && r.url.includes('/narrative/2/sections/traction/draft'));
    assert.ok(post, 'the draft route was called');
    assert.deepEqual(post.body, { mode: 'shorten', words: WORDS.traction });
    assert.equal(header(post, 'X-Rail-Option'), encodeURIComponent('draft:narrative-section'));
    assert.equal(m.requests.filter((r) => r.method === 'PUT').length, 0, 'the run writes nothing');
    assert.equal(m.textOf('story-proposal-text'), DRAFT.text);
    assert.match(m.textOf('story-proposal-removed'), /A line with a number was removed/);
    await m.click('story-proposal-accept');
    assert.equal(m.props('story-words').value, DRAFT.text);
    assert.equal(m.requests.filter((r) => r.method === 'PUT').length, 0, 'accepting writes nothing either');
    await m.click('story-save-open');
    await m.click('story-save-confirm');
    const put = m.requests.find((r) => r.method === 'PUT' && r.url.includes('/sections/traction'));
    assert.deepEqual(put.body.source, { kind: 'eadwyn' });
    assert.equal(put.body.body, DRAFT.text);
  } finally { await m.close(); }
});

test('mounted: typing over Eadwyn\'s accepted words makes them the founder\'s, so Save sends no Eadwyn source', async () => {
  const m = await mounted(STORY);
  try {
    await m.click('story-rail-traction');
    await m.click('story-ask-open');
    await m.click('story-ask-plain');
    await m.click('story-proposal-accept');
    await m.type('story-words', `${DRAFT.text} We add teams each week.`);
    await m.click('story-save-open');
    await m.click('story-save-confirm');
    const put = m.requests.find((r) => r.method === 'PUT' && r.url.includes('/sections/traction'));
    assert.equal(put.body.source, undefined);
    assert.equal(put.body.body, `${DRAFT.text} We add teams each week.`);
  } finally { await m.close(); }
});

test('NAR17b: AI assistance off greys Ask Eadwyn and says you can still write and check; nothing is run', async () => {
  const m = await mounted(STORY, { aiOff: true });
  try {
    assert.equal(m.props('story-ask-open').disabled, true);
    assert.match(m.textOf('story-ai-off'), /AI assistance is off on this page\. You can still write and check\..*Turn it back on from the Eadwyn rail\./s);
    assert.ok(m.has('story-words'), 'the founder can still write');
    assert.equal(m.requests.filter((r) => r.url.includes('/draft')).length, 0);
  } finally { await m.close(); }
});

test('NAR17c: a run the tokens cannot cover says nothing was charged, with Top up; the words stay as they were', async () => {
  const m = await mounted(STORY, { handle: handler({ draft: () => response({ error: 'budget_user_month', message: 'Not enough AI tokens. Add AI tokens or wait for next month’s allowance.' }, 402) }) });
  try {
    await m.click('story-rail-traction');
    await m.click('story-ask-open');
    await m.click('story-ask-draft');
    assert.match(m.textOf('story-ask-refused-tokens'), /Not enough AI tokens.*Nothing was charged\..*Top up AI tokens/s);
    assert.equal(m.props('story-topup').href, ADD_TOKENS_PATH);
    assert.ok(!m.has('story-proposal'));
    assert.equal(m.props('story-words').value, WORDS.traction);
  } finally { await m.close(); }
});

test('mounted Insert in Story: ?insert= opens Insert a figure on that one record, and Insert puts its value at the cursor', async () => {
  const m = await mounted(`${STORY}&insert=grow.mercury_revenue`);
  try {
    assert.ok(m.has('story-insert-only'));
    assert.ok(m.has('story-insert-row-grow.mercury_revenue') && !m.has('story-insert-row-grow.mrr'), 'only the figure Home sent');
    await m.click('story-insert-grow.mercury_revenue');
    const words = m.props('story-words').value;
    assert.match(words, /\$17,210/, 'its value is in the words');
    await m.click('story-save-open');
    await m.click('story-save-confirm');
    const put = m.requests.find((r) => r.method === 'PUT');
    assert.ok(put.body.bindings.some((b) => b.source_key === 'grow.mercury_revenue'), 'and it is bound');
  } finally { await m.close(); }
});

test('Home\'s From Mercury: Insert in Story on the narrative\'s figures only, and the line that investors see one only after', () => {
  const part = { state: 'ok', figures: [{ key: 'revenue_last_month', label: 'Revenue credits, Sep 2026', value: 1721000, unit: 'cents', source: 'From Mercury, as of 1 Oct', fact_id: 4 }], facts: [], proposals: [] };
  const html = (slug) => renderToStaticMarkup(h(MemoryRouter, null, h(MercuryRaiseFeed, { slug, part, projectId: 3 })));
  const narrative = html('investor-narrative');
  assert.match(narrative, /data-testid="mercury-insert-revenue_last_month"[^>]*>Insert in Story</);
  assert.match(narrative, /href="\/raise\/investor-narrative\/story\?project_id=3&amp;insert=grow\.mercury_revenue"/);
  assert.match(narrative, /Investors see one of these only after you insert it in the Story\./);
  assert.doesNotMatch(html('pitch-deck'), /Insert in Story/, 'the deck cites it its own way');
});

test('the rail knows the option, on the page where it is pressed, and the Worker route exists', () => {
  assert.match(read('frontend/src/lib/railOptions/founder.js'), /page: 'Founder · Raise · Investor narrative', key: 'draft:narrative-section'/);
  assert.ok(read('cloudflare-worker/src/services/ai/railMatrix.json').includes('"optionKey": "draft:narrative-section"'), 'the matrix was rebuilt');
  assert.match(read('cloudflare-worker/src/routes/cycle_raise.ts'), /cycleRaise\.post\('\/narrative\/:version\/sections\/:section\/draft'/);
  assert.match(read('frontend/src/lib/api/narrative.js'), /\/sections\/\$\{enc\(section\)\}\/draft\?project=/);
});
