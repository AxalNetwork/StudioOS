/**
 * D611 (#1311) — the colleague-seat card says what the route did, and the
 * accept page shows each refusal, signed in and signed out.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ColleagueSeatLink, seatInviteOutcome } from '../src/pages/investorSeatCopy.jsx';
import { AcceptInvestorSeatView, seatAcceptErrorCopy } from '../src/pages/AcceptInvestorSeatPage.jsx';

const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

test('the card says the invite was emailed only when the route sent one, and otherwise shows the link', () => {
  assert.equal(seatInviteOutcome({ email_sent: true, email: 'c@firm.test' }, 'c@firm.test').flash, 'Invite emailed to c@firm.test.');
  assert.equal(seatInviteOutcome({ email_sent: true, email: 'c@firm.test' }, 'c@firm.test').link, '');
  const quiet = seatInviteOutcome({ email_sent: false, email: 'c@firm.test', invite_link: 'https://axal.vc/investor-seats/accept?token=abc' }, 'c@firm.test');
  assert.equal(quiet.flash, 'No email went out. Copy the link and send it.');
  assert.equal(quiet.link, 'https://axal.vc/investor-seats/accept?token=abc');
  assert.doesNotMatch(quiet.flash, /Invite sent/);

  const markup = html(h('div', null,
    h(ColleagueSeatLink, { seat: { id: 1, accepted_at: null, revoked_at: null, invite_link: 'https://axal.vc/investor-seats/accept?token=pending' } }),
    h(ColleagueSeatLink, { seat: { id: 2, accepted_at: '2026-10-01', revoked_at: null, invite_link: 'https://axal.vc/investor-seats/accept?token=spent' } }),
  ));
  assert.match(markup, /data-testid="seat-link-1"/);
  assert.match(markup, /token=pending/);
  assert.doesNotMatch(markup, /seat-link-2/);
  assert.doesNotMatch(markup, /token=spent/);
  assert.doesNotMatch(markup, /Invite sent/);
});

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

  const admin = html(h(AcceptInvestorSeatView, { user: { role: 'admin', email: 'a@x.test' }, token: 't' }));
  assert.match(admin, /An admin account cannot take a colleague seat/);

  const founder = html(h(AcceptInvestorSeatView, { user: { role: 'founder', email: 'f@x.test' }, token: 't' }));
  assert.match(founder, /changes your founder account into an investor account/);
  assert.match(founder, /Confirm and accept/);

  const investor = html(h(AcceptInvestorSeatView, { user: { role: 'investor', email: 'i@x.test' }, token: 't' }));
  assert.match(investor, /Checking your invitation/);
  assert.doesNotMatch(investor, /Confirm and accept/);

  for (const [failure, sentence] of [
    [{ error: 'email_mismatch' }, 'This invite was sent to a different email address.'],
    [{ error: 'invite_revoked' }, 'This invite was revoked.'],
    [{ error: 'already_accepted' }, 'This invite was already accepted.'],
    [{ error: 'primary_not_institutional' }, 'The inviter’s plan no longer covers colleague seats.'],
  ]) {
    const shown = html(h(AcceptInvestorSeatView, { user: { role: 'investor', email: 'i@x.test' }, token: 't', initialFailure: failure }));
    assert.ok(shown.includes(sentence), sentence);
  }
});
