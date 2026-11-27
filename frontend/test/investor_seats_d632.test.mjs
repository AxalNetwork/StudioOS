/**
 * D632 (#1390) — colleague seats, both sides, rendered from the real
 * components: the inviter's panel (`st-invite`) shows the invite link once and
 * never from the list; the colleague's accept page (`st-accept`) reads the
 * invitation and draws each of its states, including the wrong account.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import ColleagueSeatsPanel, { seatInviteOnce, seatState, seatDate } from '../src/pages/ColleagueSeatsPanel.jsx';
import { AcceptInvestorSeatView, invitationCase, SEAT_GIVES } from '../src/pages/AcceptInvestorSeatPage.jsx';
import { codeOnly } from './_codeOnly.mjs';

const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
/** Rendered text with each tag read as a space, so adjacent elements keep their words apart. */
const words = (markup) => {
  let out = '';
  let inTag = false;
  for (const ch of String(markup)) {
    if (ch === '<') { inTag = true; out += ' '; } else if (ch === '>' && inTag) inTag = false;
    else if (!inTag) out += ch;
  }
  return out.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
};

const SEATS = [
  { id: 1, seat_email: 'one@firm.test', state: 'accepted', invited_at: '2026-10-12 09:00:00', accepted_at: '2026-10-13 09:00:00' },
  { id: 2, seat_email: 'two@firm.test', state: 'invited', invited_at: '2026-10-12 09:00:00', accepted_at: null,
    // A route that leaked a link must still not get it drawn.
    invite_link: 'https://axal.vc/investor-seats/accept?token=leaked' },
  { id: 3, seat_email: 'three@firm.test', state: 'revoked', invited_at: '2026-10-12 09:00:00', revoked_at: '2026-10-14 09:00:00' },
];
const panel = (props) => html(h(ColleagueSeatsPanel, { cap: 4, ...props }));

test('seats panel: the list draws each seat state and Revoke, never a link', () => {
  const markup = panel({ initialRead: { kind: 'ready', seats: SEATS, cap: 4 } });
  const text = words(markup);
  assert.match(text, /2 of 4 seats/, 'a revoked seat does not count');
  assert.match(text, /one@firm\.test Accepted Invited 12 Oct Accepted 13 Oct Revoke/);
  assert.match(text, /two@firm\.test Invited Invited 12 Oct Accepted: this seat has not been accepted yet\. Revoke/);
  assert.match(text, /three@firm\.test Revoked Invited 12 Oct Accepted: this seat has not been accepted yet\.(?! Revoke)/);
  assert.equal((markup.match(/>Revoke</g) || []).length, 2, 'Revoke on every seat but the revoked one');
  assert.doesNotMatch(markup, /token=/, 'no link is drawn from the list');
  assert.doesNotMatch(markup, /seat-invite-once/);
  assert.match(text, /3 of 3 seats/);
});

test('seats panel: the link is shown once, from the invite reply', () => {
  const quiet = seatInviteOnce({ email: 'c@firm.test', email_sent: false, invite_link: 'https://axal.vc/investor-seats/accept?token=fresh' }, 'c@firm.test');
  assert.equal(quiet.note, 'Copy this link now. It is shown once, because no email is sent.');
  const mailed = seatInviteOnce({ email: 'c@firm.test', email_sent: true, invite_link: 'https://axal.vc/investor-seats/accept?token=fresh' }, 'c@firm.test');
  assert.equal(mailed.note, 'An invite was also emailed to c@firm.test. This link is not shown again.');
  assert.equal(mailed.link, 'https://axal.vc/investor-seats/accept?token=fresh', 'mailed or not, the inviter sees the link once');

  const markup = panel({ initialRead: { kind: 'ready', seats: SEATS, cap: 4 }, initialOnce: quiet });
  assert.match(markup, /data-testid="seat-invite-link">https:\/\/axal\.vc\/investor-seats\/accept\?token=fresh</);
  assert.match(words(markup), /Copy this link now\. It is shown once, because no email is sent\. For c@firm\.test/);
  assert.match(words(markup), /Done — hide the link/);

  // The only thing that ever sets the once-panel is the invite reply, and
  // the list's load path never touches it.
  const src = codeOnly(readFileSync(new URL('../src/pages/ColleagueSeatsPanel.jsx', import.meta.url), 'utf8'));
  const setters = src.match(/setOnce\([^)]*\)/g) || [];
  assert.deepEqual(setters.sort(), ['setOnce(null)', 'setOnce(seatInviteOnce(res, v)'].sort());
  const loadBody = src.slice(src.indexOf('const load = useCallback'), src.indexOf('const invite = async'));
  assert.doesNotMatch(loadBody, /invite_link|setOnce/);
});

test('seats panel: loading, empty and unreadable each say so, and a failed read is never zero', () => {
  const loading = words(panel({}));
  assert.match(loading, /Loading seats…/);
  assert.doesNotMatch(loading, /of 4 seats|No seat has been used yet/);

  const empty = words(panel({ initialRead: { kind: 'ready', seats: [], cap: 4 } }));
  assert.match(empty, /No seat has been used yet\./);
  assert.match(empty, /0 of 4 seats/);

  const unread = panel({ initialRead: { kind: 'unreadable', message: 'Network down.' } });
  assert.match(words(unread), /Seats could not be read just now\. Network down\. Try again/);
  assert.match(words(unread), /Seats used: unreadable/);
  assert.doesNotMatch(words(unread), /No seat has been used yet|0 of|of 4 seats/);
  assert.match(unread, /id="seat-invite-email"[^>]* disabled=""/, 'no invite while the seats are unknown');
  assert.doesNotMatch(panel({ initialRead: { kind: 'ready', seats: [], cap: 4 } }), /id="seat-invite-email"[^>]* disabled=""/);
});

test('seat helpers read the route and the stamps', () => {
  assert.equal(seatState({ state: 'invited' }), 'invited');
  assert.equal(seatState({ accepted_at: 'x' }), 'accepted');
  assert.equal(seatState({ accepted_at: 'x', revoked_at: 'y' }), 'revoked');
  assert.equal(seatDate('2026-10-12 23:30:00'), '12 Oct');
  assert.equal(seatDate(null), '');
});

const OPEN = (inviter = { name: 'Owner', firm: 'North Firm', firm_readable: true }) => ({ kind: 'ready', inv: { state: 'open', inviter, role: 'founder' } });
const view = (props) => html(h(AcceptInvestorSeatView, { token: 'tok', ...props }));
const founder = { role: 'founder', email: 'seat@firm.test' };
const investor = { role: 'investor', email: 'seat@firm.test' };

test('accept page: the offer shows who invited, the firm, what the seat gives, and the role warning', () => {
  const markup = view({ user: founder, initialRead: OPEN() });
  const text = words(markup);
  assert.match(text, /You have been offered a seat Owner at North Firm invited you to join their Institutional plan as a colleague\./);
  for (const g of SEAT_GIVES) assert.ok(text.includes(g), g);
  assert.match(text, /Accepting turns your account into an investor account\. Your current workspace stays, but your role changes\./);
  assert.match(text, /Accept and become an investor/);

  const inv = words(view({ user: investor, initialRead: OPEN() }));
  assert.doesNotMatch(inv, /turns your account into an investor account/, 'an investor is not warned about a change that does not happen');
  assert.match(inv, /Accept the seat/);

  assert.match(words(view({ user: founder, initialRead: OPEN({ name: 'Owner', firm: null, firm_readable: true }) })),
    /Owner invited you .* Firm: the inviter has not recorded a firm name\./);
  assert.match(words(view({ user: founder, initialRead: OPEN({ name: 'Owner', firm: null, firm_readable: false }) })),
    /Firm: the inviter’s firm name could not be read just now\./);
});

test('accept page: each invitation state, including the wrong account', () => {
  const cases = [
    [{ state: 'wrong_account', invited_email: 'se***@firm.test' }, /Wrong account This invitation was for se\*\*\*@firm\.test\. Sign in with that account\. Switch account/],
    [{ state: 'revoked' }, /Revoked Owner revoked this seat\. Ask them for a new link\./],
    [{ state: 'accepted', yours: true }, /Already accepted This seat is yours\. Open your workspace\. Open workspace/],
    [{ state: 'accepted', yours: false }, /Already accepted This seat has already been accepted by another account\./],
    [{ state: 'plan_lapsed' }, /Plan no longer covers seats The inviter’s plan changed\. The seat cannot be accepted until it does again\./],
  ];
  for (const [inv, sentence] of cases) {
    const markup = view({ user: founder, initialRead: { kind: 'ready', inv: { ...inv, inviter: { name: 'Owner' } } } });
    assert.match(words(markup), sentence, inv.state);
    assert.doesNotMatch(markup, /seat-accept-button/, `${inv.state} offers no Accept`);
  }
  const wrong = view({ user: founder, initialRead: { kind: 'ready', inv: { state: 'wrong_account', invited_email: 'x', inviter: {} } } });
  assert.match(wrong, /href="\/login\?next=%2Finvestor-seats%2Faccept%3Ftoken%3Dtok"/, 'switching account comes back to this link');
  assert.equal(invitationCase({ state: 'open' }), null);
});

test('accept page: signed out, no token, loading, refused and unreadable', () => {
  const out = view({ user: null });
  assert.match(words(out), /Signed out Sign in, then come back to this link\. Nothing has changed on your account yet\. Sign in/);
  assert.match(out, /href="\/login\?next=%2Finvestor-seats%2Faccept%3Ftoken%3Dtok"/);

  assert.match(words(view({ user: founder, token: '' })), /This invitation has no seat attached\. Ask the inviter for the full link\./);

  const loading = view({ user: founder });
  assert.match(words(loading), /Checking your invitation…/);
  assert.doesNotMatch(loading, /seat-accept-button/);

  assert.match(words(view({ user: founder, initialRead: { kind: 'refused', message: 'This invitation link is not valid. Ask the inviter for a new one.' } })),
    /Not a valid link This invitation link is not valid\. Ask the inviter for a new one\./);

  const unread = view({ user: founder, initialRead: { kind: 'unreadable', message: '' } });
  assert.match(words(unread), /This invitation could not be read just now\. Try again/);
  assert.doesNotMatch(unread, /seat-accept-button|Owner/);
});

test('accept page: laid out for a 390-wide phone', () => {
  const markup = view({ user: founder, initialRead: OPEN() });
  assert.match(markup, /class="flex min-h-screen items-start justify-center bg-gray-50 px-4 /, '16px gutter, top-aligned on a phone');
  assert.match(markup, /class="w-full max-w-md /);
  assert.match(markup, /data-testid="seat-accept-button" class="mt-4 inline-flex w-full [^"]*sm:w-auto/, 'a full-width tap target on a phone');
});
