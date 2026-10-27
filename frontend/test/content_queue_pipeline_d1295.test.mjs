/**
 * D1295 (#3391, part 5 of #2383) — Pipeline as the canvas draws it: the board
 * by stage and the list (ART1, ART2), the review drawer at
 * `/admin/articles/<id>` (ART3–ART5), its in-page dialogs (ART6), the states
 * (ART13–ART15), the Admin's view (ART16) and no permission (ART17).
 *
 * Mounted at `/admin/articles` and `/admin/articles/<id>` on a stubbed
 * `fetch`, so every read and change goes through the real client to a URL.
 * Synthetic data only.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/content_queue_pipeline_d1295.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import ArticlesQueuePage from '../src/pages/admin/ArticlesQueuePage.jsx';
import ContentQueueBoundary from '../src/pages/admin/contentQueue/NoPermission.jsx';
import {
  NO_PERMISSION, actionsFor, anchorFor, compareLines, countOf, dialogFor, listStateOf, paragraphsOf, queueParams, rangeText,
  reasonOk, refusalText, searchOf, stageOf, threadsOf, waitText,
} from '../src/pages/admin/contentQueue/pipelineModel.js';
import { hqLine, hqLinks } from '../src/pages/hq/hqNoticeModel.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-27T12:00:00Z');

/* ------------------------------------------------------------------ *
 * Fixtures: what D1291's queue and D1293's article read return
 * ------------------------------------------------------------------ */

const ADMIN = { id: 7, role: 'admin', is_super_admin: 0, name: 'Synthetic Admin' };
const SUPER = { id: 8, role: 'admin', is_super_admin: 1, name: 'Synthetic Holder' };
const row = (id, status, extra = {}) => ({ id, title: `Article ${id}`, status, author_user_id: 50 + id, author_name: `Author ${id}`, sector: 'Climate', word_count: 900, open_comments: 0, rounds: 1, submitted_at: '2026-10-23T12:00:00Z', ...extra });
const ITEMS = [
  row(1, 'submitted', { stage: 'submitted', submitted_at: '2026-10-23T12:00:00Z' }),
  row(2, 'submitted', { stage: 'submitted', submitted_at: '2026-10-26T12:00:00Z', open_comments: 2, rounds: 3 }),
  row(3, 'in_review', { stage: 'in_review', reviewer_name: 'Synthetic Admin', reviewer_user_id: 7 }),
  row(4, 'approved', { stage: 'ready', approved_at: '2026-10-20T09:00:00Z' }),
  row(5, 'approved', { stage: 'scheduled', publish_at: '2026-10-30T08:00:00Z' }),
];
const COUNTS = { available: true, reason: null, total: 47, stages: {
  submitted: { count: 9, oldest_hours: 96, oldest_reason: null }, in_review: { count: 3, oldest_hours: 30, oldest_reason: null },
  changes_requested: { count: 0, oldest_hours: null, oldest_reason: 'Nothing in this stage' }, ready: { count: 1, oldest_hours: 170, oldest_reason: null },
  scheduled: { count: 1, oldest_hours: 2, oldest_reason: null }, published: { count: 30, oldest_hours: null, oldest_reason: 'A published article is not waiting' },
  rejected: { count: 3, oldest_hours: null, oldest_reason: 'A rejected article is not waiting' },
} };
const MD = 'Most seed teams hire an operator too late.\n\nAn operator is not a COO in waiting. At this stage they turn decisions into routines.\n\nCheck in after six weeks.';
const ARTICLE = (extra = {}) => ({
  article: { id: 42, title: 'Hiring your first operator', status: 'in_review', author_user_id: 60, author_name: 'Synthetic Author', author_role: 'founder',
    body_markdown: MD, rendered_html: '<p>Most seed teams hire an operator too late.</p>', word_count: 1840, read_minutes: 8, slug: 'hiring', tags: [], views: 12, ...extra },
  revisions: [{ id: 1, rev: 2, reason: 'Submitted', status_at_save: 'submitted', saved_by_name: 'Synthetic Author', created_at: '2026-10-12T09:00:00Z' },
    { id: 2, rev: 4, reason: 'Edited', status_at_save: 'submitted', saved_by_name: null, created_at: '2026-10-17T09:00:00Z' }],
  comments: [
    { id: 11, body: 'Define “operator” once, early.', anchor: '¶ 2: “An operator is not a COO in waiting…”', author_name: 'Synthetic Admin', created_at: '2026-10-18T09:00:00Z', parent_id: null, resolved_at: null },
    { id: 12, body: 'Fair, will do.', anchor: null, author_id: 60, author_name: 'Synthetic Author', created_at: '2026-10-18T10:00:00Z', parent_id: 11, resolved_at: null },
    { id: 13, body: 'Needs a source.', anchor: null, author_name: 'Synthetic Admin', created_at: '2026-10-18T11:00:00Z', parent_id: null, resolved_at: '2026-10-19T09:00:00Z', resolved_by_name: 'Synthetic Admin' },
  ],
  follower_reach: [],
});

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function Probe({ into }) { into.current = useLocation(); return null; }

async function mount(path, { user = ADMIN, queue, article, onPost } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const calls = [];
  globalThis.fetch = async (u, init = {}) => {
    const url = new URL(String(u), 'http://x');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });
    if (url.pathname.endsWith('/auth/me')) return json(user);
    if (url.pathname === '/api/client-error') return json({});
    if (url.pathname === '/api/admin/articles/queue') return queue ? queue(calls.at(-1)) : json({ items: ITEMS, total: ITEMS.length, limit: 100, offset: 0, counts: COUNTS });
    if (/^\/api\/admin\/articles\/42\/revisions\/\d+$/.test(url.pathname)) {
      const rev = Number(url.pathname.split('/').pop());
      return json({ revision: { rev, body_markdown: rev === 2 ? 'Line one\nOld line' : 'Line one\nNew line' } });
    }
    if (url.pathname === '/api/admin/articles/42' && method === 'GET') return article ? article(calls) : json(ARTICLE());
    if (method !== 'GET') return onPost ? onPost(calls.at(-1)) : json({ ok: true });
    return json({ detail: 'Not found' }, 404);
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(user));
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const n = create(tag); n.querySelector = () => null; n.querySelectorAll = () => []; n.focus = () => {}; n.children = []; return n; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const loc = { current: null };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [path] }, h(AuthProvider, null,
    h(Probe, { into: loc }),
    h(Routes, null,
      h(Route, { path: '/admin/articles/:view', element: h(ArticlesQueuePage) }),
      h(Route, { path: '/admin/articles', element: h(ArticlesQueuePage) }))))));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join(' ') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const v = {
    calls, loc, by, props, has: (id) => Boolean(by(id)),
    of: (id) => { const n = by(id); assert.ok(n, `no ${id}`); return text(n).replace(/\s+/g, ' ').trim(); },
    page: () => text(container).replace(/\s+/g, ' ').trim(),
    async click(id) { const n = by(id); assert.ok(n, `no ${id}`); assert.ok(!props(n).disabled, `${id} is disabled`); await act(async () => { await props(n).onClick?.({ preventDefault() {} }); }); await flush(); },
    async type(id, value) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => props(n).onChange({ target: { value, checked: value } })); await flush(); },
    async submit(id) { const n = by(id); await act(async () => props(n).onSubmit({ preventDefault() {} })); await flush(); },
    disabled: (id) => Boolean(props(by(id)).disabled),
    posts: () => calls.filter((c) => c.method !== 'GET'),
    queues: () => calls.filter((c) => c.path === '/api/admin/articles/queue'),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
  return v;
}

/* ------------------------------------------------------------------ *
 * The rules
 * ------------------------------------------------------------------ */

test('stages: approved splits into Ready and Scheduled; each wait is read, never guessed', () => {
  assert.equal(stageOf({ status: 'approved', publish_at: null }), 'ready');
  assert.equal(stageOf({ status: 'approved', publish_at: '2026-10-30T08:00:00Z' }), 'scheduled');
  assert.equal(stageOf({ stage: 'scheduled', status: 'approved' }), 'scheduled');
  assert.equal(stageOf({ status: 'draft' }), null);
  assert.equal(waitText(ITEMS[0], NOW), 'Waiting 4 days');
  assert.equal(waitText({ status: 'submitted', submitted_at: '2026-10-27T03:00:00Z' }, NOW), 'Waiting 9 hours');
  assert.equal(waitText({ status: 'submitted', submitted_at: null }, NOW), 'Waiting · submitted time not recorded');
  assert.equal(waitText(ITEMS[2], NOW), 'Reviewer: Synthetic Admin');
  assert.equal(waitText({ status: 'changes_requested' }, NOW), 'With the author', 'no column records when, so no date is made up');
  assert.match(waitText(ITEMS[4], NOW), /^Goes out Fri 30 Oct, 08:00 UTC$/);
  assert.equal(waitText({ status: 'approved', approved_at: null }, NOW), 'Approved · date not recorded');
});

test('counts: a stage\'s count and oldest wait, and an unreadable counts block is never a zero', () => {
  assert.deepEqual(countOf(COUNTS, 'submitted'), { readable: true, count: 9, oldest: 'oldest 4 days', reason: null });
  assert.equal(countOf(COUNTS, 'changes_requested').count, 0, 'an empty stage is a measured 0');
  const lost = countOf({ available: false, reason: 'unreadable' }, 'submitted');
  assert.equal(lost.readable, false);
  assert.equal(lost.count, undefined);
  assert.equal(lost.text, 'Could not be read');
});

test('the list lives in the address: bad values are left out, defaults are not written', () => {
  const s = listStateOf('?view=list&q=%20seed%20&stage=all&sort=title&author=12&sector=Climate&reviewer=x&submitted_from=2026-10-01&submitted_to=nope&open_comments=1&size=50&page=3');
  assert.equal(s.view, 'list');
  assert.equal(s.q, 'seed');
  assert.equal(s.stage, 'all');
  assert.equal(s.sort, 'title');
  assert.equal(s.author, '12');
  assert.equal(s.reviewer, '', 'a reviewer that is not an id is dropped');
  assert.equal(s.submitted_to, '', 'a date that is not a date is dropped');
  assert.equal(s.open_comments, '1');
  assert.deepEqual([s.size, s.page], [50, 3]);
  assert.equal(listStateOf('?stage=bogus&sort=bogus&size=7').stage, 'open');
  assert.equal(listStateOf('?sort=bogus').sort, 'waiting');
  assert.equal(listStateOf('?size=7').size, 20);
  assert.equal(searchOf(listStateOf('')), '');
  assert.equal(searchOf({ ...listStateOf(''), view: 'list' }), '?view=list');
  assert.equal(searchOf(s), '?view=list&q=seed&stage=all&author=12&sector=Climate&submitted_from=2026-10-01&open_comments=1&sort=title&size=50&page=3');
  assert.deepEqual(queueParams(s), { stage: 'all', q: 'seed', author: '12', sector: 'Climate', reviewer: undefined, submitted_from: '2026-10-01', submitted_to: undefined, open_comments: '1', sort: 'title', limit: 50, offset: 100 });
  assert.equal(rangeText(46, { page: 2, size: 20 }), '21–40 of 46');
  assert.equal(rangeText(46, { page: 3, size: 20 }), '41–46 of 46');
  assert.equal(rangeText(0, { page: 1, size: 20 }), 'No articles match');
  assert.equal(rangeText(undefined, { page: 1, size: 20 }), 'Total not recorded');
});

test('actions: what each stage offers, the self-approval rule, and Feature for the Super Admin only (ART16)', () => {
  const admin = { userId: 7, superAdmin: false };
  const sup = { userId: 8, superAdmin: true };
  const other = (status, extra = {}) => ({ status, author_user_id: 60, ...extra });
  assert.deepEqual(actionsFor(other('submitted'), admin), ['start', 'request', 'approve', 'reject']);
  assert.deepEqual(actionsFor(other('in_review'), admin), ['request', 'approve', 'reject']);
  assert.deepEqual(actionsFor(other('approved'), admin), ['schedule', 'publish']);
  assert.deepEqual(actionsFor(other('approved', { publish_at: '2026-10-30T08:00:00Z' }), admin), ['schedule', 'clear', 'publish']);
  assert.deepEqual(actionsFor(other('published'), admin), ['unpublish'], 'an Admin is never offered Feature');
  assert.deepEqual(actionsFor(other('published'), sup), ['unpublish', 'feature']);
  assert.deepEqual(actionsFor(other('published', { featured_at: '2026-10-20T09:00:00Z' }), sup), ['unpublish', 'unfeature']);
  assert.deepEqual(actionsFor(other('changes_requested'), admin), []);
  // An Admin's own article: no approve, publish or schedule; the note says why.
  assert.deepEqual(actionsFor({ status: 'in_review', author_user_id: 7 }, admin), ['request', 'reject', 'own_note']);
  assert.deepEqual(actionsFor({ status: 'approved', author_user_id: 7 }, admin), ['own_note']);
  // A Super Admin's own article: approve and publish with a reason.
  assert.deepEqual(actionsFor({ status: 'in_review', author_user_id: 8 }, sup), ['request', 'approve_self', 'reject']);
  assert.deepEqual(actionsFor({ status: 'approved', author_user_id: 8 }, sup), ['publish_self']);
});

test('dialogs: the author reads a reason of at least 8 characters wherever one is asked; a click that went stale says where it went', () => {
  for (const k of ['request', 'reject', 'unpublish', 'approve_self', 'publish_self']) assert.ok(dialogFor(k, { title: 'T' }).reason, k);
  for (const k of ['start', 'approve', 'publish', 'feature', 'clear']) assert.equal(dialogFor(k, { title: 'T' }).reason, undefined, k);
  assert.ok(dialogFor('schedule', { title: 'T' }).when);
  assert.equal(dialogFor('unpublish', { title: 'Option pools', author_name: 'Synthetic Author' }).line, 'It leaves the public page at once and goes back to Ready to publish, with no time. Synthetic Author is told it was unpublished, with your reason.');
  assert.equal(reasonOk('  seven  '), false);
  assert.equal(reasonOk('eight ch'), true);
  assert.equal(refusalText({ status: 409, code: 'status_changed' }, 'Published'), 'This article moved to Published before your click. Nothing else changed.');
  assert.equal(refusalText({ status: 409, code: 'featured_full' }), 'Three articles are featured already. Stop featuring one first.');
  assert.equal(refusalText({ status: 500, message: 'D1_ERROR: secret detail' }), 'That did not go through. Nothing was changed. Try again.', 'never the error\'s own text');
});

test('paragraph comments, threads and the compare', () => {
  const p = paragraphsOf(`# Heading\n\n${MD}\n\n\`\`\`\ncode\n\`\`\``);
  assert.equal(p.length, 4, 'a fenced block is not a paragraph');
  assert.equal(anchorFor(p[2]), '¶ 3: “An operator is not a COO in waiting. At this stage they…”');
  assert.ok(anchorFor({ n: 1, text: 'x'.repeat(300) }).length <= 120);
  const t = threadsOf(ARTICLE().comments);
  assert.deepEqual(t.map((c) => [c.id, c.replies.map((r) => r.id)]), [[11, [12]], [13, []]]);
  assert.deepEqual(compareLines('a\nb\nc', 'a\nc\nd').map((l) => `${l.kind}:${l.text}`), ['same:a', 'removed:b', 'same:c', 'added:d']);
});

/* ------------------------------------------------------------------ *
 * ART1, ART2: the board and the list, mounted
 * ------------------------------------------------------------------ */

test('ART1: the board reads the open stages once, columns count the whole stage, and the next submission opens', async () => {
  const v = await mount('/admin/articles');
  try {
    assert.equal(v.queues().length, 1);
    assert.deepEqual([v.queues()[0].query.stage, v.queues()[0].query.sort, v.queues()[0].query.limit], ['open', 'waiting', '100']);
    assert.match(v.of('cq-col-submitted'), /Submitted 9 · oldest 4 days/, 'the column counts the stage, not the page');
    assert.ok(v.has('cq-card-1') && v.has('cq-card-2'));
    assert.match(v.of('cq-card-2'), /2 open comments 3 rounds/);
    assert.match(v.of('cq-col-scheduled'), /Goes out Fri 30 Oct, 08:00 UTC/);
    assert.match(v.of('cq-col-changes_requested'), /Nothing in this stage/);
    assert.match(v.of('cq-count-published'), /Published 30/);
    await v.click('cq-next-submission');
    assert.equal(v.loc.current.pathname, '/admin/articles/1', 'the oldest submission opens at its own address');
    assert.ok(v.calls.some((c) => c.path === '/api/admin/articles/42' || c.path === '/api/admin/articles/1'));
  } finally { await v.close(); }
});

test('ART15c: a counts block that fails says so, and the rows still stand', async () => {
  const v = await mount('/admin/articles', { queue: () => json({ items: ITEMS, total: 5, limit: 100, offset: 0, counts: { available: false, reason: 'unreadable' } }) });
  try {
    assert.match(v.of('cq-count-submitted'), /Submitted Could not be read/);
    assert.doesNotMatch(v.of('cq-count-submitted'), /\b0\b/);
    assert.ok(v.has('cq-card-1'), 'the board still draws its cards');
  } finally { await v.close(); }
});

test('ART2: the list sends the address\'s search, filters, sort and page, and each change is a new address', async () => {
  const v = await mount('/admin/articles?view=list&q=seed&stage=all&sort=title&page=2', { queue: (c) => json({ items: ITEMS.slice(0, 2), total: 46, limit: Number(c.query.limit), offset: Number(c.query.offset), counts: COUNTS }) });
  try {
    const q = v.queues()[0].query;
    assert.deepEqual([q.q, q.stage, q.sort, q.limit, q.offset], ['seed', 'all', 'title', '20', '20']);
    assert.equal(v.of('cq-range'), '21–40 of 46');
    assert.match(v.of('cq-paging'), /Page 2 of 3/);
    assert.ok(v.has('cq-row-1'));
    await v.type('cq-filter-open-comments', true);
    assert.equal(v.loc.current.search, '?view=list&q=seed&stage=all&open_comments=1&sort=title', 'a filter goes back to page 1');
    assert.equal(v.queues().at(-1).query.open_comments, '1');
    await v.click('cq-next');
    assert.match(v.loc.current.search, /page=2/);
    await v.click('cq-view-board');
    assert.equal(v.loc.current.search, '?q=seed&stage=all&open_comments=1&sort=title');
  } finally { await v.close(); }
});

test('ART13b: no match says so, with Clear filters and Search every stage', async () => {
  const v = await mount('/admin/articles?view=list&q=nothing', { queue: () => json({ items: [], total: 0, limit: 20, offset: 0, counts: COUNTS }) });
  try {
    assert.match(v.of('cq-no-match'), /No articles match these filters\./);
    await v.click('cq-no-match-all');
    assert.match(v.loc.current.search, /stage=all/);
    await v.click('cq-no-match-clear');
    assert.equal(v.loc.current.search, '?view=list');
  } finally { await v.close(); }
});

test('ART13a and ART15a: no articles at all, and a queue that cannot be read with Try again', async () => {
  const empty = await mount('/admin/articles', { queue: () => json({ items: [], total: 0, limit: 100, offset: 0, counts: { ...COUNTS, total: 0 } }) });
  try { assert.match(empty.of('cq-none'), /No articles yet\. When a member sends an article for review, it appears here\./); } finally { await empty.close(); }
  let n = 0;
  const v = await mount('/admin/articles', { queue: () => { n += 1; return n === 1 ? json({ error: 'The queue could not be read. Try again.', code: 'queue_unreadable' }, 503) : json({ items: ITEMS, total: 5, counts: COUNTS }); } });
  try {
    assert.match(v.of('cq-failed'), /We could not load the queue\. The rest of the admin still works\. Try again/);
    assert.equal(v.has('cq-board'), false);
    await v.click('cq-retry');
    assert.ok(v.has('cq-board'));
  } finally { await v.close(); }
});

/* ------------------------------------------------------------------ *
 * ART3–ART5: the drawer, mounted at its address
 * ------------------------------------------------------------------ */

test('ART3: /admin/articles/42 opens that article as readers see it, or its Markdown', async () => {
  const v = await mount('/admin/articles/42');
  try {
    assert.ok(v.calls.some((c) => c.method === 'GET' && c.path === '/api/admin/articles/42'));
    assert.ok(v.has('cq-drawer'));
    assert.match(v.of('cq-drawer-meta'), /In review/);
    assert.ok(v.has('cq-article-rendered'));
    await v.click('cq-article-md');
    assert.match(v.of('cq-article-markdown'), /Most seed teams hire an operator too late\./);
  } finally { await v.close(); }
});

test('ART4: threads with their paragraph, replies and who resolved; a paragraph comment and a reply are sent as threads', async () => {
  const v = await mount('/admin/articles/42');
  try {
    await v.click('cq-drawer-tab-comments');
    assert.match(v.of('cq-drawer-tab-comments'), /Comments · 1 open/);
    assert.match(v.of('cq-thread-11'), /On ¶ 2: “An operator is not a COO in waiting…” Define “operator” once, early\./);
    assert.match(v.of('cq-reply-12'), /Fair, will do\. Synthetic Author \(author\)/);
    assert.match(v.of('cq-thread-13'), /Resolved by Synthetic Admin on 19 Oct 2026/);
    await v.type('cq-comment-on', '2');
    await v.type('cq-comment-text', 'Name the routine.');
    await v.click('cq-comment-send');
    const sent = v.posts().find((c) => c.path === '/api/admin/articles/42/comments');
    assert.deepEqual(sent.body, { body: 'Name the routine.', anchor: '¶ 2: “An operator is not a COO in waiting. At this stage they…”' });
    await v.type('cq-reply-input-11', 'Thanks.');
    await v.click('cq-reply-send-11');
    assert.deepEqual(v.posts().at(-1).body, { body: 'Thanks.', parent_id: 11 });
    await v.click('cq-delete-11');
    assert.ok(v.has('cq-dialog-delete_comment'), 'Delete asks first, in the page');
    assert.equal(v.posts().filter((c) => c.method === 'DELETE').length, 0);
    await v.click('cq-dialog-confirm');
    assert.deepEqual(v.posts().filter((c) => c.method === 'DELETE').map((c) => c.path), ['/api/admin/articles/comments/11']);
  } finally { await v.close(); }
});

test('ART5: revisions name who saved them, and two picked are compared', async () => {
  const v = await mount('/admin/articles/42');
  try {
    await v.click('cq-drawer-tab-revisions');
    assert.match(v.page(), /Rev 4 · Edited · Submitted · Saved by an account that no longer exists/);
    assert.ok(v.disabled('cq-rev-compare'));
    await v.type('cq-rev-pick-2', true);
    await v.type('cq-rev-pick-4', true);
    await v.click('cq-rev-compare');
    assert.ok(v.calls.some((c) => c.path === '/api/admin/articles/42/revisions/2') && v.calls.some((c) => c.path === '/api/admin/articles/42/revisions/4'));
    assert.match(v.of('cq-compare'), /Rev 2 → Rev 4 ?\. .* Line one Old line New line/);
    await v.click('cq-drawer-tab-details');
    assert.match(v.of('cq-tab-details'), /Approved by Not approved/);
    assert.match(v.of('cq-tab-details'), /Views are one running total per article\. Views by day are not recorded yet\./);
  } finally { await v.close(); }
});

/* ------------------------------------------------------------------ *
 * ART6, ART15d, ART16: the dialogs, mounted
 * ------------------------------------------------------------------ */

test('ART6: Approve and Reject open in the page; Reject sends nothing until the author has a reason', async () => {
  const v = await mount('/admin/articles/42');
  try {
    await v.click('cq-action-approve');
    assert.match(v.of('cq-dialog-approve'), /Approve “Hiring your first operator”\?/);
    assert.equal(v.posts().length, 0, 'opening a dialog changes nothing');
    await v.click('cq-dialog-confirm');
    assert.deepEqual(v.posts().map((c) => [c.path, c.body]), [['/api/admin/articles/42/approve', {}]]);
    assert.match(v.of('toast-message'), /Recorded: approved by you, now\./);
    await v.click('cq-action-reject');
    assert.ok(v.disabled('cq-dialog-confirm'));
    await v.type('cq-dialog-reason', 'short');
    assert.ok(v.disabled('cq-dialog-confirm'), 'under 8 characters');
    await v.type('cq-dialog-reason', '  Out of scope for Articles.  ');
    await v.click('cq-dialog-confirm');
    assert.deepEqual(v.posts().at(-1), { method: 'POST', path: '/api/admin/articles/42/reject', query: {}, body: { reason: 'Out of scope for Articles.' } }, 'the reason is sent as typed, trimmed');
  } finally { await v.close(); }
});

test('ART6 G: Unpublish asks why and sends the reason the author reads', async () => {
  const v = await mount('/admin/articles/42', { article: () => json(ARTICLE({ status: 'published', published_at: '2026-10-12T09:00:00Z' })) });
  try {
    await v.click('cq-action-unpublish');
    assert.match(v.of('cq-dialog-unpublish'), /Why is it unpublished\?/);
    await v.type('cq-dialog-reason', 'A figure in it was wrong.');
    await v.click('cq-dialog-confirm');
    assert.deepEqual(v.posts().at(-1).body, { reason: 'A figure in it was wrong.' });
    assert.equal(v.posts().at(-1).path, '/api/admin/articles/42/unpublish');
  } finally { await v.close(); }
});

test('ART15d: a click that went stale says where the article went, and reads it again', async () => {
  let reads = 0;
  const v = await mount('/admin/articles/42', {
    article: () => { reads += 1; return json(ARTICLE(reads > 1 ? { status: 'approved', approved_at: '2026-10-27T09:00:00Z' } : {})); },
    onPost: () => json({ error: 'status_changed' }, 409),
  });
  try {
    await v.click('cq-action-reject');
    await v.type('cq-dialog-reason', 'Out of scope for Articles.');
    await v.click('cq-dialog-confirm');
    assert.match(v.of('toast-message'), /This article moved to Ready to publish before your click\. Nothing else changed\./);
    assert.equal(v.has('cq-dialog-reject'), false);
    assert.match(v.of('cq-drawer-meta'), /Ready to publish/);
  } finally { await v.close(); }
});

test('ART16: an Admin on their own article sees why, and no Approve; a Super Admin approves with a reason and features', async () => {
  const own = await mount('/admin/articles/42', { article: () => json(ARTICLE({ author_user_id: 7 })) });
  try {
    assert.match(own.of('cq-own-note'), /You wrote this ?\. A second admin approves an author’s own article\./);
    assert.equal(own.has('cq-action-approve'), false);
    assert.equal(own.has('cq-action-approve_self'), false);
  } finally { await own.close(); }
  const sup = await mount('/admin/articles/42', { user: SUPER, article: () => json(ARTICLE({ author_user_id: 8 })) });
  try {
    await sup.click('cq-action-approve_self');
    assert.match(sup.of('cq-dialog-approve_self'), /Approve your own article anyway\?/);
    await sup.type('cq-dialog-reason', 'The only other admin is away.');
    await sup.click('cq-dialog-confirm');
    assert.deepEqual(sup.posts().at(-1).body, { override_reason: 'The only other admin is away.' });
  } finally { await sup.close(); }
  const pub = await mount('/admin/articles/42', { user: SUPER, article: () => json(ARTICLE({ status: 'published' })) });
  try {
    await pub.click('cq-action-feature');
    await pub.click('cq-dialog-confirm');
    assert.deepEqual([pub.posts().at(-1).path, pub.posts().at(-1).body], ['/api/admin/articles/42/feature', { featured: true }]);
  } finally { await pub.close(); }
  const admin = await mount('/admin/articles/42', { article: () => json(ARTICLE({ status: 'published' })) });
  try { assert.equal(admin.has('cq-action-feature'), false, 'an Admin is not offered Feature'); } finally { await admin.close(); }
});

/* ------------------------------------------------------------------ *
 * ART17, and no browser pop-up
 * ------------------------------------------------------------------ */

test('ART17: a member is told the queue is for studio admins; an Admin on the Content overview is sent back to the queue', () => {
  const out = renderToStaticMarkup(h(MemoryRouter, null, h(ContentQueueBoundary)));
  assert.match(out, new RegExp(NO_PERMISSION.title.replace('.', '\\.')));
  assert.match(out, /If you wrote this article, open it in your writing workspace\./);
  assert.match(out, /href="\/articles\/draft"/);
  const app = read('frontend/src/App.jsx');
  assert.match(app, /\{ under: \/\^\\\/admin\\\/articles\(\\\/\|\$\)\/, roles: FUND_ADMIN_BOUNDARY_ROLES, Panel: ContentQueueBoundary, notPreview: true \}/);
  assert.match(hqLine('/admin/content'), /^HQ runs the Content overview\. You can still review articles in the Content queue\./);
  assert.deepEqual(hqLinks('/admin/content').map((l) => [l.label, l.href]), [['Back to the Content queue', '/admin/articles']]);
  assert.notDeepEqual(hqLinks('/admin/contentx'), hqLinks('/admin/content'));
});

test('no window.confirm, prompt or alert is left in the Content queue', () => {
  const dir = 'frontend/src/pages/admin/contentQueue';
  const files = ['frontend/src/pages/admin/ArticlesQueuePage.jsx', ...readdirSync(new URL(`../../${dir}`, import.meta.url)).filter((f) => /\.jsx?$/.test(f)).map((f) => `${dir}/${f}`)];
  assert.ok(files.length >= 6);
  for (const f of files) assert.doesNotMatch(read(f), /window\.(confirm|prompt|alert)|\balert\(/, f);
});
