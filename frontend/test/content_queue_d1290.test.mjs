/**
 * D1290 (#2383) — HQ › Content › Content queue, S21's integration of the
 * owner's canvas (ART1–ART18): four tabs at their own addresses, one address
 * per article, the shared header, and a tab whose build is a slot task saying
 * what it waits on rather than drawing an empty board.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/content_queue_d1290.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { adminArticles } from '../src/lib/api.js';
import ArticlesQueuePage from '../src/pages/admin/ArticlesQueuePage.jsx';
import { QUEUE_TABS, WAITS, articleHref, viewOf } from '../src/pages/admin/contentQueueModel.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const text = (n) => n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '';
const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const byId = (root, id) => walk(root).find((n) => props(n)['data-testid'] === id);

test('the addresses: four tabs, and one per article', () => {
  assert.deepEqual(QUEUE_TABS.map((t) => t.to), ['/admin/articles', '/admin/articles/calendar', '/admin/articles/authors', '/admin/articles/performance']);
  assert.deepEqual(viewOf('/admin/articles'), { tab: 'pipeline', id: null });
  assert.deepEqual(viewOf('/admin/articles/'), { tab: 'pipeline', id: null });
  assert.deepEqual(viewOf('/admin/articles/calendar'), { tab: 'calendar', id: null });
  assert.deepEqual(viewOf('/admin/articles/performance'), { tab: 'performance', id: null });
  // Mutation checked: accept any segment as an id → 'pipeline' gets NaN, not null.
  assert.deepEqual(viewOf('/admin/articles/42'), { tab: 'pipeline', id: 42 });
  assert.deepEqual(viewOf('/admin/articles/pipeline'), { tab: 'pipeline', id: null });
  assert.deepEqual(viewOf('/admin/articles/0'), { tab: 'pipeline', id: null });
  assert.deepEqual(viewOf('/admin/articles/12abc'), { tab: 'pipeline', id: null });
  assert.equal(articleHref(42), '/admin/articles/42');
});

test('App.jsx serves the sub-paths, and the review notices link one article', () => {
  // Mutation checked: drop the route → /admin/articles/42 has no page.
  assert.match(read('frontend/src/App.jsx'), /path="\/admin\/articles\/:view" element=\{guard\(\['admin'\], <ArticlesQueuePage \/>\)\}/);
  for (const f of ['cloudflare-worker/src/services/articleNotify.ts', 'cloudflare-worker/src/services/newsNotify.ts']) {
    assert.match(read(f), /const link = `\/admin\/articles\/\$\{args\.articleId\}`;/, f);
  }
});

const ROW = { id: 42, title: 'Pricing before product', status: 'submitted', author_name: 'Synthetic Author', word_count: 900, submitted_at: '2026-10-20T10:00:00Z' };

async function mount(path) {
  const restore = installDocument();
  const original = { ...adminArticles };
  const calls = { queue: 0, get: [] };
  adminArticles.queue = async () => { calls.queue += 1; return { items: [ROW] }; };
  adminArticles.get = async (id) => { calls.get.push(id); return { article: { ...ROW, body_markdown: 'Body.' }, revisions: [], comments: [] }; };
  const container = document.createElement('div');
  const root = createRoot(container);
  const at = { path };
  function Probe() { at.path = useLocation().pathname; return null; }
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: [path] },
    React.createElement(Routes, null,
      React.createElement(Route, { path: '/admin/articles/:view', element: React.createElement(ArticlesQueuePage) }),
      React.createElement(Route, { path: '/admin/articles', element: React.createElement(ArticlesQueuePage) })),
    React.createElement(Probe))));
  return {
    container, calls, at,
    async click(n) { await act(async () => props(n).onClick({ preventDefault() {} })); },
    async done() { await act(async () => root.unmount()); Object.assign(adminArticles, original); restore(); },
  };
}

test('Pipeline: the shared header with four tabs, plain words, and today\'s queue', async () => {
  const w = await mount('/admin/articles');
  try {
    const header = byId(w.container, 'content-queue-header');
    assert.ok(header, 'the shared header');
    assert.ok(text(header).includes('Content queue'));
    for (const t of QUEUE_TABS) assert.ok(byId(w.container, `content-queue-tab-${t.key}`), t.key);
    // #2383 item 14: no "bursts the 60-day edge cache".
    assert.doesNotMatch(text(w.container), /edge cache/);
    assert.ok(text(w.container).includes('Pricing before product'));
    assert.equal(w.calls.get.length, 0, 'no article open on the bare address');
  } finally { await w.done(); }
});

test('an article address opens that article\'s review', async () => {
  const w = await mount('/admin/articles/42');
  try {
    // Mutation checked: keep selection in state → nothing is read for the address.
    assert.deepEqual(w.calls.get, [42]);
    // D1317: the article opens as the shared Sheet over the full-width queue, 760px.
    const sheet = byId(w.container, 'article-review');
    assert.equal(props(sheet).role, 'dialog');
    assert.ok(props(sheet)['aria-labelledby']);
    assert.equal(props(sheet)['data-width'], 760);
    assert.match(text(sheet), /Pricing before product/);
    assert.match(text(sheet), /Body\./);
    assert.ok(text(w.container).split('Pricing before product').length > 2, 'the queue stays drawn under the sheet');
    await w.click(byId(w.container, 'article-review-close'));
    assert.equal(w.at.path, '/admin/articles', 'closing returns to the queue');
    assert.equal(byId(w.container, 'article-review'), undefined);
  } finally { await w.done(); }
});

// D1296 builds Calendar and D1297 builds Authors and Performance, so none of the four tabs waits.
// content_calendar_d1296.test.mjs mounts Calendar; content_queue_stats_d1297.test.mjs holds the other two.
test('D1296 and D1297 drew Calendar, Authors and Performance: none of them waits', () => {
  // Mutation checked: put calendar back into WAITS → this key list is no longer empty.
  assert.deepEqual(Object.keys(WAITS), []);
});
