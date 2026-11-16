// D1153 (#3058, part 5 of #2421) — the investor's working tabs: Diligence
// (DL7), Documents and data room (DL8, DL9), Terms (DL10) and Commitment and
// closing (DL11–DL13), on stubbed reads.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_work_d1153.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import DealRoomPage from '../src/pages/DealRoomPage.jsx';
import { forgetVisits } from '../src/pages/deal/dealVisit.js';
import {
  caseForDeal, caseCard, requestRows, roomStateOf, roomListing, paperRows, proposedTerms, myCommitment, roundLines, withdrawError, NOTE_READERS,
} from '../src/pages/deal/dealWorkModel.js';
import { paperSigning, signedLine } from '../src/pages/deal/dealWorkModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const ready = (data) => ({ status: 'ready', data });

const DEAL = { id: 4, project_id: 7, project_name: 'Harbor Ledger', project_sector: 'Fintech', status: 'active', currency: 'USD', target_raise: 1000000, capital_committed: 250000, minimum_check: 25000, instrument: 'Post-money SAFE', valuation_cap: 12000000, closing_deadline: '2026-12-01' };
const INVESTOR = { id: 21, role: 'investor', name: 'Ada', email: 'ada@example.com', subscription_tier: 'professional' };
const ROOM = {
  project: { uid: 'harbor', name: 'Harbor Ledger' }, nda_signed: false,
  folders: [{ uid: 'f1', name: 'Legal' }], files: [{ uid: 'a', name: 'Certificate of incorporation.pdf', folder_uid: 'f1', size_bytes: 245760, created_at: '2026-01-14 09:00:00' }, { uid: 'b', name: 'Product overview.pdf', folder_uid: null, size_bytes: 400, created_at: null }],
  withheld_behind_nda: 6,
};

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the room\'s three access states; behind an NDA the withheld files are a count and only the read\'s files are listed', () => {
  // Mutation checked: the withheld count dropped; an open request still offering Ask; the NDA state ignored.
  assert.equal(roomStateOf({ status: 'ready', data: { granted: null, request: null } }).state, 'not_opened');
  assert.equal(roomStateOf({ status: 'ready', data: { granted: null, request: null } }).canAsk, true);
  const asked = roomStateOf({ status: 'ready', data: { granted: null, request: { state: 'open', created_at: '2026-10-20 10:00:00' } } });
  assert.deepEqual([asked.canAsk, asked.line], [false, 'You asked for access on 20 Oct 2026. The founder decides; you’ll get a notice either way.']);
  assert.match(roomStateOf({ status: 'ready', data: { granted: null, request: { state: 'declined', decided_at: '2026-10-21', decline_reason: 'Not yet.' } } }).line, /declined your request on 21 Oct 2026: Not yet\./);
  const access = { status: 'ready', data: { granted: { expires_at: null }, founder_user_id: 9, nda: null } };
  const nda = roomStateOf(access, ready(ROOM));
  assert.deepEqual([nda.state, nda.withheld, nda.canSign, nda.line], ['behind_nda', 6, true, 'You have access. 6 files are behind an NDA.']);
  assert.equal(roomStateOf({ ...access, data: { ...access.data, nda: { status: 'out_for_signature' } } }, ready(ROOM)).canSign, false, 'an NDA out for signature is not asked for twice');
  const on = roomStateOf({ status: 'ready', data: { granted: { expires_at: null }, nda: { status: 'on_file', valid_until: '2027-10-09 00:00:00' } } }, ready({ ...ROOM, nda_signed: true, withheld_behind_nda: 0 }));
  assert.deepEqual([on.state, on.line], ['nda_on_file', 'You have access and an NDA on file until 9 Oct 2027.']);
  const listing = roomListing(ROOM);
  assert.deepEqual(listing.files.map((f) => f.name), ['Certificate of incorporation.pdf', 'Product overview.pdf'], 'exactly the files the read returned');
  assert.deepEqual(listing.folders, [{ uid: 'f1', name: 'Legal', count: 1 }]);
  assert.deepEqual([listing.files[0].size, listing.files[1].size, listing.files[1].added], ['240 KB', '400 B', 'Not recorded']);
  assert.equal(roomStateOf({ status: 'unreadable' }).state, 'unreadable');
});

test('Diligence: your case on this company only, its card and requests', () => {
  // Mutation checked: another company's case taken; an archived case taken; waiting days miscounted; a withdrawn request waiting.
  // D6181 (#6181): the list is read for this company alone, so a large total is no longer "not in the read".
  const read = ready({ items: [{ uid: 'x', subject_type: 'project', subject_id: 8, status: 'open' }, { uid: 'old', subject_type: 'project', subject_id: 7, status: 'archived' }, { uid: 'dd1', subject_type: 'project', subject_id: 7, status: 'in_review', stage: 'in_review', subject_label: 'Harbor Ledger', checklist_total: 52, checklist_worked: 38, open_flags: 3, risk_band: 'moderate', created_at: '2026-10-01 08:00:00', lead_name: 'Ada', owner_user_id: 21 }], total: 3 });
  const found = caseForDeal(read, 7);
  assert.equal(found.row.uid, 'dd1');
  assert.equal(caseForDeal(ready({ items: [], total: 0 }), 7).state, 'none');
  assert.equal(caseForDeal(ready({ items: [{ uid: 'x', subject_type: 'project', subject_id: 8 }], total: 400 }), 7).state, 'none', 'D6181: no not_in_read state');
  const card = caseCard(found.row, { sections: [{ id: 1, title: 'Financial health', status: 'assigned', assignee_user_id: 21 }, { id: 2, title: 'Legal', status: 'assigned', assignee_user_id: 9 }], reviewers: [] }, 21);
  assert.deepEqual([card.stage, card.risk, card.items.line, card.items.pct, card.flags, card.opened, card.href], ['In review', 'Moderate risk', '38 of 52 items worked', 73, '3 open flags', 'Opened 1 Oct 2026 · led by Ada', '/admin/due-diligence/dd1']);
  assert.deepEqual(card.yours, [{ title: 'Financial health', status: 'Open' }]);
  assert.equal(caseCard({ ...found.row, checklist_total: 0, risk_band: null, open_flags: 0 }, null, 21).items.line, 'No checklist items are recorded on this case.');
  const now = Date.parse('2026-10-25T12:00:00Z');
  assert.deepEqual(requestRows({ requests: [
    { id: 1, title: 'Burn plan', state: 'requested', created_at: '2026-10-21 08:00:00', due_date: '2026-10-30' },
    { id: 2, title: 'Customers', state: 'received', responded_at: '2026-10-19' },
    { id: 3, title: 'Patent receipt', state: 'requested', created_at: '2026-10-20', withdrawn_at: '2026-10-22 09:00:00' },
  ] }, now).map((r) => [r.state, r.tone]), [['Waiting 4 days · due 30 Oct 2026', 'wait'], ['Answered 19 Oct 2026', 'done'], ['Withdrawn 22 Oct 2026', 'off']], 'D1248: a withdrawn request never waits');
});

test('Terms: each from the deal, and a term no field holds is Not recorded with its reason, never 0', () => {
  // Mutation checked: a missing figure drawn as $0; the four unheld terms dropped.
  const rows = proposedTerms(DEAL);
  const by = Object.fromEntries(rows.map((r) => [r.label, r]));
  assert.deepEqual([by.Instrument.value, by['Round size'].value, by['Valuation cap'].value, by.Minimum.value, by['Closing date'].value], ['Post-money SAFE', '$1,000,000', '$12,000,000', '$25,000', '1 Dec 2026']);
  assert.equal(by.Instrument.source, 'From the deal');
  assert.deepEqual([by.Carry.value, by.Carry.source], ['Not recorded', 'The deal does not record it.']);
  for (const t of ['Discount', 'Pro rata', 'Information rights', 'Board seat']) assert.deepEqual([by[t].value, by[t].source], ['Not recorded', 'No field on the deal holds it yet.'], t);
  assert.ok(proposedTerms({}).every((r) => !/\$0\b|^0$/.test(r.value)));
});

test('Commitment: yours with its note and who reads it; the round is a count and a total; withdraw needs a reason', () => {
  // Mutation checked: a withdrawn commitment drawn as live; the round naming an investor; an empty reason accepted.
  const c = myCommitment({ status: 'ready', items: [{ uid: 'old', amount: 10000, status: 'withdrawn', created_at: '2026-09-01' }, { uid: 'c1', amount: 50000, status: 'pending', notes: 'Follow on at the A.', created_at: '2026-11-04 10:00:00' }] });
  assert.deepEqual([c.state, c.uid, c.amount, c.status, c.recorded, c.note], ['ready', 'c1', '$50,000', 'Pending', 'Recorded 4 Nov 2026', 'Follow on at the A.']);
  assert.deepEqual(c.history.map((x) => x.line), ['$10,000 · Withdrawn · recorded 1 Sep 2026']);
  assert.equal(myCommitment({ status: 'ready', items: [{ uid: 'o', amount: 1, status: 'withdrawn' }] }).state, 'none');
  // D1155 (DL15): the Worker returns a note to its investor alone.
  assert.equal(NOTE_READERS, 'Only you read this note. The founder and the studio see your amount and status, never the note.');
  const r = roundLines(ready({ investors: 3, confirmed_total: 250000, pending_total: 50000, currency: 'USD' }), DEAL);
  assert.deepEqual([r.investors, r.confirmed, r.pending, r.pct], ['3 investors have a live commitment', '$250,000 confirmed of $1,000,000', '$50,000 more is pending', 25]);
  assert.match(r.privacy, /counted, never named/);
  assert.equal(withdrawError(''), 'Write why you are withdrawing.');
  assert.equal(withdrawError('   '), 'Write why you are withdrawing.');
  assert.equal(withdrawError('x'.repeat(501)), 'Keep the reason to 500 characters.');
  assert.equal(withdrawError('Allocation closed.'), null);
  assert.deepEqual(paperRows([{ id: 1, document_title: 'Three-way NDA', status: 'completed', completed_at: '2026-10-09' }, { id: 2, document_type: 'term_sheet', status: 'sent', created_at: '2026-10-18' }]).map((p) => [p.title, p.state]),
    [['Three-way NDA', 'Fully signed 9 Oct 2026'], ['term_sheet', 'Sent · sent 18 Oct 2026']]);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

function handlerWith(over = {}) {
  return (url, init = {}) => {
    const m = (init.method || 'GET').toUpperCase();
    for (const [re, fn] of Object.entries(over)) if (new RegExp(re).test(url)) { const r = fn(url, m, init); if (r) return r; }
    if (/\/api\/deals\/4\/stage/.test(url)) return response({ my_stage: 'Diligence', reason: null, next_action: { label: 'Open the diligence case', href: '/x', kind: 'navigate' }, ic: { state: 'used' } });
    if (/\/api\/deals\/4\/commitments/.test(url)) return response([]);
    if (/\/api\/deals\/4\/round/.test(url)) return response({ investors: 2, confirmed_total: 250000, pending_total: 0, currency: 'USD' });
    if (/\/api\/deals\/4\/room-access/.test(url)) return response({ project_uid: 'harbor', founder_user_id: 9, granted: { expires_at: null }, nda: null, request: null });
    if (/\/api\/data-room\/shared\/harbor/.test(url)) return response(ROOM);
    if (/\/api\/legal\/esign/.test(url)) return response({ envelopes: [] });
    if (/\/api\/dd\/cases/.test(url)) return response({ items: [], total: 0 });
    if (/\/api\/networkfx\/syndicates/.test(url)) return response([]);
    if (/\/api\/deals\/4(\?|$)/.test(url)) return response(DEAL);
    return response({});
  };
}

async function mounted(url, user, handler = handlerWith()) {
  forgetVisits();
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, init) => { requests.push({ line: `${(init?.method || 'GET').toUpperCase()} ${String(u)}`, body: init?.body ? JSON.parse(init.body) : null }); return handler(String(u), init); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null,
    h(Routes, null,
      h(Route, { path: '/deals/:dealId', element: h(DealRoomPage) }),
      h(Route, { path: '/deals/:dealId/:tab', element: h(DealRoomPage) }))))));
  const settle = async () => { await act(async () => { for (let i = 0; i < 14; i += 1) await new Promise((r) => setTimeout(r, 0)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const nodes = () => walk(document.body);
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().filter((n) => props(n)['data-testid'] === id);
  return {
    requests, text: () => text(document.body), byId,
    has: (id) => byId(id).length > 0,
    textOf: (id) => text(byId(id)[0]),
    posts: (re) => requests.filter((r) => r.line.startsWith('POST') && re.test(r.line)),
    async click(id) { const n = byId(id)[0]; assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async type(id, value) { const n = byId(id)[0]; assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange?.({ target: { value } }); }); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

test('Documents behind an NDA: the room\'s files listed, the withheld ones counted and never named, and Sign the NDA asks first', async () => {
  // Mutation checked: the withheld count not drawn; the NDA sent without its dialog.
  const v = await mounted('/deals/4/documents', INVESTOR);
  try {
    assert.ok(v.has('deal-room-state-behind_nda'));
    assert.equal(v.byId('deal-room-file').length, 2, 'only the read\'s files');
    assert.match(v.textOf('deal-room-withheld'), /6 files need your NDA/);
    assert.match(v.textOf('deal-paper'), /No envelope on this deal has been sent to you yet\./);
    await v.click('deal-room-nda');
    assert.ok(v.has('deal-room-nda-dialog'));
    assert.equal(v.posts(/trust\/intro\/request/).length, 0, 'nothing is sent before the dialog is confirmed');
  } finally { await v.close(); }
});

test('Documents not opened to you: Ask for access opens a dialog, then asks with your message', async () => {
  const v = await mounted('/deals/4/documents', INVESTOR, handlerWith({ 'room-access(\\?|$)': (u, m) => (m === 'GET' ? response({ project_uid: 'harbor', founder_user_id: 9, granted: null, nda: null, request: null }) : null) }));
  try {
    assert.ok(v.has('deal-room-state-not_opened'));
    assert.equal(v.requests.filter((r) => /data-room\/shared/.test(r.line)).length, 0, 'no room read without a grant');
    await v.click('deal-room-ask');
    assert.ok(v.has('deal-room-ask-dialog'));
    await v.click('deal-room-ask-dialog-confirm');
    assert.equal(v.posts(/room-access\/request/).length, 1);
  } finally { await v.close(); }
});

test('Commitment: Withdraw needs a reason before anything is sent, then withdraws with it; the round is a count and a total', async () => {
  // Mutation checked: the withdraw posted without a reason; the reason not sent.
  const v = await mounted('/deals/4/commitment', INVESTOR, handlerWith({ 'deals/4/commitments': (u, m) => (m === 'GET' ? response([{ id: 1, uid: 'c1', amount: 50000, status: 'pending', notes: 'Follow on.', created_at: '2026-11-04 10:00:00', investor_user_id: 21 }]) : null) }));
  try {
    assert.match(v.textOf('deal-my-commitment'), /\$50,000[\s\S]*Pending[\s\S]*Recorded 4 Nov 2026[\s\S]*Follow on\.[\s\S]*Only you read this note\./);
    assert.match(v.textOf('deal-round'), /\$250,000 confirmed of \$1,000,000[\s\S]*2 investors have a live commitment[\s\S]*counted, never named/);
    await v.click('deal-withdraw');
    assert.ok(v.has('deal-withdraw-dialog'));
    await v.click('deal-withdraw-dialog-confirm');
    assert.match(v.textOf('deal-withdraw-dialog'), /Write why you are withdrawing\./);
    assert.equal(v.posts(/withdraw/).length, 0, 'no reason, nothing sent');
    await v.type('deal-withdraw-reason', 'Our allocation closed.');
    await v.click('deal-withdraw-dialog-confirm');
    const sent = v.posts(/commitments\/c1\/withdrawal/);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].body, { reason: 'Our allocation closed.' });
    assert.ok(v.has('deal-closing-door'));
  } finally { await v.close(); }
});

test('Diligence with no case: DL7n, and Open a diligence case asks before it opens one on this company', async () => {
  const v = await mounted('/deals/4/diligence', INVESTOR);
  try {
    assert.ok(v.has('deal-dd-none'));
    assert.ok(v.has('deal-dd-questions'), 'Eadwyn’s questions are a labelled slot');
    await v.click('deal-dd-open');
    assert.equal(v.posts(/\/dd\/cases/).length, 0);
    await v.click('deal-dd-open-dialog-confirm');
    const sent = v.posts(/\/dd\/cases$/);
    assert.equal(sent.length, 1);
    assert.deepEqual([sent[0].body.subject_type, sent[0].body.subject_id], ['project', 7]);
  } finally { await v.close(); }
});

// D6181 (#6181) — the tab asks the Worker for this company's cases exactly (`subject_id`), so a caller with 201+
// cases still finds the one on this company, and Open a diligence case is never offered beside a live case.
// Mutation checked (each fails a test below):
//   - DealDiligence's `subject_id: deal.project_id` dropped → the stub answers the newest 200 of 251 other cases, no card,
//     and Open a diligence case is offered;
//   - caseForDeal's `c.status !== 'archived'` dropped → the archived case is taken over the live one;
//   - DealWorkTabs' none card also drawn for a ready case (`found.state === 'none' || found.state === 'ready'`) → Open a
//     diligence case is offered beside the live case.
const OTHER_CASES = Array.from({ length: 200 }, (_, i) => ({ uid: `other-${i}`, subject_type: 'project', subject_id: 1000 + i, status: 'open' }));
const LIVE_CASE = { uid: 'dd-live', subject_type: 'project', subject_id: 7, status: 'open', stage: 'not_started', subject_label: 'Harbor Ledger', checklist_total: 4, checklist_worked: 1, open_flags: 0, created_at: '2026-10-01 08:00:00', lead_name: 'Ada', owner_user_id: 21 };
const ARCHIVED_CASE = { ...LIVE_CASE, uid: 'dd-archived', status: 'archived', stage: 'archived' };
const casesBySubject = (forCompany) => ({
  'dd/cases\\?': (u, m) => {
    if (m !== 'GET') return null;
    const params = new URL(u, 'https://x.test').searchParams;
    if (params.get('subject_id') === '7') return response({ items: forCompany, total: forCompany.length });
    return response({ items: OTHER_CASES, total: 251 });
  },
  'dd/cases/dd-live': (u, m) => (m === 'GET' ? response({ sections: [], reviewers: [], requests: [] }) : null),
});

test('D6181: with 251 cases the Diligence tab asks for this company exactly, shows its live case and never offers to open another', async () => {
  const v = await mounted('/deals/4/diligence', INVESTOR, handlerWith(casesBySubject([ARCHIVED_CASE, LIVE_CASE])));
  try {
    const list = v.requests.filter((r) => /^GET .*\/api\/dd\/cases\?/.test(r.line));
    assert.ok(list.length >= 1, 'the case list was read');
    for (const r of list) {
      const params = new URL(r.line.slice(4), 'https://x.test').searchParams;
      assert.deepEqual([params.get('subject_type'), params.get('subject_id')], ['project', '7'], 'the list is read for this company');
    }
    assert.ok(v.has('deal-dd-case'), 'the live case on this company is found');
    assert.match(v.textOf('deal-dd-case'), /Harbor Ledger/);
    const door = v.byId('deal-dd-door')[0];
    assert.ok(door, 'the case door is drawn');
    const doorProps = Object.entries(door).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
    assert.match(String(doorProps.href ?? ''), /\/admin\/due-diligence\/dd-live$/, 'the live case, not the archived one');
    assert.equal(v.has('deal-dd-none'), false);
    assert.equal(v.has('deal-dd-open'), false, 'Open a diligence case is never offered beside a live case');
  } finally { await v.close(); }
});

test('D6181: only an archived case on this company is no live case, and the tab offers to open one', async () => {
  const v = await mounted('/deals/4/diligence', INVESTOR, handlerWith(casesBySubject([ARCHIVED_CASE])));
  try {
    assert.ok(v.has('deal-dd-none'));
    assert.ok(v.has('deal-dd-open'));
    assert.doesNotMatch(v.textOf('deal-dd-none'), /newest/, 'no "only your newest N cases" line any more');
  } finally { await v.close(); }
});

const DD_NOW = new Date('2026-11-15T12:00:00Z');
const DD_REQUESTS = [
  { id: 1, title: 'Burn plan', state: 'requested', created_at: '2026-10-21 08:00:00' },
  { id: 2, title: 'Bank statements', state: 'received', response_note: 'Attached the latest statements.',
    response_url: 'https://example.com/statements', files: [{ id: 44, name: 'Statement.pdf' }] },
  { id: 3, title: 'Insurance terms', state: 'reviewed', response_note: 'Policy renewed.', files: null },
];

function founderRequestHandler({
  owner = INVESTOR.id, lead = owner, requests = DD_REQUESTS.map((r) => ({ ...r })),
} = {}) {
  const live = { ...LIVE_CASE, owner_user_id: owner, lead_user_id: lead };
  let withdrawals = 0;
  return handlerWith({
    ...casesBySubject([live]),
    'dd/cases/dd-live': (url, method, init) => {
      const path = new URL(url, 'https://x.test').pathname;
      if (method === 'GET') return response({ case: live, sections: [], reviewers: [], requests: structuredClone(requests) });
      if (path.endsWith('/requests')) {
        const recorded = { ...JSON.parse(init.body), id: 4, state: 'requested', created_at: DD_NOW.toISOString() };
        requests.unshift(recorded);
        return response({ request: recorded }, 201);
      }
      if (path.endsWith('/remind')) return response({ error: 'A reminder was sent in the last day', code: 'reminded_recently' }, 429);
      if (path.endsWith('/withdraw')) {
        withdrawals += 1;
        if (withdrawals === 1) return response({ error: 'This request is already withdrawn', code: 'withdrawn' }, 409);
        requests.find((r) => r.id === 1).withdrawn_at = DD_NOW.toISOString();
        return response({ ok: true });
      }
      if (path.endsWith('/documents/download')) return response({ error: 'Storage not configured' }, 503);
      return null;
    },
  });
}

test('D6179: the owner sends a founder request from a dialog and sees Waiting 0 days', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: DD_NOW });
  const v = await mounted('/deals/4/diligence', INVESTOR, founderRequestHandler({ requests: [] }));
  try {
    await v.click('deal-dd-request-new');
    assert.match(v.textOf('deal-dd-new-request-dialog'), /The founder will see this/);
    await v.click('deal-dd-new-request-dialog-confirm');
    assert.match(v.textOf('deal-dd-new-request-dialog'), /Say what you need/);
    assert.equal(v.posts(/\/requests$/).length, 0);
    const due = '2026-11-16';
    await v.type('deal-dd-request-title', '  Current cash balance  ');
    await v.type('deal-dd-request-details', 'Month-end balance and currency.');
    await v.type('deal-dd-request-due', due);
    await v.click('deal-dd-new-request-dialog-confirm');
    assert.deepEqual(v.posts(/\/requests$/).map((r) => r.body), [{
      title: 'Current cash balance', details: 'Month-end balance and currency.', due_date: due,
    }]);
    assert.equal(v.has('deal-dd-new-request-dialog'), false);
    assert.match(v.textOf('deal-dd-requests'), /Current cash balanceWaiting 0 days/);
  } finally { await v.close(); }
});

test('D6179: waiting requests require confirmation, keep refusals in their dialog and refresh after withdrawal', async () => {
  const v = await mounted('/deals/4/diligence', INVESTOR, founderRequestHandler());
  try {
    await v.click('deal-dd-request-1-remind');
    assert.equal(v.posts(/\/remind$/).length, 0);
    await v.click('deal-dd-remind-dialog-confirm');
    assert.match(v.textOf('deal-dd-remind-dialog'), /A reminder was sent in the last day/);
    await v.click('deal-dd-remind-dialog-close');

    await v.click('deal-dd-request-1-withdraw');
    assert.equal(v.posts(/\/withdraw$/).length, 0);
    await v.click('deal-dd-withdraw-dialog-confirm');
    assert.match(v.textOf('deal-dd-withdraw-dialog'), /This request is already withdrawn/);
    await v.type('deal-dd-request-withdraw-reason', '  Already provided.  ');
    await v.click('deal-dd-withdraw-dialog-confirm');
    assert.deepEqual(v.posts(/\/withdraw$/).at(-1).body, { reason: 'Already provided.' });
    assert.match(v.textOf('deal-dd-requests'), /Burn planWithdrawn/);
    assert.equal(v.has('deal-dd-request-1-remind'), false);
    assert.equal(v.has('deal-dd-request-1-withdraw'), false);
  } finally { await v.close(); }
});

test('D6179: the lead can open the answer and its files, while only the owner can remind or withdraw', async () => {
  const v = await mounted('/deals/4/diligence', INVESTOR, founderRequestHandler({ owner: 24, lead: INVESTOR.id }));
  try {
    assert.ok(v.has('deal-dd-request-new'));
    assert.equal(v.has('deal-dd-request-1-remind'), false);
    assert.equal(v.has('deal-dd-request-1-withdraw'), false);
    await v.click('deal-dd-request-2-answer');
    assert.match(v.textOf('deal-dd-answer-dialog'), /Attached the latest statements\.[\s\S]*Statement\.pdf/);
    await v.click('deal-dd-answer-file-44');
    assert.deepEqual(v.posts(/\/documents\/download$/).map((r) => r.body), [{ kind: 'request_file', id: 44 }]);
    assert.match(v.textOf('deal-dd-answer-dialog'), /Storage not configured/);
    await v.click('deal-dd-answer-dialog-close');
    await v.click('deal-dd-request-3-answer');
    assert.match(v.textOf('deal-dd-answer-dialog'), /Policy renewed\.[\s\S]*Unreadable/);
  } finally { await v.close(); }
});

test('D6179: a section reviewer sees no request controls or private answer, even if a case payload includes it', async () => {
  const v = await mounted('/deals/4/diligence', INVESTOR, founderRequestHandler({ owner: 24, lead: 25 }));
  try {
    for (const id of ['new', '1-remind', '1-withdraw', '2-answer']) assert.equal(v.has(`deal-dd-request-${id}`), false);
    assert.doesNotMatch(v.textOf('deal-dd-requests'), /Burn plan|Bank statements|waiting/);
  } finally { await v.close(); }
});

test('Terms: proposed terms with their source, the slots, and How you invest says no preference is recorded (D6195)', async () => {
  const v = await mounted('/deals/4/terms', INVESTOR);
  try {
    assert.match(v.textOf('deal-term-valuation-cap'), /Valuation cap[\s\S]*From the deal[\s\S]*\$12,000,000/);
    assert.match(v.textOf('deal-term-board-seat'), /No field on the deal holds it yet\.[\s\S]*Not recorded/);
    assert.ok(v.has('deal-terms-captable'));
    assert.match(v.textOf('deal-terms-routes'), /No preference recorded\. You can record one when you commit\.[\s\S]*This is your preference\. The studio sets the route in the closing room\./);
  } finally { await v.close(); }
});

// D6184 (#6184) — the Deal paper card: the signed count, Download once fully signed (the Worker's refusal shown),
// how to sign (the emailed link; no signing URL is built in the browser), declined and unreadable.
const ENVELOPES = [
  { id: 31, document_title: 'Subscription agreement', status: 'completed', completed_at: '2026-11-02', recipient_count: 3, signed_count: 3, signed_r2_key: 'esign/signed/31.pdf' },
  { id: 32, document_title: 'Side letter', status: 'partially_signed', created_at: '2026-11-03', recipient_count: 3, signed_count: 2 },
  { id: 33, document_title: 'Term sheet', status: 'rejected', created_at: '2026-11-04', recipient_count: 2, signed_count: 0 },
];
const DETAIL_32 = { id: 32, status: 'partially_signed', recipients: [
  { id: 1, recipient_email: 'founder@example.com', status: 'signed', signed_at: '2026-11-03' },
  { id: 2, recipient_email: 'axal@example.com', status: 'signed', signed_at: '2026-11-03' },
  { id: 3, recipient_email: 'Ada@Example.com', status: 'pending', signed_at: null, token_expires_at: '2026-11-10' },
], audit_log: [], can_manage: false };
const pdf = () => ({ ok: true, status: 200, headers: { get: () => 'application/pdf' }, blob: async () => new Blob(['%PDF-1.4']), json: async () => { throw new Error('not json'); } });
const paperHandler = (over = {}) => handlerWith({
  'legal/esign/31/document': over.document || (() => pdf()),
  'legal/esign/32(\\?|$)': over.detail || (() => response(DETAIL_32)),
  'legal/esign\\?': over.list || (() => response({ envelopes: ENVELOPES })),
});

test('D6184 model: the signed count from recipient_count and signed_count, each envelope\'s action, and how to sign by email', () => {
  // Mutation checked: the count's two fields swapped; a missing count drawn as 0; Download offered on a partly signed
  // envelope; `rejected` read as open; the viewer matched case-sensitively; a signed viewer told to sign.
  assert.equal(signedLine({ recipient_count: 3, signed_count: 2 }), '2 of 3 signed');
  assert.equal(signedLine({ recipient_count: 3 }), 'Signatures not recorded', 'never a guessed 0');
  assert.equal(signedLine({ recipient_count: 0, signed_count: 0 }), 'No signer is recorded on this envelope');
  const rows = paperRows(ENVELOPES);
  assert.deepEqual(rows.map((r) => [r.state, r.signed, r.action, r.tone]), [
    ['Fully signed 2 Nov 2026', '3 of 3 signed', 'download', 'done'],
    ['Partly signed · sent 3 Nov 2026', '2 of 3 signed', 'sign', 'wait'],
    ['Declined · sent 4 Nov 2026', '0 of 2 signed', 'closed', 'off'],
  ]);
  const mine = paperSigning(ready(DETAIL_32), 'ada@example.com');
  assert.equal(mine.state, 'yours');
  assert.match(mine.line, /^Your signing link was sent by email to Ada@Example\.com\./);
  assert.doesNotMatch(mine.line, /https?:|\/esign\//, 'no link is built');
  assert.equal(paperSigning(ready(DETAIL_32), 'founder@example.com').state, 'signed');
  assert.match(paperSigning(ready(DETAIL_32), 'founder@example.com').line, /^You signed on 3 Nov 2026\./);
  assert.equal(paperSigning(ready(DETAIL_32), 'other@example.com').state, 'not_signer');
  assert.equal(paperSigning({ status: 'unreadable' }, 'ada@example.com').state, 'unreadable');
});

test('D6184: a completed envelope downloads through the Worker; a partly signed one says the link was sent by email; a declined one offers neither', async () => {
  // Mutation checked: Download drawn for every row; the download not read from /document; the sign line dropped.
  const made = [];
  const prev = URL.createObjectURL;
  URL.createObjectURL = (b) => { made.push(b); return 'blob:x'; };
  const v = await mounted('/deals/4/documents', INVESTOR, paperHandler());
  try {
    const card = v.textOf('deal-paper');
    assert.match(card, /Subscription agreement[\s\S]*Fully signed 2 Nov 2026[\s\S]*3 of 3 signed/);
    assert.match(card, /Side letter[\s\S]*Partly signed[\s\S]*2 of 3 signed[\s\S]*Download opens once the envelope is fully signed\.[\s\S]*Your signing link was sent by email to Ada@Example\.com\./);
    assert.match(card, /Term sheet[\s\S]*Declined[\s\S]*0 of 2 signed[\s\S]*It can no longer be signed/);
    assert.equal(v.byId('deal-paper-download').length, 1, 'Download on the completed envelope alone');
    assert.equal(v.requests.filter((r) => /legal\/esign\/(31|33)(\?|$)/.test(r.line)).length, 0, 'how to sign is read for the open envelope only');
    assert.equal(v.byId('deal-paper-sign').length, 1);
    assert.doesNotMatch(v.textOf('deal-paper-sign'), /https?:|\/esign\//, 'no signing URL in the browser');
    await v.click('deal-paper-download');
    assert.equal(v.requests.filter((r) => r.line === 'GET /api/legal/esign/31/document').length, 1, 'the signed copy is read from the Worker');
    assert.equal(made.length, 1, 'the PDF is handed to the browser');
    assert.equal(v.has('deal-paper-refusal'), false);
  } finally { URL.createObjectURL = prev; await v.close(); }
});

test('D6184: when the Worker refuses the download, its refusal shows in the row', async () => {
  // Mutation checked: the refusal swallowed; the fallback shown over the Worker's words.
  const v = await mounted('/deals/4/documents', INVESTOR, paperHandler({ document: () => response({ error: 'Document not yet signed' }, 409) }));
  try {
    await v.click('deal-paper-download');
    assert.equal(v.textOf('deal-paper-refusal'), 'Document not yet signed');
  } finally { await v.close(); }
});

test('D6184: an unreadable paper list and an unreadable envelope each say Unreadable, never "nothing sent"', async () => {
  // Mutation checked: a failed detail read drawn as "not a signer"; a failed list drawn as no envelope.
  const v = await mounted('/deals/4/documents', INVESTOR, paperHandler({ detail: () => response({ error: 'boom' }, 500) }));
  try {
    const card = v.textOf('deal-paper');
    assert.match(card, /How to sign this envelope/);
    assert.doesNotMatch(card, /not a signer|signing link was sent/);
  } finally { await v.close(); }
  const w = await mounted('/deals/4/documents', INVESTOR, paperHandler({ list: () => response({ error: 'boom' }, 500) }));
  try {
    assert.match(w.textOf('deal-paper'), /That is not a claim that nothing was sent\./);
    assert.doesNotMatch(w.textOf('deal-paper'), /No envelope on this deal has been sent to you yet/);
  } finally { await w.close(); }
});
