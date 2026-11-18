// D6186 (#6186) — the deal page's Documents tab for the founder, an Admin and an Operating Partner: one design
// in the frame's cards, each read with its four states, the founder one click from their data room and their
// pending access requests, and no document row without an action or a reason it cannot be opened.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_documents_6186.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import DealRoomPage from '../src/pages/DealRoomPage.jsx';
import {
  DOCS_NONE, IN_PAPER_REASON, NO_FILE_REASON, ROOM_LINE, documentRow, documentsViewer, pendingRequests, requestsLine,
  roomCounts, roomHref,
} from '../src/pages/deal/dealDocumentsModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const DEAL = { id: 4, uid: 'd4', project_id: 7, profile_uid: 'p7', project_founder_id: 9, project_name: 'Harbor Ledger', status: 'active', target_raise: 1000000, capital_committed: 0, minimum_check: 25000 };
const FOUNDER = { id: 30, role: 'founder', founder_id: 9, name: 'Bram', email: 'bram@example.com' };
const ADMIN = { id: 1, role: 'admin', name: 'Ann', email: 'ann@example.com' };
const PARTNER = { id: 40, role: 'partner', name: 'Pat', email: 'pat@example.com' };
const DOCS = [
  { id: 1, title: 'Synthetic SAFE', doc_type: 'safe', status: 'signed', in_paper: true },
  { id: 2, title: 'Synthetic memo', doc_type: 'board_memo', status: 'draft', in_paper: false },
];
const ROOM = { files: [{}, {}, {}], folders: [{}], grants: [{ status: 'active' }, { status: 'revoked' }], week: { opened: 5 } };

/** The default world: every read answers; `over` replaces a route's answer by a regex key. */
function world(over = {}) {
  return (url) => {
    for (const [re, body] of Object.entries(over)) if (new RegExp(re).test(url)) return typeof body === 'function' ? body() : body;
    if (/\/api\/deals\/4\/documents/.test(url)) return response(DOCS);
    if (/\/api\/legal\/esign\?/.test(url)) return response({ envelopes: [] });
    if (/\/api\/data-room\/p7\/requests/.test(url)) return response({ requests: [], open: 2 });
    if (/\/api\/data-room\/p7(\?|$)/.test(url)) return response(ROOM);
    if (/\/api\/deals\/4\/activity/.test(url)) return response([]);
    if (/\/api\/deals\/4\/commitments/.test(url)) return response([]);
    if (/\/api\/deals\/4(\?|$)/.test(url)) return response(DEAL);
    return response({});
  };
}

async function mounted(url, user, handler) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u) => { requests.push(String(u)); return handler(String(u)); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const at = { path: url };
  function Probe() { const l = useLocation(); at.path = l.pathname; return null; }
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null,
    h(Routes, null,
      h(Route, { path: '/deals/:dealId', element: h(DealRoomPage) }),
      h(Route, { path: '/deals/:dealId/:tab', element: h(DealRoomPage) })),
    h(Probe)))));
  await act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); });
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const ids = () => nodes().map((n) => props(n)['data-testid']).filter(Boolean);
  return {
    requests, at, text: () => text(container), ids,
    textOf: (id) => text(nodes().find((n) => props(n)['data-testid'] === id)),
    hrefOf: (id) => props(nodes().find((n) => props(n)['data-testid'] === id)).href,
    current: () => nodes().filter((n) => props(n)['aria-current'] === 'page').map((n) => props(n)['data-testid']),
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}


/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the viewer: the founder, an Admin (a Super Admin reads as one) and an Operating Partner; nobody else', () => {
  assert.deepEqual(['founder', 'admin', 'super', 'partner', 'investor', null].map(documentsViewer), ['founder', 'admin', 'admin', 'partner', null, null]);
});

test('a document row always carries a reason, since no route serves its text; one sent through e-sign points to Deal paper', () => {
  // Mutation checked: `d.in_paper === true` → `d.in_paper` → the string 'false' would point to Deal paper.
  assert.deepEqual(documentRow(DOCS[0]), { id: 1, title: 'Synthetic SAFE', kind: 'Safe', status: 'Signed', reason: IN_PAPER_REASON, inPaper: true });
  assert.equal(documentRow(DOCS[1]).reason, NO_FILE_REASON);
  assert.equal(documentRow(DOCS[1]).kind, 'Board memo');
  assert.equal(documentRow({ id: 3, in_paper: 'false', status: 'odd' }).reason, NO_FILE_REASON);
  assert.equal(documentRow({ id: 3, status: 'odd' }).status, 'Not recorded');
});

test('the founder\'s counts: a count the read did not carry is null (Not recorded), never 0', () => {
  assert.deepEqual(roomCounts(ROOM), { files: 3, folders: 1, granted: 1, opened: 5 });
  assert.deepEqual(roomCounts({}), { files: null, folders: null, granted: null, opened: null });
  assert.equal(roomCounts(null), null);
  assert.equal(pendingRequests({ open: 2 }), 2);
  assert.equal(pendingRequests({ requests: [{ state: 'open' }, { state: 'accepted' }] }), 1);
  assert.equal(pendingRequests({}), null);
  assert.deepEqual([requestsLine(0), requestsLine(1), requestsLine(3), requestsLine(null)], [
    'No investor is waiting for access.', '1 investor is waiting for your answer.', '3 investors are waiting for your answer.', null]);
  assert.equal(roomHref('requests', 7), '/raise/data-room/requests?project_id=7');
  assert.equal(roomHref('', 7), '/raise/data-room?project_id=7');
});

/* ------------------------------------------------------------------ *
 * Each role's view
 * ------------------------------------------------------------------ */

test('the founder: their data room and their pending access requests, one click each; the paper and the documents', async () => {
  const v = await mounted('/deals/4/documents', FOUNDER, world());
  try {
    const ids = v.ids();
    assert.ok(ids.includes('deal-docs-founder'), v.text());
    assert.equal(v.hrefOf('deal-docs-room-open'), '/raise/data-room?project_id=7', 'one click to the data room');
    assert.equal(v.hrefOf('deal-docs-requests-open'), '/raise/data-room/requests?project_id=7', 'one click to where they decide');
    assert.equal(v.hrefOf('deal-docs-room-activity'), '/raise/data-room/activity?project_id=7');
    assert.match(v.textOf('deal-docs-room-files'), /3/);
    assert.match(v.textOf('deal-docs-room-grants'), /1/);
    assert.match(v.textOf('deal-docs-room-opened'), /5/);
    assert.match(v.textOf('deal-docs-requests-line'), /2 investors are waiting for your answer\./);
    assert.match(v.textOf('deal-docs-requests-open'), /Decide 2 requests/);
    assert.ok(v.requests.some((u) => /\/api\/data-room\/p7\/requests/.test(u)), 'the requests are read for this venture');
    assert.ok(!ids.includes('deal-docs-room-line'), 'the staff line is not the founder\'s');
    assert.equal(ids.filter((id) => id === 'deal-docs-row').length, 2);
    assert.equal(ids.filter((id) => id === 'deal-docs-row-reason').length, 2, 'every row has its reason');
  } finally { await v.close(); }
});

test('the founder: an unreadable room or requests read says Unreadable with Try again, never empty', async () => {
  const fail = () => response({ detail: 'down' }, 503);
  const v = await mounted('/deals/4/documents', FOUNDER, world({ '/api/data-room/p7(\\?|$)': fail, '/api/data-room/p7/requests': fail, '/api/deals/4/documents': fail }));
  try {
    const t = v.text();
    assert.match(t, /That is not a claim that it is empty\./);
    assert.match(t, /That is not a claim that nobody asked\./);
    assert.match(t, /That is not a claim that no documents exist\./);
    assert.doesNotMatch(t, /No document is recorded/);
    assert.doesNotMatch(t, /No investor is waiting/);
    assert.ok(v.ids().includes('deal-docs-requests-open'), 'the founder still reaches Requests in one click');
  } finally { await v.close(); }
});

test('an Admin: every envelope, the documents with their reasons, and the support-read line; no room read', async () => {
  const v = await mounted('/deals/4/documents', ADMIN, world({ '/api/deals/4/documents': () => response([]) }));
  try {
    assert.ok(v.ids().includes('deal-docs-admin'), v.text());
    assert.equal(v.textOf('deal-docs-room-line'), ROOM_LINE.admin);
    assert.equal(v.textOf('deal-docs-none'), DOCS_NONE);
    assert.match(v.textOf('deal-paper'), /Every envelope sent on this deal\./);
    assert.ok(!v.requests.some((u) => /\/api\/data-room\//.test(u)), 'staff never read the founder\'s room here');
  } finally { await v.close(); }
});

test('an Operating Partner: the NDA reason on the documents, the room closed to them in words', async () => {
  const nda = () => response({ error: 'nda_required', detail: 'Sign the venture\'s NDA to see its documents.' }, 403);
  const v = await mounted('/deals/4/documents', PARTNER, world({ '/api/deals/4/documents': nda }));
  try {
    assert.ok(v.ids().includes('deal-docs-partner'), v.text());
    assert.equal(v.textOf('deal-docs-room-line'), ROOM_LINE.partner);
    assert.ok(v.ids().includes('deal-documents-nda'), 'the NDA is a reason, not a failure');
    assert.doesNotMatch(v.text(), /That is not a claim that no documents exist/);
  } finally { await v.close(); }
});

test('the legacy list is gone: no "No documents yet", and the page draws the frame\'s tab', () => {
  const page = readFileSync(new URL('../src/pages/DealRoomPage.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /No documents yet/);
  assert.match(page, /import DealDocumentsStaff from '\.\/deal\/DealDocumentsStaff'/);
});
