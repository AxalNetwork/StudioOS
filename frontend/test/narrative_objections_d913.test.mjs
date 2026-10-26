/**
 * D913 (#2697) — the objections investors raised: NAR10, the Objections panel
 * beside Story's writing surface, with "Answer it"; and NAR1's "Objections
 * heard" card and Objections answered tile on Home. Option A (migration
 * 624): "Answered in [Section] ›", the n-of-m tile, an accepted draft recorded
 * as the answer on Save version, and Mark answered / Clear answer behind their
 * dialogs.
 *
 * The model is pure; Story is mounted under CycleRoute, as the tool runs,
 * against the Worker's shapes (D908's read, `GET /narrative/objections`,
 * D913's draft). Every objection and figure here is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/narrative_objections_d913.test.mjs
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
import { ObjectionsCard } from '../src/pages/raise/narrative/ObjectionsPanel.jsx';
import { __resetAssistModeForTest } from '../src/hooks/useAssistMode.js';
import { SECTIONS } from '../src/pages/raise/narrative/storyModel.js';
import {
  ANSWER_FOOT, ANSWERS_UNREADABLE, OBJECTIONS_NONE, OBJECTIONS_UNREADABLE, answerItHref, answerSaveLines, answeredOf, clearDialog, homeTiles, markDialog,
  objectionRow, objectionsOf, objectionsTile, objectionsTileSub, sectionHref,
} from '../src/pages/raise/narrative/narrativeModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const K_MARKET = '0123456789abcdef';
const K_NOW = 'fedcba9876543210';
const OBJECTIONS = [
  { key: K_MARKET, text: 'Too small a market', count: 4, prospects: 3, last_heard: '2026-10-09', answer: 'The wedge opens the mid-market.' },
  { key: K_NOW, text: 'Why now?', count: 1, prospects: 1, last_heard: '2026-10-03', answer: null },
];
const ANSWERED = { version: 7, section: 'competition', how: 'picked', by: { id: 1, name: 'Fay Founder' }, at: '2026-10-20' };
const ANSWERED_ITEMS = () => [{ ...OBJECTIONS[0], answered: ANSWERED }, { ...OBJECTIONS[1], answered: null }];
const keys = SECTIONS.map((s) => s.key);
const WORDS = { market: 'Finance teams in mid-sized companies.' };
const items = () => keys.map((key, i) => ({ key, label: SECTIONS[i].label, store: SECTIONS[i].store, deck_key: null, position: i, audience_note: null, source: null, updated_at: null, body: WORDS[key] ?? null }));
const NARRATIVE = () => ({
  version: 2,
  meta: { state: 'ok', live: false, investor_type: 'seed_fund', deck_version: null, start_from: 'blank', based_on_version: null, check_against: null },
  sections: { state: 'ok', items: items() },
  positioning: { state: 'ok', core: [], overrides: [], effective: [] },
  bindings: { state: 'ok', items: [] },
});
const OPTIONS = { versions: [{ value: '2', label: 'v2 · seed fund' }] };
const MODULE = { module: { slug: 'investor-narrative', name: 'Investor narrative', records_title: 'Versions' }, card: { state: 'empty', reason: 'No narrative saved yet.' }, records: { cols: [], rows: [], total: 0, page: 1, page_size: 25 } };
const ANSWER = { version: 2, section: 'market', objection: K_MARKET, text: 'Mid-market finance teams are the first of many we serve.', removed: 0 };

function handler({ objections = () => response({ objections: OBJECTIONS, capped: false, answers: 'ok' }), draft = () => response(ANSWER), answerWrite = () => response({ answered: null }) } = {}) {
  return (url, options = {}) => {
    if (url.includes('/answer?')) return answerWrite(url, options);
    if (options.method === 'PUT') return response({ ok: true });
    if (options.method === 'POST' && url.includes('/narrative/objections/')) return draft(url, options);
    if (url.includes('/cycles/raise/narrative/objections')) return objections(url, options);
    if (url.includes('/form-options')) return response(OPTIONS);
    if (/\/cycles\/raise\/narrative\/\d+\?/.test(url)) return response(NARRATIVE());
    if (url.includes('/decks/sources')) return response({ project_id: 3, coverage: {}, items: [] });
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
    requests, props: (id) => props(byId(id)),
    has: (id) => Boolean(byId(id)),
    textOf: (id) => text(byId(id)),
    click: (id) => fire(id, 'onClick', { preventDefault() {} }),
    change: (id, value) => fire(id, 'onChange', { target: { value, selectionStart: value.length } }),
    follow: (id) => fire(id, 'onClick', { button: 0, defaultPrevented: false, preventDefault() {}, target: byId(id), currentTarget: byId(id) }),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const STORY = '/raise/investor-narrative/story?project_id=3&version=2';
const header = (r, name) => r.headers?.[name] ?? r.headers?.get?.(name) ?? null;

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the objections from either read, each row\'s words and count, the tile\'s sub, and Home\'s Answer it address', () => {
  assert.deepEqual(objectionsOf({ objections: OBJECTIONS, capped: true, answers: 'ok' }), { status: 'ok', items: OBJECTIONS, capped: true, answers: 'ok' }, 'the route\'s shape');
  assert.deepEqual(objectionsOf({ state: 'ok', items: [], capped: false, answers: 'ok' }), { status: 'ok', items: [], capped: false, answers: 'ok' }, 'the part\'s shape; none is a real empty list');
  assert.equal(objectionsOf({ objections: OBJECTIONS }).answers, 'unreadable', 'answers not read are never "none answered"');
  for (const bad of [null, undefined, { state: 'unreadable' }, {}]) assert.deepEqual(objectionsOf(bad), { status: 'unreadable' }, 'a failed or missing read is never an empty list');
  assert.deepEqual(objectionRow(OBJECTIONS[0]), { key: K_MARKET, text: 'Too small a market', times: '4 times', sub: 'Raised 4 times by 3 investors', answered: null });
  assert.equal(objectionRow(OBJECTIONS[1]).sub, 'Raised 1 time', 'one investor is not named as a count');
  assert.equal(objectionRow({ key: 'x', text: 'y' }).sub, 'Raised not recorded', 'a missing count is never 0');
  assert.equal(objectionsTileSub(objectionsOf({ objections: OBJECTIONS })), `2 heard. ${ANSWERS_UNREADABLE}`);
  assert.equal(objectionsTileSub(objectionsOf({ objections: [], answers: 'ok' })), OBJECTIONS_NONE);
  assert.equal(objectionsTileSub(objectionsOf(null)), 'The objections could not be read.');
  const tile = (objections) => homeTiles({ state: 'ok', versions: [], newest: null, objections }).find((t) => t.key === 'objections');
  assert.deepEqual([tile({ state: 'ok', items: OBJECTIONS }).value, tile({ state: 'ok', items: OBJECTIONS }).waits], ['—', true], 'answers not read: a dash, never 0');
  assert.deepEqual([tile({ state: 'unreadable' }).value, tile({ state: 'ok', items: [], answers: 'ok' }).value], ['—', '—'], 'nothing read, nothing heard: a dash');
  assert.deepEqual(objectionsTile(objectionsOf({ objections: ANSWERED_ITEMS(), answers: 'ok' })),
    { key: 'objections', label: 'Objections answered', value: '1 of 2', sub: '1 not answered in a saved section yet.', waits: false }, 'n of m, a real zero allowed');
  assert.equal(tile({ state: 'ok', items: OBJECTIONS, answers: 'ok' }).value, '0 of 2', 'none answered, once read, is a real zero');
  assert.equal(tile({ state: 'ok', items: [ANSWERED_ITEMS()[0]], answers: 'ok' }).sub, 'Each one is answered in a saved section.');
  assert.equal(answerItHref(K_MARKET, '?project_id=3&tab=x', 4), `/raise/investor-narrative/story?project_id=3&version=4&objection=${K_MARKET}`);
});

test('Answered in [Section] ›: its words, version, how and address; the dialogs and Save version\'s lines say what they change', () => {
  assert.deepEqual(answeredOf(ANSWERED, '?project_id=3&version=2'), {
    section: 'competition', version: 7, label: 'Answered in Competition', sub: 'v7 · Picked by hand · Fay Founder · 2026-10-20',
    href: '/raise/investor-narrative/story?project_id=3&version=7&section=competition',
  }, 'it opens the version that answers it, not the one open');
  assert.equal(answeredOf({ ...ANSWERED, how: 'eadwyn', by: null, at: null }).sub, 'v7 · Eadwyn’s draft, saved');
  assert.equal(answeredOf(null), null);
  assert.equal(sectionHref(2, 'why_now', '?project=3'), '/raise/investor-narrative/story?project_id=3&version=2&section=why_now');
  const row = objectionRow(ANSWERED_ITEMS()[0]);
  assert.deepEqual(markDialog(objectionRow(OBJECTIONS[0]), 'market', 2), {
    title: 'Mark answered in Market?',
    lines: ['Records that Market in v2 answers “Too small a market”.', 'Your words and Capital relationships do not change.'],
    confirm: 'Mark answered',
  });
  assert.deepEqual(markDialog(row, 'market', 2, true).lines, [
    'Records that Market in v2 answers “Too small a market”.',
    'It replaces the earlier record: answered in Competition, v7.',
    'Market has changes not saved yet. The record points to v2 as saved; Save version keeps your changes.',
    'Your words and Capital relationships do not change.',
  ]);
  assert.deepEqual(clearDialog(row), { title: 'Clear this answer?', lines: ['“Too small a market” will no longer read as answered in Competition, v7.', 'The section keeps its words. Capital relationships does not change.'], confirm: 'Clear answer' });
  const pending = { [K_MARKET]: { section: 'market', text: 'Too small a market' }, [K_NOW]: { section: 'why_now', text: 'Why now?' } };
  assert.deepEqual(answerSaveLines(pending, [{ section: 'market' }]), ['Records that Market answers “Too small a market”.'], 'only a section this save writes');
  for (const d of [markDialog(row, 'market', 2), clearDialog(row)]) for (const l of d.lines) assert.doesNotMatch(l, /North|South|investor/i, 'no investor named');
});

test('Home\'s Objections heard: each objection with its count and Answer it on the newest version; none for an admin or with no version; a failed read says so', () => {
  const part = { state: 'ok', versions: [{ version: 4 }, { version: 2 }], objections: { state: 'ok', items: OBJECTIONS, capped: false } };
  const html = renderToStaticMarkup(h(MemoryRouter, null, h(ObjectionsCard, { part, search: '?project_id=3' })));
  assert.ok(html.includes('Too small a market') && html.includes('Raised 4 times by 3 investors') && html.includes('From Capital relationships · 2'));
  assert.ok(html.includes(`href="/raise/investor-narrative/story?project_id=3&amp;version=4&amp;objection=${K_MARKET}"`), 'Answer it opens Story on the newest version');
  assert.ok(!html.includes('The wedge opens'), 'the founder\'s Capital relationships answer is not shown as the narrative\'s');
  const admin = renderToStaticMarkup(h(MemoryRouter, null, h(ObjectionsCard, { part, admin: true })));
  assert.ok(admin.includes('Too small a market') && !admin.includes('Answer it'), 'an admin reads, with no Answer it');
  const noVersion = renderToStaticMarkup(h(MemoryRouter, null, h(ObjectionsCard, { part: { ...part, versions: [] } })));
  assert.ok(noVersion.includes('Too small a market') && !noVersion.includes('Answer it'), 'no version to answer in');
  const failed = renderToStaticMarkup(h(MemoryRouter, null, h(ObjectionsCard, { part: { ...part, objections: { state: 'unreadable' } } })));
  assert.ok(failed.includes(OBJECTIONS_UNREADABLE) && failed.includes('role="alert"'));
  const none = renderToStaticMarkup(h(MemoryRouter, null, h(ObjectionsCard, { part: { ...part, objections: { state: 'ok', items: [] } } })));
  assert.ok(none.includes(OBJECTIONS_NONE));
  const answered = renderToStaticMarkup(h(MemoryRouter, null, h(ObjectionsCard, { part: { ...part, objections: { state: 'ok', items: ANSWERED_ITEMS(), answers: 'ok' } }, search: '?project_id=3' })));
  assert.ok(answered.includes('✓ Answered in Competition ›') && answered.includes('v7 · Picked by hand'));
  assert.ok(answered.includes('href="/raise/investor-narrative/story?project_id=3&amp;version=7&amp;section=competition"'));
  assert.equal(answered.split('Answer it ›').length - 1, 1, 'Answer it only on the objection not answered');
  assert.ok(html.includes(ANSWERS_UNREADABLE), 'answers not read: the card says so');
  assert.ok(!answered.includes(ANSWERS_UNREADABLE));
  for (const sample of ['[Too small', '[Market]', '[Why now', '[2] of [3]']) assert.ok(!html.includes(sample), `no canvas sample: ${sample}`);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

test('mounted NAR10: the panel lists the objections; Answer it drafts the open section under its option and writes nothing; Accept puts the words in', async () => {
  const m = await mounted(STORY);
  try {
    assert.match(m.textOf('story-objections'), /Objections heard.*From Capital relationships · 2.*Too small a market.*Raised 4 times by 3 investors.*Why now\?.*Raised 1 time/s);
    assert.equal(m.textOf('story-objections-foot'), ANSWER_FOOT);
    await m.click('story-rail-market');
    assert.equal(m.props(`story-objection-answer-${K_MARKET}`)['aria-label'], 'Answer it in Market');
    await m.click(`story-objection-answer-${K_MARKET}`);
    const post = m.requests.find((r) => r.method === 'POST' && r.url.includes(`/narrative/objections/${K_MARKET}/draft`));
    assert.ok(post, 'the objection draft route was called');
    assert.deepEqual(post.body, { version: '2', section: 'market', words: WORDS.market });
    assert.equal(header(post, 'X-Rail-Option'), encodeURIComponent('draft:narrative-objection'));
    assert.equal(m.textOf('story-proposal-text'), ANSWER.text);
    assert.equal(m.requests.filter((r) => r.method === 'PUT').length, 0, 'the run writes nothing');
    await m.click('story-proposal-accept');
    assert.equal(m.props('story-words').value, ANSWER.text);
    assert.equal(m.requests.filter((r) => r.method === 'PUT').length, 0, 'accepting writes nothing either');
  } finally { await m.close(); }
});

test('mounted NAR10: Home\'s Answer it marks its objection; AI off greys Answer it; a refused run says so', async () => {
  let m = await mounted(`${STORY}&objection=${K_NOW}`);
  try {
    assert.equal(m.props(`story-objection-${K_NOW}`)['aria-current'], 'true');
    assert.equal(m.props(`story-objection-${K_MARKET}`)['aria-current'], undefined);
  } finally { await m.close(); }
  m = await mounted(STORY, { aiOff: true });
  try {
    assert.equal(m.props(`story-objection-answer-${K_MARKET}`).disabled, true);
  } finally { await m.close(); }
  m = await mounted(STORY, { handle: handler({ draft: () => response({ error: 'budget_user_month', message: 'Not enough AI tokens. Add AI tokens or wait for next month’s allowance.' }, 402) }) });
  try {
    await m.click(`story-objection-answer-${K_MARKET}`);
    assert.match(m.textOf('story-ask-refused-tokens'), /Not enough AI tokens.*Nothing was charged\./s);
    assert.ok(!m.has('story-proposal'));
  } finally { await m.close(); }
});

test('mounted NAR10 on the live deck\'s version 0: the objections are read, with no Answer it', async () => {
  const live = (url, options) => (/\/cycles\/raise\/narrative\/\d+\?/.test(url) ? response({ ...NARRATIVE(), version: 0, meta: { ...NARRATIVE().meta, live: true } }) : handler()(url, options));
  const m = await mounted(STORY, { handle: live });
  try {
    assert.ok(m.has('story-live-deck'), 'the live deck, read only');
    assert.ok(m.has(`story-objection-${K_MARKET}`), 'the objections are still read');
    assert.ok(!m.has(`story-objection-answer-${K_MARKET}`) && !m.has('story-objections-foot'), 'no Answer it');
  } finally { await m.close(); }
});

test('mounted NAR10: a failed read says so with Try again, which reads again; none recorded says so', async () => {
  let fail = true;
  const m = await mounted(STORY, { handle: handler({ objections: () => (fail ? response({ detail: 'The narrative could not be read', code: 'unreadable' }, 503) : response({ objections: OBJECTIONS })) }) });
  try {
    assert.equal(m.textOf('objections-unreadable').startsWith(OBJECTIONS_UNREADABLE), true);
    assert.ok(!m.has(`story-objection-${K_MARKET}`), 'never an empty list');
    fail = false;
    const before = m.requests.filter((r) => r.url.includes('/narrative/objections')).length;
    await m.click('objections-retry');
    assert.equal(m.requests.filter((r) => r.url.includes('/narrative/objections')).length, before + 1);
    assert.ok(m.has(`story-objection-${K_MARKET}`));
  } finally { await m.close(); }
  const empty = await mounted(STORY, { handle: handler({ objections: () => response({ objections: [] }) }) });
  try {
    assert.equal(empty.textOf('objections-none'), OBJECTIONS_NONE);
    assert.ok(!empty.has('story-objections-foot'));
  } finally { await empty.close(); }
});

test('mounted option A: an accepted Answer it draft is recorded when Save version writes its section, and the dialog says so', async () => {
  const m = await mounted(STORY);
  try {
    await m.click('story-rail-market');
    await m.click(`story-objection-answer-${K_MARKET}`);
    await m.click('story-proposal-accept');
    assert.equal(m.requests.filter((r) => r.url.includes('/answer?')).length, 0, 'accepting records nothing');
    await m.click('story-save-open');
    assert.match(m.textOf('story-save'), /Records that Market answers “Too small a market”\./);
    const reads = m.requests.filter((r) => r.method === 'GET' && r.url.includes('/narrative/objections')).length;
    await m.click('story-save-confirm');
    const section = m.requests.findIndex((r) => r.method === 'PUT' && r.url.includes('/sections/market'));
    const answer = m.requests.findIndex((r) => r.url.includes(`/narrative/objections/${K_MARKET}/answer?`));
    assert.ok(section >= 0 && answer > section, 'the answer is recorded after its section is saved');
    assert.deepEqual([m.requests[answer].method, m.requests[answer].body], ['PUT', { version: '2', section: 'market', how: 'eadwyn' }]);
    assert.ok(m.requests.filter((r) => r.method === 'GET' && r.url.includes('/narrative/objections')).length > reads, 'the panel reads again');
    assert.ok(!m.has('story-answer-not-recorded'));
  } finally { await m.close(); }
});

test('mounted option A: a section saved but its answer refused says so; a draft not accepted records nothing', async () => {
  let m = await mounted(STORY, { handle: handler({ answerWrite: () => response({ detail: 'Version not found' }, 404) }) });
  try {
    await m.click('story-rail-market');
    await m.click(`story-objection-answer-${K_MARKET}`);
    await m.click('story-proposal-accept');
    await m.click('story-save-open');
    await m.click('story-save-confirm');
    assert.match(m.textOf('story-answer-not-recorded'), /^Saved, but which section answers “Too small a market” \(Version not found\) was not recorded\. Mark it answered from Objections heard\.$/);
  } finally { await m.close(); }
  m = await mounted(STORY);
  try {
    await m.click('story-rail-market');
    await m.click(`story-objection-answer-${K_MARKET}`);
    await m.click('story-proposal-discard');
    assert.equal(m.has('story-save-open') && m.props('story-save-open').disabled, true, 'nothing to save');
    assert.equal(m.requests.filter((r) => r.url.includes('/answer?')).length, 0);
  } finally { await m.close(); }
  // Accepted, then put back as saved: that section is not written, so its answer is not recorded.
  m = await mounted(STORY);
  try {
    await m.click('story-rail-market');
    await m.click(`story-objection-answer-${K_MARKET}`);
    await m.click('story-proposal-accept');
    await m.change('story-words', WORDS.market);
    await m.click('story-rail-solution');
    await m.change('story-words', 'Close the books in a day.');
    await m.click('story-save-open');
    assert.doesNotMatch(m.textOf('story-save'), /Records that/);
    await m.click('story-save-confirm');
    assert.ok(m.requests.some((r) => r.method === 'PUT' && r.url.includes('/sections/solution')));
    assert.equal(m.requests.filter((r) => r.url.includes('/answer?')).length, 0, 'Market was not saved, so nothing is recorded');
  } finally { await m.close(); }
});

test('mounted option A: Answered in [Section] › on the panel, and ?section= opens that section', async () => {
  const m = await mounted(`${STORY}&section=competition`, { handle: handler({ objections: () => response({ objections: ANSWERED_ITEMS(), answers: 'ok' }) }) });
  try {
    assert.equal(m.props('story-rail-competition')['aria-current'], 'true', 'the section in the address is open');
    assert.equal(m.textOf(`story-objection-answered-${K_MARKET}`), '✓ Answered in Competition ›');
    assert.equal(m.props(`story-objection-answered-${K_MARKET}`).href, '/raise/investor-narrative/story?project_id=3&version=7&section=competition');
    assert.ok(!m.has(`story-objection-answered-${K_NOW}`));
  } finally { await m.close(); }
  // Followed from Story itself, with another section open: Story moves to it.
  const here = await mounted(STORY, { handle: handler({ objections: () => response({ objections: ANSWERED_ITEMS(), answers: 'ok' }) }) });
  try {
    await here.click('story-rail-team');
    await here.follow(`story-objection-answered-${K_MARKET}`);
    assert.equal(here.props('story-rail-competition')['aria-current'], 'true');
  } finally { await here.close(); }
});

test('mounted option A: Mark answered and Clear answer each open a dialog first, then write; a refused write keeps the dialog', async () => {
  const m = await mounted(STORY, { handle: handler({ objections: () => response({ objections: ANSWERED_ITEMS(), answers: 'ok' }) }) });
  try {
    await m.click('story-rail-market');
    await m.click(`story-objection-mark-${K_NOW}`);
    assert.equal(m.requests.filter((r) => r.url.includes('/answer?')).length, 0, 'the dialog first');
    assert.match(m.textOf('story-objection-mark-dialog'), /Mark answered in Market\?.*Records that Market in v2 answers “Why now\?”\./s);
    await m.click('story-objection-mark-dialog-confirm');
    const put = m.requests.find((r) => r.url.includes(`/narrative/objections/${K_NOW}/answer?`));
    assert.deepEqual([put.method, put.body], ['PUT', { version: '2', section: 'market', how: 'picked' }]);
    assert.ok(!m.has('story-objection-mark-dialog'), 'closed once written');
    await m.click(`story-objection-clear-${K_MARKET}`);
    assert.match(m.textOf('story-objection-clear-dialog'), /no longer read as answered in Competition, v7/);
    await m.click('story-objection-clear-dialog-confirm');
    const del = m.requests.find((r) => r.method === 'DELETE');
    assert.ok(del.url.includes(`/narrative/objections/${K_MARKET}/answer?`));
    assert.ok(!m.has(`story-objection-clear-${K_NOW}`), 'nothing to clear on an objection not answered');
  } finally { await m.close(); }
  const refused = await mounted(STORY, { handle: handler({ answerWrite: () => response({ detail: 'Version not found' }, 404) }) });
  try {
    await refused.click(`story-objection-mark-${K_MARKET}`);
    await refused.click('story-objection-mark-dialog-confirm');
    assert.equal(refused.textOf('story-objection-mark-dialog-failed'), 'Nothing was changed: Version not found.');
  } finally { await refused.close(); }
});

test('mounted option A: answers not read say so, with no Mark or Clear; the live deck offers neither', async () => {
  let m = await mounted(STORY, { handle: handler({ objections: () => response({ objections: OBJECTIONS, answers: 'unreadable' }) }) });
  try {
    assert.equal(m.textOf('objections-answers-unreadable'), ANSWERS_UNREADABLE);
    assert.ok(m.has(`story-objection-${K_MARKET}`), 'the objections still show');
    assert.ok(!m.has(`story-objection-mark-${K_MARKET}`) && !m.has(`story-objection-clear-${K_MARKET}`));
  } finally { await m.close(); }
  const live = (url, options) => (/\/cycles\/raise\/narrative\/\d+\?/.test(url) ? response({ ...NARRATIVE(), version: 0, meta: { ...NARRATIVE().meta, live: true } }) : handler()(url, options));
  m = await mounted(STORY, { handle: live });
  try {
    assert.ok(!m.has(`story-objection-mark-${K_MARKET}`), 'version 0 is not a saved version');
  } finally { await m.close(); }
});

test('the sources: Answer it goes through the narrative API under its own rail option, and the panel reads no canvas sample', () => {
  const story = read('frontend/src/pages/raise/narrative/StoryTab.jsx');
  assert.match(story, /narrativeApi\.draftObjection\(projectId, key, \{ version, section: active, words: cur\.body \}, railPressHeaders\(OBJECTION_OPTION\)\)/);
  const options = read('frontend/src/lib/railOptions/founder.js');
  assert.match(options, /key: 'draft:narrative-objection'/);
  const worker = read('cloudflare-worker/src/services/narrative/objectionDraft.ts');
  assert.match(worker, /OBJECTION_OPTION = 'draft:narrative-objection'/, 'the Worker and the page name one option');
  const panel = read('frontend/src/pages/raise/narrative/ObjectionsPanel.jsx');
  assert.doesNotMatch(panel, /\[(Too small|Market|Why now|Incumbents)/);
});
