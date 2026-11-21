/**
 * D6205 part 2 (#6205): investors' requests on the admin position sheet. HQ
 * reads who asked, for what, why and when, and answers each open request:
 * Resolve (linking the mark recorded, or a note for a follow-on) or Decline
 * (with a note).
 *
 * The panel is prop-driven, so each state renders on its own:
 *   loading · unreadable (Retry, never "none") · none · open (Resolve/Decline) · answered
 * plus the model's answer rules (the Worker's own), and the real page
 * (`PortfolioPositionsPage`) against a stubbed Worker: the read is per
 * company, the mark just recorded through the write flow is the one Resolve
 * starts on, and the answer is PATCHed and read back.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/mark_requests_admin_d6205.test.mjs
 *
 * Mutation checked (each fails a named assertion):
 *   - the unreadable branch falling through to the list → "unreadable never says none";
 *   - `answerProblem` letting a mark request resolve without a mark → "a mark or a correction needs a mark";
 *   - the page reading every request rather than the company's (`projectUid` dropped) → "the read is per company";
 *   - `onMarkSaved` not keeping the stored uid → "Resolve starts on the mark just recorded".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import PortfolioPositionsPage from '../src/pages/PortfolioPositionsPage.jsx';
import MarkRequestsAdmin from '../src/pages/portfolio/MarkRequestsAdmin.jsx';
import {
  adminRequestsOf, answerProblem, answerRefusalWords, defaultMarkUid, requesterOf,
} from '../src/pages/portfolio/markRequestModel.js';

const h = React.createElement;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const MARKS = [{ uid: 'm1', as_of_date: '2026-03-31', fmv: 2400000, basis: 'round_price' }];
const OPEN = { uid: 'r1', project_uid: 'northwind', kind: 'correction', reason: 'The March mark predates the down round.', state: 'open', created_at: '2026-11-14T10:00:00Z', resolved_at: null, requester: { id: 2, name: 'Hal' } };
const FOLLOW = { uid: 'r3', project_uid: 'northwind', kind: 'follow_on', reason: 'Series A missing.', state: 'open', created_at: '2026-11-13T09:00:00Z', resolved_at: null, requester: { id: 3, name: null } };
const DECLINED = { uid: 'r2', project_uid: 'northwind', kind: 'mark', reason: 'stale', state: 'declined', created_at: '2026-10-01T09:00:00Z', resolved_at: '2026-10-02T09:00:00Z', resolution_note: 'The March mark is current.', requester: { id: 2, name: 'Hal' } };

const panel = (props) => {
  const html = renderToStaticMarkup(h(MarkRequestsAdmin, { companyName: 'Northwind Labs', read: { state: 'ok', items: [] }, marks: MARKS, onAnswer: async () => {}, onRetry: () => {}, ...props }));
  return { html, text: renderedText(html) };
};

/* ------------------------------------------------------------- the panel */

test('loading and unreadable are their own states; unreadable offers Retry and never says none', () => {
  const loading = panel({ read: { state: 'loading', items: [] } });
  assert.match(loading.html, /admin-mark-requests-loading/);
  const bad = panel({ read: { state: 'unreadable', items: [] } });
  assert.match(bad.text, /could not be read/);
  assert.match(bad.html, /button-retry-admin-mark-requests/);
  // mutation: the unreadable branch falling through to the list.
  assert.doesNotMatch(bad.text, /No investor has asked/, 'unreadable never says none');
  assert.doesNotMatch(bad.html, /button-resolve-|button-decline-/);
});

test('none names the company; the list puts open requests first with who, what, why and when, then answered ones with their state', () => {
  assert.match(panel({}).text, /No investor has asked HQ about Northwind Labs/);
  const list = panel({ read: { state: 'ok', items: [DECLINED, OPEN, FOLLOW] } });
  const order = [...list.html.matchAll(/data-testid="admin-mark-request-(r\d)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['r3', 'r1', 'r2'], 'open oldest first, then answered');
  assert.match(list.text, /Correct the recorded mark · Hal · Requested · 14 Nov 2026/);
  assert.match(list.text, /The March mark predates the down round/);
  assert.match(list.text, /Record a missing follow-on round · Investor \(name not recorded\)/);
  assert.match(list.text, /Declined · 2 Oct 2026/);
  assert.match(list.text, /HQ: The March mark is current/);
  assert.match(list.html, /button-resolve-r1/);
  assert.match(list.html, /button-decline-r1/);
  assert.doesNotMatch(list.html, /button-resolve-r2/, 'an answered request is not answered again');
  const answeredOnly = panel({ read: { state: 'ok', items: [DECLINED] } });
  assert.match(answeredOnly.text, /No request is open/);
});

/* ------------------------------------------------------------- the model */

test('model: the answer rules are the Worker’s; open/answered split; requester and default mark', () => {
  // mutation: a mark request resolving without a mark.
  assert.equal(answerProblem({ kind: 'mark', state: 'resolved', markUid: null, note: '' }), 'Choose the mark recorded for this request.', 'a mark or a correction needs a mark');
  assert.equal(answerProblem({ kind: 'correction', state: 'resolved', markUid: 'm1', note: '' }), null);
  assert.match(answerProblem({ kind: 'follow_on', state: 'resolved', markUid: null, note: ' ' }), /follow-on/);
  assert.equal(answerProblem({ kind: 'follow_on', state: 'resolved', markUid: null, note: 'Series A recorded.' }), null);
  assert.match(answerProblem({ kind: 'mark', state: 'declined', markUid: 'm1', note: '' }), /why/);
  assert.equal(answerProblem({ kind: 'mark', state: 'declined', note: 'Current.' }), null);
  assert.match(answerProblem({ kind: 'mark', state: '', note: '' }), /Resolve or Decline/);
  assert.match(answerProblem({ kind: 'mark', state: 'declined', note: 'x'.repeat(2001) }), /under 2000/);
  const split = adminRequestsOf([DECLINED, OPEN, FOLLOW, null, { state: 'open' }]);
  assert.deepEqual(split.open.map((r) => r.uid), ['r3', 'r1']);
  assert.deepEqual(split.answered.map((r) => r.uid), ['r2']);
  assert.equal(requesterOf(FOLLOW), 'Investor (name not recorded)');
  assert.equal(defaultMarkUid(MARKS, 'm1'), 'm1');
  assert.equal(defaultMarkUid(MARKS, 'mk-other-company'), '', 'a mark not in this company’s history is never the default');
  assert.match(answerRefusalWords({ code: 'request_answered' }), /already answered/);
  assert.match(answerRefusalWords({ code: 'mark_not_found' }), /not recorded for this company/);
  assert.match(answerRefusalWords({}), /Nothing was changed/);
});

/* ------------------------------------------------------------- the page */

const PROJECT = { id: 1, uid: 'northwind', name: 'Northwind Labs' };
const DETAIL = { project: PROJECT, rounds: [], cap_table_snapshot: [], marks: MARKS, distributions: [] };
const STORED = { id: 41, uid: 'mk-new', project_id: 1, as_of_date: '2026-09-30', fmv: 2100000, basis: 'gp_estimate', event: 'Down round', created_at: '2026-11-14T14:44:09Z' };
const AFTER = { ...DETAIL, marks: [{ uid: 'mk-new', as_of_date: '2026-09-30', fmv: 2100000, basis: 'gp_estimate' }, ...MARKS] };

function worker({ requests = () => json({ items: [OPEN] }) } = {}) {
  let marked = false;
  return ({ path, method, search, body }) => {
    if (path === '/api/auth/me') return json({ id: 1, role: 'admin', name: 'Ada' });
    if (method === 'GET' && path === '/api/positions') return json({ items: [{ project_id: 1, project: PROJECT, total_invested: 1500000, rounds: 1 }] });
    if (method === 'GET' && path === '/api/positions/northwind') return json(marked ? AFTER : DETAIL);
    if (method === 'POST' && path === '/api/positions/northwind/marks') { marked = true; return json(STORED, 201); }
    if (path === '/api/mark-requests' && method === 'GET') return requests({ search });
    if (path.startsWith('/api/mark-requests/') && method === 'PATCH') {
      return json({ ...OPEN, state: body.state, resolved_at: '2026-11-14T15:00:00Z', resolved_mark_uid: body.mark_uid, resolution_note: body.note });
    }
    return json({});
  };
}

async function mount(answer) {
  const restore = installDocument();
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(String(input), 'http://localhost');
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path: u.pathname, search: u.search, method, body });
    return answer({ path: u.pathname, search: u.search, method, body }) ?? json({});
  };
  localStorage.setItem('user', JSON.stringify({ id: 1, role: 'admin', name: 'Ada' }));
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const textOf = (node) => (node.nodeType === 3 ? node.textContent : (node.childNodes || []).map(textOf).join(' ') || node.textContent || '');
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(box); };
  const props = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byTestId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const squash = (s) => s.replace(/\s+/g, ' ').trim();
  const settle = async () => { for (let i = 0; i < 15; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/portfolio/positions'] }, h(AuthProvider, null, h(PortfolioPositionsPage, { embedded: true })))));
  await settle();
  const need = (node, what) => { if (!node) throw new Error(`no ${what}`); return node; };
  const fire = async (fn) => { await act(async () => { fn(); }); await settle(); };
  return {
    calls,
    has: (id) => Boolean(byTestId(id)),
    prop: (id, name) => props(need(byTestId(id), id))[name],
    text: (id) => (byTestId(id) ? squash(textOf(byTestId(id))) : null),
    click: (id) => fire(() => props(need(byTestId(id), id)).onClick({ preventDefault() {}, stopPropagation() {} })),
    clickText: (label) => fire(() => props(need(nodes().find((n) => n.tagName === 'BUTTON' && squash(textOf(n)) === label), label)).onClick({ preventDefault() {} })),
    type: (id, value) => fire(() => props(need(byTestId(id), id)).onChange({ target: { value } })),
    submit: (id) => fire(() => props(need(byTestId(id), id)).onSubmit({ preventDefault() {} })),
    async close() { await act(async () => root.unmount()); globalThis.fetch = realFetch; localStorage.removeItem('user'); restore(); },
  };
}

test('the page reads the company’s requests, and a decline is PATCHed with its note and read back', async () => {
  const page = await mount(worker());
  try {
    await page.clickText('View dilution');
    const reads = page.calls.filter((c) => c.path === '/api/mark-requests' && c.method === 'GET');
    // mutation: `projectUid` dropped from the page's read.
    assert.equal(reads.length, 1);
    assert.equal(reads[0].search, '?project_uid=northwind', 'the read is per company');
    assert.match(page.text('admin-mark-request-r1'), /Correct the recorded mark · Hal · Requested · 14 Nov 2026/);
    await page.click('button-decline-r1');
    assert.equal(page.prop('button-send-answer-r1', 'disabled'), true, 'a decline needs its note');
    await page.type('input-answer-note-r1', 'The March mark is current.');
    await page.submit('form-answer-r1');
    const patch = page.calls.find((c) => c.method === 'PATCH');
    assert.equal(patch.path, '/api/mark-requests/r1');
    assert.deepEqual(patch.body, { state: 'declined', mark_uid: null, note: 'The March mark is current.' });
    assert.equal(page.calls.filter((c) => c.path === '/api/mark-requests' && c.method === 'GET').length, 2, 'the list is read again after the answer');
  } finally { await page.close(); }
});

test('Resolve starts on the mark just recorded through the write flow, and links it', async () => {
  const page = await mount(worker());
  try {
    await page.clickText('View dilution');
    await page.click('button-mark-open');
    await page.type('input-mark-as_of_date', '2026-09-30');
    await page.type('input-mark-fmv', '2,100,000');
    await page.type('input-mark-event', 'Down round');
    // Walk the write flow to its receipt, as the D4817 test does.
    await page.submit('form-mark');
    await page.click('write-flow-continue');
    await page.click('write-flow-confirm');
    assert.ok(page.has('write-flow-receipt'), 'the mark was recorded through the write flow');
    await page.click('button-resolve-r1');
    // mutation: `onMarkSaved` not keeping the stored uid → the select starts empty.
    assert.equal(page.prop('select-answer-mark-r1', 'value'), 'mk-new', 'Resolve starts on the mark just recorded');
    assert.match(page.text('select-answer-mark-r1'), /2026-09-30 · \$2,100,000 \(just recorded\)/);
    await page.submit('form-answer-r1');
    const patch = page.calls.find((c) => c.method === 'PATCH');
    assert.deepEqual(patch.body, { state: 'resolved', mark_uid: 'mk-new', note: null });
  } finally { await page.close(); }
});

test('an unreadable request read keeps the sheet and says so; Retry reads again', async () => {
  let n = 0;
  const page = await mount(worker({ requests: () => { n += 1; return n === 1 ? json({ detail: 'boom' }, 500) : json({ items: [] }); } }));
  try {
    await page.clickText('View dilution');
    assert.ok(page.has('portfolio-position-sheet'), 'the sheet still opens');
    assert.match(page.text('admin-mark-requests-unreadable'), /could not be read/);
    await page.click('button-retry-admin-mark-requests');
    assert.match(page.text('admin-mark-requests-none'), /No investor has asked HQ about Northwind Labs/);
  } finally { await page.close(); }
});
