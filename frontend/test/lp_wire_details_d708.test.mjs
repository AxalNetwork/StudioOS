/**
 * D708 (#1773) — an LP's open Fund I line says where to wire.
 *
 *   · `commitmentsByFund` keeps each line's `pay_instructions`, or null;
 *   · an unpaid Fund I line offers Wire details: the bank, the masked account,
 *     the reference and the warning, or the refusal's sentence; a paid line
 *     and a line on another fund offer none;
 *   · the fund brief no longer names First Republic.
 *
 * The account's last four is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/lp_wire_details_d708.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { commitmentsByFund } from '../src/lib/lpCommitmentModel.js';
import { MyCommitment, WireDetails, WireInstructions } from '../src/pages/SpinoutLabLpCommitment.jsx';
import { SERVICE_PROVIDERS } from '../src/lib/spinoutFundModel.js';

const TODAY = '2026-10-17';
const WARNING = 'Before you send money, call us to confirm these details on a phone number you already hold for Axal, never one given in an email or on this page. Axal never changes its payment instructions by email.';
const AVAILABLE = {
  available: true, bank_name: 'Column N.A.', beneficiary_name: 'Axal VC Spin-Out Lab Fund I LP',
  account_masked: '••••5577', reference: 'AXAL-CC-1-L100-10', warning: WARNING,
};
const MISSING = {
  available: false, code: 'fund_account_missing',
  message: "Axal VC Spin-Out Lab Fund I LP has no bank account for capital contributions yet, so no payment instructions can be given. Do not send money until Axal adds the Fund's account.",
};

const portal = (open) => ({
  lp_holdings: [
    { id: 100, fund_id: 1, fund_name: 'Fund I', commitment_amount: 1000, invested_amount: 0, returns: 0, lpa_signed: 1 },
    { id: 101, fund_id: 2, fund_name: 'Fund II', commitment_amount: 500, invested_amount: 0, returns: 0, lpa_signed: 1 },
  ],
  performance: [],
  capital_calls_recorded: true,
  capital_calls: [
    { id: 10, fund_id: 1, limited_partner_id: 100, call_number: 1, owed_cents: 30000, received_cents: 0, status: 'pending', due_date: '2026-12-01', created_at: '2026-10-01', pay_instructions: open },
    // Paid, yet carrying instructions: the card must still offer none.
    { id: 12, fund_id: 1, limited_partner_id: 100, call_number: null, owed_cents: 5000, received_cents: 5000, status: 'paid', paid_date: '2026-01-10', created_at: '2026-01-01', pay_instructions: open },
    { id: 13, fund_id: 2, limited_partner_id: 101, call_number: 1, owed_cents: 20000, received_cents: 0, status: 'pending', due_date: '2026-12-01', created_at: '2026-10-01', pay_instructions: null },
  ],
  distributions: [],
  funds: {},
});

const render = (el) => renderToStaticMarkup(React.createElement(MemoryRouter, null, el));
const card = (open) => render(React.createElement(MyCommitment, { portal: portal(open), onReload: () => {} }));

test('commitmentsByFund keeps pay_instructions on each line, and null where there are none', () => {
  const [f1, f2] = commitmentsByFund(portal(AVAILABLE), TODAY);
  const open = f1.calls.find((c) => c.id === 10);
  assert.deepEqual(open.pay_instructions, AVAILABLE);
  assert.equal(f2.calls[0].pay_instructions, null);
  const [refused] = commitmentsByFund(portal(MISSING), TODAY);
  assert.deepEqual(refused.calls.find((c) => c.id === 10).pay_instructions, MISSING);
  // A line from a portal that predates D708 carries none.
  const [old] = commitmentsByFund({ ...portal(AVAILABLE), capital_calls: [{ id: 9, fund_id: 1, owed_cents: 100, status: 'pending' }] }, TODAY);
  assert.equal(old.calls[0].pay_instructions, null);
});

test('an unpaid Fund I line offers Wire details: the bank, the masked account, the reference and the warning', () => {
  // D717 (#1859): the panel now opens on the amount and the phone check, so
  // the masked block is no longer in the first render. It is drawn by
  // `WireInstructions` once the LP ticks and asks; that block is held here.
  const html = card(AVAILABLE);
  assert.match(html, /data-testid="wire-details-10"/);
  assert.match(html, /Amount due/);
  assert.match(html, /I confirmed by phone/);
  assert.match(html, /Show wire instructions/);
  assert.doesNotMatch(html, /Column N\.A\./);
  assert.doesNotMatch(html, /••••5577/);
  assert.doesNotMatch(html, /AXAL-CC-1-L100-10/);
  assert.doesNotMatch(html, /data-testid="wire-details-12"/, 'a paid line offers wire details');
  assert.doesNotMatch(html, /data-testid="wire-details-13"/, 'a line on another fund offers wire details');
  const block = render(React.createElement(WireInstructions, { p: AVAILABLE, full: null, busy: false, err: '', onReveal() {}, onHide() {}, testId: 10 }));
  assert.match(block, /Wire details/);
  assert.match(block, /Column N\.A\./);
  assert.match(block, /••••5577/);
  assert.match(block, /AXAL-CC-1-L100-10/);
  assert.ok(block.includes(WARNING.replace(/'/g, '&#x27;')) || block.includes(WARNING), 'the warning is not printed');
  assert.match(block, /Show the full account number/);
});

test('with no Fund account, the line prints the refusal\'s sentence and offers no number', () => {
  const html = card(MISSING);
  assert.match(html, /data-testid="wire-details-10"/);
  assert.match(html, /Do not send money until Axal adds the Fund&#x27;s account\./);
  assert.doesNotMatch(html, /Show the full account number/);
});

test('WireDetails draws nothing for a line without instructions', () => {
  assert.equal(render(React.createElement(WireDetails, { fundId: 2, line: { id: 13, pay_instructions: null } })), '');
});

test('the fund brief no longer names First Republic', () => {
  const banking = SERVICE_PROVIDERS.find((p) => p.k === 'Custody / banking');
  assert.equal(banking.v, 'Mercury (Column N.A.) · account not yet opened');
  const src = readFileSync(resolve(process.cwd(), 'frontend/src/lib/spinoutFundModel.js'), 'utf8');
  assert.doesNotMatch(src, /First Republic/);
});
