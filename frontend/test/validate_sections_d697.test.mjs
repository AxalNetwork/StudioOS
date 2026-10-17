/**
 * D697 (#1659) PR 1 — Validate's three bottom sections: what FVW's Interviews,
 * Pain map and Hypotheses pages drew, under the three module tables, from the
 * module read's `parts` (D690, #1691), with every dialog drawn after the size
 * container (decision 21). Tests 1 to 6 of the issue.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/validate_sections_d697.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import CycleRoute from '../src/pages/cycles/CycleRoute.jsx';
import { InterviewsSection, PainThemesSection, HypothesesSection, historyNotes } from '../src/pages/cycles/ValidateSections.jsx';
import { adaptModule, adaptRecords } from '../src/pages/cycles/adapters/index.js';
import { RECORDS, TITLES } from '../src/pages/cycles/adapters/validate.js';
import { cellView } from '../src/pages/cycles/cycleModel.js';

const h = React.createElement;
const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const response = (body, status = 200) => ({
  ok: status < 400, status, headers: { get: (k) => (/content-type/i.test(k) ? 'application/json' : null) },
  json: async () => body, text: async () => JSON.stringify(body), blob: async () => new Blob(['id,name\n']),
});
const ssr = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const noop = () => {};

// Made-up venture data, shaped as #1691's module reads send `parts` (cycleValidate.ts).
const RESEARCH_PARTS = { can_write: true, stats: { logged: 9, with_pain: 6, consent_agreed: 4, consent_not_asked: 2 } };
const PAIN_PARTS = {
  can_write: true,
  stats: { themes: 3, interviews: 9, ungrouped: 2, need_themes: 1, icp_themes: 2, fit_unrecorded_themes: 1 },
  themes: [{ id: 12, title: 'Manual reconciliation' }, { id: 13, title: 'Late invoices' }],
  unthemed: [{ interview_id: 41, interviewee: 'Rowan Vale', date: '2026-10-02', phrase: 'we lose a day a month' }],
  unthemed_total: 1,
};
const HYP_PARTS = {
  can_write: true,
  stats: { hypotheses: 4, supported: 1, refuted: 1, awaiting: 2, withheld: 1, fit_not_recorded: 3, bar: 5, history_since: '2026-10-10T09:00:00Z' },
  fit_gap: [{ id: 3, code: 'H3', supporting: 2, bar: 5, fit_unrecorded: 1 }],
};
const COLS = {
  'customer-research': ['Interviewee', 'Company', 'Date', 'ICP fit', 'Consent', 'State'],
  'problem-discovery': ['Theme', 'Mentions', 'Severity', 'Trend', 'Supports'],
  experiments: ['Hypothesis', 'Status', 'Evidence', 'Sprint', 'Owner', 'Source'],
};
const PARTS = { 'customer-research': RESEARCH_PARTS, 'problem-discovery': PAIN_PARTS, experiments: HYP_PARTS };
const moduleRead = (slug, parts = PARTS[slug]) => ({
  module: { slug, name: slug }, card: null,
  records: { cols: COLS[slug], rows: [], total: 0, page: 1, page_size: 25, linkable: false }, parts,
});

/** CycleRoute mounted on a fake DOM, every request answered by `handler`. */
async function mounted(url, handler) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), options }); return handler(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const node = create(tag); node.querySelector = () => null; node.querySelectorAll = () => []; node.focus = () => {}; node.click = () => {}; node.remove = () => {}; node.children = []; return node; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  globalThis.URL.createObjectURL = () => 'blob:x'; globalThis.URL.revokeObjectURL = () => {};
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const out = {};
  function Capture() { out.location = useLocation(); return null; }
  const props = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1];
  const nodes = (from = container) => { const walk = (node) => [node, ...(node.childNodes || []).flatMap(walk)]; return walk(from); };
  const text = (node) => (node?.nodeType === 3 ? node.textContent : node?.childNodes?.length ? node.childNodes.map(text).join('') : node?.textContent || '');
  const byTestid = (id, from) => nodes(from).find((n) => props(n)?.['data-testid'] === id) || null;
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Capture), h(Routes, null,
    h(Route, { path: '/validate/:slug', element: h(CycleRoute, { cycle: 'validate' }) }),
  ))));
  const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  return {
    out, requests, nodes, props, byTestid, flush, text: () => text(container),
    textOf: text,
    press: (id) => act(async () => { const node = byTestid(id); assert.ok(node, `found ${id}`); await props(node).onClick({ preventDefault() {}, stopPropagation() {} }); }),
    run: (fn) => act(async () => { await fn(); }),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const handlerFor = (slug, extra = () => null) => (url, opts) => extra(url, opts)
  ?? (url.includes(`/cycles/validate/modules/${slug}?`) ? response(moduleRead(slug)) : response({}));
const moduleReads = (requests, slug) => requests.filter((r) => r.url.includes(`/cycles/validate/modules/${slug}?`)).length;

// ---------------------------------------------------------------------------
// 1. Customer research
// ---------------------------------------------------------------------------

test('1: the Interviews strip says FVW\'s four labels from parts.stats, the never-asked note, and Not recorded for a missing stat', () => {
  const html = ssr(h(InterviewsSection, { parts: RESEARCH_PARTS, openDialog: noop, onLog: noop, onExport: noop }));
  for (const label of ['Interviews logged', 'With a pain recorded', 'Consent to quote', 'Deck-eligible']) assert.match(html, new RegExp(label));
  assert.match(html, />9</);
  assert.match(html, /2 never asked — not the same as declined/);
  const missing = ssr(h(InterviewsSection, { parts: { can_write: true, stats: { logged: 3 } }, openDialog: noop, onLog: noop, onExport: noop }));
  assert.equal((missing.match(/Not recorded/g) || []).length, 3, 'with_pain and both consent tiles were not sent: Not recorded, never 0');
  assert.doesNotMatch(missing, />0</);
});

test('1: More tools links the Marketplace and Advisory under their own descriptions', () => {
  const html = ssr(h(InterviewsSection, { parts: RESEARCH_PARTS, openDialog: noop, onLog: noop, onExport: noop }));
  assert.match(html, /More tools/);
  assert.match(html, /href="\/build\/marketplace"[^>]*>Marketplace: partners&#x27; services, and the needs you post</);
  assert.match(html, /href="\/advisory"[^>]*>Advisory: the advisor directory</);
  assert.doesNotMatch(html, /Find interviewees/);
});

test('1: Log an interview opens LogInterviewModal; a save posts the page\'s venture and re-reads the module', async () => {
  const m = await mounted('/validate/customer-research?project_id=7', handlerFor('customer-research'));
  try {
    assert.equal(m.byTestid('modal-log-interview'), null);
    await m.press('validate-log-interview');
    assert.ok(m.byTestid('modal-log-interview'), 'the modal opened');
    const before = moduleReads(m.requests, 'customer-research');
    const modal = m.nodes().find((n) => m.props(n)?.['data-testid'] === 'modal-log-interview');
    // The modal's own submit calls onSave then onClose; drive onSave through its props chain.
    const fiberKey = Object.keys(modal).find((k) => k.startsWith('__reactFiber$'));
    let f = modal[fiberKey];
    while (f && f.type?.name !== 'LogInterviewModal') f = f.return;
    assert.ok(f, 'LogInterviewModal found');
    await m.run(() => f.memoizedProps.onSave({ interviewee_name: 'Rowan Vale', pains: [] }));
    await m.flush();
    const post = m.requests.find((r) => r.options.method === 'POST' && r.url.includes('/progress/discovery/'));
    assert.ok(post, 'createInterview was called');
    assert.match(post.url, /\/progress\/discovery\/7$/);
    assert.equal(JSON.parse(post.options.body).interviewee_name, 'Rowan Vale');
    assert.ok(moduleReads(m.requests, 'customer-research') > before, 'the module is read again');
  } finally { await m.close(); }
});

test('1: ?log=notes opens Log an interview with intent notes and leaves no log in the URL; ?log=x opens nothing', async () => {
  const m = await mounted('/validate/customer-research?log=notes&project_id=7', handlerFor('customer-research'));
  try {
    const modal = m.byTestid('modal-log-interview');
    assert.ok(modal, 'opened on load');
    const fiberKey = Object.keys(modal).find((k) => k.startsWith('__reactFiber$'));
    let f = modal[fiberKey];
    while (f && f.type?.name !== 'LogInterviewModal') f = f.return;
    assert.equal(f.memoizedProps.intent, 'notes');
    assert.doesNotMatch(m.out.location.search, /log=/);
    assert.match(m.out.location.search, /project_id=7/, 'the venture stays');
  } finally { await m.close(); }
  const x = await mounted('/validate/customer-research?log=x&project_id=7', handlerFor('customer-research'));
  try { assert.equal(x.byTestid('modal-log-interview'), null); } finally { await x.close(); }
});

test('1: Export interviews downloads venture 7\'s file, and a refusal prints the Worker\'s sentence', async () => {
  const sentence = 'Only the venture and an admin can export its interviews.';
  const m = await mounted('/validate/customer-research?project_id=7', handlerFor('customer-research',
    (url) => (url.includes('/export.csv') ? response({ detail: sentence }, 403) : null)));
  try {
    await m.press('validate-export-interviews');
    await m.flush();
    assert.ok(m.requests.some((r) => r.url.endsWith('/api/founder/validate/interviews/7/export.csv')));
    assert.match(m.text(), new RegExp(sentence));
  } finally { await m.close(); }
});

test('1: the table has no Stage column or chip, and Consent offers "Agreed · deck-eligible"', () => {
  const recs = adaptRecords('validate', 'customer-research', { cols: COLS['customer-research'], rows: [], total: 0 });
  assert.equal(recs.cols.some((c) => c.label === 'Stage'), false);
  assert.equal(recs.filters.some((f) => f.key === 'stage' || f.label === 'Stage'), false);
  assert.ok(recs.filters.find((f) => f.key === 'consent').options.some((o) => o.value === 'agreed' && o.label === 'Agreed · deck-eligible'));
});

// ---------------------------------------------------------------------------
// 2. Problem discovery
// ---------------------------------------------------------------------------

test('2: the table is titled Pain themes and offers ICP only, Need-to-have and Most recent', () => {
  assert.equal(TITLES['problem-discovery'], 'Pain themes');
  assert.equal(adaptModule('validate', 'problem-discovery', { module: {} }).module.records_title, 'Pain themes');
  const recs = adaptRecords('validate', 'problem-discovery', { cols: COLS['problem-discovery'], rows: [] });
  assert.deepEqual(recs.filters.map((f) => f.key), ['severity', 'hypothesis', 'icp', 'need']);
  assert.deepEqual(recs.filters.find((f) => f.key === 'icp').options, [{ value: 'yes', label: 'ICP only' }]);
  assert.deepEqual(recs.filters.find((f) => f.key === 'need').options, [{ value: 'yes', label: 'Need-to-have' }]);
  assert.ok(recs.sorts.some((s) => s.key === 'recent' && s.label === 'Most recent'));
});

test('2: the five tiles read parts.stats, with FVW\'s notes for an unrecorded need or ICP', () => {
  const html = ssr(h(PainThemesSection, { parts: PAIN_PARTS, onExport: noop, onAssign: noop }));
  for (const label of ['Themes', 'Interviews behind them', 'Ungrouped phrases', 'Need-to-have themes', 'Themes your ICP named']) assert.match(html, new RegExp(`>${label}<`));
  assert.match(html, /1 more have mentions whose ICP fit was never recorded/);
  const none = ssr(h(PainThemesSection, { parts: { ...PAIN_PARTS, stats: { ...PAIN_PARTS.stats, need_themes: null, icp_themes: null } }, onExport: noop, onAssign: noop }));
  assert.match(none, /no severity recorded against any pain yet/);
  assert.match(none, /no ICP fit recorded on any interview yet/);
  assert.equal((none.match(/Not recorded/g) || []).length, 2);
});

test('2: each unthemed quote shows its interviewee and date; Assign attaches it to the theme through recordAction', async () => {
  const html = ssr(h(PainThemesSection, { parts: PAIN_PARTS, onExport: noop, onAssign: noop }));
  assert.match(html, /Unthemed quotes · 1/);
  assert.match(html, /“we lose a day a month” · Rowan Vale · 2026-10-02/);
  const m = await mounted('/validate/problem-discovery?project_id=7', handlerFor('problem-discovery'));
  try {
    const before = moduleReads(m.requests, 'problem-discovery');
    const select = m.byTestid('validate-assign-theme');
    await m.run(() => m.props(select).onChange({ target: { value: '12' } }));
    await m.flush();
    const post = m.requests.find((r) => r.options.method === 'POST');
    assert.ok(post.url.endsWith('/api/cycles/validate/modules/problem-discovery/records/12/actions/attach?project=7'), post.url);
    assert.deepEqual(JSON.parse(post.options.body), { interview_id: 41, phrase: 'we lose a day a month' });
    assert.ok(moduleReads(m.requests, 'problem-discovery') > before, 'the module is read again');
  } finally { await m.close(); }
});

test('2: New theme is drawn only once its form is registered; no parts.unthemed draws no panel; Export map and the Problem slide link are drawn', () => {
  const withForm = ssr(h(PainThemesSection, { parts: PAIN_PARTS, onExport: noop, onAssign: noop, newThemeHref: '/validate/problem-discovery/new?project_id=7' }));
  assert.match(withForm, /href="\/validate\/problem-discovery\/new\?project_id=7"[^>]*>New theme</);
  const without = ssr(h(PainThemesSection, { parts: PAIN_PARTS, onExport: noop, onAssign: noop }));
  assert.doesNotMatch(without, /New theme/);
  // CycleRoute passes the address only while formFor finds the form (#1656's PR 2 registers it).
  assert.match(read('pages/cycles/CycleRoute.jsx'), /newThemeHref=\{formFor\('validate', 'problem-discovery'\) \? `\/validate\/problem-discovery\/new\?project_id=\$\{encodeURIComponent\(ctx\.projectId\)\}` : null\}/);
  const { unthemed, unthemed_total, ...rest } = PAIN_PARTS;
  const noPanel = ssr(h(PainThemesSection, { parts: rest, onExport: noop, onAssign: noop }));
  assert.doesNotMatch(noPanel, /Unthemed quotes/);
  assert.match(without, /Export map/);
  assert.match(without, /href="\/raise\/pitch\?mode=workspace"[^>]*>Open the Problem slide</);
  assert.match(without, /title="These themes already feed the deck’s Problem slide — open the deck to read it\."/);
});

// ---------------------------------------------------------------------------
// 3. Experiments and evidence
// ---------------------------------------------------------------------------

test('3: the table is titled Hypotheses; Status offers Retired and Fit not recorded; Sprint offers the read\'s; the three views are there', () => {
  assert.equal(adaptModule('validate', 'experiments', { module: {} }).module.records_title, 'Hypotheses');
  const fallback = adaptRecords('validate', 'experiments', { cols: COLS.experiments, rows: [] });
  const status = fallback.filters.find((f) => f.key === 'status').options.map((o) => o.label);
  assert.ok(status.includes('Retired') && status.includes('Fit not recorded'));
  assert.deepEqual(fallback.filters.map((f) => f.key), ['status', 'sprint', 'strength', 'moved', 'history']);
  assert.deepEqual(fallback.filters.find((f) => f.key === 'moved').options, [{ value: 'recent', label: 'Recently moved' }]);
  assert.deepEqual(fallback.filters.find((f) => f.key === 'history').options.map((o) => o.label), ['As of last week', 'Changed this month']);
  const sprints = [{ value: 'Sprint 4', label: 'Sprint 4' }];
  const fromRead = adaptRecords('validate', 'experiments', { cols: COLS.experiments, rows: [], filters: [{ key: 'sprint', label: 'Sprint', options: sprints }] });
  assert.deepEqual(fromRead.filters.find((f) => f.key === 'sprint').options, sprints, 'the read\'s sprints win');
});

test('3: a retired row reads Retired, a recently moved one says Moved, and Source stays the last column', () => {
  const row = (r) => RECORDS.experiments.row({ id: 3, hypothesis: 'H3 · Teams reconcile by hand', evidence: 2, ...r });
  assert.deepEqual(cellView(row({ status: 'testing', retired: true }).cells.status), { text: 'Retired', tone: 'grey', href: null });
  assert.equal(cellView(row({ status: 'testing', moved: 'recent' }).cells.status).text, 'Testing · Moved');
  assert.equal(cellView(row({ status: 'testing', moved: null }).cells.status).text, 'Testing');
  assert.equal(RECORDS.experiments.keys.at(-1), 'source');
  const recs = adaptRecords('validate', 'experiments', { cols: COLS.experiments, rows: [] });
  assert.equal(recs.cols.at(-1).label, 'Source');
});

test('3: the four tiles, the fit line and the distance to the bar render from parts.stats and parts.fit_gap', () => {
  const html = ssr(h(HypothesesSection, { parts: HYP_PARTS, projectId: 7, query: { filter: {} }, openDialog: noop, onLoadLinkLists: noop, onLink: noop }));
  for (const label of ['Hypotheses', 'Awaiting evidence', 'Bar per claim', 'Verdict withheld']) assert.match(html, new RegExp(`>${label}<`));
  assert.match(html, /1 supported, 1 refuted/);
  assert.match(html, /<span class="font-semibold">3<\/span> interviews have no ICP fit recorded/);
  assert.match(html, /href="\/validate\/customer-research\?project_id=7"[^>]*>Record it on the interview</);
  assert.doesNotMatch(html, /\/build\/discovery/);
  assert.match(html, /H3<\/span> · 2 of 5 supporting ICP interviews · 1 interview with no fit recorded/);
  const none = ssr(h(HypothesesSection, { parts: { ...HYP_PARTS, stats: { ...HYP_PARTS.stats, withheld: 0, fit_not_recorded: 0 } }, query: { filter: {} }, openDialog: noop }));
  assert.doesNotMatch(none, /no ICP fit recorded\. Those/);
  assert.match(none, />Verdict withheld<\/div><div class="mt-1.5"><span[^>]*>Not recorded</, 'none withheld: absent, never 0');
});

test('3: each history view draws its note only when its window opens before history_since; the no-history note drops FVW\'s second sentence', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  const lastWeek = { history: 'last_week' }, month = { history: 'this_month' }, moved = { moved: 'recent' };
  // Since 10 Oct: last week's window (10 Oct 12:00) opens after it; the 14-day and month windows open before it.
  assert.deepEqual(historyNotes(lastWeek, '2026-10-10T09:00:00Z', now), []);
  assert.deepEqual(historyNotes(moved, '2026-10-10T09:00:00Z', now), ['Lane history starts 2026-10-10, so moves before that are not on record.']);
  assert.deepEqual(historyNotes(month, '2026-10-10T09:00:00Z', now), ['Status history starts 2026-10-10. Hypotheses with nothing on record that far back are left out rather than shown at today\'s status.']);
  assert.deepEqual(historyNotes(lastWeek, '2026-10-11T09:00:00Z', now), ['Status history starts 2026-10-11. Hypotheses with nothing on record that far back are left out rather than shown at today\'s status.']);
  // Changed this month opens on the 1st (UTC), not 30 days back: since 25 Sep reaches it, since 2 Oct does not.
  assert.deepEqual(historyNotes(month, '2026-09-25T00:00:00Z', now), []);
  assert.deepEqual(historyNotes(month, '2026-10-01T00:00:00Z', now), [], 'the 1st itself reaches');
  assert.equal(historyNotes(month, '2026-10-02T00:00:00Z', now).length, 1);
  // The history reaches back: no note for any view.
  for (const f of [lastWeek, month, moved]) assert.deepEqual(historyNotes(f, '2026-09-01T00:00:00Z', now), [], JSON.stringify(f));
  assert.deepEqual(historyNotes(moved, null, now), ['No lane history is on record yet.']);
  assert.deepEqual(historyNotes(lastWeek, null, now), ['No status history is on record yet.']);
  assert.deepEqual(historyNotes({}, null, now), [], 'no view chosen, no note');
  const html = ssr(h(HypothesesSection, { parts: { ...HYP_PARTS, stats: { ...HYP_PARTS.stats, history_since: null } }, query: { filter: lastWeek }, openDialog: noop }));
  assert.match(html, /No status history is on record yet\./);
  assert.doesNotMatch(html, /It starts the first time this board is opened/);
  assert.match(html, /Status from the recorded history · counts are current/);
  const monthHtml = ssr(h(HypothesesSection, { parts: HYP_PARTS, query: { filter: month }, openDialog: noop }));
  assert.doesNotMatch(monthHtml, /counts are current/, 'only As of last week reads last week\'s status');
});

test('3: Link to a pain reads the board when it opens, lists the unretired claims and the themes, and saves through the theme\'s link', async () => {
  const board = {
    hypotheses: [{ id: 3, code: 'H3', claim: 'Teams reconcile by hand' }, { id: 4, code: 'H4', claim: 'Retired one', retired_at: '2026-10-01' }],
    pain_groups: [{ id: 12, title: 'Manual reconciliation' }],
  };
  const m = await mounted('/validate/experiments?project_id=7', handlerFor('experiments',
    (url, opts) => (url.endsWith('/api/founder/validate/board/7') ? response(board) : opts.method === 'POST' ? response({ ok: true }) : null)));
  try {
    await m.press('validate-link-pain');
    await m.flush();
    const dialog = m.byTestid('dialog-link-pain') || m.nodes().find((n) => /link/i.test(m.props(n)?.['data-testid'] || '') && m.props(n)?.['data-testid'] !== 'validate-link-pain');
    assert.ok(dialog, 'the dialog opened');
    const fiberKey = Object.keys(dialog).find((k) => k.startsWith('__reactFiber$'));
    let f = dialog[fiberKey];
    while (f && f.type?.name !== 'LinkPainDialog') f = f.return;
    assert.ok(f, 'LinkPainDialog found');
    assert.deepEqual(f.memoizedProps.hypotheses.map((x) => x.id), [3], 'unretired claims only');
    assert.deepEqual(f.memoizedProps.painGroups, board.pain_groups);
    const before = moduleReads(m.requests, 'experiments');
    await m.run(() => f.memoizedProps.onSave(3, { pain_group_id: 12, direction: 'supports' }));
    await m.flush();
    const post = m.requests.find((r) => r.options.method === 'POST');
    assert.ok(post.url.endsWith('/api/cycles/validate/modules/problem-discovery/records/12/actions/link?project=7'), post.url);
    assert.deepEqual(JSON.parse(post.options.body), { hypothesis_id: 3, direction: 'supports' });
    assert.ok(moduleReads(m.requests, 'experiments') > before, 'the module is read again');
  } finally { await m.close(); }
});

test('3: a failed board read prints its sentence and opens nothing', async () => {
  const sentence = 'The board could not be read.';
  const m = await mounted('/validate/experiments?project_id=7', handlerFor('experiments',
    (url) => (url.endsWith('/api/founder/validate/board/7') ? response({ detail: sentence }, 500) : null)));
  try {
    await m.press('validate-link-pain');
    await m.flush();
    assert.match(m.text(), new RegExp(sentence));
    const fiberNames = [];
    for (const n of m.nodes()) { const k = Object.keys(n).find((x) => x.startsWith('__reactFiber$')); let f = k && n[k]; while (f) { if (f.type?.name) fiberNames.push(f.type.name); f = f.return; } }
    assert.equal(fiberNames.includes('LinkPainDialog'), false);
  } finally { await m.close(); }
});

test('3: New hypothesis is drawn while no form is registered, and saves through createHypothesis; with it registered the section draws none', async () => {
  const m = await mounted('/validate/experiments?project_id=7', handlerFor('experiments',
    (url, opts) => (opts.method === 'POST' ? response({ id: 9 }) : null)));
  try {
    await m.press('validate-new-hypothesis');
    const dialog = m.nodes().find((n) => /hypothesis/i.test(m.props(n)?.['data-testid'] || '') && m.props(n)?.['data-testid'] !== 'validate-new-hypothesis');
    assert.ok(dialog, 'the dialog opened');
    const fiberKey = Object.keys(dialog).find((k) => k.startsWith('__reactFiber$'));
    let f = dialog[fiberKey];
    while (f && f.type?.name !== 'NewHypothesisDialog') f = f.return;
    assert.ok(f, 'NewHypothesisDialog found');
    await m.run(() => f.memoizedProps.onSave({ claim: 'Finance leads pay to skip month-end' }));
    await m.flush();
    const post = m.requests.find((r) => r.options.method === 'POST');
    assert.ok(post.url.endsWith('/api/founder/validate/board/7/hypotheses'), post.url);
    assert.deepEqual(JSON.parse(post.options.body), { claim: 'Finance leads pay to skip month-end' });
  } finally { await m.close(); }
  const registered = ssr(h(HypothesesSection, { parts: HYP_PARTS, query: { filter: {} }, openDialog: noop, onLoadLinkLists: noop, onLink: noop }));
  assert.doesNotMatch(registered, /New hypothesis/);
  assert.match(read('pages/cycles/CycleRoute.jsx'), /onNewHypothesis=\{formFor\('validate', 'experiments'\) \? undefined : /);
});

// ---------------------------------------------------------------------------
// 4. Writers only
// ---------------------------------------------------------------------------

test('4: with can_write false, no write tool is drawn, whatever the read sends; the strips, the Ungrouped tile and More tools stay', () => {
  const reader = (parts) => ({ ...parts, can_write: false });
  const all = [
    ssr(h(InterviewsSection, { parts: reader(RESEARCH_PARTS), openDialog: noop, onLog: noop, onExport: noop })),
    ssr(h(PainThemesSection, { parts: reader(PAIN_PARTS), onExport: noop, onAssign: noop, newThemeHref: '/validate/problem-discovery/new?project_id=7' })),
    ssr(h(HypothesesSection, { parts: reader(HYP_PARTS), query: { filter: {} }, openDialog: noop, onLoadLinkLists: noop, onLink: noop, onNewHypothesis: noop })),
  ].join('\n');
  for (const tool of ['Log an interview', 'Export interviews', 'Export map', 'Open the Problem slide', 'Unthemed quotes', 'Assign to a theme', 'New theme', 'New hypothesis', 'Link to a pain', 'we lose a day']) {
    assert.doesNotMatch(all, new RegExp(tool), tool);
  }
  assert.match(all, />Ungrouped phrases</);
  assert.match(all, />Interviews logged</);
  assert.match(all, /More tools/);
  // Missing can_write is not a write gate either.
  const unsure = ssr(h(InterviewsSection, { parts: { stats: RESEARCH_PARTS.stats }, openDialog: noop, onLog: noop, onExport: noop }));
  assert.doesNotMatch(unsure, /Log an interview/);
});

test('4: a reader\'s ?log=notes opens nothing', async () => {
  const m = await mounted('/validate/customer-research?log=notes&project_id=7', handlerFor('customer-research',
    (url) => (url.includes('/cycles/validate/modules/customer-research?') ? response(moduleRead('customer-research', { ...RESEARCH_PARTS, can_write: false })) : null)));
  try { assert.equal(m.byTestid('modal-log-interview'), null); } finally { await m.close(); }
});

// ---------------------------------------------------------------------------
// 5. One vocabulary
// ---------------------------------------------------------------------------

test('5: the sections and the adapters draw no Validated, Invalidated or Unproven, over every status', () => {
  const statuses = ['supported', 'refuted', 'testing', 'untested', 'inconclusive', 'not_recorded'];
  const cells = statuses.flatMap((status) => [false, true].map((retired) => cellView(RECORDS.experiments.row({ id: 1, status, retired, moved: 'recent' }).cells.status).text));
  const filters = adaptRecords('validate', 'experiments', { cols: COLS.experiments, rows: [] }).filters.flatMap((f) => [f.label, ...f.options.map((o) => o.label)]);
  const html = [
    ssr(h(InterviewsSection, { parts: RESEARCH_PARTS, openDialog: noop, onLog: noop, onExport: noop })),
    ssr(h(PainThemesSection, { parts: PAIN_PARTS, onExport: noop, onAssign: noop })),
    ...[{}, { history: 'last_week' }, { history: 'this_month' }, { moved: 'recent' }, { status: 'retired' }]
      .map((filter) => ssr(h(HypothesesSection, { parts: HYP_PARTS, query: { filter }, openDialog: noop, onLoadLinkLists: noop, onLink: noop, onNewHypothesis: noop }))),
  ].join('\n');
  const text = [html, ...cells, ...filters].join('\n');
  assert.doesNotMatch(text, /Validated|Invalidated|Unproven/);
  assert.doesNotMatch(read('pages/cycles/ValidateSections.jsx').replace(/\/\*[\s\S]*?\*\//g, ''), /Validated|Invalidated|Unproven/);
});

// ---------------------------------------------------------------------------
// 6. The sections read nothing and draw no dialog in place
// ---------------------------------------------------------------------------

test('6: ValidateSections.jsx imports no api module, makes every write a callback and opens every dialog through openDialog', () => {
  const src = read('pages/cycles/ValidateSections.jsx');
  const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.equal(imports.some((p) => /lib\/api/.test(p)), false, imports.join(', '));
  assert.doesNotMatch(src, /\bfetch\(|\bapi\.|cyclesApi|cyclesWrite/);
  // Each dialog element is built only as openDialog's argument.
  for (const dialog of ['LogInterviewModal', 'LinkPainDialog', 'NewHypothesisDialog']) {
    const uses = [...src.matchAll(new RegExp(`<${dialog}\\b`, 'g'))].map((m) => m.index);
    assert.ok(uses.length >= 1, dialog);
    for (const at of uses) assert.match(src.slice(Math.max(0, at - 40), at), /openDialog\(\s*$/, `${dialog} is opened through openDialog`);
  }
});

test('6: mounted at ?log=notes, LogInterviewModal renders after the size container, outside cycle-route-body', async () => {
  const m = await mounted('/validate/customer-research?log=notes&project_id=7', handlerFor('customer-research'));
  try {
    const body = m.byTestid('cycle-route-body');
    assert.ok(body, 'the body');
    const modal = m.byTestid('modal-log-interview');
    assert.ok(modal, 'the modal');
    assert.equal(m.nodes(body).includes(modal), false, 'not inside the body');
    const container = body.parentNode;
    assert.equal(m.nodes(container).includes(modal), false, 'not inside the size container');
    // It sits after the container, beside the action Mount.
    const frameKids = container.parentNode.childNodes;
    assert.ok(frameKids.indexOf(container) < frameKids.findIndex((k) => m.nodes(k).includes(modal)));
  } finally { await m.close(); }
});
