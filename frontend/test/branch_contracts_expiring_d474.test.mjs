/**
 * D474 — Expiring soon is the next 90 days of the end dates the list carries,
 * and each current library card links into the send flow.
 *
 * A regex over the source is not the test. These render the ledger and the
 * cards. A failed list must not draw an empty strip.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  BranchContractsLedger,
  BranchTemplateCards,
  NDA_END_UNRECORDED,
  DEAL_END_UNRECORDED,
  RENEWAL_UNRECORDED,
} from '../src/pages/branch/BranchContracts.jsx';

const NOW = Date.parse('2026-10-04T00:00:00Z');

const ledger = (items, extra = {}) => renderToStaticMarkup(createElement(BranchContractsLedger, {
  ledger: { total: items.length, items, meta: { sources: ['documents', 'esign_envelopes', 'pairwise_ndas', 'partner_deals'] } },
  ledgerFailed: false,
  stats: { pending_signature: 0 },
  statsFailed: false,
  now: NOW,
  ...extra,
}));

const cards = (items) => renderToStaticMarkup(createElement(
  MemoryRouter,
  null,
  createElement(BranchTemplateCards, { items }),
));

test('an NDA inside 90 days is in the strip by valid_until, and the renewal cell shows that date', () => {
  const out = ledger([
    {
      source: 'pairwise_nda',
      uid: 'nda-soon',
      title: 'Pairwise NDA — a ↔ b',
      recipient_email: 'b@t.test',
      status: 'signed',
      template_name: 'pairwise_nda',
      valid_until: '2026-11-01T00:00:00Z',
      expires_at: null,
    },
    {
      source: 'pairwise_nda',
      uid: 'nda-later',
      title: 'Pairwise NDA — later',
      recipient_email: 'c@t.test',
      status: 'signed',
      template_name: 'pairwise_nda',
      valid_until: '2027-06-01T00:00:00Z',
    },
  ]);
  assert.match(out, /Pairwise NDA — a ↔ b/);
  assert.match(out, /2026-11-01/);
  assert.match(out, /valid_until/);
  assert.match(out, /28 days/);
  assert.match(out, /Pairwise NDA — later/);
  assert.match(out, /2027-06-01/);
  const strip = out.slice(out.indexOf('data-testid="branch-contracts-expiring"'), out.indexOf('data-testid="branch-contracts-rows"'));
  assert.match(strip, /nda-soon|Pairwise NDA — a ↔ b/);
  assert.doesNotMatch(strip, /Pairwise NDA — later/);
  assert.doesNotMatch(strip, /None in the next 90 days/);
});

test('a partner deal inside 90 days is in the strip by expires_at, not by a renewal the list does not carry', () => {
  const out = ledger([{
    source: 'partner_deal',
    uid: 'deal-soon',
    title: 'Partner Deal — p@t.test',
    recipient_email: 'p@t.test',
    status: 'signed',
    template_name: 'partner_custom',
    valid_until: null,
    expires_at: '2026-10-20T00:00:00Z',
  }]);
  assert.match(out, /16 days/);
  assert.match(out, /2026-10-20/);
  assert.match(out, /expires_at/);
  assert.match(out, /no renewal date separate from a partner deal/);
  assert.doesNotMatch(out, /renews/);
});

test('a row with no end date is not expiring, and the cell says so', () => {
  const out = ledger([
    {
      source: 'pairwise_nda',
      uid: 'nda-open',
      title: 'Pairwise NDA — open',
      status: 'signed',
      template_name: 'pairwise_nda',
      valid_until: null,
    },
    {
      source: 'partner_deal',
      uid: 'deal-open',
      title: 'Partner Deal — open',
      status: 'signed',
      template_name: 'partner_custom',
      expires_at: null,
    },
    {
      source: 'esign',
      uid: 'env-1',
      title: 'Partner MSA',
      status: 'sent',
      template_name: 'partner_msa',
    },
    {
      source: 'documents',
      uid: 'doc-1',
      title: 'Signed MSA',
      status: 'signed',
      template_name: 'partner_msa',
    },
  ]);
  assert.ok(out.includes(NDA_END_UNRECORDED));
  assert.ok(out.includes(DEAL_END_UNRECORDED));
  assert.ok(out.includes(RENEWAL_UNRECORDED));
  assert.match(out, /None in the next 90 days/);
  assert.match(out, /4 rows record no end date, so they are not expiring/);
  const strip = out.slice(out.indexOf('data-testid="branch-contracts-expiring"'), out.indexOf('data-testid="branch-contracts-rows"'));
  assert.doesNotMatch(strip, /Pairwise NDA — open/);
  assert.doesNotMatch(strip, /Partner Deal — open/);
  assert.doesNotMatch(strip, /Partner MSA/);
  assert.doesNotMatch(strip, /Signed MSA/);
});

test('a date that is not a date is not expiring and is not zero days', () => {
  const out = ledger([{
    source: 'pairwise_nda',
    uid: 'nda-bad',
    title: 'Pairwise NDA — bad',
    status: 'signed',
    template_name: 'pairwise_nda',
    valid_until: 'next quarter',
  }]);
  assert.match(out, /valid_until is not a date this page can read, so this row is not expiring/);
  assert.match(out, /None in the next 90 days/);
  assert.doesNotMatch(out, /\b0 days\b/);
  assert.doesNotMatch(out, /Ends today/);
});

test('a failed list is Unreadable and is not an empty expiring strip', () => {
  const out = renderToStaticMarkup(createElement(BranchContractsLedger, {
    ledger: null,
    ledgerFailed: true,
    stats: { pending_signature: 0 },
    statsFailed: false,
    now: NOW,
  }));
  assert.match(out, /contract list could not be read/);
  assert.doesNotMatch(out, /None in the next 90 days/);
  assert.doesNotMatch(out, /data-testid="branch-contracts-expiring"/);
  assert.doesNotMatch(out, /rows record no end date/);
});

test('an end date already past is on the row and not in the strip', () => {
  const out = ledger([{
    source: 'pairwise_nda',
    uid: 'nda-past',
    title: 'Pairwise NDA — past',
    status: 'signed',
    template_name: 'pairwise_nda',
    valid_until: '2026-09-01T00:00:00Z',
  }]);
  assert.match(out, /2026-09-01/);
  assert.match(out, /None in the next 90 days/);
  const strip = out.slice(out.indexOf('data-testid="branch-contracts-expiring"'), out.indexOf('data-testid="branch-contracts-rows"'));
  assert.doesNotMatch(strip, /Pairwise NDA — past/);
  assert.doesNotMatch(out, /data-testid="branch-contracts-expiring-no-end"/);
});

test('a page of rows is not the whole expiring population', () => {
  const out = renderToStaticMarkup(createElement(BranchContractsLedger, {
    ledger: {
      total: 4,
      items: [{
        source: 'pairwise_nda',
        uid: 'nda-soon',
        title: 'Pairwise NDA — a ↔ b',
        status: 'signed',
        template_name: 'pairwise_nda',
        valid_until: '2026-11-01T00:00:00Z',
      }],
    },
    ledgerFailed: false,
    stats: { pending_signature: 0 },
    statsFailed: false,
    now: NOW,
  }));
  assert.match(out, /This strip reads 1 of 4 rows/);
  assert.match(out, /Showing 1 of 4/);
});

test('each current library card links to the send flow, and no archived card is invented', () => {
  const out = cards([
    { slug: 'partner-msa', title: 'Partner MSA', category: 'partner', version: 4 },
    { slug: 'advisory', title: 'Advisory agreement', category: null, version: 2 },
  ]);
  const uses = out.match(/data-testid="branch-template-use"/g) || [];
  assert.equal(uses.length, 2);
  assert.match(out, /href="\/legal\/send"/);
  assert.match(out, /data-template="partner-msa"/);
  assert.match(out, /data-template="advisory"/);
  assert.match(out, />Use template</);
  assert.doesNotMatch(out, /Archived/);
  assert.doesNotMatch(out, /<button/);
});
