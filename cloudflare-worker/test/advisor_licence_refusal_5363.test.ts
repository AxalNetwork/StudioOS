/**
 * #5363 — every advisor `/me/*` route answers one coded refusal for an account
 * without the Advisor licence: 403 `advisor_licence_required`, the same body
 * `GET`/`POST /me` answer. An eligible account that owns no advisor row gets
 * 400 `advisor_profile_missing`. Who passes is D4715's policy, unchanged.
 *
 * On the migrated schema, synthetic rows only.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/advisor_licence_refusal_5363.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { d1Over } from './_d1_sqlite.mjs';
import advisors from '../src/routes/advisors.ts';

const SECRET = 'test'.repeat(16);
test.after(() => removeMigratedDatabases());

// One route of each module that goes through `requireMyAdvisor` (or, for the
// thinking shelf, its own licence check).
const ROUTES = [
  ['services', '/me/services'],
  ['proof', '/me/proof'],
  ['thinking', '/me/thinking'],
  ['engagements', '/me/engagements'],
  ['deliverables', '/me/deliverables'],
  ['money', '/me/ledger'],
] as const;

// 21 a live advisor (row 201); 22 a demoted advisor, now a founder, still
// pointing at their old row 202; 24 a founder whose additional Advisor licence
// is revoked (row 203); 25 an advisor with no row; 30 an admin with no row.
function fixture() {
  const db = migratedDatabase();
  db.exec(`
    INSERT INTO users(id,name,email,role,is_active) VALUES
      (21,'Advisor','a@example.test','advisor',1),
      (22,'Demoted','d@example.test','founder',1),
      (24,'Revoked','r@example.test','founder',1),
      (25,'Rowless','n@example.test','advisor',1),
      (30,'Admin','ad@example.test','admin',1);
    INSERT INTO advisors(id,uid,user_id,display_name,email,is_active) VALUES
      (201,'a-1',21,'Advisor','a@example.test',1),
      (202,'a-2',22,'Demoted','d@example.test',1),
      (203,'a-3',24,'Revoked','r@example.test',1);
    UPDATE users SET advisor_id = 201 WHERE id = 21;
    UPDATE users SET advisor_id = 202 WHERE id = 22;
    UPDATE users SET advisor_id = 203 WHERE id = 24;
    INSERT INTO account_licences(user_id,licence,source,revoked_at) VALUES (24,'advisor','admin',datetime('now'));
  `);
  const env: any = { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) };
  const ctx: any = { waitUntil() {}, passThroughOnException() {}, props: {} };
  const app = new Hono<any>();
  app.route('/api/advisors', advisors);
  return async (path: string, who: number) => {
    const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    const res = await app.request(`/api/advisors${path}`, { headers: { Authorization: `Bearer ${jwt}` } }, env, ctx);
    const text = await res.text();
    return { status: res.status, text, body: JSON.parse(text) as any };
  };
}

const NO_EXCEPTION_TEXT = /Error|at \w+ \(|D1_|SQLITE|undefined|\[object/;

for (const [who, id] of [['a demoted advisor', 22], ['a member whose additional Advisor licence was revoked', 24]] as const) {
  test(`${who} gets 403 advisor_licence_required on every module`, async () => {
    const call = fixture();
    for (const [mod, path] of ROUTES) {
      const r = await call(path, id);
      assert.equal(r.status, 403, `${mod} ${path}`);
      assert.equal(r.body.error, 'advisor_licence_required', `${mod} ${path}`);
      assert.equal(r.body.message, 'An advisor profile needs the Advisor licence.');
      assert.doesNotMatch(r.text, NO_EXCEPTION_TEXT, `${mod} ${path}`);
    }
  });
}

test('an eligible account with no advisor row gets advisor_profile_missing', async () => {
  const call = fixture();
  for (const [mod, path] of ROUTES) {
    if (mod === 'thinking') continue; // the shelf reads articles by author, not the advisor row
    const r = await call(path, 25);
    assert.equal(r.status, 400, `${mod} ${path}`);
    assert.equal(r.body.error, 'advisor_profile_missing', `${mod} ${path}`);
    assert.doesNotMatch(r.text, NO_EXCEPTION_TEXT, `${mod} ${path}`);
  }
});

test('a live advisor is unchanged: every module answers 200', async () => {
  const call = fixture();
  for (const [mod, path] of ROUTES) {
    const r = await call(path, 21);
    assert.equal(r.status, 200, `${mod} ${path}: ${r.text.slice(0, 200)}`);
  }
});

test('an admin is unchanged: eligible, so never the licence refusal', async () => {
  const call = fixture();
  for (const [mod, path] of ROUTES) {
    if (mod === 'thinking') continue; // licence-only before #5363 and after
    const r = await call(path, 30);
    assert.notEqual(r.body?.error, 'advisor_licence_required', `${mod} ${path}`);
    assert.equal(r.status, 400, `${mod} ${path}`);
    assert.equal(r.body.error, 'advisor_profile_missing');
  }
});
