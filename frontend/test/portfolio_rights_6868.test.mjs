/**
 * D6868 (#6868, canvas PRM18 and PRM19): Ownership & rights' holding line, "Rights under your documents" and the
 * investor's requests that HQ record a right. The model is checked directly; `OwnershipRights` is mounted against a
 * stubbed `fetch` in its populated, nothing-recorded, unreadable and asking states; the company page is checked to
 * draw it on Financials above the duties.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/portfolio_rights_6868.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import OwnershipRights from '../src/pages/portfolio/OwnershipRights.jsx';
import RightsAdmin from '../src/pages/portfolio/RightsAdmin.jsx';
import {
  NOT_RECORDED_AT_CLOSING, RIGHT_TYPES, adminRightsOf, askProblem, askRefusal, askableTypes, holdingCells, nothingRecorded, recordProblem, requestRows, rightsRows,
} from '../src/pages/portfolio/rightsModel.js';
import { portfolioRightsApi } from '../src/lib/api/portfolioRights.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const none = (type) => ({ type, recorded: false });
const PRO_RATA = { uid: 'g1', type: 'pro_rata', recorded: true, document_title: 'Investors’ Rights Agreement', clause: '§2.1', terms: 'Buy up to your share of new securities, on the same terms', signed_on: '2026-03-31', recorded_at: '2026-04-01T10:00:00Z' };
const ANTI = { uid: 'g2', type: 'anti_dilution', recorded: true, document_title: 'Restated Certificate', clause: 'Art. IV §4(d)', terms: 'Broad-based weighted average', signed_on: null, recorded_at: '2026-04-01T10:00:00Z' };
const RIGHTS = { scope: 'own_rights', project: { uid: 'p-abc', name: 'Acme Robotics' }, rights: RIGHT_TYPES.map((t) => (t === 'pro_rata' ? PRO_RATA : t === 'anti_dilution' ? ANTI : none(t))), requests: [] };
const OPEN_OBSERVER = { uid: 'q1', project_uid: 'p-abc', type: 'observer_seat', description: 'IRA §3.3, page 9', state: 'open', created_at: '2026-11-14T09:00:00Z', answered_at: null, right_uid: null, answer_note: null };
const DECLINED_BOARD = { uid: 'q0', project_uid: 'p-abc', type: 'board_seat', description: 'IRA §3.1', state: 'declined', created_at: '2026-11-01T09:00:00Z', answered_at: '2026-11-03T09:00:00Z', right_uid: null, answer_note: 'The seat is the Series Seed majority’s.' };
const POSITION = { total_invested: 1500000, rounds: 2, latest_ownership_pct: 6.2, latest_round: 'Seed extension', latest_date: '2026-03-31' };

/* ------------------------------------------------------------------ the model */

test('model: seven rows in the canvas’s order; an unrecorded right reads Not recorded at closing, never none', () => {
  const rows = rightsRows(RIGHTS, { state: 'ok', count: 5 });
  assert.deepEqual(rows.map((r) => r.key), ['reporting', ...RIGHT_TYPES]);
  assert.equal(rows[0].state, 'recorded');
  assert.equal(rows[0].count, 5);
  const pr = rows.find((r) => r.type === 'pro_rata');
  assert.equal(pr.state, 'recorded');
  assert.equal(pr.source.doc, 'Investors’ Rights Agreement §2.1');
  assert.equal(pr.source.signed, 'signed 31 Mar 2026');
  assert.equal(rows.find((r) => r.type === 'anti_dilution').source.signed, 'signing date not recorded');
  const obs = rows.find((r) => r.type === 'observer_seat');
  assert.equal(obs.state, 'not_recorded');
  assert.equal(obs.source, null);
  assert.equal(obs.terms, null);
  assert.equal(NOT_RECORDED_AT_CLOSING, 'Not recorded at closing');
  // The duties row carries the duties read's own state: a failure is not "none".
  assert.equal(rightsRows(RIGHTS, { state: 'unreadable' })[0].state, 'unreadable');
  assert.equal(rightsRows(RIGHTS, { state: 'ok', count: 0 })[0].state, 'none');
});

test('model: an open request marks its right and leaves the ask for the others; nothing recorded is only no duty and no right', () => {
  const rows = rightsRows({ ...RIGHTS, requests: [OPEN_OBSERVER] }, { state: 'ok', count: 5 });
  assert.deepEqual(rows.find((r) => r.type === 'observer_seat').open, { uid: 'q1', since: '14 Nov 2026' });
  assert.deepEqual(askableTypes(rows), ['information_rights', 'board_seat', 'liquidation_preference']);
  assert.equal(nothingRecorded(rows), false);
  const bare = rightsRows({ rights: RIGHT_TYPES.map(none), requests: [] }, { state: 'ok', count: 0 });
  assert.equal(nothingRecorded(bare), true);
  // A failed duties read is not "nothing recorded".
  assert.equal(nothingRecorded(rightsRows({ rights: RIGHT_TYPES.map(none), requests: [] }, { state: 'unreadable' })), false);
});

test('model: the holding line says what the book holds and Not recorded for what it does not', () => {
  const cells = holdingCells(POSITION, 'syndicate');
  assert.deepEqual(cells.map((c) => [c.key, c.value]), [['route', 'Via a syndicate (SPV)'], ['rounds', '2 rounds'], ['invested', '$1,500,000'], ['ownership', '6.2%']]);
  assert.equal(cells[3].label, 'Ownership % · as recorded 31 Mar 2026');
  const bare = holdingCells({ rounds: 0, total_invested: null, latest_ownership_pct: null }, null);
  assert.ok(bare.every((c) => c.value === null), 'nothing recorded is null, never a zero');
  assert.equal(bare[0].note, 'no reporting duty records how this is held');
});

test('model: requests newest first with their state words; a decline carries HQ’s reason; the form and refusals', () => {
  const rows = requestRows([DECLINED_BOARD, OPEN_OBSERVER]);
  assert.deepEqual(rows.map((r) => r.key), ['q1', 'q0']);
  assert.equal(rows[0].stateText, 'Requested · 14 Nov 2026');
  assert.equal(rows[1].stateText, 'Declined · 3 Nov 2026');
  assert.equal(rows[1].note, 'The seat is the Series Seed majority’s.');
  assert.equal(askProblem({ type: 'pro_rata', description: '  ' }), 'Say where the right is written: the document and its clause.');
  assert.equal(askProblem({ type: 'pro_rata', description: 'x' }, ['board_seat']), 'Choose which right to record.');
  assert.equal(askProblem({ type: 'pro_rata', description: 'Side letter §2' }), null);
  assert.match(askRefusal({ code: 'request_open', message: 'raw worker words' }), /already asked HQ/);
  assert.doesNotMatch(askRefusal({ message: 'SQLITE_ERROR' }), /SQLITE/, 'a Worker detail never reaches the page');
});

test('client: each method names a mounted path', () => {
  const route = readFileSync(new URL('../../cloudflare-worker/src/routes/portfolio_rights.ts', import.meta.url), 'utf8');
  assert.match(route, /path: '\/api\/portfolio-rights'/);
  for (const m of ["r.get('/:projectUid'", "r.post('/requests'", "r.put('/:projectUid/holders/:holderId/:type'", "r.patch('/requests/:uid'"]) assert.ok(route.includes(m), m);
  assert.equal(typeof portfolioRightsApi.company, 'function');
});

/* ------------------------------------------------------------------ the section */

async function mount(routes, props = {}) {
  const restore = installDocument();
  const prev = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (u, opts = {}) => {
    const path = String(u).replace(/^.*\/api/, '');
    const method = opts.method || 'GET';
    asked.push({ path, method, body: opts.body ? JSON.parse(opts.body) : null });
    const hit = routes[`${method} ${path}`];
    const out = typeof hit === 'function' ? await hit(opts) : hit;
    if (out && out.__status) return response({ error: out.code, message: out.message || 'refused' }, out.__status);
    return response(out ?? {});
  };
  localStorage.setItem('user', JSON.stringify({ id: 6, role: 'investor', name: 'Ivy' }));
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const flush = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  await act(async () => root.render(h(MemoryRouter, null, h(OwnershipRights, {
    uid: 'p-abc', position: POSITION, route: 'syndicate', duties: { state: 'ok', count: 5 }, reportsHref: '/portfolio/companies/p-abc/reports', ...props,
  }))));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(txt).join(' ') || n.textContent || '');
  return {
    asked, has: (id) => !!by(id), props: (id) => pr(by(id)),
    text: (id) => txt(id ? by(id) : document.body).replace(/\s+/g, ' ').trim(),
    click: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onClick({ preventDefault() {} }); }); await flush(); },
    change: async (id, value) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onChange({ target: { value } }); }); },
    submit: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { await pr(n).onSubmit({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = prev; localStorage.removeItem('user'); restore(); },
  };
}

test('section: populated — the holding line, seven rows with their sources, Not recorded at closing with Ask HQ, no primary action', async () => {
  const v = await mount({ 'GET /portfolio-rights/p-abc': RIGHTS });
  try {
    assert.match(v.text('rights-holding'), /Holding route Via a syndicate \(SPV\).*2 rounds.*\$1,500,000.*6\.2%/);
    assert.match(v.text('rights-row-reporting'), /Reporting duties .* 5 duties · listed below/);
    assert.match(v.text('rights-row-pro_rata'), /Investors’ Rights Agreement §2\.1 signed 31 Mar 2026 Buy up to your share/);
    assert.match(v.text('rights-row-pro_rata'), /Read only/);
    assert.match(v.text('rights-row-observer_seat'), /Not recorded at closing Not recorded at closing Ask HQ to record…/);
    assert.equal(v.props('rights-row-observer_seat')['data-state'], 'not_recorded');
    assert.equal(v.props('rights-see-reporting').href, '/portfolio/companies/p-abc/reports');
    assert.equal(v.has('button-rights-ask'), false, 'no primary action when rights are recorded');
    assert.equal(v.has('rights-none'), false);
  } finally { await v.close(); }
});

test('section: asking — the form names the right, is checked before sending, posts, and reads back Requested', async () => {
  let rights = RIGHTS;
  const v = await mount({
    'GET /portfolio-rights/p-abc': () => rights,
    'POST /portfolio-rights/requests': (opts) => { rights = { ...RIGHTS, requests: [{ ...OPEN_OBSERVER, description: JSON.parse(opts.body).description }] }; return rights.requests[0]; },
  });
  try {
    await v.click('button-rights-ask-observer_seat');
    assert.equal(v.props('rights-ask-type').value, 'observer_seat', 'the form starts on the row asked from');
    await v.submit('rights-ask-form');
    assert.match(v.text('rights-ask-error'), /Say where the right is written/);
    assert.equal(v.asked.filter((a) => a.method === 'POST').length, 0, 'nothing is sent before the form is complete');
    await v.change('rights-ask-description', 'IRA §3.3, page 9');
    await v.submit('rights-ask-form');
    const post = v.asked.find((a) => a.method === 'POST');
    assert.deepEqual(post.body, { project_uid: 'p-abc', type: 'observer_seat', description: 'IRA §3.3, page 9' });
    assert.equal(v.has('rights-ask-form'), false);
    assert.match(v.text('rights-ask-sent'), /Sent\. HQ answers on this page/);
    assert.match(v.text('rights-open-observer_seat'), /Requested · 14 Nov 2026/);
    assert.match(v.text('rights-request-q1'), /Observer seat IRA §3\.3, page 9 Requested · 14 Nov 2026/);
    assert.equal(v.has('button-rights-ask-observer_seat'), false, 'no second request for the same right');
  } finally { await v.close(); }
});

test('section: a refusal is worded by its code and keeps the form', async () => {
  const v = await mount({
    'GET /portfolio-rights/p-abc': RIGHTS,
    'POST /portfolio-rights/requests': { __status: 409, code: 'request_open', message: 'raw words' },
  });
  try {
    await v.click('button-rights-ask-board_seat');
    await v.change('rights-ask-description', 'IRA §3.1');
    await v.submit('rights-ask-form');
    assert.match(v.text('rights-ask-error'), /You already asked HQ to record this right/);
    assert.doesNotMatch(v.text('rights-ask-error'), /raw words/);
    assert.ok(v.has('rights-ask-form'));
  } finally { await v.close(); }
});

test('section: nothing recorded (PRM19 a) — said plainly with Ask HQ to record a right…, and a declined request shows HQ’s reason', async () => {
  const v = await mount({ 'GET /portfolio-rights/p-abc': { rights: RIGHT_TYPES.map(none), requests: [DECLINED_BOARD] } }, { duties: { state: 'ok', count: 0 } });
  try {
    assert.match(v.text('rights-none'), /Your documents grant no reporting duty, and no other right is recorded/);
    assert.equal(v.has('rights-table'), false);
    assert.ok(v.has('button-rights-ask'));
    assert.match(v.text('rights-request-q0'), /Board seat IRA §3\.1 Declined · 3 Nov 2026 HQ: The seat is the Series Seed majority’s\./);
    await v.click('button-rights-ask');
    assert.ok(v.has('rights-ask-form'));
  } finally { await v.close(); }
});

test('section: an unreadable rights read says so with Retry and offers no ask; the holding line still stands', async () => {
  let fail = true;
  const v = await mount({ 'GET /portfolio-rights/p-abc': () => (fail ? { __status: 500, code: 'boom' } : RIGHTS) });
  try {
    assert.match(v.text('rights-unreadable'), /could not be read\. That is not a claim that none is recorded/);
    assert.equal(v.has('rights-table'), false);
    assert.equal(v.has('button-rights-ask'), false);
    assert.ok(v.has('rights-holding'));
    fail = false;
    await v.click('button-retry-rights');
    assert.ok(v.has('rights-table'));
  } finally { await v.close(); }
});

test('section: a session that cannot act (support) reads the rows and is offered no ask', async () => {
  const v = await mount({ 'GET /portfolio-rights/p-abc': RIGHTS }, { canAsk: false });
  try {
    assert.equal(v.has('button-rights-ask-observer_seat'), false);
    assert.match(v.text('rights-row-observer_seat'), /No action until HQ records it/);
  } finally { await v.close(); }
});

test('page: Financials draws the rights section inside Ownership & rights, above the duties', () => {
  const src = readFileSync(new URL('../src/pages/investor/PortfolioCompanyPage.jsx', import.meta.url), 'utf8');
  const at = src.indexOf('<OwnershipRights');
  assert.ok(at > src.indexOf('id={OWNERSHIP_ANCHOR}'), 'inside the anchored section');
  assert.ok(at < src.indexOf('<TermsCard company={c} />'), 'above the duties');
  assert.ok(at < src.indexOf('<InvestorCapTablePanel'), 'above the cap table');
});

/* ------------------------------------------------------------------ HQ's side */


const ADMIN_READ = {
  scope: 'all_holders', project: { uid: 'p-abc', name: 'Acme Robotics' }, types: RIGHT_TYPES,
  holders: [{ id: 2, name: 'Hal' }],
  rights: [{ ...PRO_RATA, holder: { id: 2, name: 'Hal' } }],
  requests: [
    { ...OPEN_OBSERVER, requester: { id: 9, name: 'Hal’s analyst' }, holder_id: 2 },
    { ...DECLINED_BOARD, requester: { id: 2, name: 'Hal' }, holder_id: 2 },
  ],
};

test('admin model: the queue first, each holder’s six rights, answered requests; the record form’s own check', () => {
  const m = adminRightsOf(ADMIN_READ);
  assert.deepEqual(m.open.map((q) => q.uid), ['q1']);
  assert.deepEqual(m.answered.map((q) => q.uid), ['q0']);
  assert.equal(m.holders[0].rights.length, 6);
  assert.equal(m.holders[0].rights.find((r) => r.type === 'pro_rata').recorded, true);
  assert.equal(m.holders[0].rights.find((r) => r.type === 'board_seat').recorded, false);
  assert.equal(recordProblem({ documentTitle: ' ', terms: 'x' }), 'Name the signed document the right is in.');
  assert.equal(recordProblem({ documentTitle: 'IRA', terms: '' }), 'Say what the right grants, as the document says it.');
  assert.equal(recordProblem({ documentTitle: 'IRA', terms: 'x', signedOn: '' }), null);
});

async function mountAdmin(routes) {
  const restore = installDocument();
  const prev = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (u, opts = {}) => {
    const path = String(u).replace(/^.*\/api/, '');
    const method = opts.method || 'GET';
    asked.push({ path, method, body: opts.body ? JSON.parse(opts.body) : null });
    const hit = routes[`${method} ${path}`];
    const out = typeof hit === 'function' ? await hit(opts) : hit;
    if (out && out.__status) return response({ error: out.code, message: 'refused' }, out.__status);
    return response(out ?? {});
  };
  localStorage.setItem('user', JSON.stringify({ id: 1, role: 'admin', name: 'Ada' }));
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const flush = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  await act(async () => root.render(h(RightsAdmin, { projectUid: 'p-abc', companyName: 'Acme Robotics' })));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(txt).join(' ') || n.textContent || '');
  return {
    asked, has: (id) => !!by(id), props: (id) => pr(by(id)),
    text: (id) => txt(id ? by(id) : document.body).replace(/\s+/g, ' ').trim(),
    click: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onClick({ preventDefault() {} }); }); await flush(); },
    change: async (id, value) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onChange({ target: { value } }); }); },
    submit: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { await pr(n).onSubmit({ preventDefault() {} }).catch?.(() => {}); }); await flush(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = prev; localStorage.removeItem('user'); restore(); },
  };
}

test('admin panel: Record from the queue records the holder’s right and answers the request; the list is read again', async () => {
  let reads = 0;
  const v = await mountAdmin({
    'GET /portfolio-rights/p-abc': () => { reads += 1; return ADMIN_READ; },
    'PUT /portfolio-rights/p-abc/holders/2/observer_seat': { uid: 'g9' },
  });
  try {
    assert.match(v.text('admin-right-request-q1'), /Record Observer seat · Hal’s analyst · Requested · 14 Nov 2026 IRA §3\.3, page 9/);
    assert.match(v.text('admin-right-2-pro_rata'), /Pro rata · Investors’ Rights Agreement §2\.1 · Buy up to/);
    assert.equal(v.props('admin-right-2-board_seat')['data-recorded'], 'no');
    await v.click('button-record-request-q1');
    assert.equal(v.props('button-save-right-q1').disabled, true, 'nothing is sent until the paper’s fields are given');
    await v.change('input-right-document-q1', 'Investors’ Rights Agreement');
    await v.change('input-right-clause-q1', '§3.3');
    await v.change('input-right-terms-q1', 'One observer seat at board meetings');
    await v.submit('form-right-q1');
    const put = v.asked.find((a) => a.method === 'PUT');
    assert.equal(put.path, '/portfolio-rights/p-abc/holders/2/observer_seat', 'recorded for the requester’s seat holder');
    assert.deepEqual(put.body, { document_title: 'Investors’ Rights Agreement', clause: '§3.3', terms: 'One observer seat at board meetings', signed_on: null, request_uid: 'q1' });
    assert.equal(reads, 2, 'read again after the write');
  } finally { await v.close(); }
});

test('admin panel: Decline takes a reason; a refusal keeps the form; unreadable never says none', async () => {
  let fail = false;
  const v = await mountAdmin({
    'GET /portfolio-rights/p-abc': () => (fail ? { __status: 500, code: 'boom' } : ADMIN_READ),
    'PATCH /portfolio-rights/requests/q1': { __status: 400, code: 'note_required' },
  });
  try {
    await v.click('button-decline-request-q1');
    assert.equal(v.props('button-send-decline-right-q1').disabled, true);
    await v.change('input-decline-right-q1', 'Not in the signed paper');
    await v.submit('form-decline-right-q1');
    assert.deepEqual(v.asked.find((a) => a.method === 'PATCH').body, { state: 'declined', note: 'Not in the signed paper' });
    assert.match(v.text('decline-right-error-q1'), /Say why, in words the investor reads/);
    assert.ok(v.has('form-decline-right-q1'), 'the form stays');
    fail = true;
    await v.click('button-cancel-decline-right-q1');
  } finally { await v.close(); }
  const u = await mountAdmin({ 'GET /portfolio-rights/p-abc': { __status: 500, code: 'boom' } });
  try {
    assert.match(u.text('admin-rights-unreadable'), /could not be read.*not a claim that none is/);
    assert.equal(u.has('admin-rights-none'), false);
  } finally { await u.close(); }
});

test('page: the admin position sheet draws Investors’ rights for its company', () => {
  const src = readFileSync(new URL('../src/pages/PortfolioPositionsPage.jsx', import.meta.url), 'utf8');
  assert.match(src, /isAdmin && detail\.project\?\.uid \? <RightsAdmin key=\{detail\.project\.uid\} projectUid=\{detail\.project\.uid\}/);
});
