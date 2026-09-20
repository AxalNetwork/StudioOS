/**
 * D168 — HQ's Data subject requests zone gets its first assertions.
 *
 * TWO FINDINGS, AND THE SECOND IS WHY THIS FILE IS PART OF THE DELIVERABLE.
 *
 * 1. THE ZONE COULD NOT ACT. `users.deletion_requested_at` was written only by
 *    the subject, read here against a GDPR Art. 12(3) 30-day clock, and painted
 *    amber with a "deadline pressure" headline — while `admin_security.ts` had
 *    four handlers, none of which could close one. HQ watched a statutory
 *    deadline it had no way to stop.
 *
 * 2. THE CLOCK WAS HALF-GUARDED, AND THE GUARDED HALF WAS ITS SPELLING.
 *    `hq_security.test.mjs` pinned two literals in the route — the constant
 *    and the exact text of the subtraction — and never read the line above,
 *    where milliseconds became days. Turning `86400000` into `3600000` would
 *    have made every request read twenty-four times more overdue with nothing
 *    failing. (My first pass reported the surface as entirely unguarded; that
 *    was a case-sensitive grep missing `DSR_CLOCK_DAYS`, and the real finding
 *    is the worse one.) The controls and the render's claims had no assertion
 *    of any kind, which is what this file adds.
 *
 * WHERE THE ASSERTIONS LIVE. The clock arithmetic is exercised for real in
 * `cloudflare-worker/test/dsr_close_d168.test.ts`, against the service that now
 * owns it — a source scan cannot show that `days_left` counts the right way.
 * What is left here is the RENDER's own claims, and they are read from a slice
 * bounded to this zone at both ends: a whole-file scan would be satisfied by a
 * neighbouring zone, which is the D147/D161/D167 failure three times over.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const at = (p) => resolve(process.cwd(), p);
const raw = (p) => readFileSync(at(p), 'utf8');

const PAGE = raw('frontend/src/pages/hq/SecurityPage.jsx');
const API = raw('frontend/src/lib/api.js');
const ROUTE = raw('cloudflare-worker/src/routes/admin_security.ts');

/**
 * JSX prose is line-wrapped by the formatter, so a sentence that reads as one
 * line in the file is not one line in the source. Matching prose without
 * collapsing whitespace first fails on correct code — which it did here, on
 * the very sentence this file exists to pin.
 */
const flat = (s) => s.replace(/\s+/g, ' ');

/** The zone's own JSX, bounded at both ends so a sibling zone cannot satisfy it. */
function dsrZone() {
  const start = PAGE.indexOf('<Zone title="Data subject requests"');
  assert.ok(start > 0, 'the Data subject requests zone is gone');
  const rest = PAGE.slice(start + 1);
  const end = rest.indexOf('<Zone ');
  assert.ok(end > 0, 'the zone has no following sibling — the bound would run to EOF');
  return rest.slice(0, end);
}

/** The close control's own component, bounded the same way. */
function closeControl() {
  const start = PAGE.indexOf('function DsrClose(');
  assert.ok(start > 0, 'the DsrClose control is gone');
  const rest = PAGE.slice(start + 1);
  const end = rest.indexOf('\nfunction ') >= 0 ? rest.indexOf('\nfunction ') : rest.indexOf('\nexport default');
  assert.ok(end > 0, 'DsrClose has no end');
  return rest.slice(0, end);
}

test('the zone offers the two outcomes HQ may record, and only those', () => {
  const zone = dsrZone();
  assert.match(zone, /<DsrClose\b/, 'the zone renders no way to close a request — the defect is back');
  assert.match(zone, /onDone=\{load\}/,
    'closing does not refresh the list, so a closed request stays on screen until a reload');

  const ctl = closeControl();
  assert.match(ctl, /setOutcome\('fulfilled'\)/, 'the fulfilled control is gone');
  assert.match(ctl, /setOutcome\('denied'\)/, 'the denied control is gone');

  // A WITHDRAWAL IS THE SUBJECT'S OWN ACT. The server refuses it from HQ, so a
  // control here would offer a button the server declines — the
  // `still_an_admin` mistake D134 named — and, worse, it would be recording
  // that the subject changed their mind when they did not.
  assert.doesNotMatch(ctl, /setOutcome\('withdrawn'\)/,
    'HQ is offered a withdrawal, which records an act the subject did not perform');
});

test('the reason floor the server enforces is mirrored, so the form never offers a refusal', () => {
  const ctl = closeControl();
  assert.match(ctl, /reason\.trim\(\)\.length < 8/,
    'the submit is no longer disabled below the reason length the server requires');
  // And the server is where it is actually enforced — a client-only rule is a
  // convention, not a control.
  assert.match(ROUTE, /const MIN_REASON = 8;/,
    'the server-side reason floor moved; the mirrored client check is now wrong');
});

test('"fulfilled" is described as recording a manual act, never as performing one', () => {
  // The single most important line in this PR. There is no erasure path in the
  // codebase; a control that read as if it deleted the account would make the
  // compliance record itself false.
  const ctl = closeControl();
  assert.match(flat(ctl), /does not erase anything/i,
    'the fulfilled control no longer says the platform erases nothing');

  const zone = dsrZone();
  assert.match(flat(zone), /erasure itself is still a manual act/,
    'the zone stopped saying erasure is manual — which is still true, and now load-bearing');
  assert.match(flat(zone), /records that act rather than performing one/,
    'the zone no longer distinguishes recording the act from performing it');
});

test('an unreadable ledger renders as unknown, never as "never asked before"', () => {
  // #204's rule on a screen where it changes a judgement: a third request read
  // as a first is a different decision from a third read as a third.
  const zone = dsrZone();
  assert.match(zone, /d\.prior_requests === null/,
    'the zone no longer distinguishes an unreadable ledger from a subject with no history');
  assert.match(zone, /hq-dsr-history-unreadable/, 'the unreadable state has no testid');
  assert.match(zone, /<Unrecorded>earlier requests unknown<\/Unrecorded>/,
    'the unreadable state renders something other than a stated absence');
  // The server must keep sending the null rather than defaulting to 0.
  assert.match(ROUTE, /prior_requests: ledgerAvailable \? \(seen\?\.prior \?\? 0\) : null/,
    'the server now reports 0 earlier requests when the ledger could not be read');
});

test('the SPA method and the worker route are the same endpoint', () => {
  const api = codeOnly(API);
  assert.match(api, /hqCloseDsrRequest:/, 'the api.js method is gone');
  assert.match(api, /\/admin\/security\/dsr\/\$\{encodeURIComponent\(userId\)\}\/close/,
    'the api.js method no longer posts to the close route');
  assert.match(ROUTE, /r\.post\('\/dsr\/:userId\/close'/,
    'the worker route the api.js method calls is gone');
  // The page must go through the method rather than fetching directly.
  assert.match(closeControl(), /api\.hqCloseDsrRequest\(row\.id, outcome, reason\.trim\(\)\)/,
    'the control no longer calls the api.js method');
});
