/**
 * D1297 (#3393, part 7 of #2383) — the Content queue's Authors (ART9, ART10)
 * and Performance (ART11, ART12) tabs, and their phone layout (ART18), from
 * D1294's two reads. Fixtures only; the reads' own rules are D1294's tests.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/content_queue_stats_d1297.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { adminArticles } from '../src/lib/api.js';
import ArticlesQueuePage from '../src/pages/admin/ArticlesQueuePage.jsx';
import AuthorsTab from '../src/pages/admin/contentQueue/AuthorsTab.jsx';
import PerformanceTab from '../src/pages/admin/contentQueue/PerformanceTab.jsx';
import {
  NOT_RECORDED, authorRow, authorsView, filterAuthors, hoursWord, pageOf, performanceView, rangeFor,
} from '../src/pages/admin/contentQueue/statsModel.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const text = (n) => n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '';
const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const byId = (root, id) => walk(root).find((n) => props(n)['data-testid'] === id);

// ───────────────────────────────────────────── fixtures (synthetic, no person)

const author = (id, over = {}) => ({
  user_id: id, name: `Synthetic Author ${id}`, role: 'founder', stages: {}, published: 0, waiting: 0, rejected: 0,
  views_all_time: 0, followers: 0, this_week: { used: 0, limit: 3, at_limit: false },
  last_submitted_at: '2026-10-01 09:00:00', first_submitted_at: '2026-01-05 09:00:00',
  approval: { approved: 0, decided: 0 }, median_hours_to_decision: null, decisions_timed: 0, ...over,
});

const AUTHORS = {
  authors: [
    author(11, { published: 4, waiting: 1, rejected: 1, views_all_time: 1520, followers: 12, approval: { approved: 4, decided: 5 }, median_hours_to_decision: 50, this_week: { used: 3, limit: 3, at_limit: true } }),
    author(12, { name: 'Another Writer', role: 'investor', published: 0, waiting: 2, followers: null, last_submitted_at: '2026-10-20 09:00:00' }),
    author(13, { published: 9, views_all_time: 90, followers: 0 }),
  ],
  summary: { with_published: 2, new_last_90_days: 1, waiting_from_first_time: 2, at_weekly_limit: 1 },
  submissions_per_week: 3,
  followers_read: true,
  views_note: 'Views, all time, count every load of the article, admins’ included.',
};

const week = (w, over = {}) => ({ week: w, from: w, to: w, published: 0, submitted: 0, approved: 0, rejected: 0, changes_requested: 0, views: null, views_partial: false, ...over });
const NR = {
  unique_readers: 'Not recorded: needs a reader-analytics decision.',
  read_through: 'Not recorded: needs a reader-analytics decision.',
  sources: 'Not recorded: daily views keep no referrer.',
  newsletter_clicks: 'Not recorded: needs a reader-analytics decision.',
};
/** Before migration 637's first daily row: no view is known. */
const BEFORE = {
  from: '2026-08-03', to: '2026-10-26', views_recorded_since: null,
  views_reason: 'Not recorded: views are counted per day from the first read after migration 637.',
  weeks: [week('2026-10-12', { published: 2, submitted: 3, approved: 2, changes_requested: 1 }), week('2026-10-19', { published: 1, submitted: 2, rejected: 1 })],
  views_by_sector: null,
  // D1332: the top articles rank by views all time, so they show before the daily count starts.
  top_articles: [{ id: 7, title: 'Pricing before product', author_name: 'Synthetic Author 11', published_at: '2026-10-13 08:00:00', read_minutes: 6, views_all_time: 1240, views_per_day: 88.6 }],
  top_articles_of: 148,
  decisions: { median_hours_to_decision: 30, timed: 3, note: 'Change requests are counted per week, not timed.' },
  follower_reach: { publishes_recorded: 0, followers: 0, notified: 0, note: 'No publish before migration 637 has a reach.' },
  not_recorded: NR,
};
/** After it: the start week partial, a later week a real 0. */
const AFTER = {
  ...BEFORE, views_recorded_since: '2026-10-14', views_reason: null,
  weeks: [week('2026-10-12', { published: 2, views: 40, views_partial: true }), week('2026-10-19', { views: 0 })],
  views_by_sector: [{ sector: 'B2B software', views: 30 }, { sector: null, views: 10 }],
  follower_reach: { publishes_recorded: 2, followers: 20, notified: 18, note: null },
};

// ───────────────────────────────────────────── the model

test('an author row: unknown is never 0, and a failed follows read says so', () => {
  const r = authorRow(AUTHORS.authors[0]);
  assert.equal(r.approval, '80%');
  assert.equal(r.views, '1,520');
  assert.equal(r.week, '3 of 3');
  assert.equal(r.atLimit, true);
  assert.equal(r.medianDecision, '2 days');
  assert.equal(r.lastSubmitted, '1 Oct 2026');
  // Mutation checked: `?? 0` on followers → "0", not "Couldn’t be read".
  assert.equal(authorRow(AUTHORS.authors[1]).followers, 'Couldn’t be read');
  assert.equal(authorRow(AUTHORS.authors[1]).followersN, null);
  assert.equal(authorRow(AUTHORS.authors[0], false).followers, 'Couldn’t be read');
  assert.equal(authorRow(AUTHORS.authors[2]).followers, '0', 'a real 0 stays 0');
  assert.equal(authorRow(AUTHORS.authors[1]).approval, 'No decisions yet');
  assert.equal(authorRow({ user_id: 5 }).views, NOT_RECORDED);
  assert.equal(hoursWord(5), '5 hours');
  assert.equal(hoursWord(null), null);
});

test('the tiles, the states, the filters, the sort and the pages', () => {
  assert.equal(authorsView({ status: 'loading' }).status, 'loading');
  assert.equal(authorsView({ status: 'unreadable' }).status, 'unreadable');
  assert.equal(authorsView({ status: 'ready', data: { ...AUTHORS, authors: [] } }).status, 'empty');
  const v = authorsView({ status: 'ready', data: AUTHORS });
  assert.deepEqual(v.tiles.map((t) => t.value), ['2', '1', '2', '1']);
  assert.equal(v.tiles[3].sub, '3 submissions in 7 days');
  assert.equal(authorsView({ status: 'ready', data: { ...AUTHORS, summary: {} } }).tiles[0].value, NOT_RECORDED);

  assert.deepEqual(filterAuthors(v.rows, {}).map((r) => r.id), [13, 11, 12]);
  assert.deepEqual(filterAuthors(v.rows, { waiting: true }).map((r) => r.id), [11, 12]);
  assert.deepEqual(filterAuthors(v.rows, { role: 'investor' }).map((r) => r.id), [12]);
  assert.deepEqual(filterAuthors(v.rows, { q: 'another' }).map((r) => r.id), [12]);
  assert.deepEqual(filterAuthors(v.rows, { sort: 'last' }).map((r) => r.id), [12, 11, 13]);
  // Mutation checked: an unread follower count sorted as 0 → 12 ties with 13 and sorts above it by name.
  assert.deepEqual(filterAuthors(v.rows, { sort: 'followers' }).map((r) => r.id), [11, 13, 12]);

  const many = Array.from({ length: 37 }, (_, i) => ({ id: i }));
  assert.equal(pageOf(many, 1, 25).range, '1–25 of 37');
  assert.deepEqual([pageOf(many, 2, 25).range, pageOf(many, 2, 25).pages], ['26–37 of 37', 2]);
  assert.equal(pageOf(many, 9, 25).page, 2, 'a page past the end is the last');
  assert.equal(pageOf([], 1, 25).range, '0 of 0');
});

test('the periods: the Worker’s default sends nothing; others stay within 400 days', () => {
  const today = new Date(Date.UTC(2026, 9, 27, 15));
  assert.deepEqual(rangeFor('12w', today), {});
  assert.deepEqual(rangeFor('30d', today), { from: '2026-09-28', to: '2026-10-27' });
  assert.deepEqual(rangeFor('12m', today), { from: '2025-10-28', to: '2026-10-27' });
});

test('Performance before the daily count: views Not recorded with the reason, never 0', () => {
  const v = performanceView({ status: 'ready', data: BEFORE });
  const views = v.tiles.find((t) => t.key === 'views');
  // Mutation checked: summing null weeks as 0 → the tile reads "0".
  assert.equal(views.value, NOT_RECORDED);
  assert.equal(views.sub, BEFORE.views_reason);
  assert.equal(v.viewsKnown, false);
  assert.equal(v.summaries.views, null);
  assert.equal(v.sectors, null);
  // D1332: the top articles rank by views all time, so they do not wait on the daily count.
  assert.equal(v.top[0].views, '1,240');
  assert.equal(v.topOf, '1–1 of 148');
  assert.equal(v.tiles.find((t) => t.key === 'published').value, '3');
  assert.equal(v.tiles.find((t) => t.key === 'decision').value, '1 day');
  assert.match(v.summaries.decided, /5 submitted\. Reviews ended in 2 approvals, 1 change requests and 1 rejections\./);
  assert.deepEqual(v.notRecorded.map((n) => n.title), ['Unique readers', 'How far people read', 'Where readers came from', 'Newsletter clicks']);
  assert.equal(performanceView({ status: 'unreadable' }).status, 'unreadable');
  assert.equal(performanceView({ status: 'ready', data: { ...BEFORE, decisions: {} } }).tiles.find((t) => t.key === 'decision').value, NOT_RECORDED);
});

test('Performance after it: the partial week, a real 0, sectors and the top articles', () => {
  const v = performanceView({ status: 'ready', data: AFTER });
  assert.equal(v.tiles.find((t) => t.key === 'views').value, '40');
  assert.equal(v.tiles.find((t) => t.key === 'views').sub, 'Counted from 14 Oct 2026', 'the start week is partial');
  assert.deepEqual(v.weeks.map((w) => [w.views, w.partial]), [[40, true], [0, false]]);
  assert.deepEqual(v.sectors, [{ sector: 'B2B software', views: 30 }, { sector: 'No sector', views: 10 }]);
  assert.deepEqual(v.top[0], { rank: 1, id: 7, title: 'Pricing before product', author: 'Synthetic Author 11', published: '13 Oct 2026', views: '1,240', perDay: '88.6', read: '6 min' });
  assert.equal(performanceView({ status: 'ready', data: { ...AFTER, top_articles: [{ ...AFTER.top_articles[0], views_per_day: null }] } }).top[0].perDay, NOT_RECORDED, 'no publish date: no rate, never 0');
  assert.equal(v.tiles.find((t) => t.key === 'reach').value, '18');
});

// ───────────────────────────────────────────── the tabs, rendered

async function mount(el, path = '/admin/articles/authors') {
  const restore = installDocument();
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: [path] }, el)));
  return {
    container,
    by: (id) => byId(container, id),
    text: (id) => text(byId(container, id) || { textContent: '' }),
    async click(n) { assert.ok(n, 'the control'); await act(async () => props(n).onClick({ preventDefault() {} })); },
    async change(n, value) { await act(async () => props(n).onChange({ target: { value, checked: value } })); },
    async done() { await act(async () => root.unmount()); restore(); },
  };
}

test('Authors: tiles, the table and cards, the row menu and the drawer', async () => {
  const w = await mount(React.createElement(AuthorsTab, { load: async () => AUTHORS }));
  try {
    assert.ok(w.text('authors-tiles').includes('Authors with a published article'));
    assert.ok(w.text('authors-tiles').includes('3 submissions in 7 days'));
    assert.ok(w.by('authors-table') && w.by('authors-cards'), 'a table and cards, one per width');
    assert.equal(w.text('authors-range'), '1–3 of 3');
    assert.ok(w.text('author-row-12').includes('Couldn’t be read'));
    assert.ok(w.text('author-week-11').includes('3 of 3 · at the limit'));
    assert.ok(!w.text('author-week-13').includes('at the limit'));
    assert.ok(w.text('authors-views-note').includes('admins’ included'));

    await w.click(w.by('author-menu-11'));
    assert.equal(props(w.by('author-account-11')).href, '/admin/accounts/all/11');
    assert.equal(props(w.by('author-public-11')).href, '/authors/11');
    await w.click(w.by('author-open-11'));
    const drawer = w.text('author-drawer');
    assert.ok(drawer.includes('Synthetic Author 11, author'));
    // D1317: the author drawer is the shared Sheet, 640px.
    assert.equal(props(w.by('author-drawer')).role, 'dialog');
    assert.ok(props(w.by('author-drawer'))['aria-labelledby']);
    assert.equal(props(w.by('author-drawer'))['data-width'], 640);
    assert.ok(w.text('author-facts').includes('Writing since5 Jan 2026'));
    assert.ok(w.text('author-drawer-wait').includes('not read here yet'));

    await w.change(w.by('authors-waiting'), true);
    assert.equal(w.text('authors-range'), '1–2 of 2');
    await w.change(w.by('authors-search'), 'nobody');
    assert.ok(w.by('authors-no-match'));
  } finally { await w.done(); }
});

test('Authors: a failed read says so and offers Try again; none yet is not a failure', async () => {
  let calls = 0;
  const w = await mount(React.createElement(AuthorsTab, { load: async () => { calls += 1; if (calls === 1) throw new Error('x'); return AUTHORS; } }));
  try {
    assert.ok(w.text('authors-unreadable').includes('not the same as there being none'));
    const retry = walk(w.by('authors-unreadable')).find((n) => text(n) === 'Try again' && props(n).onClick);
    await w.click(retry);
    assert.equal(calls, 2);
    assert.ok(w.by('authors-table'));
  } finally { await w.done(); }
  const e = await mount(React.createElement(AuthorsTab, { load: async () => ({ ...AUTHORS, authors: [] }) }));
  try { assert.ok(e.by('authors-empty')); assert.ok(!e.by('authors-unreadable')); } finally { await e.done(); }
});

test('Performance before the daily store: views, sectors and top articles say Not recorded', async () => {
  const asked = [];
  const w = await mount(React.createElement(PerformanceTab, { load: async (r) => { asked.push(r); return BEFORE; }, today: new Date(Date.UTC(2026, 9, 27)) }), '/admin/articles/performance');
  try {
    assert.deepEqual(asked, [{}], 'the default period sends no range');
    assert.ok(w.text('perf-tiles-views').includes(NOT_RECORDED));
    assert.doesNotMatch(w.text('perf-tiles-views'), /\b0\b/);
    for (const id of ['views', 'sectors']) assert.ok(w.text(`perf-nr-${id}`).includes('migration 637'), id);
    assert.ok(!w.by('perf-nr-top'), 'D1332: the top articles do not wait on the daily count');
    assert.ok(w.text('perf-not-recorded').includes('left out rather than shown as zero'));
    assert.ok(w.by('perf-nr-item-unique_readers'));

    // View as table: the same numbers as rows.
    assert.ok(!w.by('perf-table-decided'));
    await w.click(w.by('perf-table-toggle-decided'));
    const table = w.text('perf-table-decided');
    assert.ok(table.includes('Changes requested') && table.includes('12 Oct'));

    await w.click(w.by('perf-period-30d'));
    assert.deepEqual(asked[1], { from: '2026-09-28', to: '2026-10-27' });
  } finally { await w.done(); }
});

test('Performance after it, and a failed read with Try again', async () => {
  const w = await mount(React.createElement(PerformanceTab, { load: async () => AFTER }), '/admin/articles/performance');
  try {
    assert.ok(w.text('perf-tiles-views').includes('40'));
    assert.ok(!w.by('perf-nr-views'));
    await w.click(w.by('perf-table-toggle-views'));
    assert.ok(w.text('perf-table-views').includes('(counted from mid-week)'));
    assert.ok(w.text('perf-top-table').includes('Pricing before product'));
  } finally { await w.done(); }
  // D1332: the canvas's two columns, ranked by views all time, with the count of all published.
  const b = await mount(React.createElement(PerformanceTab, { load: async () => BEFORE }), '/admin/articles/performance');
  try {
    const top = b.text('perf-top-table');
    assert.ok(top.includes('Views, all time ↓') && top.includes('Views per day since publish'), top);
    assert.ok(top.includes('1,240') && top.includes('88.6'), 'all-time views and the rate, before the daily count starts');
    assert.equal(b.text('perf-top-of'), '1–1 of 148');
    assert.ok(b.text('perf-top-cards').includes('1,240 views all time · 88.6 a day'));
  } finally { await b.done(); }
  let n = 0;
  const f = await mount(React.createElement(PerformanceTab, { load: async () => { n += 1; if (n === 1) throw new Error('x'); return BEFORE; } }), '/admin/articles/performance');
  try {
    assert.ok(f.text('perf-unreadable').includes('Could not be read'));
    await f.click(walk(f.by('perf-unreadable')).find((x) => text(x) === 'Try again' && props(x).onClick));
    assert.ok(f.by('content-queue-performance'));
  } finally { await f.done(); }
});

test('the queue page mounts both tabs at their addresses', async () => {
  const original = { ...adminArticles };
  adminArticles.authors = async () => AUTHORS;
  adminArticles.performance = async () => BEFORE;
  adminArticles.queue = async () => ({ items: [] });
  try {
    for (const [tab, id] of [['authors', 'content-queue-authors'], ['performance', 'content-queue-performance']]) {
      const restore = installDocument();
      const container = document.createElement('div');
      const root = createRoot(container);
      await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: [`/admin/articles/${tab}`] },
        React.createElement(Routes, null, React.createElement(Route, { path: '/admin/articles/:view', element: React.createElement(ArticlesQueuePage) })))));
      // Mutation checked: leave the QueueWait mount → no tab, a wait card.
      assert.ok(byId(container, id), tab);
      assert.ok(!byId(container, `content-queue-wait-${tab}`), tab);
      await act(async () => root.unmount());
      restore();
    }
  } finally { Object.assign(adminArticles, original); }
});

test('the phone (ART18, 390px): cards and a bottom sheet below md, 44px targets', async () => {
  const src = read('frontend/src/pages/admin/contentQueue/AuthorsTab.jsx');
  // Mutation checked: drop `md:hidden` from the cards → both layouts at every width.
  assert.match(src, /md:hidden" data-testid="authors-cards"/);
  assert.match(src, /hidden overflow-x-auto md:block/);
  assert.match(src, /phone="sheet"[^\n]*testId="authors-filters-sheet"/);
  assert.match(read('frontend/src/pages/admin/contentQueue/PerformanceTab.jsx'), /md:hidden" data-testid="perf-top-cards"/);
  const w = await mount(React.createElement(AuthorsTab, { load: async () => AUTHORS }));
  try {
    await w.click(w.by('authors-filters-open'));
    assert.ok(w.by('authors-filters-sheet'), 'Filters and sort opens a sheet, not a pop-up');
    assert.equal(w.text('authors-filters-show'), 'Show 3 authors');
    for (const id of ['authors-filters-open', 'authors-filters-show', 'author-menu-11']) {
      assert.match(String(props(w.by(id)).className), /min-h-\[44px\]|h-11/, id);
    }
  } finally { await w.done(); }
});
