/**
 * D453 — Session 16 item 4: HQ · Revenue wires the statement ledger (H10).
 *
 * `api.statementDraw` and `api.statementUpdate` existed with no caller since
 * D266 filed them. This holds the draw editor, HQ entry actions, payload
 * validation, and page wiring.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import {
  StatementDrawEditor,
  StatementActions,
  statementDrawPayload,
  statementPaidPayload,
  statementDisputePayload,
  licencesDrawableForStatements,
} from '../src/pages/hq/RevenuePage.jsx';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnly(raw('frontend/src/pages/hq/RevenuePage.jsx'));
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

test('paid and dispute payloads refuse what the worker would refuse', () => {
  assert.ok(statementPaidPayload({ amountText: '', note: 'x', owedCents: 100 }).error);
  const okPay = statementPaidPayload({ amountText: '1', note: 'wire', owedCents: 200 });
  assert.equal(okPay.body.paid_cents, 100);
  const over = statementPaidPayload({ amountText: '2', note: 'wire', owedCents: 100 });
  assert.ok(over.error, 'overpayment is refused before the call');
  const ok = statementPaidPayload({ amountText: '0.35', note: 'wire', owedCents: 3500 });
  assert.equal(ok.body.paid_cents, 35);
  assert.ok(statementDisputePayload({ amountText: '', note: 'why' }).error);
  assert.ok(statementDisputePayload({ amountText: '1', note: '' }).error);
  assert.equal(statementDisputePayload({ amountText: '10', note: 'disputed fee' }).body.disputed_cents, 1000);
});

test('the draw editor lists drawable licences and names re-draw limits', () => {
  const h = renderToStaticMarkup(
    React.createElement(StatementDrawEditor, {
      licences: LICENCES,
      currentPeriod: '2026-Q3',
      onDraw: async () => ({}),
    }),
  );
  assert.match(h, /Draw draft/);
  assert.match(text(h), /France/);
  assert.doesNotMatch(text(h), /Untermed/);
  assert.match(text(h), /Re-drawing replaces a draft only/);
});

test('statement actions expose issue, void, and HQ entry forms', () => {
  const stmt = {
    uid: 'st_1', status: 'draft', owed_cents: 3500, currency: 'EUR',
  };
  const h = renderToStaticMarkup(
    React.createElement(StatementActions, {
      statement: stmt,
      onUpdate: async () => ({}),
    }),
  );
  assert.match(text(h), /Issue to subsidiary/);
  assert.match(text(h), /Record payment/);
  assert.match(text(h), /Record dispute/);
  assert.match(h, /data-testid="hq-statement-actions-st_1"/);
});

test('the page calls the statement api methods and reloads the ledger', () => {
  assert.match(PAGE, /api\.statementDraw\(/);
  assert.match(PAGE, /api\.statementUpdate\(/);
  assert.match(PAGE, /StatementDrawEditor/);
  assert.match(PAGE, /StatementActions/);
  assert.match(PAGE, /loadStatements\(\)/, 'a draw or update re-reads the ledger');
  assert.match(API, /statementDraw:/);
  assert.match(API, /statementUpdate:/);
  assert.doesNotMatch(PAGE, /api\.statementDraw has no caller/,
    'the stale D266 comment must not remain');
});
