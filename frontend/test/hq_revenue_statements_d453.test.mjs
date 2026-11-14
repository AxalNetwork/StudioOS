/**
 * D453 — Session 16 item 4: HQ · Revenue wires the statement ledger (H10).
 *
 * `api.statementDraw` and `api.statementUpdate` existed with no caller since
 * D266 filed them. This holds the draw editor, HQ entry actions, payload
 * validation, and page wiring. D514 holds the draw: the editor test became the
 * hold test, and issue and payment carry their new labels. D5039 part 2 moved
 * payment, issue and void to governed flows (`statementActionModel.js`); the
 * dispute stays the PATCH.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';
import {
  StatementDrawHeld,
  STATEMENT_DRAW_HELD,
  StatementActions,
  statementDrawPayload,
  statementDisputePayload,
  licencesDrawableForStatements,
} from '../src/pages/hq/RevenuePage.jsx';
import { revenuePageSource } from './_revenuePage.mjs';
import { paymentPreview } from '../src/pages/hq/revenue/statementActionModel.js';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnly(revenuePageSource());
const API = codeOnly(raw('frontend/src/lib/api.js'));
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const LICENCES = [
  { uid: 'lic_fr', licence_ref: 'AXL-FR', brand_name: 'France', revenue_share_bps: 3500, status: 'active' },
  { uid: 'lic_s', licence_ref: 'AXL-S', brand_name: 'Paused', revenue_share_bps: 3500, status: 'suspended' },
  { uid: 'lic_x', licence_ref: 'AXL-X', brand_name: 'Untermed', revenue_share_bps: null, status: 'active' },
];

test('draw payload requires a licence and a quarter period', () => {
  assert.ok(statementDrawPayload({ licenceUid: '', period: '2026-Q3' }).error);
  assert.ok(statementDrawPayload({ licenceUid: 'lic_fr', period: '2026-Q5' }).error);
  assert.deepEqual(
    statementDrawPayload({ licenceUid: 'lic_fr', period: '2026-Q3' }),
    { licenceUid: 'lic_fr', period: '2026-Q3' },
  );
});

test('only licences with a revenue share appear in the draw list', () => {
  const list = licencesDrawableForStatements(LICENCES);
  assert.equal(list.length, 1);
  assert.equal(list[0].uid, 'lic_fr');
});

test('payment and dispute payloads refuse what the worker would refuse', () => {
  const st = (owed) => ({ status: 'issued', owed_cents: owed, paid_cents: 0, disputed_cents: 0, currency: 'EUR', unreported_streams: 0, estimated_streams: 0 });
  const pay = (amountText, owed) => paymentPreview({ statement: st(owed), amountText, reference: 'wire', reason: 'Received by SEPA transfer' });
  assert.ok(pay('', 100).error);
  assert.equal(pay('1', 200).body.amount_cents, 100);
  assert.ok(pay('2', 100).error, 'overpayment is refused before the call');
  assert.equal(pay('0.35', 3500).body.amount_cents, 35);
  assert.ok(statementDisputePayload({ amountText: '', note: 'why', currency: 'EUR' }).error);
  assert.deepEqual(statementDisputePayload({ amountText: '0', note: '', currency: 'EUR' }).body, { disputed_cents: 0 }, 'D514: 0 clears a dispute');
  assert.ok(statementDisputePayload({ amountText: '1', note: '', currency: 'EUR' }).error);
  assert.equal(statementDisputePayload({ amountText: '10', note: 'disputed fee', currency: 'EUR' }).body.disputed_cents, 1000);
});

test('D514 — the draw editor is replaced by the hold sentence', () => {
  const h = renderToStaticMarkup(React.createElement(StatementDrawHeld));
  assert.ok(renderedText(h).includes(STATEMENT_DRAW_HELD), renderedText(h));
  assert.match(STATEMENT_DRAW_HELD, /held for the owner's decision/);
  // D5039 (canvas RV05) words the hold as a policy state and names its decision, D514.
  assert.match(STATEMENT_DRAW_HELD, /\(D514\)/);
  assert.doesNotMatch(h, /<form|<select|Draw draft/, 'the draw form is back');
});

test('statement actions offer the governed issue and void, and the dispute form', () => {
  const stmt = {
    uid: 'st_1', status: 'draft', owed_cents: 3500, paid_cents: 0, disputed_cents: 0, currency: 'EUR',
    complete: true, unreported_streams: 0, estimated_streams: 0,
  };
  const h = renderToStaticMarkup(
    React.createElement(StatementActions, {
      statement: stmt,
      onUpdate: async () => ({}),
    }),
  );
  assert.match(text(h), /Mark issued…/);
  assert.match(text(h), /Void…/);
  assert.doesNotMatch(text(h), /Set total paid|Record payment…/, 'a draft takes no payment');
  assert.match(text(h), /Record dispute/);
  assert.match(h, /data-testid="hq-statement-actions-st_1"/);
});

test('the page calls the statement api methods and reloads the ledger', () => {
  assert.doesNotMatch(PAGE, /api\.statementUpdate\(/);
  assert.match(PAGE, /adminStatementActionsApi\.recordDispute\(/);
  assert.match(PAGE, /<StatementDrawHeld \/>/);
  assert.doesNotMatch(PAGE, /api\.statementDraw\(/, 'D514 holds the draw: the page must not call it');
  assert.match(PAGE, /StatementActions/);
  assert.match(PAGE, /onChanged=\{refreshStatements\}/, 'an applied action re-reads the ledger');
  assert.match(API, /statementDraw:/);
  assert.match(API, /statementUpdate:/);
  assert.doesNotMatch(PAGE, /api\.statementDraw has no caller/,
    'the stale D266 comment must not remain');
});
