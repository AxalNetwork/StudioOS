/**
 * `GET /auth/me` tells the SPA whether this account still owes an acceptance —
 * and it has to be right in both directions, because one of them locks people
 * out of the product and the other silently keeps the record false.
 *
 * PR #549 made the terms consent real, but only at the onboarding licence gate,
 * and only fresh Auth-v2 signups pass through it. Admins, impersonated sessions,
 * `access_level = 'limited'` accounts, the legacy `flow='chat'` rows and EVERY
 * account older than #549 still have `tos_v1` and `privacy_v1` sitting
 * `pending`: satisfiable since #549, satisfied by nothing.
 *
 * THIS FILE RUNS THE ROUTE'S OWN SQL, read out of `routes/auth.ts` rather than
 * restated here. A copy of the query in a test proves the copy works. Pulling
 * the real one means an edit to the route is an edit to what these six cases
 * assert, which is the only way a text this small stays honest.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/terms_reacceptance_gate.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const AUTH = readFileSync(resolve(process.cwd(), 'cloudflare-worker/src/routes/auth.ts'), 'utf8');
const BASELINE = readFileSync(
  resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8',
);

/** The `terms_acceptance_pending` entry of /me's response literal, verbatim. */
function flagBlock(): string {
  const at = AUTH.indexOf('terms_acceptance_pending:');
  assert.ok(at >= 0, 'GET /me no longer returns terms_acceptance_pending — the SPA gate is blind');
  return AUTH.slice(at, AUTH.indexOf('})(),', at) + 5);
}

/** The one SQL string inside it. */
function flagSql(): string {
  const block = flagBlock();
  const open = block.indexOf('`');
  const close = block.indexOf('`', open + 1);
  assert.ok(open >= 0 && close > open, 'the flag no longer asks the database anything');
  return block.slice(open + 1, close);
}

function db(): InstanceType<typeof DatabaseSync> {
  const at = BASELINE.indexOf('CREATE TABLE legal_obligations (');
  assert.ok(at >= 0, 'legal_obligations is not in schema_baseline.sql');
  const d = new DatabaseSync(':memory:');
  d.exec(BASELINE.slice(at, BASELINE.indexOf(');', at) + 2));
  return d;
}

function seed(
  d: InstanceType<typeof DatabaseSync>,
  userId: number,
  rows: Array<[key: string, required: number, status: string]>,
) {
  for (const [key, required, status] of rows) {
    d.prepare(
      'INSERT INTO legal_obligations (user_id, obligation_key, required, status) VALUES (?, ?, ?, ?)',
    ).run(userId, key, required, status);
  }
}

const pendingFor = (d: InstanceType<typeof DatabaseSync>, userId: number) =>
  !!d.prepare(flagSql()).get(userId);

test('an account that never accepted is reported as owing one', () => {
  const d = db();
  seed(d, 1, [['tos_v1', 1, 'pending'], ['privacy_v1', 1, 'pending']]);
  assert.equal(pendingFor(d, 1), true);

  // One of the two is enough. Both are required, and a half-satisfied account is
  // exactly the state a failed write leaves behind.
  const e = db();
  seed(e, 2, [['tos_v1', 1, 'satisfied'], ['privacy_v1', 1, 'pending']]);
  assert.equal(pendingFor(e, 2), true, 'a half-accepted account must still be asked');

  // `in_review` is a real status on these rows and is not an acceptance.
  const f = db();
  seed(f, 3, [['tos_v1', 1, 'in_review'], ['privacy_v1', 1, 'satisfied']]);
  assert.equal(pendingFor(f, 3), true);
});

test('an account that has accepted is not asked again', () => {
  const d = db();
  seed(d, 4, [['tos_v1', 1, 'satisfied'], ['privacy_v1', 1, 'satisfied']]);
  assert.equal(pendingFor(d, 4), false);

  // `waived` is how `seedObligations` retires an obligation that does not apply
  // to a role. Treating it as outstanding would interrupt someone the platform
  // has already decided not to ask.
  const e = db();
  seed(e, 5, [['tos_v1', 1, 'waived'], ['privacy_v1', 1, 'waived']]);
  assert.equal(pendingFor(e, 5), false);
});

test('a not-required row is not a debt', () => {
  // `required` is per-role in ROLE_MATRIX. Gating on a row the matrix says this
  // account does not owe would block someone over an obligation that is not
  // theirs — and the Trust Center score, which only counts required rows, would
  // read 100 while the interstitial refused to let them in.
  const d = db();
  seed(d, 6, [['tos_v1', 0, 'pending'], ['privacy_v1', 0, 'pending']]);
  assert.equal(pendingFor(d, 6), false);
});

test('an unrelated obligation never triggers the terms screen', () => {
  // The interstitial collects exactly two things and can satisfy exactly two
  // things (`SATISFIABLE_BY_CLICKWRAP`). Showing it over a pending `kyc_v1`
  // would put a reader in front of a checkbox that cannot clear the row it was
  // shown for — an infinite gate, and the failure mode is invisible because the
  // acceptance still records successfully.
  const d = db();
  seed(d, 7, [
    ['kyc_v1', 1, 'pending'],
    ['kyb_v1', 1, 'pending'],
    ['accreditation_v1', 1, 'pending'],
    ['tos_v1', 1, 'satisfied'],
    ['privacy_v1', 1, 'satisfied'],
  ]);
  assert.equal(pendingFor(d, 7), false);
});

test('no rows at all reads as nothing owed, and that is deliberate', () => {
  // An account with no seeded obligations is not evidence of a debt; it is
  // evidence of an account that has not been seeded. `seedObligations` runs on
  // every login path — registration, magic-link verify, the Google callback —
  // so rows exist for anyone who has signed in. Gating on their absence would
  // interrupt a session over bookkeeping that had not happened yet.
  const d = db();
  assert.equal(pendingFor(d, 8), false);
});

test('the flag is scoped to the caller', () => {
  const d = db();
  seed(d, 9, [['tos_v1', 1, 'pending']]);
  assert.equal(pendingFor(d, 9), true);
  assert.equal(pendingFor(d, 10), false, 'one account\'s debt reached another account');
});

test('a database error reads as "do not gate", not as "gate"', () => {
  // THE DIRECTION MATTERS MORE THAN THE HANDLING. A thrown query that defaulted
  // to `true` would put an unskippable consent screen in front of every session
  // for as long as the fault lasted, and the screen's own accept call would be
  // failing too. `recovery_pending` two keys above resolves the same way for the
  // same reason.
  const block = flagBlock();
  assert.match(block, /catch\s*\{\s*return false;\s*\}/,
    'the flag no longer fails closed-to-open — an unreadable table would gate everyone');
  assert.doesNotMatch(block, /catch\s*\{\s*return true/);
});

test('the accept route takes no user id, so nothing can be accepted on somebody\'s behalf', () => {
  // Migration 245's own rationale anticipates three surfaces — a signup
  // checkbox, a re-acceptance interstitial and an admin backfill — and names
  // them so an audit can tell them apart. Only two of the three should ever be
  // written: an acceptance recorded FOR someone forges the record this whole
  // change exists to make honest. The route is the place that would make it
  // possible, so the route is where it is refused.
  const at = AUTH.indexOf("auth.post('/accept-terms'");
  assert.ok(at >= 0, 'the accept route is gone — the interstitial has nothing to call');
  const route = AUTH.slice(at, AUTH.indexOf('}));', at) + 4);
  assert.match(route, /const user = await requireAuth\(c\)/,
    'the acceptance must be attributed to the authenticated caller and to nobody else');
  assert.match(route, /recordTermsAcceptance\(c\.env, user\.id/,
    'the user id must come from the session, never from the request');
  assert.doesNotMatch(route, /req\.json\(\)|body|user_id|userId/,
    'the route reads a user from the request — that is the backfill this must not have');
  assert.match(route, /surface: 'reacceptance_interstitial'/);
  assert.match(route, /source: 'reacceptance_interstitial'/,
    'without its own source the Trust Center renders "Accepted at signup" over this act');
});
