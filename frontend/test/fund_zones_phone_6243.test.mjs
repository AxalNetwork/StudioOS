/**
 * #6243 (D6243): the four Fund zones at phone width. Below 640px every register
 * and ledger row is a card (label/value lines from `data-label`, the untitled
 * cell is the row's title), nothing forces the page wider than 390px, row
 * actions and form controls are at least 44px, and the four forms are one column.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { CommsLog } from '../src/pages/investor/InvestorFundLPs.jsx';
import { LineTable } from '../src/pages/investor/InvestorFundCalls.jsx';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const DIR = 'frontend/src/pages/investor/';
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

/** The body of the last `@media(max-width:640px){…}` block in a stylesheet: the D6243 one. */
function phoneBlock(css) {
  const at = css.lastIndexOf('/* D6243');
  assert.ok(at >= 0, 'the stylesheet carries its D6243 phone block');
  const open = css.indexOf('{', css.indexOf('@media(max-width:640px)', at));
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error('unclosed phone block');
}
const ZONES = [
  ['investorFundLPs.css', '.ip1-fund-table-wrap'],
  ['investorFundCalls.css', '.if2-table-wrap'],
  ['investorFundAccounting.css', '.if3-ledger'],
  ['investorFundReporting.css', '.if4-table-wrap'],
];

for (const [file, wrap] of ZONES) {
  test(`${file}: a row is a card below 640px, and no table keeps its desktop width`, () => {
    const block = phoneBlock(read(DIR + file));
    assert.ok(block.includes(`${wrap} table{min-width:0!important`), 'the table drops its 620–780px minimum');
    assert.ok(block.includes(`${wrap} table,${wrap} tbody,${wrap} tr,${wrap} td{display:block}`), 'rows and cells stack');
    assert.match(block, new RegExp(`${wrap.replace('.', '\\.')} thead\\{position:absolute;[^}]*clip:rect\\(0 0 0 0\\)`), 'the header row is kept for screen readers, not drawn');
    assert.ok(block.includes(`${wrap} td[data-label]::before{content:attr(data-label)`), 'each cell names its column');
    assert.match(block, /white-space:normal;overflow-wrap:anywhere/, 'a long reference wraps instead of widening the page');
    assert.match(block, /\.(i6|if4)-refresh\{min-width:44px;min-height:44px/, 'the refresh control is a 44px target');
    assert.match(block, /\.i6-fund-switcher select,[^{]*\{min-height:44px\}/, 'the fund picker is a 44px target');
  });
}

test('Calls: row actions are a full-width row of 44px buttons, Record receipt first and alone on its line', () => {
  const block = phoneBlock(read(DIR + 'investorFundCalls.css'));
  assert.ok(block.includes('.if2-table-wrap td.if2-actions{display:flex;flex-wrap:wrap'));
  assert.ok(block.includes('.if2-row-action{flex:1 1 100%;min-height:44px'));
  assert.ok(block.includes('.if2-table-wrap td.if2-actions .if2-row-action:first-child{flex-basis:100%'));
  const markup = html(h(LineTable, { lines: [{ id: 7, limited_partner_id: 3, lp_name: 'LP Three', owed_cents: 100, received_cents: 0, commitment_cents: 1000, state: 'pending' }],
    showCall: true, receipt: null, setReceipt: () => {}, onOpen: () => {}, onSave: () => {} }));
  assert.match(markup, /<td class="if2-actions"><button[^>]*data-testid="button-record-receipt-7"/, 'Record receipt leads the actions cell');
  for (const label of ['Call', 'Commitment', 'Owed', 'Received', 'State', 'Age']) assert.ok(markup.includes(`data-label="${label}"`), label);
});

test('Calls: Record receipt, New call and Log as sent are one column of 44px fields, their errors kept', () => {
  const css = read(DIR + 'investorFundCalls.css');
  assert.ok(css.includes('@media(max-width:640px){.if2-receipt,.if2-composer-fields{flex-direction:column;align-items:stretch'), 'the receipt, log and New call forms are one column');
  const block = phoneBlock(css);
  assert.ok(block.includes('.if2-receipt input,.if2-composer-fields input{min-height:44px;font-size:16px;width:100%'));
  assert.ok(block.includes('.if2-receipt button,.if2-composer-fields button,.if2-issue{min-height:44px;width:100%'));
  assert.ok(block.includes('.if2-receipt p,.if2-error,.if2-note{overflow-wrap:anywhere}'), 'an error wraps in place, never clipped');
});

test('LPs: Add LP is one column with 44px fields and its note or error above the buttons', () => {
  const block = phoneBlock(read(DIR + 'investorFundLPs.css'));
  assert.ok(block.includes('.ip1-fund-add{flex-direction:column;align-items:stretch}'));
  assert.ok(block.includes('.ip1-fund-add input,.ip1-fund-type select{min-height:44px;font-size:16px;width:100%'));
  assert.ok(block.includes('.ip1-fund-add-actions button{min-height:44px;width:100%}'));
  assert.ok(block.includes('.ip1-fund-add-note{order:-1}'), 'the error is read before the buttons, not below the fold');
  const src = read(DIR + 'InvestorFundLPs.jsx');
  assert.match(src, /className="ip1-fund-add-note" role=\{addError \? 'alert' : undefined\}/, 'the error keeps its alert role');
});

test('LPs: every register and comms log cell but the title names its column', () => {
  const src = read(DIR + 'InvestorFundLPs.jsx');
  for (const label of ['Type', 'Commitment', 'Share', 'Paid to date', 'State', 'KYC']) assert.ok(src.includes(`<td data-label="${label}">`), label);
  const markup = html(h(CommsLog, { comms: { status: 'ready', data: { items: [{ id: 1, sent_at: '2026-11-03', lp_name: 'LP One', kind: 'reminder', subject: 'Call 2', capital_call_id: 4, logged_by_name: 'GP' }] } }, onRetry: () => {} }));
  for (const label of ['Sent', 'LP', 'Kind', 'Subject', 'Call line', 'Logged by']) assert.ok(markup.includes(`data-label="${label}"`), label);
  const block = phoneBlock(read(DIR + 'investorFundLPs.css'));
  assert.match(block, /\.ip1-fund-type>span\{position:absolute;[^}]*clip:rect/, 'on a phone the select alone shows the type; the text stays for screen readers');
});

test('Accounting and Reporting: their cells name their columns', () => {
  const acc = read(DIR + 'InvestorFundAccounting.jsx');
  for (const label of ['Amount', 'State', 'Note']) assert.ok(acc.includes(`data-label="${label}"`), label);
  assert.match(acc, /CAPITAL_LABELS = \{ called_cents: 'Called', collected_cents: 'Collected', outstanding_cents: 'Outstanding' \}/);
  assert.ok(acc.includes('data-label={CAPITAL_LABELS[field]}'));
  const rep = read(DIR + 'InvestorFundReporting.jsx');
  for (const label of ['State', 'Issued', 'Contents']) assert.ok(rep.includes(`<td data-label="${label}">`), label);
  assert.ok(phoneBlock(read(DIR + 'investorFundAccounting.css')).includes('.if3-ledger{overflow:visible!important}'), 'the old sideways scroller is switched off');
});
