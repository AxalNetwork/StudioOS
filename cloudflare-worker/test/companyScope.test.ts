/**
 * companyScope + resolveActiveCompany — the company dimension.
 *
 * Migration 189 gave `projects` a `company_id`; before it, the entire schema
 * carried that column on one table (`user_company_links`) and the
 * CompanySwitcher changed a label. These tests pin the two properties that
 * make the new scope safe to spread to the other project-keyed surfaces:
 * it NARROWS ownership rather than replacing it, and the id it narrows on has
 * been checked against membership rather than believed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { companyScope, projectOwnerScope, NO_ROWS } from '../src/services/tenancyScope';
import { resolveActiveCompany, ACTIVE_COMPANY_HEADER } from '../src/middleware/activeCompany';

const founder = { id: 42, role: 'founder', founder_id: 7 };

test('company is a narrowing of ownership, never a replacement', () => {
  const owner = projectOwnerScope(founder, 'p');
  const scoped = companyScope(founder, 3, 'p');
  // Belonging to a company must not hand you another founder's projects that
  // happen to share it, so the ownership predicate survives intact.
  assert.ok(scoped.sql.includes(owner.sql), 'the ownership clause is still there');
  assert.match(scoped.sql, /p\.company_id = \?/);
  assert.deepEqual(scoped.binds, [...owner.binds, 3]);
});

test('one bind per placeholder', () => {
  // D1 throws at runtime, not at review, when these disagree.
  for (const cid of [null, 3]) {
    const s = companyScope(founder, cid, 'p');
    assert.equal(s.binds.length, (s.sql.match(/\?/g) || []).length, `companyId=${cid}`);
  }
});

test('no company selected means every project you own, not none', () => {
  // Returning NO_ROWS here would blank the app for every existing user the
  // moment this shipped — nobody has touched the switcher yet.
  const scoped = companyScope(founder, null, 'p');
  assert.deepEqual(scoped, projectOwnerScope(founder, 'p'));
});

test('unassigned projects stay visible under a selected company', () => {
  // `company_id IS NULL` is a real state: migration 189 backfills only founders
  // who have a primary company and invents nothing for the rest. Hiding those
  // projects would make a founder's own work vanish behind a control they did
  // not know changed anything.
  assert.match(companyScope(founder, 3, 'p').sql, /p\.company_id IS NULL/);
});

test('an actor with no ownership gets no rows, whatever company they claim', () => {
  for (const actor of [
    null,
    { id: 42, role: 'investor', founder_id: 7 },   // role-gated, not id-gated
    { id: 42, role: 'founder', founder_id: null }, // founder with no founders row
    { role: 'founder', founder_id: 7 },            // no user id
  ] as any[]) {
    assert.equal(companyScope(actor, 3, 'p').sql, NO_ROWS.sql,
      `${JSON.stringify(actor)} must get no rows`);
    assert.deepEqual(companyScope(actor, 3, 'p').binds, []);
  }
});

test('admin stays unscoped — the tenant overlay is a separate feature', () => {
  const s = companyScope({ id: 1, role: 'admin' }, 3, 'p');
  assert.ok(!s.sql.includes('company_id'), 'no company narrowing for admin');
  assert.deepEqual(s.binds, []);
});

// ---------- the header is a claim, not a grant ----------

/** An env stub whose membership table contains exactly the given (user, company) pairs. */
const dbWith = (pairs: Array<[number, number]>) => ({ DB: {
  prepare(_sql: string) {
    let bound: any[] = [];
    const stmt = {
      bind(...a: any[]) { bound = a; return stmt; },
      async first<T>() {
        const [u, co] = bound;
        return pairs.some(([pu, pc]) => pu === u && pc === co) ? ({ ok: 1 } as T) : null;
      },
    };
    return stmt;
  },
} }) as any;

test('a company the caller does not belong to resolves to null', async () => {
  const env = dbWith([[42, 3]]);
  assert.equal(await resolveActiveCompany(env, { id: 42 }, '3'), 3, 'a real membership passes');
  assert.equal(await resolveActiveCompany(env, { id: 42 }, '9'), null, 'a forged id is dropped');
  assert.equal(await resolveActiveCompany(env, { id: 99 }, '3'), null, 'another user cannot borrow it');
});

test('malformed header values never reach a bind', async () => {
  // Number() alone would accept every one of these.
  const env = dbWith([[42, 3]]);
  for (const raw of ['', '   ', '0', '-3', '0x3', '3e0', '3.0', 'Infinity', 'NaN',
                     '3; DROP TABLE users', '٣', '1'.repeat(20), null, undefined]) {
    assert.equal(await resolveActiveCompany(env, { id: 42 }, raw as any), null,
      `${JSON.stringify(raw)} must not resolve`);
  }
});

test('an unauthenticated caller resolves to null without querying', async () => {
  const exploding = { DB: { prepare() { throw new Error('must not query'); } } } as any;
  assert.equal(await resolveActiveCompany(exploding, null, '3'), null);
  assert.equal(await resolveActiveCompany(exploding, { id: null }, '3'), null);
});

test('the header name is the one the client sends', () => {
  assert.equal(ACTIVE_COMPANY_HEADER, 'X-Company-Id');
});
