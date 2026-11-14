// #4046 Group B4 — Ask on the review drawer's new comment, the pages half.
//   - the model: `SCOPED_FORMS.reviewComment` is FILL_FIELDS' one field on
//     article_review_comments; where it points and whether to approve are said
//     never to be filled;
//   - ReviewDrawer's Comments tab, mounted against a stubbed fetch: the read
//     names the article as the parent and no record; the comment draws a
//     trigger, its label naming its textarea; Ask sends only the comment's
//     value, never the paragraph it points at or a reply; Accept places the
//     words; Send posts them, then records the placed proposal against the id
//     the 201 names, before the comments are read again;
//   - with nothing placed, Send records nothing; an unreadable comment list
//     reads no sheet.
//
// Booleans, not nodes: a failing assert on a DOM node prints the whole fake tree and never ends.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fill_admin_review_comment_pages_4046.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { NOT_FILLED_HERE, SCOPED_FORMS } from '../src/lib/fillScoped.js';
import { fieldsOf } from '../src/lib/fillFields.js';
import ReviewDrawer from '../src/pages/admin/contentQueue/ReviewDrawer.jsx';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const RC = SCOPED_FORMS.reviewComment;
const ADMIN = { id: 7, role: 'admin', is_super_admin: 0, name: 'Synthetic Admin', email: 'admin@example.com' };
const PROPOSED = 'Define “operator” before the second paragraph uses it.';

const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const MD = 'Most seed teams hire an operator too late.\n\nAn operator is not a COO in waiting.';
const ARTICLE = (extra = {}) => ({
  article: { id: 42, title: 'Hiring your first operator', status: 'in_review', author_user_id: 60, author_name: 'Synthetic Author', body_markdown: MD, slug: 'hiring', tags: [] },
  revisions: [],
  comments: [{ id: 11, body: 'Needs a source.', anchor: null, author_name: 'Synthetic Admin', created_at: '2026-10-18T09:00:00Z', parent_id: null, resolved_at: null }],
  follower_reach: [],
  ...extra,
});
const SHEET = {
  page: RC.page, form: RC.form, project: null, scope: 'article:42', record: null, can_fill: true, marks_state: 'ok',
  sources: [{ key: 'eadwyn', kind: 'eadwyn', label: 'Eadwyn', state: 'ok', as_of: null }],
  fields: [{ field: 'body', label: 'Comment', table: 'article_review_comments', column: 'body', class: 'composition', sources: ['eadwyn'],
    value: null, mark: null, never_fill: null, offered_to_eadwyn: true, trigger: true, waiting: [], choices: [] }],
  quote: { option: `form:${RC.form}`, state: 'ok', runs: 0, average_microusd: null },
};

/** `routes`: `METHOD /path` → handler(call, state); the drawer's own article read answers `article`. */
async function mounted(routes, { article = ARTICLE() } = {}) {
  const restore = installDocument('', { focus: true });
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const calls = [];
  const state = {};
  globalThis.fetch = async (u, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const [path] = String(u).split('?');
    const call = { url: String(u), path, method, body: options.body ? JSON.parse(options.body) : null };
    calls.push(call);
    if (path === '/api/auth/me') return response(ADMIN);
    const key = Object.keys(routes).find((k) => k === `${method} ${path}`);
    if (key) return routes[key](call, state);
    if (path === '/api/admin/articles/42' && method === 'GET') return response(article);
    if (method === 'GET') return response({});
    throw new Error(`unrouted ${method} ${path}`);
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(ADMIN));
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const n = create(tag); n.querySelector = () => null; n.querySelectorAll = () => []; n.focus = () => {}; n.children = []; return n; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/admin/articles/42'] },
    h(AuthProvider, null, h(ReviewDrawer, { id: 42, viewer: ADMIN, onClose() {}, onChanged() {}, notify() {} })))));
  const flush = () => act(async () => { for (let i = 0; i < 14; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const event = { button: 0, preventDefault() {}, stopPropagation() {}, defaultPrevented: false };
  const w = {
    calls, flush, state,
    has: (id) => !!byId(id),
    value: (id) => props(byId(id)).value,
    textOf: (id) => text(byId(id)),
    labelFor: (forId) => walk(container).some((n) => n.tagName?.toLowerCase?.() === 'label' && props(n).htmlFor === forId),
    idOf: (id) => props(byId(id)).id,
    async press(id) { const p = props(byId(id)); assert.equal(typeof p.onClick, 'function', `no ${id} to press`); assert.equal(!!p.disabled, false, `${id} is disabled`); await act(async () => { await p.onClick(event); }); await flush(); },
    async change(id, value) { await act(async () => { props(byId(id)).onChange({ target: { value } }); }); await flush(); },
    sheets: () => calls.filter((c) => c.path === '/api/fills/sheet'),
    async close() {
      await act(async () => root.unmount());
      globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia;
      localStorage.removeItem?.('user');
      restore();
    },
  };
  await w.press('cq-drawer-tab-comments');
  return w;
}

test('the model: the comment on article_review_comments; where it points and whether to approve are never filled', () => {
  assert.deepEqual(RC, { page: 'Super Admin · Content · Content queue', form: 'review-comment', table: 'article_review_comments' });
  assert.deepEqual(fieldsOf(RC.page, RC.form).map((f) => [f.field, f.label, f.table, f.class]),
    [['body', 'Comment', 'article_review_comments', 'composition']]);
  assert.equal(NOT_FILLED_HERE['review-comment'][0], 'Where it points and whether to approve · those are yours to decide.');
});

test('Comments: the read names the article as the parent and no record; the comment draws Ask, its label naming its textarea; typing clears it', async () => {
  // Mutations checked: the FillLabel wrapper dropped from the comment → no field trigger; htmlFor dropped → labelFor is
  // false; `parent: article.id` dropped → the read names no parent.
  const w = await mounted({ 'GET /api/fills/sheet': () => response(SHEET) });
  try {
    const sheets = w.sheets();
    assert.equal(sheets.length, 1);
    assert.match(sheets[0].url, /form=review-comment/);
    assert.match(sheets[0].url, /parent=42/, 'a new comment hangs under the article');
    assert.doesNotMatch(sheets[0].url, /record=|project=/);
    assert.equal(w.has('fill-trigger-body'), true);
    assert.equal(w.has('fill-form-trigger'), true, 'the form\'s Ask');
    assert.match(w.textOf('fill-scoped-not-here'), /Where it points and whether to approve/);
    assert.equal(w.idOf('cq-comment-text'), 'cq-comment-text');
    assert.equal(w.labelFor('cq-comment-text'), true, 'the label names its textarea');
    assert.equal(w.has('fill-trigger-anchor') || w.has('fill-trigger-parent_id'), false, 'nothing else draws Ask');
    await w.change('cq-comment-text', 'Typed by me');
    assert.equal(w.has('fill-trigger-body'), false, 'a typed comment draws no trigger');
    assert.equal(w.has('fill-form-trigger'), false);
  } finally { await w.close(); }
});

test('Ask → Accept → Send: the run reads only the comment; the comment is sent with the words, then recorded on the id the 201 names', async () => {
  // Mutations checked: `fill.afterSave` dropped from send() → no record call; `anchor: on` added to the hook's values →
  // the run carries the paragraph choice; afterSave moved after `run`'s re-read (outside fn) → recorded after the re-read.
  const sse = `event: done\ndata: ${JSON.stringify({ proposals: [{ uid: 'p-1', field: 'body', value: PROPOSED }], dropped: [], charged_microusd: 1200 })}\n\n`;
  let readsAtRecord = null;
  const articleReads = (calls) => calls.filter((c) => c.method === 'GET' && c.path === '/api/admin/articles/42').length;
  const w = await mounted({
    'GET /api/fills/sheet': () => response(SHEET),
    'POST /api/ai/rail/run': () => ({ ok: true, status: 200, headers: new Map(), text: async () => sse, json: async () => ({}) }),
    'POST /api/admin/articles/42/comments': () => response({ id: 77, ok: true }, 201),
    'POST /api/fills/record': (_c, s) => { readsAtRecord = articleReads(w.calls); return response({ record: 'article_review_comments:77', outcomes: [] }); },
  });
  try {
    await w.change('cq-comment-on', '2');
    await w.press('fill-form-trigger');
    await w.press('fill-sheet-preview');
    const run = w.calls.find((c) => c.path === '/api/ai/rail/run');
    assert.equal(!!run, true, 'the run was asked');
    assert.deepEqual([run.body.option, run.body.page, run.body.record ?? null, run.body.parent ?? null, run.body.project ?? null],
      [`form:${RC.form}`, RC.page, null, 42, null], 'the run names the article as the parent, and no venture or record');
    assert.doesNotMatch(JSON.stringify(run.body), /An operator is not a COO|"anchor"|Needs a source/, 'the paragraph choice and the thread never reach the run');
    await w.press('fill-sheet-accept-all');
    assert.equal(w.value('cq-comment-text'), PROPOSED);
    assert.equal(w.calls.some((c) => c.path === '/api/fills/record'), false, 'nothing is recorded before Send');
    const before = articleReads(w.calls);
    await w.press('cq-comment-send');
    const sent = w.calls.find((c) => c.method === 'POST' && c.path === '/api/admin/articles/42/comments');
    assert.equal(sent.body.body, PROPOSED);
    const rec = w.calls.find((c) => c.path === '/api/fills/record');
    assert.equal(!!rec, true, 'Send records the placed proposal');
    assert.deepEqual(rec.body, { page: RC.page, form: RC.form, record: 77, proposals: ['p-1'] });
    assert.equal(readsAtRecord, before, 'recorded before the comments are read again');
    assert.equal(articleReads(w.calls) > before, true, 'the comments are read again after Send');
    assert.equal(w.value('cq-comment-text'), '', 'the box is cleared');
  } finally { await w.close(); }
});

test('Send with nothing placed records nothing; an unreadable comment list reads no sheet', async () => {
  const w = await mounted({
    'GET /api/fills/sheet': () => response(SHEET),
    'POST /api/admin/articles/42/comments': () => response({ id: 78, ok: true }, 201),
  });
  try {
    await w.change('cq-comment-text', 'My own words.');
    await w.press('cq-comment-send');
    assert.equal(w.calls.find((c) => c.path === '/api/admin/articles/42/comments' && c.method === 'POST').body.body, 'My own words.');
    assert.equal(w.calls.some((c) => c.path === '/api/fills/record'), false);
  } finally { await w.close(); }
  // Mutation checked: `enabled: Array.isArray(comments)` dropped → the sheet is read for an unreadable list.
  const u = await mounted({ 'GET /api/fills/sheet': () => response(SHEET) }, { article: ARTICLE({ comments: null }) });
  try {
    assert.equal(u.has('cq-comments-unreadable'), true);
    assert.equal(u.sheets().length, 0, 'no read while the comments are unreadable');
  } finally { await u.close(); }
});

test('the wiring: the hook sits before the early return; the record step sits inside run, after the 201', () => {
  const drawer = read('pages/admin/contentQueue/ReviewDrawer.jsx');
  const hook = drawer.indexOf('scope: SCOPED_FORMS.reviewComment');
  const early = drawer.indexOf('if (!Array.isArray(comments)) return <BlockFailed');
  assert.equal(hook > 0 && early > hook, true, 'the hook comes before the early return');
  assert.match(drawer, /scope: SCOPED_FORMS\.reviewComment, parent: article\.id, enabled: Array\.isArray\(comments\),\n\s+values: \{ body: text \},/);
  assert.match(drawer, /const r = await api\.addComment\(article\.id, text\.trim\(\), p \? anchorFor\(p\) : null\);\n\s+setText\(''\);\n(\s+\/\/.*\n)?\s+await fill\.afterSave\(r\?\.id\);/);
  assert.match(drawer, /<FillLabel fill=\{fill\} name="body" label="Comment" value=\{text\}>/);
  assert.equal((drawer.match(/<FillLabel /g) || []).length, 1, 'nothing else draws Ask: no reply, no paragraph choice');
});
