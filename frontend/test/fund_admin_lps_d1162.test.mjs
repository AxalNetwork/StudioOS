/**
 * D1162 (#3069) — FND5, every LP across the administered funds at
 * /admin/fund-admin/lps, and FND6, one LP's drawer at /admin/fund-admin/lps/:id:
 *
 *   · an LP with no ledger line reads Not recorded with the Worker's reason,
 *     in the table and the drawer, never 0;
 *   · an Admin adding an LP sees the act table's sentence in place of the
 *     first call, and the LP is added without one; a Super Admin has the field;
 *   · an Admin sees the acceptance sentence in place of "Send to the General
 *     Partner"; opening a booklet reads it through the audited route and says
 *     the view is recorded;
 *   · filters, sort and pages live in the address and go to the Worker;
 *     "Not recorded" is the chart's dashed outline.
 *
 * Every API is a stub: no test reaches the Worker, Mercury or the network.
 * Every name, email and figure here is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_admin_lps_d1162.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { FundAdminConsoleView } from '../src/pages/admin/fundAdmin/FundAdminConsole.jsx';
import {
  ACCEPT_SENTENCE, ADD_WITHOUT_CALL, BOOKLET_VIEW_RECORDED, addLpBody, cell, keepRoster, lpCallLines, lpHref, lpIdFrom, lpTiles,
  receiptBody, rosterQuery, typeBars, typeNote, withQuery, withdrawReady,
} from '../src/pages/admin/fundAdmin/lpsModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const ADMIN = { id: 2, role: 'admin', is_super_admin: 0 };
const SUPER = { id: 1, role: 'admin', is_super_admin: 1 };
const NO_LEDGER = 'No capital call line has been issued to this LP.';

const ACCESS = (sa) => ({
  super_admin: sa,
  acts: [
    { act: 'capital_call.issue', tier: 'super_admin', allowed: sa, sentence: 'A Super Admin issues capital calls.' },
    { act: 'fund_booklet.accept', tier: 'super_admin', allowed: sa, sentence: ACCEPT_SENTENCE },
    ...['fund.write', 'capital_call.receipt', 'fund_booklet.read', 'fund_booklet.withdraw'].map((act) => ({ act, tier: 'admin', allowed: true, sentence: null })),
  ],
});
const OVERVIEW = () => ({
  as_of: '2026-10-26', entities: { state: 'ok', items: [] },
  funds: { state: 'ok', items: [{ fund_id: 7, name: 'Example Fund I', overdue_lines: 1 }, { fund_id: 9, name: 'Example Fund II', overdue_lines: 0 }] },
  fees: { state: 'ok', items: [] }, drafts: { state: 'ok', items: [] }, matches: { state: 'ok', items: [] },
});
const ALPHA = {
  limited_partner_id: 10, fund_id: 7, fund_name: 'Example Fund I', name: 'LP Alpha', email: 'alpha@example.test', has_account: true,
  status: 'active', lp_type: 'institution', lpa_signed: true, lpa_signed_at: '2025-03-14 10:00:00', kyc_status: 'approved',
  commitment_cents: 200000000, called_cents: 100000000, received_cents: 92000000, outstanding_cents: 8000000, distributed_cents: 15000000,
  overdue_lines: 1, last_notice: { uid: 'n-1', notice_type: 'capital_call_notice', reference: 'CALL-4-A', amount_cents: 25000000, issued_at: '2026-08-26 00:00:00' },
  booklet: { state: 'submitted', application_status: 'approved', submitted_at: '2026-10-12 00:00:00', uid: 'b-alpha' }, unavailable: {},
};
const CHARLIE = {
  limited_partner_id: 12, fund_id: 9, fund_name: 'Example Fund II', name: 'LP Charlie', email: 'charlie@example.test', has_account: false,
  status: 'committed', lp_type: null, lpa_signed: false, lpa_signed_at: null, kyc_status: null,
  commitment_cents: 50000000, called_cents: null, received_cents: null, outstanding_cents: null, distributed_cents: null, overdue_lines: null,
  last_notice: null, booklet: null,
  unavailable: {
    called_cents: NO_LEDGER, received_cents: NO_LEDGER, outstanding_cents: NO_LEDGER, overdue_lines: NO_LEDGER,
    distributed_cents: 'No paid distribution is recorded for this LP.', kyc_status: 'This LP has no account, so no identity check is recorded.',
    lp_type: 'No LP type is recorded.', last_notice: 'No notice has been issued to this LP.',
    booklet: 'This LP has no account, so no application links it to a booklet.',
  },
};
const ROSTER = (items = [ALPHA, CHARLIE]) => ({
  as_of: '2026-10-26', funds: [{ id: 7, name: 'Example Fund I' }, { id: 9, name: 'Example Fund II' }], page: 1, per_page: 25, pages: 3, total_rows: 52,
  totals: { rows: 52, commitment_cents: 1250000000, called_cents: 500000000, received_cents: 462000000, outstanding_cents: 38000000, distributed_cents: 15000000,
    not_recorded: { called_cents: 6, received_cents: 6, outstanding_cents: 6, distributed_cents: 40 } },
  tally: { lpa_pending: 7, identity_pending: 4, identity_not_recorded: 9, overdue_lines: 3,
    by_type: [{ lp_type: 'family_office', lps: 8, commitment_cents: 420000000 }, { lp_type: 'institution', lps: 4, commitment_cents: 260000000 }, { lp_type: null, lps: 6, commitment_cents: 50000000 }] },
  items,
});
const LEDGER = () => ({
  calls: [
    { id: 4, call_number: 4, due_date: '2026-09-09', lines: [
      { id: 41, limited_partner_id: 10, owed_cents: 25000000, received_cents: 17000000, outstanding_cents: 8000000, state: 'overdue', days_overdue: 47, due_date: '2026-09-09' },
      { id: 42, limited_partner_id: 11, owed_cents: 20000000, received_cents: 20000000, outstanding_cents: 0, state: 'paid', days_overdue: null, due_date: '2026-09-09' },
    ] },
    { id: 3, call_number: 3, due_date: '2026-06-10', lines: [
      { id: 31, limited_partner_id: 10, owed_cents: 25000000, received_cents: 25000000, outstanding_cents: 0, state: 'paid', days_overdue: null, due_date: '2026-06-10' },
    ] },
  ],
  unnumbered: [],
});

function stubs({ sa = false, roster = ROSTER, booklet = null } = {}) {
  const calls = [];
  const rec = (name, f) => (...args) => { calls.push([name, ...args]); return f(...args); };
  return {
    calls,
    names: () => calls.map((c) => c[0]),
    apis: {
      fundAdmin: {
        access: rec('access', async () => ACCESS(sa)), overview: rec('overview', async () => OVERVIEW()),
        lps: rec('lps', async (q) => (q?.lp ? ROSTER([ALPHA, CHARLIE].filter((r) => r.limited_partner_id === Number(q.lp))) : roster())),
      },
      performance: { list: async () => ({ items: [] }) },
      lps: {
        add: rec('add', async () => ({ ok: true, lp: { id: 77 } })),
        setType: rec('setType', async () => ({ ok: true })),
        ledger: rec('ledger', async () => LEDGER()),
        receipt: rec('receipt', async () => ({ ok: true })),
        distributions: rec('distributions', async () => ({ items: [{ id: 5, lp_id: 10, amount_cents: 8750000, distribution_type: 'exit_proceeds', status: 'paid', distributed_at: '2026-09-30' }, { id: 6, lp_id: 11, amount_cents: 1, status: 'paid' }] })),
        contacts: rec('contacts', async () => ({ items: [{ id: 3, kind: 'call_reminder', subject: 'Call 4 reminder', sent_at: '2026-10-01 09:00:00', logged_by_name: 'Admin One' }], truncated: false })),
        logContact: rec('logContact', async () => ({ ok: true, id: 4 })),
      },
      notices: {
        list: rec('notices', async () => ({ notices: [{ uid: 'n-1', type: 'capital_call_notice', title: 'Capital call · Call 4', reference: 'CALL-4-A', amount_cents: 25000000, notice_date: '2026-08-26', superseded: false }] })),
        pdfBlob: rec('pdf', async (uid) => ({ blob: { size: 3 }, filename: `notice-${uid}.pdf` })),
      },
      booklets: {
        one: rec('booklet', booklet || (async (uid) => ({ uid, status: 'submitted', parts: [{ part: 3, fields: [{ id: 'a', checked: true }, { id: 'b', checked: false }] }], signing: { state: 'awaiting_gp' }, gp_sent: false, withdrawn_reason: null }))),
        withdraw: rec('withdraw', async () => ({ uid: 'b-alpha', status: 'withdrawn' })),
        sendToGeneralPartner: rec('accept', async () => ({ stage: 'gp' })),
      },
      saveFile: rec('save', () => {}),
    },
  };
}

async function mount(url, { user = ADMIN, s = stubs({ sa: user === SUPER }) } = {}) {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const at = { path: '', search: '' };
  function Probe() { const l = useLocation(); at.path = l.pathname; at.search = l.search; return null; }
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(FundAdminConsoleView, { user, apis: s.apis }), h(Probe))));
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const ev = { preventDefault() {}, stopPropagation() {}, button: 0 };
  return {
    at, s, by, flush,
    text: (id) => txt(by(id)).replace(/\s+/g, ' ').trim(),
    props: (id) => pr(by(id)),
    async click(id) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onClick?.(ev); }); await flush(); },
    async type(id, value) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onChange?.({ target: { value } }); }); },
    async submit(id) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { await pr(n).onSubmit?.(ev); }); await flush(); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

/* ------------------------------------------------------------------ the model */

test('the roster query comes from the address; a change goes back to page 1; malformed values never reach the Worker', () => {
  assert.deepEqual(rosterQuery('?fund=7&lpa=unsigned&identity=pending&booklet=submitted&outstanding=1&q=%20Alpha%20&sort=called&dir=asc&page=3'), {
    fund: '7', lpa: 'unsigned', identity: 'pending', booklet: 'submitted', outstanding: true, overdue: undefined, q: 'Alpha', sort: 'called', dir: 'asc', page: 3, per_page: 25,
  });
  const bad = rosterQuery('?fund=7x&lpa=yes&identity=DROP&booklet=lost&outstanding=yes&sort=email&dir=up&page=-2');
  assert.deepEqual([bad.fund, bad.lpa, bad.identity, bad.booklet, bad.outstanding, bad.sort, bad.dir, bad.page], [undefined, undefined, undefined, undefined, undefined, 'commitment', 'desc', 1]);
  assert.equal(withQuery('?fund=7&page=3', 'overdue', true), '?fund=7&overdue=1', 'a filter resets the page');
  assert.equal(withQuery('?fund=7&page=3', 'page', 4), '?fund=7&page=4');
  assert.equal(withQuery('?overdue=1', 'overdue', false), '');
  assert.equal(keepRoster('?fund=7&moved=x&q=a&add=1'), '?fund=7&q=a');
  assert.equal(lpHref(12, '?fund=9&page=2'), '/admin/fund-admin/lps/12?fund=9&page=2');
  assert.equal(lpIdFrom('/admin/fund-admin/lps/12'), 12);
  for (const p of ['/admin/fund-admin/lps', '/admin/fund-admin/lps/0', '/admin/fund-admin/lps/x', '/admin/fund-admin/lps/12/more']) assert.equal(lpIdFrom(p), null, p);
});

test('a missing figure is Not recorded with the Worker\'s reason, Unreadable when its store failed, never 0', () => {
  assert.deepEqual(cell(CHARLIE, 'called_cents'), { text: 'Not recorded', reason: NO_LEDGER });
  assert.deepEqual(cell({ called_cents: null, unavailable: { called_cents: 'Unreadable: this store could not be read. Try again.' } }, 'called_cents').text, 'Unreadable');
  assert.deepEqual(cell(ALPHA, 'called_cents'), { text: '$1,000,000.00', reason: null });
  assert.equal(cell({ called_cents: 0, unavailable: {} }, 'called_cents').text, '$0.00', 'a recorded zero is a zero');
});

test('the tiles and the chart by LP type count every row the filters keep; Not recorded is the dashed bar', () => {
  const tiles = Object.fromEntries(lpTiles(ROSTER()).map((t) => [t.k, t]));
  assert.deepEqual([tiles.LPs.v, tiles.LPs.note], ['52', 'in 2 funds']);
  assert.equal(tiles['Total committed'].v, '$12,500,000.00');
  assert.deepEqual([tiles.Called.v, tiles.Called.note], ['$5,000,000.00', '6 LPs not recorded']);
  assert.deepEqual([tiles.Outstanding.note, tiles.Outstanding.tone], ['3 lines overdue', 'warn']);
  assert.deepEqual([tiles['LPAs pending'].v, tiles['Identity checks pending'].v], ['7', '4']);
  assert.equal(lpTiles({ ...ROSTER(), totals: { rows: 0, called_cents: null, not_recorded: {} } }).find((t) => t.k === 'Called').v, 'Not recorded', 'no row holds it: never $0');

  const bars = typeBars(ROSTER().tally);
  assert.deepEqual(bars.map((b) => [b.label, b.width, b.dashed]), [['Family office', 100, false], ['Institution', 61.9, false], ['Not recorded', 11.9, true]]);
  assert.equal(typeNote(bars), 'Family office LPs hold the most: $4,200,000.00 across 8 LPs.');
  const none = typeBars({ by_type: [{ lp_type: 'corporate', lps: 2, commitment_cents: null }] });
  assert.deepEqual([none[0].width, none[0].text], [0, 'No commitment recorded']);
});

test('Add LP: an Admin\'s body carries no first call even when one is typed; a Super Admin\'s needs its due date', () => {
  const form = { fundId: '7', name: 'LP Iota', email: 'iota@example.test', commitment: '250,000', lpType: 'individual', firstCall: '62500', firstDue: '' };
  const admin = addLpBody(form, { canIssue: false });
  assert.deepEqual(admin, { body: { name: 'LP Iota', email: 'iota@example.test', commitment_amount: 250000 }, lpType: 'individual' });
  assert.match(addLpBody(form, { canIssue: true }).error, /needs its due date/);
  assert.deepEqual(addLpBody({ ...form, firstDue: '2026-11-20' }, { canIssue: true }).body,
    { name: 'LP Iota', email: 'iota@example.test', commitment_amount: 250000, first_call_cents: 6250000, first_call_due_date: '2026-11-20' });
  assert.match(addLpBody({ ...form, firstCall: '300000', firstDue: '2026-11-20' }, { canIssue: true }).error, /more than the commitment/);
  assert.match(addLpBody({ ...form, fundId: '' }, { canIssue: false }).error, /Choose the fund/);
  assert.match(addLpBody({ ...form, name: '', email: '' }, { canIssue: false }).error, /name or an email/);
  assert.match(addLpBody({ ...form, commitment: '0' }, { canIssue: false }).error, /commitment/);
});

test('Calls & receipts are the LP\'s own lines; Record receipt takes the outstanding or less; Withdraw takes 10 to 200 characters', () => {
  const lines = lpCallLines(LEDGER(), 10);
  assert.deepEqual(lines.map((l) => [l.id, l.label, l.outstanding, l.open]), [[41, 'Call 4', '$80,000.00', true], [31, 'Call 3', '$0.00', false]]);
  assert.deepEqual(receiptBody({ full: true, receivedOn: '2026-10-21', reference: ' Wire 42 ' }, lines[0]).body, { amount_cents: 8000000, received_on: '2026-10-21', reference: 'Wire 42' });
  assert.deepEqual(receiptBody({ full: false, amount: '1000', receivedOn: '2026-10-21' }, lines[0]).body, { amount_cents: 100000, received_on: '2026-10-21' });
  assert.match(receiptBody({ full: false, amount: '80000.01', receivedOn: '2026-10-21' }, lines[0]).error, /more than this line still owes/);
  assert.match(receiptBody({ full: true, receivedOn: '' }, lines[0]).error, /date the wire landed/);
  assert.deepEqual([withdrawReady('too short'), withdrawReady('  The LP asked to change it.  '), withdrawReady('x'.repeat(201))], [false, true, false]);
});

/* ------------------------------------------------------------------ FND5 */

test('FND5: the roster replaces the wait card; an LP with no ledger reads Not recorded; filters go to the Worker through the address', async () => {
  const v = await mount('/admin/fund-admin/lps?fund=9&sort=called');
  try {
    assert.ok(v.by('fund-admin-panel-lps') && v.by('lps-section'));
    assert.ok(!v.by('fund-admin-wait-lps'), 'the wait card is gone');
    const first = v.s.calls.find((c) => c[0] === 'lps')[1];
    assert.deepEqual([first.fund, first.sort, first.page, first.per_page], ['9', 'called', 1, 25]);
    assert.equal(v.text('lps-called-12'), 'Not recorded', 'no ledger line: Not recorded, never $0');
    assert.equal(v.props('lps-called-12').title, NO_LEDGER, 'with the Worker\'s reason');
    assert.equal(v.text('lps-called-10'), '$1,000,000.00');
    assert.ok(v.by('lps-type-dashed'), 'type not recorded is the dashed outline');
    assert.match(v.text('lps-tile-count'), /52/);
    assert.equal(v.text('lps-count'), '1–25 of 52');
    assert.equal(v.props('lps-open-12').href, '/admin/fund-admin/lps/12?fund=9&sort=called');

    await v.click('lps-filter-overdue');
    assert.equal(v.at.search, '?fund=9&sort=called&overdue=1');
    assert.equal(v.s.calls.filter((c) => c[0] === 'lps').at(-1)[1].overdue, true, 'the Worker filters');
    await v.click('lps-next');
    assert.equal(v.at.search, '?fund=9&sort=called&overdue=1&page=2');
    await v.click('lps-types-show-table');
    assert.ok(v.by('lps-types-table') && /Not recorded/.test(v.text('lps-types-table')));
  } finally { await v.close(); }
});

test('FND5: Add LP — an Admin sees the sentence in place of the first call and adds without one; a Super Admin has the field', async () => {
  const v = await mount('/admin/fund-admin/lps?fund=9');
  try {
    await v.click('lps-add');
    assert.ok(v.by('lps-add-dialog'));
    assert.equal(v.text('lps-add-first-call-refused'), 'A Super Admin issues capital calls.');
    assert.equal(v.text('lps-add-without-call'), ADD_WITHOUT_CALL);
    assert.ok(!v.by('lps-add-first-call'), 'never a disabled field');
    assert.equal(v.props('lps-add-fund').value, '9', 'the header\'s fund is chosen');
    await v.type('lps-add-name', 'LP Iota');
    await v.type('lps-add-commitment', '250000');
    await v.type('lps-add-type', 'corporate');
    await v.submit('lps-add-form');
    const add = v.s.calls.find((c) => c[0] === 'add');
    assert.deepEqual(add.slice(1), ['9', { name: 'LP Iota', email: undefined, commitment_amount: 250000 }]);
    assert.deepEqual(v.s.calls.find((c) => c[0] === 'setType').slice(1), ['9', 77, 'corporate'], 'the type is set after the LP is written');
    assert.match(v.text('lps-add-done'), /The LP was added\./);
  } finally { await v.close(); }

  const s = await mount('/admin/fund-admin/lps?add=1', { user: SUPER });
  try {
    assert.ok(s.by('lps-add-dialog'), '?add=1 (the header\'s Add LP) opens it');
    assert.ok(s.by('lps-add-first-call') && !s.by('lps-add-first-call-refused') && !s.by('lps-add-without-call'));
    assert.match(s.text('lps-add-first-call-note'), /authenticator code/);
  } finally { await s.close(); }
});

test('FND5: the row menu opens the drawer, sets the type and logs a contact, each in an in-page dialog', async () => {
  const v = await mount('/admin/fund-admin/lps');
  try {
    await v.click('lps-menu-12');
    await v.click('lps-menu-12-type');
    assert.ok(v.by('lps-type-dialog'));
    await v.type('lps-type-select', 'family_office');
    await v.submit('lps-type-form');
    assert.deepEqual(v.s.calls.find((c) => c[0] === 'setType').slice(1), [9, 12, 'family_office']);
    await v.click('lps-menu-12');
    await v.click('lps-menu-12-contact');
    await v.type('lps-contact-subject', 'Welcome pack');
    await v.submit('lps-contact-form');
    const logged = v.s.calls.find((c) => c[0] === 'logContact');
    assert.deepEqual([logged[1], logged[2].lp_id, logged[2].subject], [9, 12, 'Welcome pack']);
    await v.click('lps-menu-12');
    await v.click('lps-menu-12-open');
    assert.equal(v.at.path, '/admin/fund-admin/lps/12');
  } finally { await v.close(); }
  assert.doesNotMatch(read('frontend/src/pages/admin/fundAdmin/LpsTab.jsx') + read('frontend/src/pages/admin/fundAdmin/LpDrawer.jsx') + read('frontend/src/pages/admin/fundAdmin/LpDialogs.jsx'),
    /window\.(confirm|alert|prompt)\(/, 'dialogs, never browser pop-ups');
});

/* ------------------------------------------------------------------ FND6 */

test('FND6: the drawer reads the LP\'s row; with no ledger line its figures read Not recorded with the reason', async () => {
  const v = await mount('/admin/fund-admin/lps/12?fund=9');
  try {
    assert.ok(v.by('lp-drawer-12'));
    // D1317: the LP's drawer is the shared Sheet over the roster, 680 → 720px.
    assert.equal(v.props('lp-drawer').role, 'dialog');
    assert.ok(v.props('lp-drawer')['aria-labelledby']);
    assert.equal(v.props('lp-drawer')['data-width'], 720);
    assert.ok(v.by('lps-section'), 'the roster stays drawn under the sheet');
    assert.ok(v.s.calls.some((c) => c[0] === 'lps' && c[1].lp === 12), 'one LP\'s row, through the audited roster');
    assert.equal(v.text('lp-summary-called'), `Called Not recorded: ${NO_LEDGER}`);
    assert.equal(v.text('lp-summary-outstanding'), `Outstanding Not recorded: ${NO_LEDGER}`);
    assert.equal(v.text('lp-summary-commitment'), 'Commitment $500,000.00');
    await v.click('lp-tab-calls');
    assert.match(v.text('lp-calls-none'), /No capital call line/);
    await v.click('lp-tab-booklet');
    assert.match(v.text('lp-booklet-none'), /no application links it/);
    await v.click('lp-drawer-close');
    assert.deepEqual([v.at.path, v.at.search], ['/admin/fund-admin/lps', '?fund=9'], 'closing keeps the roster\'s filters');
  } finally { await v.close(); }
});

test('FND6: an Admin sees the acceptance sentence; opening a booklet reads it through the audited route and says the view is recorded', async () => {
  const v = await mount('/admin/fund-admin/lps/10');
  try {
    await v.click('lp-tab-booklet');
    assert.equal(v.text('lp-booklet-accept-refused'), ACCEPT_SENTENCE);
    assert.ok(!v.by('lp-booklet-accept'), 'never a disabled button');
    assert.match(v.text('lp-booklet-state'), /recorded in the audit log/);
    assert.ok(!v.s.names().includes('booklet'), 'opening the tab reads no answers');
    await v.click('lp-booklet-open');
    assert.deepEqual(v.s.calls.filter((c) => c[0] === 'booklet').map((c) => c[1]), ['b-alpha'], 'Open reads that booklet once');
    assert.match(v.text('lp-booklet-recorded'), new RegExp(BOOKLET_VIEW_RECORDED.replace('.', '\\.')));
    assert.match(v.text('lp-booklet-recorded'), /1 of 2 answers ticked/);

    await v.click('lp-booklet-withdraw');
    assert.equal(v.props('lp-withdraw-submit').disabled, true, 'no reason, no withdrawal');
    await v.type('lp-withdraw-reason', 'The LP asked to change the commitment amount.');
    assert.equal(v.props('lp-withdraw-submit').disabled, false);
    await v.submit('lp-withdraw-form');
    assert.deepEqual(v.s.calls.find((c) => c[0] === 'withdraw').slice(1), ['b-alpha', 'The LP asked to change the commitment amount.']);
  } finally { await v.close(); }

  const s = await mount('/admin/fund-admin/lps/10', { user: SUPER });
  try {
    await s.click('lp-tab-booklet');
    assert.ok(!s.by('lp-booklet-accept-refused'));
    await s.click('lp-booklet-accept');
    assert.deepEqual(s.s.calls.find((c) => c[0] === 'accept').slice(1), ['b-alpha']);
    assert.match(s.text('lp-booklet-sent'), /General Partner/);
  } finally { await s.close(); }
});

test('FND6: a failed booklet read says so and keeps the drawer; the other tabs read only when opened', async () => {
  const s = stubs({ booklet: async () => { throw new Error('Unreadable: the booklet could not be read or saved. Try again.'); } });
  const v = await mount('/admin/fund-admin/lps/10', { s });
  try {
    assert.deepEqual(['ledger', 'distributions', 'notices', 'contacts'].filter((n) => s.names().includes(n)), [], 'the Summary tab reads nothing more');
    await v.click('lp-tab-booklet');
    await v.click('lp-booklet-open');
    assert.match(v.text('lp-booklet-error'), /could not be read/);
    assert.ok(v.by('lp-booklet-open') && v.by('lp-drawer-tabs'), 'one failed block never blanks the drawer');
  } finally { await v.close(); }
});

test('FND6: Calls & receipts records a receipt on an open line; Distributions, Notices (PDF) and the Contact log are the LP\'s own', async () => {
  const v = await mount('/admin/fund-admin/lps/10');
  try {
    await v.click('lp-tab-calls');
    assert.ok(v.by('lp-receipt-41') && !v.by('lp-receipt-31'), 'a paid line takes no receipt');
    await v.click('lp-receipt-41');
    await v.type('lp-receipt-date', '2026-10-21');
    await v.submit('lp-receipt-form');
    assert.deepEqual(v.s.calls.find((c) => c[0] === 'receipt').slice(1), [7, 41, { amount_cents: 8000000, received_on: '2026-10-21' }]);

    await v.click('lp-tab-distributions');
    assert.ok(v.by('lp-distribution-5') && !v.by('lp-distribution-6'), 'only this LP\'s');
    await v.click('lp-tab-notices');
    assert.deepEqual(v.s.calls.find((c) => c[0] === 'notices')[1], { fundId: 7, lpId: 10 });
    await v.click('lp-notice-pdf-n-1');
    assert.deepEqual(v.s.calls.find((c) => c[0] === 'save').slice(2), ['notice-n-1.pdf']);
    await v.click('lp-tab-contacts');
    assert.deepEqual(v.s.calls.find((c) => c[0] === 'contacts').slice(1), [7, 10]);
    assert.match(v.text('lp-contact-3'), /Call 4 reminder/);
  } finally { await v.close(); }
});

test('the admin clients: notices and booklets reach their Worker routes (D527)', async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.fetch = async (url, init = {}) => { seen.push([String(url), init.method || 'GET', init.body || null]); return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  try {
    const { fundNoticesApi } = await import('../src/lib/api/fundNotices.js');
    const { fundBookletsApi } = await import('../src/lib/api/fundBooklets.js');
    await fundNoticesApi.list({ fundId: 7, lpId: 10 });
    await fundNoticesApi.list();
    await fundNoticesApi.one('n/1');
    await fundBookletsApi.list();
    await fundBookletsApi.one('b-1');
    await fundBookletsApi.withdraw('b-1', 'The LP asked to change it.');
    await fundBookletsApi.sendToGeneralPartner('b-1');
    const paths = seen.map(([u, m, b]) => [u.replace(/^.*\/api/, ''), m, b]);
    assert.deepEqual(paths, [
      ['/fund-notices?fund_id=7&lp_id=10', 'GET', null], ['/fund-notices', 'GET', null], ['/fund-notices/n%2F1', 'GET', null],
      ['/fund-booklets', 'GET', null], ['/fund-booklets/b-1', 'GET', null],
      ['/fund-booklets/b-1/withdraw', 'POST', JSON.stringify({ reason: 'The LP asked to change it.' })],
      ['/fund-booklets/b-1/acceptance', 'POST', null],
    ]);
  } finally { globalThis.fetch = realFetch; }
});
