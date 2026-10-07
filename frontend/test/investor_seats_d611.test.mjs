/**
 * D611 (#1311) — the accept page shows each refusal, signed in and signed
 * out. D632 (#1390) reads the invitation before offering Accept, so the
 * signed-in cases below hand the view a read invitation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AcceptInvestorSeatView, seatAcceptErrorCopy } from '../src/pages/AcceptInvestorSeatPage.jsx';

const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

// D632 retired the first D611 test: the list no longer carries a pending
// seat's link, so `ColleagueSeatLink` is gone. The once-only link is pinned in
// investor_seats_d632.test.mjs.

test('each accept refusal has a sentence, and the page shows them signed in and signed out', () => {
  assert.equal(seatAcceptErrorCopy({ error: 'email_mismatch' }), 'This invite was sent to a different email address.');
  assert.equal(seatAcceptErrorCopy({ error: 'invite_revoked' }), 'This invite was revoked.');
  assert.equal(seatAcceptErrorCopy({ error: 'already_accepted' }), 'This invite was already accepted.');
  assert.equal(seatAcceptErrorCopy({ error: 'primary_not_institutional' }), 'The inviter’s plan no longer covers colleague seats.');
  assert.match(seatAcceptErrorCopy({ error: 'role_change_needs_confirmation', role: 'partner' }), /partner/);

  const signedOut = html(h(AcceptInvestorSeatView, { user: null, token: 'tok en' }));
  assert.match(signedOut, /Sign in/);
  assert.match(signedOut, /href="\/login\?next=/);
  assert.match(signedOut, /investor-seats%2Faccept/);
  assert.doesNotMatch(signedOut, /Confirm and accept/);

  const open = { kind: 'ready', inv: { state: 'open', inviter: { name: 'Owner', firm: null, firm_readable: true } } };
  const admin = html(h(AcceptInvestorSeatView, { user: { role: 'admin', email: 'a@x.test' }, token: 't', initialRead: open }));
  assert.match(admin, /An admin account cannot take a colleague seat/);
  assert.doesNotMatch(admin, /seat-accept-button/);

  const founder = html(h(AcceptInvestorSeatView, { user: { role: 'founder', email: 'f@x.test' }, token: 't', initialRead: open }));
  assert.match(founder, /Accepting turns your account into an investor account/);
  assert.match(founder, /Accept and become an investor/);

  const investor = html(h(AcceptInvestorSeatView, { user: { role: 'investor', email: 'i@x.test' }, token: 't', initialRead: open }));
  assert.match(investor, /Accept the seat/);
  assert.doesNotMatch(investor, /seat-accept-warning/);

  for (const [failure, sentence] of [
    [{ error: 'email_mismatch' }, 'This invite was sent to a different email address.'],
    [{ error: 'invite_revoked' }, 'This invite was revoked.'],
    [{ error: 'already_accepted' }, 'This invite was already accepted.'],
    [{ error: 'primary_not_institutional' }, 'The inviter’s plan no longer covers colleague seats.'],
  ]) {
    const shown = html(h(AcceptInvestorSeatView, { user: { role: 'investor', email: 'i@x.test' }, token: 't', initialRead: open, initialFailure: failure }));
    assert.ok(shown.includes(sentence), sentence);
  }
});
