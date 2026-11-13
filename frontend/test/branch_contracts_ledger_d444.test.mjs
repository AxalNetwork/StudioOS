/**
 * D444 — the branch ledger renders the list it was given, and does not
 * invent a value, a renewal, a sent-from version, or a zero for a count
 * the stats payload did not include.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  BranchContractsLedger,
  VALUE_UNRECORDED,
  RENEWAL_UNRECORDED,
} from '../src/pages/branch/BranchContracts.jsx';

const html = (props) => renderToStaticMarkup(createElement(BranchContractsLedger, props));

const ROW = {
  source: 'esign',
  uid: 'env-1',
  title: 'Partner MSA',
  recipient_email: 'a@b.test',
  status: 'sent',
  template_name: 'partner_msa',
};

test('a read row shows what the list carries, and Not recorded for the three it does not', () => {
  const out = html({
    ledger: { total: 1, items: [ROW], meta: { sources: ['documents', 'esign_envelopes', 'pairwise_ndas', 'partner_deals'] } },
    ledgerFailed: false,
    stats: { pending_signature: 2 },
    statsFailed: false,
  });
  assert.match(out, /Partner MSA/);
  assert.match(out, /a@b\.test/);
  assert.match(out, /partner_msa/);
  assert.match(out, />sent</);
  assert.match(out, /2 pending signatures/);
  assert.match(out, /Showing 1 of 1/);
  assert.ok(out.includes(VALUE_UNRECORDED));
  assert.ok(out.includes(RENEWAL_UNRECORDED));
  assert.match(out, /not the version the agreement was sent from/);
  assert.doesNotMatch(out, /\$\d/);
  assert.doesNotMatch(out, /v\d/);
});

test('a page is not the population', () => {
  const out = html({
    ledger: { total: 3, items: [ROW] },
    ledgerFailed: false,
    stats: { pending_signature: 1 },
    statsFailed: false,
  });
  assert.match(out, /Showing 1 of 3/);
});

test('a read of zero is a read, and a missing pending count is not zero', () => {
  const empty = html({
    ledger: { total: 0, items: [], meta: { sources: ['documents', 'esign_envelopes'] } },
    ledgerFailed: false,
    stats: {},
    statsFailed: false,
  });
  assert.match(empty, /None in this database/);
  assert.match(empty, /documents, esign_envelopes/);
  assert.match(empty, /Not recorded/);
  assert.doesNotMatch(empty, /None pending signature/);
  assert.doesNotMatch(empty, /<table/);
});

test('a failed stats read is not zero pending, even when a zero was passed alongside it', () => {
  const out = html({
    ledger: { total: 1, items: [ROW] },
    ledgerFailed: false,
    stats: { pending_signature: 0 },
    statsFailed: true,
  });
  assert.match(out, /signature counts could not be read/);
  assert.doesNotMatch(out, /None pending signature/);
  assert.doesNotMatch(out, /0 pending/);
});

test('a failed list is not an empty database', () => {
  const out = html({
    ledger: null,
    ledgerFailed: true,
    stats: { pending_signature: 0 },
    statsFailed: false,
  });
  assert.match(out, /contract list could not be read/);
  assert.match(out, /None pending signature/);
  assert.doesNotMatch(out, /None in this database/);
  assert.doesNotMatch(out, /<table/);
});
