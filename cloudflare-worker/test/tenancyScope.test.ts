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
  esignEnvelopeScope, fundGpScope, lpMembershipScope, lpSelfScope,
  isUnscoped, andScope,
  ALL_ROWS, NO_ROWS, UNSCOPED_ROLES,
  projectOwnerScope,
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

// ---------- LP membership ----------

test('LP membership denies by default like every other resource', () => {
  for (const actor of [
    null, undefined, {}, { id: null }, { id: 0 }, { id: -1 },
    { id: NaN }, { id: 1.5 }, { email: 'lp@example.com' },
    { role: 'admin' }, { id: 0, role: 'admin', email: 'a@b.co' },
  ] as any[]) {
    assert.equal(lpMembershipScope(actor).sql, NO_ROWS.sql,
      `actor ${JSON.stringify(actor)} must match no LP row`);
    assert.equal(lpSelfScope(actor).sql, NO_ROWS.sql,
      `actor ${JSON.stringify(actor)} must own no LP row`);
  }
});

test('an actor with no email is matched on the account link alone', () => {
  // The arm is DROPPED, not bound to ''. `LOWER(email) = LOWER('')` is true
  // for every row with an empty email, so binding the empty string would have
  // handed those rows to any session missing an address — which is precisely
  // what spinout_lab.ts's `user.email ?? ''` did before this module.
  for (const email of [undefined, null, '', '   ', 42, {}] as any[]) {
    const s = lpMembershipScope({ id: 8, role: 'investor', email });
    assert.equal(s.sql, '(lp.user_id = ?)', `email ${JSON.stringify(email)} must not open the email arm`);
    assert.deepEqual(s.binds, [8]);
    assert.doesNotMatch(s.sql, /LOWER/, 'no email means no email comparison at all');
  }
});

test('the email arm only reaches rows nobody has claimed', () => {
  // `limited_partners.email` is operator-entered, so it can name one address
  // while user_id points at another account. Without the IS NULL qualifier the
  // arm hands such a row to whoever holds the address, over the top of the
  // account that owns it. funds.ts and spinout_lab.ts both shipped it that way.
  const s = lpMembershipScope({ id: 8, role: 'investor', email: 'lp@example.com' });
  assert.match(s.sql, /lp\.user_id = \?/, 'the account link is the primary arm');
  assert.match(s.sql, /lp\.user_id IS NULL AND LOWER\(lp\.email\) = LOWER\(\?\)/,
    'the email arm must be qualified by an unclaimed row');
  assert.deepEqual(s.binds, [8, 'lp@example.com']);
  assert.equal(s.binds.length, (s.sql.match(/\?/g) || []).length);
});

test('the email arm cannot be reached without the IS NULL qualifier on either side of the OR', () => {
  // A regression that dropped only the qualifier would still pass a loose
  // "matches on email" assertion, so pin the shape: every LOWER(...) comparison
  // in the clause is preceded by an unclaimed-row test.
  const s = lpMembershipScope({ id: 3, role: 'investor', email: 'x@y.z' }).sql;
  const lowerCount = (s.match(/LOWER\(lp\.email\)/g) || []).length;
  const guardCount = (s.match(/lp\.user_id IS NULL AND LOWER\(lp\.email\)/g) || []).length;
  assert.equal(lowerCount, guardCount, 'every email comparison must sit behind IS NULL');
  assert.equal(lowerCount, 1, 'and there should be exactly one of them');
});

test('the email is trimmed but never case-folded in the bind', () => {
  // Case-insensitivity belongs in the SQL (LOWER on both sides), not in a
  // pre-lowered bind — folding here would silently diverge from the UPDATE in
  // lpClaim.ts, which compares the raw address the same way.
  const s = lpMembershipScope({ id: 4, role: 'investor', email: '  LP@Example.com  ' });
  assert.deepEqual(s.binds, [4, 'LP@Example.com']);
});

test('lpMembershipScope is administrative — an admin sees every LP row', () => {
  const s = lpMembershipScope({ id: 1, role: 'admin', email: 'ops@axal.vc' });
  assert.equal(s.sql, ALL_ROWS.sql);
  assert.deepEqual(s.binds, []);
});

test('lpSelfScope is personal — an admin sees only their own LP rows', () => {
  // /lp-portal and /liquidity/my-portfolio answer "what do I hold". Returning
  // every row to an admin there does not grant oversight, it corrupts a
  // personal view: every LP's commitments summed into one operator's TVPI.
  const s = lpSelfScope({ id: 1, role: 'admin', email: 'ops@axal.vc' });
  assert.notEqual(s.sql, ALL_ROWS.sql, 'a self-view has no unscoped escape');
  assert.match(s.sql, /lp\.user_id = \?/);
  assert.deepEqual(s.binds, [1, 'ops@axal.vc']);
});

test('the two LP functions share one predicate for a non-admin', () => {
  // The whole point of the pair. If these ever diverge, the legacy-email rule
  // has been re-implemented twice — the failure this module exists to end.
  const actor = { id: 11, role: 'investor', email: 'lp@example.com' };
  assert.deepEqual(lpSelfScope(actor), lpMembershipScope(actor));
});

test('the LP scope is parenthesised and alias-configurable', () => {
  const s = lpMembershipScope({ id: 2, role: 'investor', email: 'a@b.co' });
  assert.ok(s.sql.startsWith('(') && s.sql.trimEnd().endsWith(')'),
    'an unparenthesised OR leaks past any AND the caller composes it into');
  const aliased = lpSelfScope({ id: 2, email: 'a@b.co' }, 'x');
  assert.match(aliased.sql, /x\.user_id/);
  assert.doesNotMatch(aliased.sql, /\blp\.user_id/);
});

test('the LP scope is not interchangeable with the other two resources', () => {
  const lp = lpMembershipScope({ id: 3, role: 'investor', email: 'a@b.co' }).sql;
  assert.doesNotMatch(lp, /created_by|esign_recipients|gp_user_id/);
  assert.doesNotMatch(fundGpScope({ id: 3, role: 'investor' }).sql, /lp\.email/);
});

/* ------------------------------------------------------------------ *
 * projectOwnerScope — the fourth resource                             *
 * ------------------------------------------------------------------ */

test('a founder is scoped to their own founders row, never their user id', () => {
  // `projects.founder_id` references `founders(id)`. Binding the USER id here
  // would be valid SQL that silently matches whichever unrelated founder holds
  // that number — the worst kind of wrong, because it returns rows.
  const s = projectOwnerScope({ id: 900, role: 'founder', founder_id: 7 });
  assert.match(s.sql, /p\.founder_id = \?/);
  assert.deepEqual(s.binds, [7], 'the bind is the FOUNDER id, not the user id');
  assert.match(s.sql, /deleted_at IS NULL/, 'a soft-deleted project is not owned');
});

test('a residual founder_id on a converted account grants nothing', () => {
  // This is the whole reason the scope is role-gated. `auth.ts` records it
  // twice: a principal converted to another role KEEPS users.founder_id, so an
  // id-only check would let a former founder keep reading their old projects
  // after becoming an investor.
  for (const role of ['investor', 'partner', 'advisor', 'exploring', '', null]) {
    const s = projectOwnerScope({ id: 900, role, founder_id: 7 });
    assert.equal(s.sql, '1=0', `role ${JSON.stringify(role)} must get no rows`);
    assert.deepEqual(s.binds, []);
  }
});

test('partners get nothing here, unlike canAccessFounderResource', () => {
  // A deliberate divergence: that predicate treats partners as studio-wide
  // staff, but a data room is the set of documents a founder chose to share
  // with named investors. A blanket partner path would make the grant
  // decorative.
  assert.equal(projectOwnerScope({ id: 5, role: 'partner' }).sql, '1=0');
});

test('a founder with no founders row owns nothing, rather than falling back', () => {
  assert.equal(projectOwnerScope({ id: 900, role: 'founder' }).sql, '1=0');
  assert.equal(projectOwnerScope({ id: 900, role: 'founder', founder_id: null }).sql, '1=0');
});

test('an unidentified caller gets no rows whatever it claims', () => {
  assert.equal(projectOwnerScope(null).sql, '1=0');
  assert.equal(projectOwnerScope(undefined).sql, '1=0');
  assert.equal(projectOwnerScope({ role: 'founder', founder_id: 7 }).sql, '1=0',
    'a founder_id with no user id behind it is not an identity');
});

test('admin sees every project except the deleted ones', () => {
  const s = projectOwnerScope({ id: 1, role: 'admin' });
  assert.match(s.sql, /deleted_at IS NULL/);
  assert.doesNotMatch(s.sql, /founder_id/);
  assert.deepEqual(s.binds, []);
});

test('the alias is honoured, so the clause composes into a join', () => {
  assert.match(projectOwnerScope({ id: 9, role: 'founder', founder_id: 2 }, 'proj').sql,
    /proj\.founder_id/);
});
