/**
 * D458 — Wave 9 Session 16 item 3: statement draw hold, floor vs paid-in-full, void audit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import {
  StatementActions,
  licencesDrawableForStatements,
  statementVoidPayload,
  statementAllowsPaidInFull,
} from '../src/pages/hq/RevenuePage.jsx';

const ROUTE = codeOnly(readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/admin_statements.ts'), 'utf8'));
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const LICENCES = [
  { uid: 'lic_fr', licence_ref: 'AXL-FR', brand_name: 'France', revenue_share_bps: 3500, status: 'active' },
  { uid: 'lic_s', licence_ref: 'AXL-S', brand_name: 'Paused', revenue_share_bps: 3500, status: 'suspended' },
  { uid: 'lic_x', licence_ref: 'AXL-X', brand_name: 'Untermed', revenue_share_bps: null, status: 'active' },
];

test('only active licences with a revenue share are drawable', () => {
  const list = licencesDrawableForStatements(LICENCES);
  assert.equal(list.length, 1);
  assert.equal(list[0].uid, 'lic_fr');
});

test('void payload requires a substantive reason', () => {
  assert.ok(statementVoidPayload({ note: 'short' }).error);
  assert.deepEqual(
    statementVoidPayload({ note: 'Terms changed before issue' }).body,
    { status: 'void', void_note: 'Terms changed before issue' },
  );
});

test('paid in full is blocked while the statement is a floor', () => {
  assert.equal(statementAllowsPaidInFull({ complete: false, unreported_streams: 2 }), false);
  assert.equal(statementAllowsPaidInFull({ complete: true, unreported_streams: 0, estimated_streams: 0 }), true);
  const floor = {
    uid: 'st_floor', status: 'issued', owed_cents: 3500, complete: false, unreported_streams: 3,
  };
  const h = renderToStaticMarkup(
    React.createElement(StatementActions, { statement: floor, onUpdate: async () => ({}) }),
  );
  assert.doesNotMatch(text(h), /Mark paid in full/);
  assert.match(h, /hq-statement-no-paid-in-full/);
  assert.match(text(h), /Void statement/);
});

test('the worker refuses held licences, incomplete paid-in-full, and bare voids', () => {
  assert.match(ROUTE, /licence\.status !== 'active'/);
  assert.match(ROUTE, /incomplete_statement/);
  assert.match(ROUTE, /void_note_required/);
  assert.match(ROUTE, /subsidiary_statement_void/);
  assert.match(ROUTE, /logAdminAction/);
});
