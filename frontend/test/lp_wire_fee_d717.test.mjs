/**
 * D717 decision 13 (#1859) — the LP's capital-call panel behind the phone
 * check, and the issued management fee statement on screen (L12).
 *
 *   · an open Fund I line's panel opens on "Amount due", the amount, the due
 *     date and LP number, the four rows, then the phone check, one tick and a
 *     disabled "Show wire instructions"; nothing names the account;
 *   · the reveal route is reached only through `revealWire`, and only after
 *     the tick and "Show wire instructions";
 *   · a refused line opens on the amount, then the refusal, with nothing to gate;
 *   · the fee statement draws the canvas's rows, "Nothing is due from you
 *     against this statement.", and no account digits; absent reads Not
 *     recorded, failed reads Unreadable;
 *   · the Worker's words are read back from its own files.
 *
 * Every account figure is synthetic, taken from the D708 test.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/lp_wire_fee_d717.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { MyCommitment, WireGate, WireInstructions } from '../src/pages/SpinoutLabLpCommitment.jsx';
import { FeeStatementView, FeeStatements } from '../src/pages/SpinoutLabLpFeeStatement.jsx';
import { PHONE_CHECK, canReveal, initialWire, revealWire, wireReducer } from '../src/lib/lpWireGate.js';
import { BASIS_LABELS, NOTHING_DUE } from '../src/lib/lpFeeStatementModel.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const WARNING = 'Before you send money, call us to confirm these details on a phone number you already hold for Axal, never one given in an email or on this page. Axal never changes its payment instructions by email.';
const AVAILABLE = {
  available: true, bank_name: 'Column N.A.', beneficiary_name: 'Axal VC Spin-Out Lab Fund I LP',
  account_masked: '••••5577', reference: 'AXAL-CC-1-L100-10', warning: WARNING,
};
const MISSING = {
  available: false, code: 'fund_account_missing',
  message: "Axal VC Spin-Out Lab Fund I LP has no bank account for capital contributions yet, so no payment instructions can be given. Do not send money until Axal adds the Fund's account.",
};

const portal = (open, { due = '2026-12-01', commitment = 1000 } = {}) => ({
  lp_holdings: [{ id: 100, fund_id: 1, fund_name: 'Fund I', commitment_amount: commitment, invested_amount: 0, returns: 0, lpa_signed: 1 }],
  performance: [],
  capital_calls_recorded: true,
  capital_calls: [
    { id: 10, fund_id: 1, limited_partner_id: 100, call_number: 1, owed_cents: 30000, received_cents: 0, status: 'pending', due_date: due, created_at: '2026-10-01', pay_instructions: open },
    { id: 12, fund_id: 1, limited_partner_id: 100, call_number: null, owed_cents: 5000, received_cents: 5000, status: 'paid', paid_date: '2026-01-10', created_at: '2026-01-01', pay_instructions: open },
  ],
  distributions: [],
  funds: {},
});

const render = (el) => renderToStaticMarkup(React.createElement(MemoryRouter, null, el));
// One pass, so an escaped ampersand is never decoded a second time.
const ENTITIES = { '&#x27;': "'", '&amp;': '&', '&quot;': '"' };
const unescape = (h) => h.replace(/&#x27;|&amp;|&quot;/g, (e) => ENTITIES[e]);
/** The `wire-details-10` panel's markup, cut out of the whole card. */
function panel(open, opts) {
  const html = unescape(render(React.createElement(MyCommitment, { portal: portal(open, opts), onReload: () => {} })));
  const at = html.indexOf('data-testid="wire-details-10"');
  assert.ok(at > 0, 'no panel for line 10');
  return html.slice(at);
}
const inOrder = (html, parts) => {
  let from = 0;
  for (const p of parts) {
    const i = html.indexOf(p, from);
    assert.ok(i >= 0, `"${p}" is missing or out of order`);
    from = i + p.length;
  }
};
const minHeights = (html) => [...html.matchAll(/min-h-\[(\d+)px\]/g)].map((m) => Number(m[1]));

test('the panel opens on the amount and the due date, then the phone check, and names no account', () => {
  const html = panel(AVAILABLE);
  inOrder(html, [
    'Amount due', '$300.00', 'Due 2026-12-01 · LP no. L100',
    'Investments', 'Management fee', 'Partnership expenses', 'Unfunded after this call',
    PHONE_CHECK, 'I confirmed by phone', 'Show wire instructions',
  ]);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Show wire instructions/);
  assert.doesNotMatch(html, /Column N\.A\.|••••5577|AXAL-CC-1-L100-10/);
  // The three split rows read Not recorded; Unfunded counts line 10 only, as the paper notice does.
  const head = html.slice(html.indexOf('Investments'), html.indexOf('Unfunded after this call'));
  assert.equal((head.match(/Not recorded/g) || []).length, 3);
  assert.match(html, /Unfunded after this call<\/span><span[^>]*>\$700\.00/);
  assert.doesNotMatch(html, /\$650\.00/);
});

test('with no due date, or no commitment, the panel says so', () => {
  assert.match(panel(AVAILABLE, { due: null }), /No due date recorded · LP no\. L100/);
  assert.match(panel(AVAILABLE, { commitment: null }), /Unfunded after this call<\/span><span[^>]*><span[^>]*>Not recorded/);
});

test('the reveal route is called only after the tick and "Show wire instructions"', () => {
  let calls = 0;
  const fetchLine = () => { calls += 1; return Promise.resolve({}); };
  const run = (...actions) => actions.reduce((s, a) => wireReducer(s, a), initialWire());
  const confirm = (value) => ({ type: 'confirm', value });
  const show = { type: 'show' };
  revealWire(initialWire(), fetchLine);
  revealWire(run(confirm(true)), fetchLine);
  const noTick = run(show);
  assert.equal(noTick.step, 'gate');
  revealWire(noTick, fetchLine);
  revealWire(run(confirm(true), show, confirm(false)), fetchLine);
  assert.equal(calls, 0);
  assert.equal(revealWire(run(confirm(true)), fetchLine), null);
  revealWire(run(confirm(true), show), fetchLine);
  assert.equal(calls, 1);

  for (const step of ['gate', 'masked', 'full']) {
    for (const confirmed of [true, false]) {
      assert.equal(canReveal({ step, confirmed }), step === 'masked' && confirmed, `${step}/${confirmed}`);
    }
  }
  const full = run(confirm(true), show, { type: 'revealed' });
  assert.equal(full.step, 'full');
  assert.deepEqual(wireReducer(full, confirm(false)), initialWire());
  const same = initialWire();
  assert.equal(wireReducer(same, { type: 'hide' }), same, 'an action that does not apply returns the same state');

  const src = read('frontend/src/pages/SpinoutLabLpCommitment.jsx');
  assert.equal(src.split('bankAccountsApi.linePayInstructions(').length - 1, 1);
  assert.match(src, /revealWire\(wire, \(\) => bankAccountsApi\.linePayInstructions\(/);
});

test('the tick row is a label at least 44 px tall, holding the checkbox', () => {
  const html = renderToStaticMarkup(React.createElement(WireGate, { wire: initialWire(), onConfirm() {}, onShow() {}, testId: 10 }));
  const label = html.match(/<label class="([^"]*)"[^>]*>(.*?)<\/label>/);
  assert.ok(label, 'no label');
  const n = Number(label[1].match(/min-h-\[(\d+)px\]/)?.[1]);
  assert.ok(n >= 44, `the tick row is ${n}px`);
  assert.match(label[2], /type="checkbox"/);
  assert.match(label[2], /I confirmed by phone/);
});

test('the masked block keeps the bank, the masked account, the reference and the warning', () => {
  const html = unescape(renderToStaticMarkup(React.createElement(WireInstructions, { p: AVAILABLE, full: null, busy: false, err: '', onReveal() {}, onHide() {} })));
  for (const s of ['Wire details', 'Column N.A.', '••••5577', 'AXAL-CC-1-L100-10', WARNING, 'Show the full account number']) {
    assert.ok(html.includes(s), `missing ${s}`);
  }
});

test('a refused line opens on the amount, then the refusal, with nothing to gate', () => {
  const html = panel(MISSING);
  inOrder(html, ['Amount due', '$300.00', MISSING.message]);
  assert.doesNotMatch(html, /I confirmed by phone|Show wire instructions|Show the full account number/);
});

const FIGURES = {
  schema: 'mgmt_fee_statement/1',
  fund: { id: 1, name: 'Axal VC Spin-Out Lab Fund I LP' }, lp: { id: 101 },
  quarter: '2026-Q3', window: { start: '2026-07-01', end: '2026-09-30', days: 92 }, rate_bps: 200,
  basis: [{ basis: 'committed', days: 92, cents: 100000000 }],
  gross_fee_cents: 504110, catch_up_days: 0, catch_up_cents: 0, offset_cents: 50000, net_fee_cents: 454110,
  pay_to: { due: false, sentence: 'Nothing is due from you against this statement.' },
  remittance: { available: true, instructions: { account_last4: '5577', account_masked: '••••5577' }, warning: WARNING },
};
const stmt = (figures = FIGURES, extra = {}) => ({ uid: 's1', fund_id: 1, limited_partner_id: 101, period_label: '2026-Q3', issued_at: '2026-10-05T10:00:00Z', corrects_draft_id: null, figures, ...extra });
const view = (s, props = {}) => unescape(renderToStaticMarkup(React.createElement(FeeStatementView, { statement: s, ...props })));

test('the fee statement draws the canvas rows in order, and the nothing-due sentence', () => {
  const html = view(stmt());
  inOrder(html, [
    'Axal VC Spin-Out Lab Fund I LP', 'Management Fee Statement', 'Quarter 2026-Q3 · 92 days · LP no. L101',
    'Basis', 'Committed capital', 'Rate', '2% a year', 'Your basis', '$1,000,000.00',
    'Fee for the period', '$5,041.10', 'Offset for portfolio fees', '($500.00)',
    'Your share', '$4,541.10', NOTHING_DUE,
  ]);
  assert.match(html, /font-extrabold"><span>Your share<\/span>/);
  for (const n of minHeights(html)) assert.ok(n >= 44, `a row is ${n}px`);
  assert.doesNotMatch(html, /Catch-up/);

  const withCatchUp = view(stmt({ ...FIGURES, catch_up_days: 10, catch_up_cents: 5000 }));
  inOrder(withCatchUp, ['Fee for the period', 'Catch-up (10 days)', 'Offset for portfolio fees']);

  const two = view(stmt({ ...FIGURES, basis: [{ basis: 'committed', days: 40, cents: 100000000 }, { basis: 'net_invested_share', days: 52, cents: 60000000 }] }));
  inOrder(two, ['Basis', 'Committed capital · 40 days', 'Basis', 'Share of net invested capital · 52 days']);
});

test('the statement carries no account digits and no pay-to block', () => {
  const html = view(stmt());
  for (const s of ['5577', '•', 'Paid to', 'checking', 'Confirm payment instructions', WARNING]) {
    assert.ok(!html.includes(s), `the statement prints ${s}`);
  }
});

test('"Download PDF" is drawn only with a handler', () => {
  assert.doesNotMatch(view(stmt()), /Download PDF/);
  assert.equal(view(stmt(), { onDownloadPdf() {} }).split('Download PDF').length - 1, 1);
});

test('absent reads Not recorded, and a failed read reads Unreadable', () => {
  const noRate = view(stmt({ ...FIGURES, rate_bps: null }));
  assert.match(noRate, /<span>Rate<\/span><span[^>]*><span[^>]*>Not recorded/);
  assert.doesNotMatch(noRate, /0% a year/);
  for (const figures of [null, { ...FIGURES, schema: 'other/1' }]) {
    const html = view(stmt(figures));
    assert.match(html, /This statement could not be read\./);
    assert.doesNotMatch(html, /Your share/);
  }
  const list = (props) => unescape(renderToStaticMarkup(React.createElement(FeeStatements, { onReload() {}, ...props })));
  for (const props of [{ portal: { fee_statements: null, fee_statements_recorded: false } }, { portal: null, failed: true }]) {
    const html = list(props);
    assert.match(html, /Your management fee statements could not be read\./);
    assert.match(html, /This is not a claim that none was issued\./);
  }
  assert.match(list({ portal: { fee_statements: [], fee_statements_recorded: true } }), /No management fee statement has been issued to you yet\./);
});

test('the list puts the newest first and open, and marks a correction', () => {
  const html = unescape(renderToStaticMarkup(React.createElement(FeeStatements, {
    portal: {
      fee_statements_recorded: true,
      fee_statements: [
        stmt(FIGURES, { uid: 'new', corrects_draft_id: 7, issued_at: '2026-10-09T10:00:00Z' }),
        stmt(FIGURES, { uid: 'old' }),
      ],
    },
    onReload() {},
  })));
  inOrder(html, ['2026-Q3 · issued 2026-10-09 · corrects an earlier statement', '2026-Q3 · issued 2026-10-05']);
  assert.match(html, /aria-expanded="true"[^>]*><span>2026-Q3 · issued 2026-10-09/);
  assert.equal(html.split('data-testid="fee-statement-').length - 1, 1, 'more than one statement is open');
});

test("the statement's words are the Worker's own", () => {
  const notices = read('cloudflare-worker/src/services/fundNotices.ts');
  const fees = read('cloudflare-worker/src/services/fundFees.ts');
  assert.equal(notices.match(/nothingDue: '([^']+)'/)?.[1], NOTHING_DUE);
  assert.equal(fees.match(/pay_to: \{ due: false, sentence: '([^']+)' \}/)?.[1], NOTHING_DUE);
  const keys = [...fees.matchAll(/\{ basis: '(\w+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(keys, Object.keys(BASIS_LABELS).sort());
});

test('the section is mounted under My commitment, and nothing is stored in the browser', () => {
  const page = read('frontend/src/pages/SpinoutLabLpWorkspacePage.jsx');
  const a = page.indexOf('<MyCommitment portal={portal}');
  const b = page.indexOf('<FeeStatements portal={portal}');
  assert.ok(a > 0 && b > a, 'FeeStatements does not follow MyCommitment');
  for (const f of [
    'frontend/src/lib/lpWireGate.js', 'frontend/src/lib/lpFeeStatementModel.js', 'frontend/src/pages/SpinoutLabLpFeeStatement.jsx',
    'frontend/src/pages/SpinoutLabLpCommitment.jsx', 'frontend/src/lib/lpCommitmentModel.js',
  ]) {
    assert.doesNotMatch(read(f), /localStorage|sessionStorage|indexedDB|document\.cookie/, f);
  }
});
