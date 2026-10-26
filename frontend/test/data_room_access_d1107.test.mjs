// D1107 (#2987) — Data room part 6: Access (DR6, DR6m), Share (DR7), one
// investor (DR7i), Revoke (DR7r), the NDA (DR8), Requests (DR9, DR9d), the
// co-founder (DR16) and no permission (DR18). The matrix never says an
// investor opens what `accessNow` refuses; Share picks only this venture's
// prospects; every change opens an in-page dialog first. Every name is invented.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/data_room_access_d1107.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import DataRoomAccess from '../src/pages/raise/dataroom/DataRoomAccess.jsx';
import DataRoomRequests from '../src/pages/raise/dataroom/DataRoomRequests.jsx';
import { accessNow } from '../src/pages/raise/dataRoomRead.js';
import {
  accessRefusal, accessRows, candidateRows, canOpen, declineError, diligenceRows, filterRows, foldersWord, grantBody, grantBodyError,
  matrix, ndaOf, ndaUnlocks, noPermission, requestRows, shareEffect, MATRIX_COLUMNS,
} from '../src/pages/raise/dataroom/accessModel.js';
import { grantOn } from '../src/pages/raise/dataroom/filesModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const NOW = Date.parse('2026-10-25T12:00:00Z');
const FAR = '2099-12-31 23:59:59';
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const ROOM = (o = {}) => ({
  project: { uid: 'p3uid', name: 'Harbor Ledger' },
  role: 'owner',
  folders: [
    { id: 1, uid: 'f1', name: 'Financials', parent_id: null, visibility: 'nda' },
    { id: 2, uid: 'f2', name: 'Bank', parent_id: 1, visibility: 'open' },
    { id: 3, uid: 'f3', name: 'Legal', parent_id: null, visibility: 'open' },
  ],
  files: [
    { id: 11, uid: 'a1', name: 'Model.xlsx', folder_id: 1, visibility: 'nda', access_tier: 'invited', access_expires_at: null },
    { id: 12, uid: 'a2', name: 'Deck.pdf', folder_id: null, visibility: 'open', access_tier: 'nobody', access_expires_at: null },
    { id: 13, uid: 'a3', name: 'Statement.pdf', folder_id: 2, visibility: 'open', access_tier: 'invited', access_expires_at: null },
    { id: 14, uid: 'a4', name: 'Contract.pdf', folder_id: 3, visibility: 'open', access_tier: 'committed', access_expires_at: null },
    { id: 15, uid: 'a5', name: 'Old memo.pdf', folder_id: 3, visibility: 'open', access_tier: 'invited', access_expires_at: '2026-01-01' },
  ],
  grants: [
    { uid: 'g1', status: 'active', created_at: '2026-10-01 09:00:00', expires_at: FAR, investor_name: 'Bluefern Capital', investor_email: 'a@bluefern.example', granted_by_name: 'Founder A', nda_signed: true, nda_pending: false, committed: 1, folders: null },
    { uid: 'g2', status: 'active', created_at: '2026-10-02 09:00:00', expires_at: null, investor_name: 'Juniper Angels', investor_email: 'j@juniper.example', granted_by_name: 'Founder A', nda_signed: false, nda_pending: true, committed: 0, folders: ['f3'] },
    { uid: 'g3', status: 'active', created_at: '2026-09-01 09:00:00', expires_at: '2026-10-01', investor_name: 'Northwind', investor_email: 'n@northwind.example', nda_signed: false, nda_pending: false, committed: 0, folders: null },
    { uid: 'g4', status: 'revoked', created_at: '2026-08-01 09:00:00', expires_at: null, investor_name: 'Harbor Seed Fund', investor_email: 'h@harbor.example', nda_signed: false, nda_pending: false, committed: 0, folders: null },
  ],
  report_shares: [{ id: 1, status: 'active', grantee_name: 'Larch Capital', created_at: '2026-10-12 09:00:00' }],
  recent_access: [
    { action: 'download', created_at: '2026-10-23 10:00:00', user_email: 'a@bluefern.example', file_name: 'Model.xlsx' },
    { action: 'open_room', created_at: '2026-10-22 10:00:00', user_email: 'a@bluefern.example', file_name: null },
    { action: 'blocked', created_at: '2026-10-21 10:00:00', user_email: 'j@juniper.example', file_name: 'Model.xlsx' },
  ],
  ...o,
});
const CANDIDATES = { candidates: [
  { uid: 'rp-1', name: 'Nia', firm: 'Northwind Angels', stage: 'in_conversation', email: 'nia@northwind.example' },
  { uid: 'rp-2', name: null, firm: 'Bluefern Capital', stage: 'committed', email: 'a@bluefern.example' },
  { uid: 'rp-3', name: 'Pat', firm: 'Pinecone Fund', stage: 'to_contact', email: null },
] };
const REQUESTS = (o = {}) => ({
  requests: [
    { uid: 'q1', investor: { id: 8, name: 'Northwind Angels', email: 'nia@northwind.example' }, source: 'round_call', round_call: { uid: 'c1', name: 'Seed' }, message: 'Could we see the financials?', state: 'open', created_at: '2026-10-22 10:00:00', decided_at: null, decided_by: null, decline_reason: null, nda: 'none', has_access: false },
    { uid: 'q2', investor: { id: 9, name: 'Saltmarsh Partners', email: 's@salt.example' }, source: 'deal_page', round_call: null, message: null, state: 'declined', created_at: '2026-10-20 10:00:00', decided_at: '2026-10-21 10:00:00', decided_by: { id: 1, name: 'Founder A' }, decline_reason: 'Not this round', nda: 'none', has_access: false },
    { uid: 'q3', investor: { id: 10, name: 'Old Ask', email: 'o@old.example' }, source: 'round_call', round_call: null, message: null, state: 'accepted', created_at: '2026-10-01 10:00:00', decided_at: null, decided_by: null, decline_reason: null, nda: 'active', has_access: true },
  ],
  open: 1, can_answer: true,
  diligence: [
    { id: 60, title: 'Burn and runway by month', state: 'requested', created_at: '2026-10-21 09:00:00', responded_at: null, reviewed_at: null, files: [{ uid: 'a3', name: 'Statement.pdf' }] },
    { id: 61, title: 'Security questionnaire', state: 'requested', created_at: '2026-10-22 09:00:00', responded_at: null, reviewed_at: null, files: [] },
  ],
  ...o,
});

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the matrix never says an investor opens what accessNow refuses, and names the first rule that shuts them out', () => {
  // Mutation checked: a cell from the tier alone (no folders) → Juniper opens Model; an ended grant shown as a column.
  const room = ROOM();
  const m = matrix(room, {}, NOW);
  assert.deepEqual(m.investors.map((i) => i.uid), ['g1', 'g2'], 'only grants in force are columns');
  for (const row of m.rows) {
    const f = room.files.find((x) => x.uid === row.uid);
    row.cells.forEach((c, i) => {
      const g = room.grants.find((x) => x.uid === m.investors[i].uid);
      if (c.open) assert.ok(accessNow(f, [g], NOW).length, `${f.name} for ${g.investor_name}: open where accessNow refuses`);
      assert.equal(c.open, grantOn(room, f, g, NOW).open);
    });
  }
  const cell = (file, g) => m.rows.find((r) => r.uid === file).cells[m.investors.findIndex((i) => i.uid === g)];
  assert.deepEqual(cell('a1', 'g1'), { open: true, why: 'Can open' });
  assert.equal(cell('a1', 'g2').why, 'Its access does not include this folder', 'folders before the NDA');
  assert.equal(cell('a2', 'g1').why, 'Private to you');
  assert.equal(cell('a4', 'g2').why, 'Not committed');
  assert.match(cell('a5', 'g1').why, /ended/i, 'a file past its end date opens for nobody');
  const many = ROOM({ grants: Array.from({ length: MATRIX_COLUMNS + 2 }, (_, i) => ({ uid: `x${i}`, status: 'active', expires_at: null, investor_name: `I${i}`, folders: null, nda_signed: true, committed: 1 })) });
  assert.equal(matrix(many, {}, NOW).investors.length, MATRIX_COLUMNS);
  assert.equal(matrix(many, {}, NOW).more, 2, 'past six, the rest fold into +N more');
  assert.deepEqual(matrix(room, { folder: 'f3' }, NOW).rows.map((r) => r.uid), ['a4', 'a5']);
  assert.deepEqual(matrix(room, { folder: 'top' }, NOW).rows.map((r) => r.uid), ['a2']);
});

test('Access rows: state, end, folders, NDA, what each opens now, and the last event among the last fifty; Active by default', () => {
  const room = ROOM();
  const rows = accessRows(room, NOW);
  const r = Object.fromEntries(rows.map((x) => [x.uid, x]));
  assert.deepEqual([r.g1.state, r.g3.state, r.g4.state], ['active', 'ended', 'revoked']);
  assert.equal(r.g1.canOpen, '3 of 5', 'Model (NDA signed), Statement, Contract (committed)');
  assert.equal(r.g2.canOpen, '0 of 5', 'Legal only: Contract needs committed, the memo has ended');
  assert.equal(r.g2.folders, 'Legal');
  assert.equal(r.g1.folders, 'All folders');
  assert.equal(foldersWord(room, { folders_unreadable: true }), 'Could not be read', 'never drawn as every folder');
  assert.deepEqual([ndaOf(room.grants[0]), ndaOf(room.grants[1]), ndaOf(room.grants[2])], ['signed', 'pending', 'none']);
  assert.match(r.g1.last, /^Link issued for Model\.xlsx · 23 Oct 2026$/);
  assert.equal(r.g3.last, 'None in the last fifty events', 'never "not opened": the log read is the last fifty');
  assert.deepEqual(filterRows(rows).map((x) => x.uid), ['g1', 'g2'], 'Grant: Active by default');
  assert.deepEqual(filterRows(rows, { state: 'all', nda: 'pending' }).map((x) => x.uid), ['g2']);
  assert.deepEqual(filterRows(rows, { state: 'all', q: 'harbor' }).map((x) => x.uid), ['g4']);
});

test('Share picks this venture\'s prospects only; one already holding the room or with no email cannot be picked; what it opens is said', () => {
  const room = ROOM();
  const rows = candidateRows(CANDIDATES.candidates, room, '', NOW);
  assert.deepEqual(rows.map((r) => [r.uid, r.disabled, r.sub]), [
    ['rp-1', false, 'In conversation · from Capital relationships'],
    ['rp-2', true, 'Committed · already has access'],
    ['rp-3', true, 'To contact · no email in Capital relationships'],
  ]);
  assert.doesNotMatch(JSON.stringify(rows), /account/i, 'whether an address has an account is never said');
  assert.deepEqual(candidateRows(CANDIDATES.candidates, room, 'pine', NOW).map((r) => r.uid), ['rp-3']);
  assert.equal(shareEffect(room, {}, NOW), 'They will be able to open 1 file. 1 more needs the NDA.', 'Statement; Model needs the NDA; Contract is committed only');
  assert.equal(shareEffect(room, { committed: true }, NOW), 'They will be able to open 2 files. 1 more needs the NDA.');
  assert.equal(shareEffect(room, { folders: ['f3'] }, NOW), 'They will be able to open 0 files.');
  assert.deepEqual(grantBody({ until: '', scope: 'all' }), { expires_at: null, folders: null });
  assert.deepEqual(grantBody({ until: '2026-12-01', scope: 'some', chosen: ['f1', 'f1'] }), { expires_at: '2026-12-01', folders: ['f1'] });
  assert.equal(grantBodyError({ scope: 'some', chosen: [] }), 'Choose at least one folder, or give every folder.', 'an empty list is never sent: the Worker would refuse it');
  assert.equal(grantBodyError({ until: '2026-10-01' }, '2026-10-25'), 'The end date must be today or later.');
  assert.deepEqual(ndaUnlocks(room, room.grants[2], NOW).map((f) => f.name), [], 'an ended grant unlocks nothing');
  assert.deepEqual(ndaUnlocks(room, { ...room.grants[0], nda_signed: false }, NOW).map((f) => f.name), ['Model.xlsx']);
  assert.equal(canOpen(room, room.grants[0], NOW), 3);
});

test('Requests in words: where each came from, its decision (who and when, or that they were not recorded), and diligence answered by a file', () => {
  const rows = requestRows(REQUESTS());
  assert.deepEqual(rows.map((r) => [r.uid, r.state, r.line]), [
    ['q1', 'Waiting', 'Round call · Seed · 22 Oct 2026'], ['q2', 'Declined', 'Deal page · 20 Oct 2026'], ['q3', 'Shared', 'Round call · 1 Oct 2026'],
  ]);
  assert.equal(rows[1].decided, 'Declined 21 Oct 2026 by Founder A');
  assert.equal(rows[1].reason, 'Not this round');
  assert.equal(rows[2].decided, 'Shared (who and when were not recorded)', 'a backfilled answer invents no decider');
  assert.deepEqual(diligenceRows(REQUESTS()).map((d) => [d.id, d.state]), [[60, 'Answered'], [61, 'Requested']]);
  assert.equal(diligenceRows({ diligence: null, diligence_unreadable: true }), null, 'unreadable, never an empty list');
  assert.match(declineError(''), /Write a short note/);
  assert.equal(declineError('x'.repeat(501)), 'Keep the note under 500 characters.');
  assert.equal(accessRefusal({ status: 403, data: { code: 'owner_only' } }), 'Only the venture’s owner can do that.');
  assert.equal(accessRefusal({ status: 409, data: { code: 'nda_pending' } }), 'An NDA with this investor is already out for signature.');
  assert.equal(noPermission('investor').cta, 'Go to your deals');
  assert.equal(noPermission('exploring').to, '/exploring');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

function handler(over = {}) {
  return (url, options = {}) => {
    const method = options.method || 'GET';
    for (const [k, f] of Object.entries(over)) if (url.includes(k) && (!f.method || f.method === method)) return f.answer(url, options);
    if (url.includes('/share-candidates')) return response(CANDIDATES);
    if (/\/data-room\/p3uid\/requests$/.test(url)) return response(REQUESTS());
    return response({ ok: true });
  };
}

async function mounted(el, { handle = handler() } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, el)));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    requests, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), props: (id) => props(byId(id)), all: () => text(document.body),
    count: (id) => nodes().filter((n) => props(n)['data-testid'] === id).length,
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick({ preventDefault() {}, stopPropagation() {} }); }); await flush(); },
    type: async (id, value) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { value, checked: value } }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const writes = (v) => v.requests.filter((q) => q.method !== 'GET');

test('Access mounted: the list (Active), the matrix, one investor, the NDA strip, and the report shares; nothing is written by reading', async () => {
  let reloads = 0;
  const v = await mounted(h(DataRoomAccess, { room: ROOM(), projectUid: 'p3uid', reload: () => { reloads += 1; } }));
  try {
    assert.equal(v.count('dataroom-grant-row'), 2);
    assert.match(v.textOf('dataroom-access-table'), /Bluefern Capital.*1 Oct 2026by Founder A.*All folders.*Signed.*Yes.*3 of 5.*Link issued for Model\.xlsx/s);
    assert.match(v.textOf('nda-row-g2'), /Juniper AngelsWaiting for signatures/);
    assert.ok(!v.has('nda-send-g2'), 'an NDA out for signature is not sent twice');
    assert.match(v.textOf('nda-files'), /1 NDA file\..*Model\.xlsx/s);
    assert.match(v.textOf('access-report-shares'), /Larch Capital/);
    // D1109: the advisor grant moved here from the retired files tool, for the owner.
    assert.ok(v.has('access-advisor-grants'), 'the owner lost the advisor grant');
    assert.match(v.textOf('access-advisor-grants'), /Advisors/, 'the advisor grant section is drawn inside it');
    await v.click('access-view-matrix');
    assert.match(v.textOf('matrix-cell-a1-g2'), /Its access does not include this folder/);
    assert.match(v.textOf('matrix-cell-a1-g1'), /Can open/);
    await v.click('access-view-list');
    await v.click('grant-open-g2');
    assert.match(v.textOf('investor-lightbox'), /Juniper Angels.*Legal.*Waiting for signatures.*0 of 5 files.*Refused for Model\.xlsx/s);
    assert.equal(writes(v).length, 0);
  } finally { await v.close(); }
});

test('Share: picks a prospect, says what it opens, sends the prospect\'s uid (never a typed address), and a refusal stays in the dialog', async () => {
  let refuse = true;
  const v = await mounted(h(DataRoomAccess, { room: ROOM(), projectUid: 'p3uid', reload: () => {} }), { handle: handler({
    '/data-room/p3uid/grants': { method: 'POST', answer: () => (refuse ? response({ detail: 'This investor has no email in Capital relationships.', code: 'no_email' }, 400) : response({ ok: true }, 201)) },
  }) });
  try {
    await v.click('access-share');
    assert.match(v.textOf('share-candidates'), /Northwind Angels · Nia.*Bluefern Capital.*already has access.*Pinecone Fund.*no email/s);
    assert.equal(v.props('share-candidate-rp-2').disabled, true, 'one already holding the room cannot be picked');
    assert.equal(v.props('share-dialog-go').disabled, true, 'nothing is shared before a pick');
    await v.click('share-candidate-rp-1');
    assert.equal(v.textOf('share-effect'), 'They will be able to open 1 file. 1 more needs the NDA.');
    await v.click('share-dialog-go');
    assert.match(v.textOf('share-dialog-refusal'), /no email in Capital relationships/);
    refuse = false;
    await v.click('grant-scope-some');
    assert.equal(v.props('share-dialog-go').disabled, true, 'no folder chosen is never sent');
    await v.click('grant-scope-all');
    await v.click('share-dialog-go');
    const sent = writes(v).filter((q) => q.url.endsWith('/data-room/p3uid/grants')).at(-1);
    assert.deepEqual(sent.body, { prospect: 'rp-1', expires_at: null, folders: null });
    // D1109: the Worker cannot say whether the address has an account, so the line never claims access.
    assert.match(v.textOf('access-said'), /^If [^ ]+ has a StudioOS account, Northwind Angels can open the room now\. Nobody is invited by email\./);
  } finally { await v.close(); }
});

test('Revoke, Change and the NDA each open a dialog that says what they change before anything is sent', async () => {
  const v = await mounted(h(DataRoomAccess, { room: ROOM(), projectUid: 'p3uid', reload: () => {} }), { handle: handler({
    '/grants/g1/nda': { method: 'POST', answer: () => response({ status: 'envelope_issued', envelope_uuid: 'e', signing_url: 'https://sign.example/x' }) },
  }) });
  try {
    await v.click('grant-open-g1');
    await v.click('investor-revoke');
    assert.match(v.textOf('revoke-dialog'), /Revoke Bluefern Capital’s access\?.*They lose the room now\. Their past events stay in Activity\./s);
    assert.equal(writes(v).length, 0);
    await v.click('revoke-dialog-go');
    assert.ok(writes(v).some((q) => q.method === 'DELETE' && q.url.endsWith('/data-room/p3uid/grants/g1')));
    await v.click('grant-open-g2');
    await v.click('investor-change');
    assert.match(v.textOf('change-effect'), /They can open 0 files, as now\./);
    await v.click('grant-scope-all');
    assert.match(v.textOf('change-effect'), /They can open 1 file after this, 0 now\./, 'every folder opens Statement');
    await v.click('change-dialog-go');
    assert.deepEqual(writes(v).at(-1).body, { expires_at: null, folders: null });
    assert.equal(writes(v).at(-1).method, 'PATCH');
  } finally { await v.close(); }
  const n = await mounted(h(DataRoomAccess, { room: ROOM({ grants: [{ ...ROOM().grants[0], nda_signed: false }] }), projectUid: 'p3uid', reload: () => {} }), { handle: handler({
    '/grants/g1/nda': { method: 'POST', answer: () => response({ status: 'envelope_issued', envelope_uuid: 'e', signing_url: 'https://sign.example/x' }) },
  }) });
  try {
    await n.click('nda-send-g1');
    assert.match(n.textOf('nda-dialog'), /three-way NDA.*Signers: you for Harbor Ledger · Bluefern Capital · Axal VC.*Once signed, they can also open 1 NDA file\./s);
    await n.click('nda-dialog-go');
    assert.ok(writes(n).some((q) => q.url.endsWith('/grants/g1/nda')));
    assert.equal(n.props('access-said').children[1].props.children[1].props.href, 'https://sign.example/x');
  } finally { await n.close(); }
});

test('DR16: a co-founder reads Access with the owner-only line and no Share, Revoke, Change or NDA', async () => {
  const v = await mounted(h(DataRoomAccess, { room: ROOM({ role: 'cofounder' }), projectUid: 'p3uid', reload: () => {} }));
  try {
    assert.match(v.textOf('access-cofounder'), /Only the venture’s owner shares the room/);
    assert.ok(!v.has('access-share') && !v.has('nda-send-g1'));
    assert.ok(!v.has('access-advisor-grants'), 'only the owner grants an advisor');
    await v.click('grant-open-g1');
    assert.ok(!v.has('investor-revoke') && !v.has('investor-change'));
  } finally { await v.close(); }
});

test('Requests mounted: accept through the share fields, decline needs a note, diligence answered with a file; a co-founder cannot answer access', async () => {
  const v = await mounted(h(DataRoomRequests, { room: ROOM(), projectUid: 'p3uid', reload: () => {} }));
  try {
    assert.equal(v.textOf('requests-waiting'), '1 waiting');
    assert.match(v.textOf('request-q1'), /Northwind Angels.*Waiting.*Round call · Seed · 22 Oct 2026.*“Could we see the financials\?”/s);
    assert.match(v.textOf('request-q2'), /Declined 21 Oct 2026 by Founder A · “Not this round”/);
    assert.ok(!v.has('request-share-q2'), 'a decided request is not answered again');
    await v.click('request-share-q1');
    await v.click('accept-dialog-go');
    assert.deepEqual(writes(v).at(-1), { url: writes(v).at(-1).url, method: 'POST', body: { expires_at: null, folders: null } });
    assert.ok(writes(v).at(-1).url.endsWith('/requests/q1/accept'));
    await v.click('request-decline-q1');
    assert.equal(v.props('decline-dialog-go').disabled, true, 'the Worker needs a note, so none is sent without one');
    await v.type('decline-reason', 'Next round');
    await v.click('decline-dialog-go');
    assert.deepEqual(writes(v).at(-1).body, { reason: 'Next round' });
    assert.match(v.textOf('diligence-60'), /Burn and runway by month.*Answered.*answered by Statement\.pdf/s);
    await v.click('diligence-answer-61');
    await v.type('answer-file', 'a4');
    await v.click('answer-dialog-go');
    assert.deepEqual(writes(v).at(-1).body, { dd_request_id: 61 });
    assert.ok(writes(v).at(-1).url.endsWith('/files/a4'));
  } finally { await v.close(); }
  const co = await mounted(h(DataRoomRequests, { room: ROOM({ role: 'cofounder' }), projectUid: 'p3uid', reload: () => {} }), { handle: handler({
    '/data-room/p3uid/requests': { answer: () => response(REQUESTS({ can_answer: false })) },
  }) });
  try {
    assert.ok(!co.has('request-share-q1') && !co.has('request-decline-q1'));
    assert.match(co.textOf('requests-owner-only'), /Only the venture’s owner answers access requests\./);
    assert.ok(co.has('diligence-answer-61'), 'a co-founder still answers diligence with a file (D1103)');
  } finally { await co.close(); }
});

test('Requests failing: the queue says Unreadable, never "nobody asked"; a failed diligence block leaves the queue standing', async () => {
  const down = await mounted(h(DataRoomRequests, { room: ROOM(), projectUid: 'p3uid', reload: () => {} }), { handle: handler({
    '/data-room/p3uid/requests': { answer: () => response({ code: 'requests_unreadable', detail: 'x' }, 503) },
  }) });
  try {
    assert.match(down.all(), /The access requests could not be read\. This is not a claim that nobody asked\./);
    assert.ok(!down.has('requests-none'));
  } finally { await down.close(); }
  const part = await mounted(h(DataRoomRequests, { room: ROOM(), projectUid: 'p3uid', reload: () => {} }), { handle: handler({
    '/data-room/p3uid/requests': { answer: () => response(REQUESTS({ diligence: null, diligence_unreadable: true })) },
  }) });
  try {
    assert.ok(part.has('request-q1'));
    assert.match(part.textOf('requests-diligence'), /The diligence requests could not be read\. This is not a claim that none were sent\./);
  } finally { await part.close(); }
});

test('wiring: Access and Requests are drawn by the tool, DR18 by who the caller is; no browser pop-up and no new raw SQL', () => {
  const tool = read('frontend/src/pages/raise/dataroom/DataRoomTool.jsx');
  assert.match(tool, /<DataRoomAccess room=\{read\.room\} projectUid=\{read\.uid\}/);
  assert.match(tool, /<DataRoomRequests room=\{read\.room\} projectUid=\{read\.uid\}/);
  assert.match(tool, /if \(read\.status === 'refused'\) return <NoPermission/);
  for (const f of ['DataRoomAccess.jsx', 'DataRoomRequests.jsx', 'accessModel.js']) {
    assert.doesNotMatch(read(`frontend/src/pages/raise/dataroom/${f}`), /window\.(alert|confirm|prompt)|\balert\(|\bconfirm\(/, f);
  }
  const worker = read('cloudflare-worker/src/routes/data_room.ts');
  assert.match(worker, /r\.get\('\/:projectUid\/share-candidates'/);
  assert.match(worker, /SELECT email FROM raise_prospects WHERE uid = \? AND project_id = \?/, 'a prospect is read on this venture only');
});
