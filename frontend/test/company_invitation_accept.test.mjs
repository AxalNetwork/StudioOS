/**
 * Task #121 — the invitee's half: `/company/invitations/accept`.
 *
 * The settings page's guard (`company_settings_members.test.mjs`) covers the
 * inviter's side. This covers the side that was missing entirely, because the
 * flow it replaces had no invitee side at all: `POST /company/:uid/members`
 * resolved an address to an existing account and joined it to the company
 * without asking, so there was nobody to send anywhere.
 *
 * What is pinned here is the set of facts that, if any one of them slipped,
 * would leave someone holding a link that cannot work — the failure this
 * feature exists to prevent and the one nobody would notice from the inviting
 * side, where the invitation looks sent either way.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = read('frontend/src/pages/AcceptCompanyInvitePage.jsx');
const APP = read('frontend/src/App.jsx');
const ROUTE = read('cloudflare-worker/src/routes/company.ts');
const API = read('frontend/src/lib/api.js');

test('the accept route is mounted, and mounted without a role gate', () => {
  const line = APP.split('\n').find((l) => l.includes('/company/invitations/accept'));
  assert.ok(line, 'the accept route is not registered — the emailed link 404s');
  assert.match(line, /element=\{<AcceptCompanyInvitePage \/>\}/, 'the route renders something else');
  // The invitee may have no account at all. `guard([...])` redirects by ROLE,
  // which they do not have yet, so wrapping this route sends them away from
  // the one page that can let them in.
  assert.doesNotMatch(line, /guard\(/,
    'the accept route is role-gated — an invitee with no account cannot reach it');
  assert.match(APP, /const AcceptCompanyInvitePage = lazy\(/, 'the page is not imported');
});

test('a signed-out invitee is bounced to sign-in and comes back WITH the token', () => {
  // A `?next=` that drops the token returns them to a page that can only say
  // "this link is missing its token" — the bounce has to round-trip it.
  assert.match(PAGE, /const nextPath = `\/company\/invitations\/accept\$\{token \? `\?token=\$\{encodeURIComponent\(token\)\}` : ''\}`/,
    'the return path no longer carries the token through sign-in');
  for (const [name, href] of [['loginHref', '/login'], ['registerHref', '/register']]) {
    const m = PAGE.match(new RegExp(`const ${name} = \`([^\`]+)\``));
    assert.ok(m, `${name} is gone`);
    assert.equal(m[1], `${href}?next=\${encodeURIComponent(nextPath)}`,
      `${name} does not return the invitee to the invitation`);
  }
  // Creating an account is offered, not just signing in: the address may be
  // a stranger's, which is the whole point of an invitation over a link.
  assert.match(PAGE, /Create an account/, 'an invitee with no account is offered no way to make one');
});

test('accepting is the invitee’s own act, and happens once', () => {
  assert.match(PAGE, /api\.acceptCompanyInvitation\(token\)/, 'the page never posts the token');
  assert.match(PAGE, /if \(!user\) return;/, 'the page tries to accept before anyone is signed in');
  assert.match(PAGE, /if \(state === 'idle'\) accept\(\);/,
    'the accept effect is not idle-guarded — a re-render would re-post a spent token');
});

test('already a member is a success, and the wrong account says which one', () => {
  // Two server outcomes that are easy to render as the same flat failure and
  // must not be. `already_member` is 200 with the outcome the invitation
  // asked for; `wrong_account` is the one error the reader can actually act
  // on, and only if the page tells them the address.
  assert.match(ROUTE, /already_member: !!already/, 'the route no longer reports already_member');
  const done = PAGE.slice(PAGE.indexOf("state === 'done'"), PAGE.indexOf('Open company settings'));
  assert.ok(done.length > 100, 'the success branch is gone');
  assert.match(done, /result\?\.already_member/,
    'someone already on the company is shown the joined-just-now message');

  assert.match(ROUTE, /code: 'wrong_account',\s*\n\s*invited_email: inv\.email,/,
    'the route stopped naming the address the invitation was for');
  assert.match(PAGE, /e\?\.data\?\.invited_email/, 'the page discards the address the server sent');
  assert.match(PAGE, /It was sent to <strong/, 'the wrong-account case no longer names the address');
});

test('the page never prints the token it was given', () => {
  // It is a bearer credential in a URL. Rendering it puts it in a screenshot.
  assert.doesNotMatch(PAGE, /\{token\}/, 'the raw token is rendered into the page');
});

test('every invitation method has a worker route behind it', () => {
  for (const [method, matcher] of [
    ['inviteCompanyMember', /r\.post\('\/company\/:uid\/invitations',/],
    ['listCompanyInvitations', /r\.get\('\/company\/:uid\/invitations',/],
    ['resendCompanyInvitation', /r\.post\('\/company\/:uid\/invitations\/:inviteUid\/resend',/],
    ['revokeCompanyInvitation', /r\.delete\('\/company\/:uid\/invitations\/:inviteUid',/],
    ['acceptCompanyInvitation', /r\.post\('\/company\/invitations\/accept',/],
  ]) {
    assert.match(API, new RegExp(`\\n\\s*${method}:`), `api.js does not expose ${method}`);
    assert.match(ROUTE, matcher, `${method} has no worker route — it would 404`);
  }
});
