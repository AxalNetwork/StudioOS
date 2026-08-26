/**
 * Tenancy scope — the deny-by-default property, pinned.
 *
 * A scoping bug in this shape is silent. An accidental "no filter" reads as
 * working software right up until it serves another tenant's contracts, which
 * is exactly how the /api/legal/entities cross-tenant leak got shipped once
 * already. So the tests that matter most here are the ones asserting that
 * anything unrecognised produces NO rows rather than ALL rows.
 *
 * Pure functions — no D1, no auth, no clock.
 *
 * Run via the strip-types loader:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/tenancyScope.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  esignEnvelopeScope, fundGpScope, isUnscoped, andScope,
  ALL_ROWS, NO_ROWS, UNSCOPED_ROLES,
} from '../src/services/tenancyScope.ts';

// ---------- the default ----------

test('anything unidentifiable is denied every row, not granted every row', () => {
  // Each of these is a plausible bug: a missing session, a half-built actor,
  // a role that did not load. None may widen to 1=1.
  for (const actor of [
    null, undefined, {}, { id: null }, { id: 0 }, { id: -1 },
    { id: NaN }, { id: 1.5 }, { role: 'admin' }, { id: undefined, role: 'admin' },
  ] as any[]) {
    const s = esignEnvelopeScope(actor);
    assert.equal(s.sql, NO_ROWS.sql, `actor ${JSON.stringify(actor)} must get no rows`);
    assert.deepEqual(s.binds, []);
  }
});

test('a role string that is not exactly an unscoped role fails closed', () => {
  // Capitalisation, whitespace and near-misses must not read as admin.
  for (const role of ['Admin', 'ADMIN', ' admin', 'admin ', 'administrator', 'superadmin', '']) {
    assert.equal(isUnscoped({ id: 7, role }), false, `"${role}" must not be unscoped`);
    assert.notEqual(esignEnvelopeScope({ id: 7, role }).sql, ALL_ROWS.sql);
  }
  assert.equal(isUnscoped({ id: 7, role: 'admin' }), true);
});

// ---------- what a scoped actor gets ----------

test('a scoped actor sees envelopes they originated, are named in, or must sign', () => {
  const s = esignEnvelopeScope({ id: 42, role: 'founder' });
  assert.match(s.sql, /e\.created_by = \?/, 'envelopes they originated');
  assert.match(s.sql, /e\.user_id = \?/, 'envelopes about them');
  assert.match(s.sql, /esign_recipients/, 'envelopes they must sign');
  // One bind per placeholder, or D1 throws at runtime rather than at review.
  assert.equal(s.binds.length, (s.sql.match(/\?/g) || []).length);
  assert.deepEqual(s.binds, [42, 42, 42]);
});

test('the clause is parenthesised, so OR cannot leak past an AND', () => {
  // `WHERE status = ? AND a = ? OR b = ?` returns every row matching b.
  // The scope must bind tighter than any AND a caller composes it into.
  const s = esignEnvelopeScope({ id: 9, role: 'founder' });
  assert.ok(s.sql.startsWith('('), 'scope must open with a paren');
  assert.ok(s.sql.trimEnd().endsWith(')'), 'scope must close it');
});

test('the alias is configurable so a joined query can still scope', () => {
  const s = esignEnvelopeScope({ id: 5, role: 'founder' }, 'env');
  assert.match(s.sql, /env\.created_by/);
  assert.doesNotMatch(s.sql, /\be\.created_by/);
});

test('an admin is unscoped, and carries no binds to misalign', () => {
  const s = esignEnvelopeScope({ id: 1, role: 'admin' });
  assert.equal(s.sql, ALL_ROWS.sql);
  assert.deepEqual(s.binds, []);
  assert.ok(UNSCOPED_ROLES.has('admin'));
});

// ---------- funds ----------

test('fund ownership is the GP of record, and denies by default', () => {
  assert.equal(fundGpScope({ id: 12, role: 'investor' }).sql, '(f.gp_user_id = ?)');
  assert.deepEqual(fundGpScope({ id: 12, role: 'investor' }).binds, [12]);
  for (const actor of [null, undefined, {}, { id: 0 }, { role: 'investor' }] as any[]) {
    assert.equal(fundGpScope(actor).sql, NO_ROWS.sql, `${JSON.stringify(actor)} must own no fund`);
  }
});

test('a fund with no GP of record is owned by nobody, not by everybody', () => {
  // The scope compares with `=`, and in SQL `NULL = 5` is NULL rather than
  // true, so a legacy fund with gp_user_id unset matches no non-admin. That
  // is the correct failure: the alternative hands every institutional account
  // write access to every unowned fund, capital calls included.
  const s = fundGpScope({ id: 5, role: 'investor' });
  assert.match(s.sql, /gp_user_id = \?/);
  assert.doesNotMatch(s.sql, /IS NULL|IS \?|COALESCE/, 'must not treat unowned as open');
});

test('an admin operates any fund, and the alias is configurable', () => {
  assert.equal(fundGpScope({ id: 1, role: 'admin' }).sql, ALL_ROWS.sql);
  assert.match(fundGpScope({ id: 2, role: 'investor' }, 'vf').sql, /vf\.gp_user_id/);
});

test('the two resources are independent — one cannot be used for the other', () => {
  // A copy-paste that scoped funds with the envelope clause would silently
  // grant on created_by, which vc_funds does not even have.
  const fund = fundGpScope({ id: 3, role: 'investor' }).sql;
  assert.doesNotMatch(fund, /created_by|esign_recipients/);
  const env = esignEnvelopeScope({ id: 3, role: 'investor' }).sql;
  assert.doesNotMatch(env, /gp_user_id/);
});

// ---------- composition ----------

test('andScope appends the scope and keeps bind order', () => {
  const base = 'SELECT * FROM esign_envelopes e WHERE e.status = ?';
  const composed = andScope(base, ['sent'], esignEnvelopeScope({ id: 3, role: 'founder' }));
  assert.match(composed.sql, /WHERE e\.status = \? AND \(/);
  // Base binds first, scope binds after — the order the SQL reads them.
  assert.deepEqual(composed.binds, ['sent', 3, 3, 3]);
  assert.equal(composed.binds.length, (composed.sql.match(/\?/g) || []).length);
});

test('composing an admin scope leaves the base binds untouched', () => {
  const composed = andScope('SELECT 1 WHERE x = ?', [7], esignEnvelopeScope({ id: 1, role: 'admin' }));
  assert.deepEqual(composed.binds, [7]);
  assert.match(composed.sql, /AND 1=1$/);
});

test('composing a denied scope produces a query that returns nothing', () => {
  const composed = andScope('SELECT 1 WHERE x = ?', [7], esignEnvelopeScope(null));
  assert.match(composed.sql, /AND 1=0$/, 'a denied actor must not fall through to the base query alone');
});
