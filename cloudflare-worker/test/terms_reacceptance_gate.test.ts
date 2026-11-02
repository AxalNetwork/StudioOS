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
 *
 * D1548 (#3793) adds the re-acceptance of a new Terms version (the v4 slot,
 * owner decision Y) at the end of this file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { recordTermsAcceptance, LEGAL_DOCUMENT_VERSIONS, TERMS_REACCEPT_FROM } from '../src/services/trust.ts';

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

/* ------------------------------------------------------------------ *
 * D1548 (#3793): re-acceptance of a new Terms version through this gate.
 *
 * Owner decision Y ships the Terms' AI-output clause (A19's v4 draft) with
 * re-acceptance. Counsel's text has not been given, so `TERMS_REACCEPT_FROM`
 * ships null. These cases run the route's own second query with a version
 * set, as it will be when the text lands, and the real accept writer.
 * ------------------------------------------------------------------ */

const MIGRATIONS = ['245_legal_acceptances.sql', '583_legal_acceptance_version.sql'].map((f) => readFileSync(
  resolve(process.cwd(), `cloudflare-worker/sql/migrations/${f}`), 'utf8',
)).join('\n');

/** Both SQL strings in the flag, in order: the never-accepted one and the stale-version one. */
function flagSqls(): string[] {
  const block = flagBlock();
  const out: string[] = [];
  for (let i = block.indexOf('`'); i >= 0; i = block.indexOf('`', block.indexOf('`', i + 1) + 1)) {
    out.push(block.slice(i + 1, block.indexOf('`', i + 1)));
  }
  return out;
}

/** legal_obligations from the baseline, legal_acceptances from its migrations, and a D1-shaped env over them. */
function dbWithAcceptances() {
  const d = db();
  const sql = MIGRATIONS.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  for (const stmt of sql.split(';')) { const s = stmt.trim(); if (s) d.exec(`${s};`); }
  const DB = {
    prepare(q: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x.map((v) => (v === undefined ? null : v)); return api; },
        async first() { return d.prepare(q).get(...b) ?? null; },
        async all() { return { results: d.prepare(q).all(...b) }; },
        async run() { const r = d.prepare(q).run(...b); return { meta: { changes: Number(r.changes) } }; },
      };
      return api;
    },
  };
  return { d, env: { DB } as any };
}

/** The route's decision, step for step: the first query, then the second only when a version is set. */
function reason(d: InstanceType<typeof DatabaseSync>, userId: number, from: string | null): 'missing' | 'updated' | null {
  const [never, stale] = flagSqls();
  if (d.prepare(never).get(userId)) return 'missing';
  if (!from) return null;
  return d.prepare(stale).get(userId, from) ? 'updated' : null;
}

function accepted(d: InstanceType<typeof DatabaseSync>, userId: number, version: string | null) {
  d.prepare(
    `INSERT INTO legal_acceptances (user_id, obligation_key, accepted_at, surface, document_version)
     VALUES (?, 'tos_v1', '2026-08-01T00:00:00Z', 'onboarding_licence', ?)`,
  ).run(userId, version);
}

const V3 = LEGAL_DOCUMENT_VERSIONS.tos_v1;
const V4 = '2099-01-01'; // a stand-in: v4's date is the day counsel's text goes on /terms

test('the re-acceptance gate passes with v4: an earlier acceptance is asked again, a v4 one is not', () => {
  const { d } = dbWithAcceptances();
  seed(d, 20, [['tos_v1', 1, 'satisfied'], ['privacy_v1', 1, 'satisfied']]);
  accepted(d, 20, V3);
  assert.equal(reason(d, 20, null), null, 'with no version set, an accepted member is not asked');
  assert.equal(reason(d, 20, V4), 'updated', 'a member who accepted v3 must be asked to accept v4');

  accepted(d, 20, V4);
  assert.equal(reason(d, 20, V4), null, 'a member who accepted v4 is asked again');

  // Only a Terms acceptance counts: a newer Privacy Policy row is not one.
  seed(d, 28, [['tos_v1', 1, 'satisfied'], ['privacy_v1', 1, 'satisfied']]);
  accepted(d, 28, V3);
  d.prepare(
    `INSERT INTO legal_acceptances (user_id, obligation_key, accepted_at, surface, document_version)
     VALUES (28, 'privacy_v1', '2026-08-01T00:00:00Z', 'onboarding_licence', ?)`,
  ).run(V4);
  assert.equal(reason(d, 28, V4), 'updated', 'a Privacy Policy acceptance counted as the Terms');

  // Accepted before migration 583 recorded a version: nothing says it was v4.
  seed(d, 21, [['tos_v1', 1, 'satisfied'], ['privacy_v1', 1, 'satisfied']]);
  accepted(d, 21, null);
  assert.equal(reason(d, 21, V4), 'updated', 'an acceptance with no recorded version counted as v4');
});

test('re-acceptance keeps the gate\'s own exclusions and scope', () => {
  const { d } = dbWithAcceptances();
  seed(d, 22, [['tos_v1', 1, 'waived'], ['privacy_v1', 1, 'waived']]);
  assert.equal(reason(d, 22, V4), null, 'a waived obligation was asked again');
  seed(d, 23, [['tos_v1', 0, 'satisfied'], ['privacy_v1', 0, 'satisfied']]);
  assert.equal(reason(d, 23, V4), null, 'a not-required obligation was asked again');
  assert.equal(reason(d, 24, V4), null, 'an account with no rows was asked');
  seed(d, 25, [['tos_v1', 1, 'satisfied'], ['privacy_v1', 1, 'satisfied']]);
  accepted(d, 25, V4);
  seed(d, 26, [['tos_v1', 1, 'satisfied'], ['privacy_v1', 1, 'satisfied']]);
  accepted(d, 26, V3);
  assert.equal(reason(d, 25, V4), null, 'another account\'s old acceptance reached this one');
  assert.equal(reason(d, 26, V4), 'updated');
  // Never accepted at all stays "missing", whatever the version.
  seed(d, 27, [['tos_v1', 1, 'pending'], ['privacy_v1', 1, 'pending']]);
  assert.equal(reason(d, 27, V4), 'missing');
});

test('accepting through the real writer clears the re-acceptance, so the gate cannot loop', async () => {
  // On go-live the version required is the page's own date, which is what the
  // writer records. A member who accepted the earlier page is asked; one click
  // through `recordTermsAcceptance` (the interstitial's route) ends it.
  const { d, env } = dbWithAcceptances();
  seed(d, 30, [['tos_v1', 1, 'satisfied'], ['privacy_v1', 1, 'satisfied']]);
  accepted(d, 30, '2026-01-01');
  assert.equal(reason(d, 30, V3), 'updated');
  await recordTermsAcceptance(env, 30, { surface: 'reacceptance_interstitial', source: 'reacceptance_interstitial' });
  assert.equal(reason(d, 30, V3), null, 'the accept route did not clear the re-acceptance');
});

test('the switch is off and can only be set to a version the writer can satisfy', () => {
  // Off until counsel's text is on /terms: nobody is asked to accept text that
  // does not exist. When set, it must not be later than the page's date, or
  // accepting would record an earlier version and the screen would never clear.
  assert.equal(TERMS_REACCEPT_FROM, null, 'TERMS_REACCEPT_FROM is set: is counsel\'s text on /terms?');
  if (TERMS_REACCEPT_FROM !== null) assert.ok(TERMS_REACCEPT_FROM <= V3);
});

test('the route asks the second question only when a version is set, bound, and reports why', () => {
  const block = flagBlock();
  const sqls = flagSqls();
  assert.equal(sqls.length, 2, 'the flag should hold exactly the two queries');
  assert.match(sqls[1], /a\.document_version >= \?/);
  assert.match(sqls[1], /o\.status = 'satisfied'/);
  assert.match(sqls[1], /o\.required = 1/);
  const guard = block.indexOf('if (!TERMS_REACCEPT_FROM) return false;');
  assert.ok(guard >= 0 && guard < block.indexOf(sqls[1]),
    'the second query must not run while the switch is off');
  assert.match(block, /\.bind\(user\.id, TERMS_REACCEPT_FROM\)/);
  assert.match(block, /termsReason = 'missing'; return true;/);
  assert.match(block, /termsReason = 'updated'; return true;/);
  assert.match(AUTH, /terms_acceptance_reason: termsReason,/);
});
