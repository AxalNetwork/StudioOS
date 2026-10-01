/**
 * Deals · Closing money and paper — D462. The Wires view, the Record wire
 * form, the closing checklist, and the packet export.
 *
 * What this file pins is the WIRING: which api.js method each control calls,
 * that the amount is converted to integer cents on the page, that the
 * conditions gate's 409 is printed from the route's own sentence, and that
 * the write controls are the operator's (the routes refuse an investor, so
 * the page must not offer them one). The worker half is pinned in
 * `cloudflare-worker/test/deal_closing_money.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ZONE = codeOnly(read('frontend/src/pages/investor/deals/ClosingZone.jsx'));
const API = read('frontend/src/lib/api.js');

test('Record wire posts integer cents and prints the gate’s refusal', () => {
  assert.match(ZONE, /Math\.round\(Number\(wireForm\.amount\) \* 100\)/,
    'the form must convert dollars to integer cents — the store holds cents');
  assert.match(ZONE, /api\.dealTransferRecord\(wireForm\.dealId, \{/,
    'the form must record against the deal it names');
  assert.match(API, /dealTransferRecord: \(id, data\) => request\(`\/deals\/\$\{id\}\/transfers`/,
    'api.js lost the transfer write');
  // The 409 from the conditions gate is printed from e.message — the route's
  // own sentence — never reworded on the page.
  assert.match(ZONE, /cause\?\.message \|\| 'The transfer could not be recorded\.'/,
    'the form must print the route’s refusal verbatim');
  // And the phone-verified flag is the artboard's fraud note, carried as data.
  assert.match(ZONE, /phone_verified: wireForm\.phoneVerified/, 'the phone-verified flag is not sent');
});

test('the Wires view reads the scoped transfers list and renders who and when', () => {
  assert.match(ZONE, /api\.dealsTransfers\(\)/, 'the zone never reads the transfers');
  assert.match(API, /dealsTransfers: \(\) => request\('\/deals\/transfers'\)/, 'api.js lost the list read');
  assert.match(ZONE, /transfers\.filter\(\(t\) => ids\.has\(t\.deal_id\)\)/,
    'the wires view must narrow to the deals at closing');
  assert.match(ZONE, /recorded_by_name/, 'a transfer renders who recorded it');
  // A failed read is unreadable with a retry, never "no money has moved".
  assert.match(ZONE, /That is not a claim that no money has moved\./,
    'a failed transfers read must not render as an empty wire trail');
});

test('the checklist applies a closing template and moves items by hand', () => {
  assert.match(ZONE, /api\.dealClosingChecklistApply\(templateForm\.dealId, templateForm\.slug\)/,
    'the apply control must post the deal and the template');
  assert.match(ZONE, /api\.dealClosingChecklistAddItem\(dealId, label\)/, 'the add-item control is gone');
  assert.match(ZONE, /api\.dealClosingChecklistSetItem\(dealId, itemUid, \{ state \}\)/,
    'the item state control is gone');
  // The missing owner decision is named on screen, not seeded around.
  assert.match(ZONE, /default item set is the owner’s call/, 'the page stopped naming the missing owner decision');
});

test('the write controls are the operator’s, and the packet indexes executed paper', () => {
  // The routes refuse an investor, so the page decides before the click.
  assert.match(ZONE, /canOperate = user\?\.role === 'admin' \|\| user\?\.role === 'partner'/,
    'the operator gate is gone');
  assert.match(ZONE, /disabled: true, title: 'Recording a transfer is an operator’s act/,
    'Record wire must say why it is disabled for an investor');
  assert.match(ZONE, /disabled: true, title: 'Applying a closing template is an operator’s act/,
    'Apply template must say why it is disabled for an investor');
  // The packet is the index of EXECUTED envelopes — status completed, never a
  // signature ratio — from the reads the page already made.
  assert.match(ZONE, /zone: 'closing-packet'/, 'the packet export is gone');
  assert.match(ZONE, /rows: executed,/, 'the packet must index the executed envelopes');
});
