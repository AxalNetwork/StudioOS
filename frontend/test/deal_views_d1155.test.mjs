/**
 * D1155 (#3060, part 7 of #2421) — the founder's (DL16), an Admin's (DL17a)
 * and an Operating Partner's (DL17b) Commitment tab, and DL15's table of who
 * sees what. The Worker's own replies are read against the same table in
 * `cloudflare-worker/test/deal_who_sees_what_d1155.test.ts`.
 *
 * Mounted on a stubbed fetch with the Worker's shapes. Every name is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_views_d1155.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import DealCommitmentsStaff from '../src/pages/deal/DealCommitmentsStaff.jsx';
import {
  FOOT, VIEWERS, WHO_SEES, cellOf, gateLine, heading, rowAction, statusWord, tableRows, viewerOf, wireCents,
} from '../src/pages/deal/dealAudienceModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const ROWS = [
  { id: 11, uid: 'c11', investor_user_id: 21, investor_name: 'Ada Angel', amount: 200000, status: 'pending', created_at: '2026-10-12 09:00:00' },
  { id: 12, uid: 'c12', investor_user_id: 22, investor_name: 'Bluefern Partners', amount: 150000, status: 'confirmed', created_at: '2026-10-15 09:00:00' },
  { id: 13, uid: 'c13', investor_user_id: 23, investor_name: 'Cam Carter', amount: 40000, status: 'withdrawn', created_at: '2026-10-16 09:00:00' },
  { id: 14, uid: 'c14', investor_user_id: 24, investor_name: 'Dee Dawson', amount: null, status: 'pending', created_at: '2026-10-17 09:00:00' },
];

// ---------------------------------------------------------------- DL15

test('DL15: twelve kinds against seven viewers, each cell a word in the canvas’s order, each kind with its source', () => {
  assert.deepEqual(VIEWERS.map((v) => v.label), ['You', 'Your firm colleagues', 'Other investors on this deal', 'Founder', 'Operating Partner', 'Admin', 'Super Admin']);
  assert.deepEqual(WHO_SEES.map((k) => k.label), [
    'Score and evidence', 'Data room files', 'Diligence case', 'IC record and votes', 'Your commitment and its note',
    'Other investors’ commitments', 'Syndicate members', 'Your notes', 'Reference calls', 'Activity', 'Mercury capacity',
    'The studio’s internal deal notes',
  ]);
  for (const k of WHO_SEES) {
    assert.equal(k.cells.length, 7, k.key);
    for (const c of k.cells) assert.ok(typeof c === 'string' && c.trim().length > 1, `${k.key}: a cell with no word`);
    assert.ok(k.source.length > 20, `${k.key} names its source`);
    for (const [viewer, why] of Object.entries(k.departs)) {
      assert.ok(VIEWERS.some((v) => v.key === viewer), `${k.key}: ${viewer} is not a viewer`);
      assert.ok(why.length > 5, `${k.key}: ${viewer}'s departure says why`);
    }
  }
  assert.equal(cellOf('mine', 'founder'), 'Amount and status, never the note');
  assert.equal(cellOf('mine', 'partner'), 'Full, never the note');
  assert.equal(cellOf('others', 'other'), 'Count and total only');
  assert.equal(cellOf('mercury', 'you'), 'Full');
  assert.deepEqual(VIEWERS.map((v) => cellOf('studio_notes', v.key)), ['Never', 'Never', 'Never', 'Never', 'Full', 'Full', 'Full']);
  assert.deepEqual(VIEWERS.map((v) => cellOf('notes', v.key)), ['Full', 'Full', 'Never', 'Never', 'Never', 'Never', 'Never']);
  assert.equal(cellOf('odd', 'you'), null);
  assert.ok(WHO_SEES.find((k) => k.key === 'mine').departs.colleague, 'the per-person read is named where DL15 says a colleague sees it');
});

test('the viewer: the deal’s own founder, an Admin or a Super Admin, an Operating Partner, an investor; anyone else none', () => {
  const deal = { project_founder_id: 41 };
  assert.equal(viewerOf('founder', { founder_id: 41 }, deal), 'founder');
  assert.equal(viewerOf('founder', { founder_id: 42 }, deal), null, 'another founder');
  assert.equal(viewerOf('admin', { is_super_admin: 0 }, deal), 'admin');
  assert.equal(viewerOf('admin', { is_super_admin: 1 }, deal), 'super');
  assert.equal(viewerOf('partner', {}, deal), 'partner');
  assert.equal(viewerOf('investor', {}, deal), 'investor');
  assert.equal(viewerOf('advisor', {}, deal), null);
});

test('the table: the closing room’s words, search, status, three sorts, pages of 25, and a heading that never counts a missing amount', () => {
  assert.deepEqual(['pending', 'confirmed', 'withdrawn', 'odd'].map(statusWord), ['Committed', 'Received', 'Withdrawn', 'Not recorded']);
  assert.deepEqual(tableRows(ROWS).rows.map((r) => r.id), [11, 12, 13, 14], 'amount, largest first; a missing amount last');
  assert.deepEqual(tableRows(ROWS, { sort: 'recorded' }).rows.map((r) => r.id), [14, 13, 12, 11]);
  assert.deepEqual(tableRows(ROWS, { sort: 'name' }).rows.map((r) => r.id), [11, 12, 13, 14]);
  assert.deepEqual(tableRows(ROWS, { q: 'blue' }).rows.map((r) => r.id), [12]);
  assert.deepEqual(tableRows(ROWS, { status: 'withdrawn' }).rows.map((r) => r.id), [13]);
  const many = Array.from({ length: 30 }, (_, i) => ({ id: i, amount: i, status: 'pending' }));
  assert.deepEqual([tableRows(many).range, tableRows(many, { page: 2 }).range, tableRows(many, { page: 9 }).page, tableRows([]).range], ['1–25 of 30', '26–30 of 30', 2, '0 of 0']);
  assert.equal(heading(ROWS), 'Commitments · 3 in · $350,000 · 1 with no amount recorded, not counted', 'a withdrawn one is not in');
  assert.equal(heading([]), 'Commitments · 0 in');
});

test('who may act: the founder matches to Mercury, an Admin records a wire on a pending line, an Operating Partner reads', () => {
  const p = ROWS[0]; const c = ROWS[1]; const w = ROWS[2];
  assert.deepEqual([rowAction('founder', p), rowAction('founder', c), rowAction('founder', w)], ['match', 'match', null]);
  assert.deepEqual([rowAction('admin', p), rowAction('super', p), rowAction('admin', c), rowAction('admin', w)], ['wire', 'wire', null, null]);
  assert.deepEqual([rowAction('partner', p), rowAction('partner', c), rowAction(null, p)], [null, null, null]);
  assert.match(FOOT.founder, /Investors’ notes are private to them\. A withdrawn commitment does not count toward the round\./);
  assert.equal(FOOT.admin, 'Admins see every commitment with names, never a note.');
  assert.match(FOOT.partner, /^Investors’ notes and Mercury figures are not shown to you\. An Admin records wires/);
  assert.deepEqual([wireCents(p), wireCents({ amount: 12.345 }), wireCents({ amount: null }), wireCents({ amount: 0 })], [20000000, 1235, null, null]);
  assert.equal(gateLine({ status: 'ready', data: { held: false, open_conditions: null } }).held, false);
  assert.deepEqual(gateLine({ status: 'ready', data: { held: true, open_conditions: 2 } }), { held: true, text: '2 IC conditions are open on this deal. Wires are refused until they are met.' });
  assert.equal(gateLine({ status: 'ready', data: { held: true, open_conditions: null } }).text, 'A condition is open on this deal. Wires are refused until it is met.', 'a condition the Admin cannot see holds the wire with no count');
  assert.equal(gateLine({ status: 'failed' }).held, null, 'an unread gate is never "nothing holds it"');
});

// ---------------------------------------------------------------- mounted

function handler(over = {}) {
  return (url, options = {}) => {
    const method = options.method || 'GET';
    for (const [k, f] of Object.entries(over)) if (url.includes(k) && (!f.method || f.method === method)) return f.answer(url, options);
    if (/\/api\/deals\/3\/commitments$/.test(url)) return response(ROWS.map((r) => ({ ...r, notes: `${r.investor_name} secret note` })));
    if (/\/api\/deals\/3\/transfer-gate$/.test(url)) return response({ held: false, open_conditions: null });
    if (/\/api\/deals\/3\/transfers$/.test(url) && method === 'POST') return response({ uid: 't1' }, 201);
    return response({});
  };
}

async function mounted(element, { handle = handler() } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, open: globalThis.open, alert: globalThis.alert };
  const requests = []; const popups = [];
  globalThis.fetch = async (u, options = {}) => {
    requests.push({ url: String(u), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    return handle(String(u), options);
  };
  globalThis.open = (...a) => { popups.push(a); return null; };
  globalThis.alert = (...a) => popups.push(a);
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, element)));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props_ = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props_(n)['data-testid'] === id);
  return {
    requests, popups, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), props: (id) => props_(byId(id)), all: () => text(container),
    ids: (re) => nodes().map((n) => props_(n)['data-testid']).filter((id) => id && re.test(id)),
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onClick({ preventDefault() {} }); }); await flush(); },
    change: async (id, value) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props_(n).onChange({ target: { value, checked: value } }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}
const writes = (r) => r.requests.filter((q) => q.method !== 'GET');

test('mounted DL16: the founder reads every commitment with its status and Match to my Mercury, and never a note', async () => {
  const r = await mounted(h(DealCommitmentsStaff, { dealId: 3, viewer: 'founder' }));
  try {
    assert.equal(r.textOf('deal-commitments-heading'), 'Commitments · 3 in · $350,000 · 1 with no amount recorded, not counted');
    assert.equal(r.ids(/^deal-commitment-row$/).length, 4);
    assert.deepEqual([11, 12, 13, 14].map((id) => r.textOf(`deal-commitment-status-${id}`)), ['Committed', 'Received', 'Withdrawn', 'Committed']);
    assert.deepEqual(r.ids(/^mercury-match-open-commitment-/), ['mercury-match-open-commitment-11', 'mercury-match-open-commitment-12', 'mercury-match-open-commitment-14']);
    assert.ok(!r.ids(/^deal-wire-open-/).length, 'the founder records no wire');
    assert.doesNotMatch(r.all(), /secret note/, 'a note is never drawn, whatever a reply carries');
    assert.match(r.textOf('deal-commitments-foot'), /Investors’ notes are private to them/);
    assert.deepEqual(writes(r), []);
  } finally { await r.close(); }
});

test('mounted DL17a: an Admin records a wire on a pending line, after reading the IC gate, from an in-page dialog', async () => {
  const r = await mounted(h(DealCommitmentsStaff, { dealId: 3, viewer: 'admin' }));
  try {
    assert.deepEqual(r.ids(/^deal-wire-open-/), ['deal-wire-open-11', 'deal-wire-open-14'], 'pending lines only');
    assert.ok(!r.ids(/^mercury-match-open-/).length, 'an Admin never matches the founder’s Mercury');
    assert.equal(r.textOf('deal-commitments-foot'), 'Admins see every commitment with names, never a note.');
    await r.click('deal-wire-open-11');
    assert.ok(r.requests.some((q) => q.url === '/api/deals/3/transfer-gate'), 'the gate is read before recording');
    assert.equal(r.props('deal-wire-amount').value, '200000.00');
    assert.deepEqual(writes(r), [], 'opening the dialog records nothing');
    await r.change('deal-wire-reference', 'HARBOR-SEED-0412');
    await r.change('deal-wire-phone', true);
    await r.click('deal-wire-go');
    assert.deepEqual(writes(r).map((w) => [w.method, w.url, w.body]), [['POST', '/api/deals/3/transfers', { amount_cents: 20000000, reference: 'HARBOR-SEED-0412', phone_verified: true, note: null }]]);
    assert.ok(!r.has('deal-wire'), 'the dialog closes once recorded');
    assert.deepEqual(r.popups, []);
  } finally { await r.close(); }

  const held = await mounted(h(DealCommitmentsStaff, { dealId: 3, viewer: 'admin' }), {
    handle: handler({ '/transfer-gate': { answer: () => response({ held: true, open_conditions: 1 }) } }),
  });
  try {
    await held.click('deal-wire-open-11');
    assert.equal(held.textOf('deal-wire-gate'), '1 IC condition is open on this deal. Wires are refused until it is met.');
    assert.equal(held.props('deal-wire-go').disabled, true);
    assert.equal(held.textOf('deal-wire-held'), 'Recording opens once the IC condition is met.');
  } finally { await held.close(); }

  const refused = await mounted(h(DealCommitmentsStaff, { dealId: 3, viewer: 'admin' }), {
    handle: handler({ '/transfers': { method: 'POST', answer: () => response({ error: 'open_conditions_block_transfer', message: '1 open IC condition on this deal. Resolve it in the commit room before recording a transfer.', open_conditions: 1 }, 409) } }),
  });
  try {
    await refused.click('deal-wire-open-11');
    await refused.click('deal-wire-go');
    assert.ok(refused.has('deal-wire'), 'a refusal keeps the dialog open');
    assert.match(refused.textOf('deal-wire'), /1 open condition[\s\S]*Nothing was recorded\./, 'the transfers tab’s own words for the refusal');
  } finally { await refused.close(); }
});

test('mounted DL17b: an Operating Partner reads every commitment and records nothing', async () => {
  const r = await mounted(h(DealCommitmentsStaff, { dealId: 3, viewer: 'partner' }));
  try {
    assert.equal(r.ids(/^deal-commitment-row$/).length, 4);
    assert.ok(!r.ids(/^deal-wire-open-|^mercury-match-open-/).length, 'no wire and no Mercury match');
    assert.match(r.textOf('deal-commitments-foot'), /^Investors’ notes and Mercury figures are not shown to you\./);
    assert.doesNotMatch(r.all(), /secret note/);
    assert.ok(!r.requests.some((q) => /transfer-gate|capital-attestations/.test(q.url)));
  } finally { await r.close(); }
});

test('mounted: a failed read is Unreadable; a total-only reply is the total; filters that match nobody can be cleared', async () => {
  const failed = await mounted(h(DealCommitmentsStaff, { dealId: 3, viewer: 'admin' }), { handle: handler({ '/commitments': { answer: () => response({ error: 'down' }, 503) } }) });
  try { assert.match(failed.textOf('deal-commitments'), /The commitments could not be read\. That is not a claim that none is recorded\./); } finally { await failed.close(); }
  const total = await mounted(h(DealCommitmentsStaff, { dealId: 3, viewer: null }), { handle: handler({ '/commitments': { answer: () => response({ total: 3000 }) } }) });
  try { assert.match(total.textOf('commitments-total'), /Total committed: \$3,000/); } finally { await total.close(); }
  const none = await mounted(h(DealCommitmentsStaff, { dealId: 3, viewer: 'admin' }));
  try {
    await none.change('deal-commitments-search', 'nobody-by-this-name');
    assert.match(none.textOf('deal-commitments-none'), /No commitment matches\./);
    await none.change('deal-commitments-status', 'withdrawn');
    await none.change('deal-commitments-search', '');
    assert.equal(none.ids(/^deal-commitment-row$/).length, 1);
  } finally { await none.close(); }
});

// ---------------------------------------------------------------- wiring and guards

test('the wiring: each non-investor gets the staff table, the Operating Partner is read only, and an Admin alone records transfers', () => {
  const page = read('frontend/src/pages/DealRoomPage.jsx');
  assert.match(page, /\{tab === 'commitment' && !isInvestor && <DealCommitmentsStaff dealId=\{deal\.id\} currency=\{deal\.currency\} viewer=\{viewerOf\(role, user, deal\)\} proof=\{isAdmin && !branchOfUser\(user\)\} \/>\}/);
  assert.match(page, /\{isPartner && <span className=\{PILL_N\} data-testid="deal-read-only">◉ \{READ_ONLY\}<\/span>\}/);
  assert.match(page, /<DealTransfersTab dealId=\{deal\.id\} currency=\{deal\.currency\} canRecord=\{isAdmin\} \/>/);
  assert.match(page, /<DealCommitment key=\{proofKey\} deal=\{deal\} user=\{user\} onChangeAmount=\{\(\) => setCommitOpen\(true\)\} onShare=\{openProof\} \/>/, 'D752’s proof door sits on the investor’s own commitment');
  assert.match(read('frontend/src/pages/closing/ClosingRoom.jsx'), /if \(role === 'partner' \|\| !Array\.isArray\(read\.data\)\) return null;/, 'the closing room keeps the Operating Partner to the total');
  assert.match(read('frontend/src/lib/api/dealStaff.js'), /transferGate: \(dealId\) => request\(`\/deals\/\$\{encodeURIComponent\(dealId\)\}\/transfer-gate`\)/);
  assert.match(read('frontend/src/lib/api.js'), /^export \* from '\.\/api\/dealStaff\.js';$/m);
  for (const f of ['documentation/architecture/decisions/D1155.md', 'frontend/src/pages/deal/README.md', 'documentation/architecture/ROUTE_MAP.md']) assert.match(read(f), /D1155/, f);
});

test('no browser pop-up and no raw colour in the new files; every light hover has its dark pair', () => {
  for (const f of ['frontend/src/pages/deal/DealCommitmentsStaff.jsx', 'frontend/src/pages/deal/dealAudienceModel.js']) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(src, /\b(alert|confirm|prompt)\s*\(|window\.open/, f);
    if (f.endsWith('.jsx')) assert.doesNotMatch(src, /['"`\s:]#[0-9a-fA-F]{3,6}\b/, `${f}: a raw colour`);
    for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const cls = m[1] || m[2];
      if (/(^|\s)hover:(bg|text|border)-/.test(cls)) assert.match(cls, /dark:hover:/, `${f}: ${cls}`);
    }
  }
  const SMALL = read('frontend/src/pages/deal/DealCommitmentsStaff.jsx').match(/const SMALL = '([^']+)'/)[1];
  assert.match(SMALL, /hover:bg-gray-50 .*dark:hover:bg-gray-800/);
});
