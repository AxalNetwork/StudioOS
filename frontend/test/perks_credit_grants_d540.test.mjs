/**
 * D540 — the Perks page shows each grant's reason and source, a revoked
 * grant as revoked, the balance's dollar value, and a balance it could not
 * read as unreadable — never as 0.
 *
 * The two pieces are rendered for real (`CreditBalance`, `LedgerLine`). The
 * Worker half — the fields on `/perks/mine`, and a failed balance read
 * answering 500 with no balance — is driven in
 * cloudflare-worker/test/credit_grants_d540.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CreditBalance, LedgerLine } from '../src/pages/PerksPage.jsx';

const render = (C, props) => renderToStaticMarkup(React.createElement(C, props));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

test('a balance that could not be read says so — no number, and never 0', () => {
  const html = render(CreditBalance, { catalog: null, failed: true, onRetry: () => {} });
  assert.match(html, /data-testid="perks-balance-unreadable"/);
  assert.match(text(html), /Balance unreadable/);
  assert.match(html, /role="alert"/);
  assert.doesNotMatch(text(html), /\d/, 'no figure at all');
  // Even with a stale catalogue in hand, a failed read is not shown as a balance.
  const stale = render(CreditBalance, { catalog: { balance: 0 }, failed: true });
  assert.doesNotMatch(stale, /perks-balance"/);
  assert.doesNotMatch(text(stale), /\b0\b/);
});

test('a read balance shows its credits and their US$ value; no catalogue yet shows nothing', () => {
  const html = render(CreditBalance, { catalog: { balance: 1250 }, failed: false });
  assert.match(html, /data-testid="perks-balance"/);
  assert.match(text(html), /1,250 perk credits · US\$1,250 of perk value/);
  assert.match(html, /credits have no cash value and cannot be transferred/);
  assert.equal(render(CreditBalance, { catalog: null, failed: false }), '');
  assert.equal(render(CreditBalance, { catalog: { balance: null }, failed: false }), '', 'a missing balance is not drawn as 0');
});

test('a grant line says why it was earned and where it came from', () => {
  const html = render(LedgerLine, {
    l: { delta: 150, kind: 'grant', reason: 'A bug you reported was confirmed and fixed (high impact)', source: 'Support ticket #7', revoked: false, created_at: '2026-10-04T10:00:00Z' },
    balanceAfter: 150,
  });
  const t = text(html);
  assert.match(t, /^2026-10-04 A bug you reported was confirmed and fixed \(high impact\)/);
  assert.match(html, /data-testid="perks-ledger-source">Support ticket #7</);
  assert.doesNotMatch(html, /perks-ledger-revoked/);
  assert.match(t, /\+150 150$/);
});

test('a revoked grant is marked revoked; a line with no source shows none', () => {
  const html = render(LedgerLine, {
    l: { delta: 50, kind: 'grant', reason: 'Spin-Out Lab milestone completed: okrs created', source: null, revoked: true, created_at: '2026-10-04' },
    balanceAfter: 0,
  });
  assert.match(html, /data-testid="perks-ledger-revoked"[^>]*>revoked</);
  assert.doesNotMatch(html, /perks-ledger-source/);
  // The note stands in when the Worker sent no reason (an older ledger line).
  const old = render(LedgerLine, { l: { delta: -20, kind: 'spend', note: 'Claimed Acme', created_at: '2026-09-01' }, balanceAfter: 5 });
  assert.match(text(old), /Claimed Acme perk claimed −20 5/);
});
